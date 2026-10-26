import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { splitPurkinsMigrationSql } from './migration-test-sql';
import { parseLiveCopyFields } from './liveCopy';
import { applyGuardedLiveCopy, retryLiveCopyPurge } from './liveCopyGuard';

const actor = 'owner:bearer';
const product = 'prod_0123456789';
const requestId = () => crypto.randomUUID();

describe('Approved Purkins live copy updates (real isolated D1)', () => {
  let mf: Miniflare;
  let db: D1Database;
  const state = async () => db.prepare(
    'SELECT p.active,p.price_cents,p.compare_at_price_cents,p.stock,p.description,' +
    'p.mcp_catalog_revision AS revision,p.last_purkins_live_edit_nonce AS nonce,' +
    'i.status FROM products p JOIN purkins_intake i ON i.product_id=p.id WHERE p.public_id=?',
  ).bind(product).first<{
    active: number; price_cents: number; compare_at_price_cents: number | null;
    stock: number; description: string | null; revision: number;
    nonce: string | null; status: string;
  }>();

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      compatibilityDate: '2026-07-20',
      d1Databases: ['DB'],
    });
    db = await mf.getD1Database('DB');
    await db.exec('CREATE TABLE products (' +
      'id INTEGER PRIMARY KEY,public_id TEXT UNIQUE,name TEXT,slug TEXT,description TEXT,' +
      'price_cents INTEGER,currency TEXT,image_key TEXT,stock INTEGER,active INTEGER,' +
      'variant_label TEXT,weight_grams INTEGER,requires_shipping INTEGER)');
    await db.exec('CREATE TABLE product_variants (' +
      'id INTEGER PRIMARY KEY,product_id INTEGER,label TEXT,price_cents INTEGER,' +
      'stock INTEGER,active INTEGER,image_id INTEGER,weight_grams INTEGER,sku TEXT)');
    await db.exec('CREATE TABLE product_images (' +
      'id INTEGER PRIMARY KEY,product_id INTEGER,image_key TEXT,position INTEGER,alt TEXT)');
    await db.exec('CREATE TABLE purkins_intake (' +
      'product_id INTEGER PRIMARY KEY,status TEXT,condition_status TEXT,pricing_mode TEXT,' +
      'purchase_cost_minor INTEGER,purchase_currency TEXT,zar_to_zmw REAL,' +
      'overhead_zwm_cents INTEGER,markup_percent INTEGER)');
    for (const filename of [
      '0052_purkins_mcp_publication.sql',
      '0053_purkins_compare_at_price.sql',
      '0054_purkins_live_edit_receipts.sql',
    ]) {
      const sql = readFileSync(new URL('../../../migrations/' + filename, import.meta.url), 'utf8');
      for (const statement of splitPurkinsMigrationSql(sql)) {
        await db.prepare(statement).run();
      }
    }
    await db.batch([
      db.prepare('INSERT INTO products(id,public_id,name,slug,description,price_cents,' +
        'currency,image_key,stock,active,requires_shipping) ' +
        "VALUES(1,?,'TY-899','ty-899','Original copy',95000,'zmw','media/ty.png',4,1,1)")
        .bind(product),
      db.prepare('INSERT INTO purkins_intake(product_id,status,condition_status,' +
        "pricing_mode,purchase_currency) VALUES(1,'approved','complete','manual','ZMW')"),
    ]);
  }, 30000);
  afterAll(async () => { await mf?.dispose(); });

  it('validates a genuine old price and handles a blank promotion', () => {
    expect(parseLiveCopyFields('A warmer', '1100', 95000, 'zmw')).toEqual({
      data: { description: 'A warmer', compare_at_price_cents: 110000 },
    });
    expect(parseLiveCopyFields('', '', 95000, 'zmw')).toEqual({
      data: { description: null, compare_at_price_cents: null },
    });
    for (const old of ['0', '950', '900', '-1', 'nope', '1000.999', 'Infinity']) {
      expect(parseLiveCopyFields('A', old, 95000, 'zmw')).toHaveProperty('error');
    }
    expect(parseLiveCopyFields('A'.repeat(8001), '', 95000, 'zmw')).toHaveProperty('error');
  });

  it('updates only the description/compare-at amount with an atomic receipt', async () => {
    const before = await state();
    const purge = vi.fn(async () => {});
    const input = {
      product_id: product,
      request_id: requestId(),
      expected_catalog_revision: before!.revision,
      description: 'New customer-facing text',
      compare_at_price_cents: 110000,
    };
    expect(await applyGuardedLiveCopy(db, actor, input, purge)).toMatchObject({
      ok: true, cache_purged: true, replayed: true,
    });
    const after = await state();
    expect(after).toMatchObject({
      active: 1, status: 'approved', stock: 4, price_cents: 95000,
      compare_at_price_cents: 110000, description: 'New customer-facing text',
    });
    expect(after!.revision).toBeGreaterThan(before!.revision);
    expect((await db.prepare(
      'SELECT completed,cache_purged FROM purkins_live_edit_receipts WHERE request_id=?',
    ).bind(input.request_id).first())!).toMatchObject({ completed: 1, cache_purged: 1 });
    expect(await applyGuardedLiveCopy(db, actor, input, purge)).toMatchObject({
      ok: true, cache_purged: true, replayed: false,
    });
    expect(purge).toHaveBeenCalledTimes(1);
    expect(await applyGuardedLiveCopy(db, 'owner:access:other@example.com', input, purge))
      .toMatchObject({ ok: false });
    expect(await applyGuardedLiveCopy(db, actor,
      { ...input, description: 'Different attempt' }, purge))
      .toMatchObject({ ok: false });
  });

  it('rejects stale revisions and never revokes approval', async () => {
    const previous = await state();
    await db.prepare("UPDATE products SET name='Updated brand label' WHERE id=1").run();
    expect((await state())!.revision).toBeGreaterThan(previous!.revision);
    const request_id = requestId();
    const result = await applyGuardedLiveCopy(db, actor, {
      product_id: product, request_id,
      expected_catalog_revision: previous!.revision,
      description: 'Should not save', compare_at_price_cents: null,
    }, vi.fn());
    expect(result).toMatchObject({ ok: false });
    expect(await state()).toMatchObject({ active: 1, status: 'approved', stock: 4 });
    expect((await db.prepare('SELECT COUNT(*) AS n FROM purkins_live_edit_receipts WHERE request_id=?')
      .bind(request_id).first<{ n: number }>())?.n).toBe(0);
  });

  it('does not mutate a product when cross-Worker cache refresh is unconfigured', async () => {
    const before = await state();
    const result = await applyGuardedLiveCopy(db, actor, {
      product_id: product, request_id: requestId(),
      expected_catalog_revision: before!.revision,
      description: 'No purge configured', compare_at_price_cents: null,
    }, null);
    expect(result).toMatchObject({ ok: false });
    expect(await state()).toEqual(before);
  });

  it('retries a failed public cache purge WITHOUT repeating the DB edit', async () => {
    const before = await state();
    const request_id = requestId();
    const input = {
      product_id: product, request_id,
      expected_catalog_revision: before!.revision,
      description: 'Saved despite a cache outage',
      compare_at_price_cents: 115000,
    };
    const purge = vi.fn().mockRejectedValueOnce(new Error('cache unavailable'))
      .mockResolvedValue(undefined);
    const first = await applyGuardedLiveCopy(db, actor, input, purge);
    expect(first).toMatchObject({ ok: true, cache_purged: false });
    const after = await state();
    expect(after).toMatchObject({ active: 1, status: 'approved',
      description: 'Saved despite a cache outage', price_cents: 95000 });
    const replay = await retryLiveCopyPurge(db, actor, request_id, product, purge);
    expect(replay).toMatchObject({ ok: true, cache_purged: true, replayed: true });
    expect(await state()).toEqual(after);
    expect(purge).toHaveBeenCalledTimes(2);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM purkins_live_edit_receipts WHERE request_id=?')
      .bind(request_id).first<{ n: number }>())?.n).toBe(1);
  });

  it('refuses edits to an unpublished draft or incomplete condition item', async () => {
    await db.prepare("UPDATE purkins_intake SET status='draft' WHERE product_id=1").run();
    const rev = (await state())!.revision;
    const r = await applyGuardedLiveCopy(db, actor, {
      product_id: product, request_id: requestId(), expected_catalog_revision: rev,
      description: 'Must reject', compare_at_price_cents: null,
    }, vi.fn());
    expect(r).toMatchObject({ ok: false });
    await db.prepare("UPDATE purkins_intake SET status='approved',condition_status='complete' WHERE product_id=1").run();
  });
});
