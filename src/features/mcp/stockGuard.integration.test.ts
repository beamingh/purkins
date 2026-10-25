import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { readFileSync } from 'node:fs';
import { splitPurkinsMigrationSql } from '../purkins/migration-test-sql';
import { getProductByPublicId } from '../products/db';
import { getIntake } from '../purkins/db';
import { parseIntakeFields } from '../purkins/intake';
import {
  createGuardedStockDraft, adjustGuardedDraftStock, type StockDraftInput,
} from './stockGuard';

const actor = 'owner:client:8da8ea6f-6d5f-4391-8cce-21312f76ca01';
const uuid = () => crypto.randomUUID();
const form = new FormData();
form.set('pricing_mode', 'manual');
form.set('condition_status', 'review');
const parsed = parseIntakeFields(form);
if ('error' in parsed) throw Error(parsed.error);
const intake = parsed.data;
const draft = (name: string, request_id = uuid()): StockDraftInput => ({
  request_id, name, description: null, price_cents: 95000, stock: 5,
  location_id: null, intake,
});

describe('Private MCP stock writes against real isolated D1', () => {
  let mf: Miniflare;
  let db: D1Database;

  async function migrate(name: string) {
    const raw = readFileSync(new URL('../../../migrations/' + name, import.meta.url), 'utf8');
    for (const sql of splitPurkinsMigrationSql(raw)) await db.prepare(sql).run();
  }

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
      compatibilityDate: '2026-07-20',
      d1Databases: ['DB'],
    });
    db = await mf.getD1Database('DB');
    await db.exec(
      'CREATE TABLE products (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT UNIQUE, name TEXT NOT NULL,' +
      'slug TEXT NOT NULL UNIQUE, description TEXT,price_cents INTEGER NOT NULL,' +
      'currency TEXT NOT NULL,image_key TEXT,stock INTEGER NOT NULL,' +
      'active INTEGER NOT NULL,weight_grams INTEGER,requires_shipping INTEGER NOT NULL)',
    );
    await db.exec(
      'CREATE TABLE product_variants (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT,public_id TEXT UNIQUE,product_id INTEGER NOT NULL,' +
      'label TEXT NOT NULL,price_cents INTEGER NOT NULL,stock INTEGER NOT NULL,' +
      'active INTEGER NOT NULL DEFAULT 1)',
    );
    for (const name of [
      '0040_purkins_intake.sql','0041_purkins_cataloguing.sql',
      '0042_purkins_manual_pricing.sql','0043_purkins_location_tree.sql',
      '0045_purkins_mcp_write_guard.sql','0046_purkins_mcp_stock_guard.sql',
    ]) await migrate(name);
  }, 30_000);
  afterAll(async () => { await mf?.dispose(); });

  it('creates a private draft and intake in one batch, then replays without duplication', async () => {
    const key=uuid(), input=draft('Safe Draft Bottle Warmer',key);
    const result=await createGuardedStockDraft(db,actor,input);
    expect(result).toMatchObject({ok:true,stock:5,revision:0,replayed:false});
    if(!result.ok) return;
    const product=await getProductByPublicId(db,result.id);
    expect(product).toMatchObject({active:0,stock:5,price_cents:95000,currency:'zmw'});
    expect((await getIntake(db,product!.id))?.status).toBe('draft');
    const receipt=await db.prepare(
      'SELECT action,actor,outcome,after_stock,payload_sha256 FROM purkins_mcp_stock_mutations WHERE request_id=?',
    ).bind(key).first<{action:string;actor:string;outcome:string;after_stock:number;payload_sha256:string}>();
    expect(receipt).toMatchObject({action:'product.create_draft',actor,outcome:'applied',after_stock:5});
    expect(receipt?.payload_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await createGuardedStockDraft(db,actor,input))
      .toMatchObject({ok:true,id:result.id,stock:5,replayed:true});
    const count=await db.prepare('SELECT count(*) AS n FROM products WHERE public_id=?')
      .bind(result.id).first<{n:number}>();
    expect(count?.n).toBe(1);
  });

  it('denies reuse of a request ID with a changed payload or owner actor', async () => {
    const key=uuid(),input=draft('Safe Draft New Bibs',key);
    expect((await createGuardedStockDraft(db,actor,input)).ok).toBe(true);
    expect(await createGuardedStockDraft(db,actor,{...input,stock:6}))
      .toMatchObject({ok:false,conflict:true});
    expect(await createGuardedStockDraft(db,'owner:bearer',input))
      .toMatchObject({ok:false,conflict:true});
  });

  it('rejects a duplicate slug and nonexistent location without orphaning an intake', async () => {
    const first=await createGuardedStockDraft(db,actor,draft('Safe Draft Receiver Towel'));
    expect(first.ok).toBe(true);
    expect(await createGuardedStockDraft(db,actor,draft('Safe Draft Receiver Towel')))
      .toMatchObject({ok:false,conflict:true});
    const bogus={...draft('Safe Draft Missing Sack'),location_id:'loc_0123456789abcdef01234567'};
    const attempt=await createGuardedStockDraft(db,actor,bogus);
    expect(attempt).toMatchObject({ok:false,conflict:true});
    const row=await db.prepare('SELECT id FROM products WHERE slug=?').bind('safe-draft-missing-sack').first();
    expect(row).toBeNull();
  });

  it('only adjusts a draft when its counted stock AND revision match', async () => {
    const created=await createGuardedStockDraft(db,actor,draft('Safe Draft Cotton Set'));
    if(!created.ok) throw Error('fixture create failed');
    const key=uuid(), args={
      request_id:key, product_id:created.id,variant_id:null,
      expected_stock:5,expected_revision:0,new_stock:4,
    };
    expect(await adjustGuardedDraftStock(db,actor,args))
      .toMatchObject({ok:true,stock:4,revision:1,replayed:false});
    expect(await adjustGuardedDraftStock(db,actor,args))
      .toMatchObject({ok:true,stock:4,revision:1,replayed:true});
    const current=await getProductByPublicId(db,created.id);
    expect(current?.stock).toBe(4);
    const row=await db.prepare('SELECT mcp_stock_revision FROM products WHERE public_id=?')
      .bind(created.id).first<{mcp_stock_revision:number}>();
    expect(row?.mcp_stock_revision).toBe(1);
    // Admin/sales writes bypass this service but MUST increment the trigger.
    await db.prepare('UPDATE products SET stock=5 WHERE public_id=?').bind(created.id).run();
    const updated=await db.prepare('SELECT mcp_stock_revision FROM products WHERE public_id=?')
      .bind(created.id).first<{mcp_stock_revision:number}>();
    expect(updated?.mcp_stock_revision).toBe(2);
    const stale=await adjustGuardedDraftStock(db,actor,{
      ...args,request_id:uuid(),expected_stock:5,expected_revision:0,new_stock:3,
    });
    expect(stale).toMatchObject({ok:false,conflict:true});
    expect((await getProductByPublicId(db,created.id))?.stock).toBe(5);
  });

  it('rejects stock edits to published products', async () => {
    const created=await createGuardedStockDraft(db,actor,draft('Safe Draft Publish Gate'));
    if(!created.ok) throw Error('fixture create failed');
    const row=await getProductByPublicId(db,created.id);
    await db.prepare('UPDATE products SET active=1 WHERE id=?').bind(row!.id).run();
    const denied=await adjustGuardedDraftStock(db,actor,{
      request_id:uuid(),product_id:created.id,variant_id:null,
      expected_stock:5,expected_revision:0,new_stock:4,
    });
    expect(denied).toMatchObject({ok:false,conflict:true});
    expect((await getProductByPublicId(db,created.id))?.stock).toBe(5);
  });

  it('adjusts an existing variant without modifying the parent stock and tracks third-party edits', async () => {
    const created=await createGuardedStockDraft(db,actor,draft('Safe Draft Two Sizes'));
    if(!created.ok) throw Error('fixture create failed');
    const row=await getProductByPublicId(db,created.id);
    const variantId='var_0123456789';
    await db.prepare(
      'INSERT INTO product_variants (product_id,public_id,label,price_cents,stock,active) VALUES (?,?,?,?,?,1)',
    ).bind(row!.id,variantId,'0–3 months',95000,3).run();
    const result=await adjustGuardedDraftStock(db,actor,{
      request_id:uuid(),product_id:created.id,variant_id:variantId,
      expected_stock:3,expected_revision:0,new_stock:2,
    });
    expect(result).toMatchObject({ok:true,id:variantId,stock:2,revision:1});
    const variant=await db.prepare('SELECT stock,mcp_stock_revision FROM product_variants WHERE public_id=?')
      .bind(variantId).first<{stock:number;mcp_stock_revision:number}>();
    expect(variant).toMatchObject({stock:2,mcp_stock_revision:1});
    expect((await getProductByPublicId(db,created.id))?.stock).toBe(5);
    const another=await createGuardedStockDraft(db,actor,draft('Safe Draft Wrong Parent'));
    if(!another.ok) throw Error('fixture create failed');
    expect(await adjustGuardedDraftStock(db,actor,{
      request_id:uuid(),product_id:another.id,variant_id:variantId,
      expected_stock:2,expected_revision:1,new_stock:1,
    })).toMatchObject({ok:false,conflict:true});
  });

  it('never accepts a stock edit as an implicit sale or approval', async () => {
    const created=await createGuardedStockDraft(db,actor,draft('Safe Draft Test Inventory'));
    if(!created.ok) throw Error('fixture create failed');
    expect(await adjustGuardedDraftStock(db,actor,{
      request_id:uuid(),product_id:created.id,variant_id:null,
      expected_stock:5,expected_revision:0,new_stock:0,
    })).toMatchObject({ok:true,stock:0});
    const row=await getProductByPublicId(db,created.id);
    expect(row?.active).toBe(0);
    expect((await getIntake(db,row!.id))?.status).toBe('draft');
  });
});
