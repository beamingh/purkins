import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { splitPurkinsMigrationSql } from './migration-test-sql';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { getIntake } from './db';
import { listLocationTree } from './locations';

/** Backward-compat migration test on an isolated real SQLite-backed D1. */
describe('Purkins location migration 0043', () => {
  let mf: Miniflare;
  let db: D1Database;

  async function apply(name: string) {
    const raw = readFileSync(new URL('../../../migrations/' + name, import.meta.url), 'utf8');
    // Execute each prepared statement separately, keeping the entire
    // CREATE TRIGGER ... BEGIN ... END block together.
    for (const sql of splitPurkinsMigrationSql(raw)) {
      await db.prepare(sql).run();
    }
  }

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
      compatibilityDate: '2026-07-20',
      d1Databases: ['DB'],
    });
    db = await mf.getD1Database('DB');
    await db.exec('CREATE TABLE products (id INTEGER PRIMARY KEY)');
    await db.exec('CREATE TABLE product_variants (id INTEGER PRIMARY KEY)');
    for (const name of ['0040_purkins_intake.sql', '0041_purkins_cataloguing.sql', '0042_purkins_manual_pricing.sql']) {
      await apply(name);
    }
    await db.exec('INSERT INTO products(id) VALUES (1),(2),(3)');
    await db.prepare(
      'INSERT INTO purkins_intake (product_id, sku, storage_location) VALUES (?,?,?)',
    ).bind(1, 'PUR-000001', 'Grey Sack / Blue PEP Bag').run();
    await db.prepare(
      'INSERT INTO purkins_intake (product_id, sku, storage_location) VALUES (?,?,?)',
    ).bind(2, 'PUR-000002', 'grey sack / blue pep bag').run();
    await db.prepare(
      'INSERT INTO purkins_intake (product_id, sku, storage_location) VALUES (?,?,?)',
    ).bind(3, 'PUR-000003', 'White Bag A').run();
    await apply('0043_purkins_location_tree.sql');
  });

  afterAll(async () => { await mf?.dispose(); });

  it('preserves legacy text locations as distinct root nodes without guessing slash-delimited parents', async () => {
    const roots = await listLocationTree(db);
    expect(roots).toHaveLength(2);
    expect(roots.every((loc) => loc.parent_id === null)).toBe(true);
    const first = await getIntake(db, 1);
    const duplicate = await getIntake(db, 2);
    expect(first?.location_id).toBeTruthy();
    expect(duplicate?.location_id).toBe(first?.location_id);
    expect(first?.storage_location?.toLowerCase()).toBe('grey sack / blue pep bag');
    expect((await getIntake(db, 3))?.storage_location).toBe('White Bag A');
  });

  it('stores no private location fields on customer product records', async () => {
    const row = await db.prepare('SELECT * FROM products WHERE id=1').first<Record<string, unknown>>();
    expect(row).not.toHaveProperty('location_id');
    expect(row).not.toHaveProperty('storage_location');
  });
});
