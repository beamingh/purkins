import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { recordManualSale } from '../../src/features/purkins/manualSaleDb.ts';

const mf = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("ok") } }',
  compatibilityDate: '2026-07-20',
  d1Databases: ['DB'],
});
try {
  const db = await mf.getD1Database('DB');
  for (const sql of [
    'CREATE TABLE products (id INTEGER PRIMARY KEY, public_id TEXT UNIQUE, name TEXT, currency TEXT, stock INTEGER, active INTEGER)',
    'CREATE TABLE product_variants (id INTEGER PRIMARY KEY, public_id TEXT UNIQUE, product_id INTEGER, label TEXT, price_cents INTEGER, stock INTEGER, active INTEGER, position INTEGER)',
    "CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, provider_session_id TEXT UNIQUE, public_id TEXT UNIQUE, email TEXT, amount_total_cents INTEGER, currency TEXT, status TEXT, payment_method TEXT, settlement_token TEXT, fulfillment_status TEXT, fulfilled_at TEXT, delivery_method TEXT, created_at TEXT DEFAULT (datetime('now')))",
    'CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INTEGER, product_id INTEGER, variant_id INTEGER, name TEXT, price_cents INTEGER, quantity INTEGER, public_id TEXT UNIQUE)',
    'CREATE TABLE order_item_ids (public_id TEXT PRIMARY KEY, order_public_id TEXT)',
    "CREATE TABLE purkins_manual_sales (order_id INTEGER PRIMARY KEY REFERENCES orders(id), channel TEXT NOT NULL CHECK (channel IN ('walk_in','whatsapp','facebook','phone','other')), tender TEXT NOT NULL, customer_name TEXT, note TEXT, recorded_by TEXT)",
    "INSERT INTO products VALUES (1,'prod_0123456789','Double Bottle Warmer','zmw',2,0)",
    "INSERT INTO products VALUES (2,'prod_abcdf01234','Clothing Set','zmw',10,0)",
    "INSERT INTO product_variants VALUES (11,'var_0123456789',2,'3-6 months',12000,3,0,1)",
  ]) await db.exec(sql);

  const sample = {
    idempotencyKey: '6fb06f65-692c-4ceb-a061-5fc82c531288',
    channel: 'whatsapp',
    tender: 'airtel_money',
    customerName: null,
    email: null,
    note: 'Paid on collection',
    fulfillment: 'fulfilled',
    items: [
      { productPublicId: 'prod_0123456789', variantPublicId: null, quantity: 1, unitPriceCents: 95000 },
      { productPublicId: 'prod_abcdf01234', variantPublicId: 'var_0123456789', quantity: 2, unitPriceCents: 12000 },
    ],
  };

  const first = await recordManualSale(db, sample, 'zmw', 'test-operator');
  assert.equal(first.ok, true);
  assert.equal(first.alreadyRecorded, false);
  const order = await db.prepare('SELECT * FROM orders').first();
  assert.equal(order.status, 'paid');
  assert.equal(order.amount_total_cents, 119000);
  assert.equal(order.email, null);
  assert.equal(order.payment_method, 'airtel_money');
  assert.equal(order.fulfillment_status, 'fulfilled');
  const lines = await db.prepare('SELECT * FROM order_items ORDER BY id').all();
  assert.equal(lines.results.length, 2);
  assert.deepEqual(lines.results.map(r => r.quantity), [1, 2]);
  assert.equal((await db.prepare('SELECT stock FROM products WHERE id=1').first()).stock, 1);
  assert.equal((await db.prepare('SELECT stock FROM product_variants WHERE id=11').first()).stock, 1);
  const metadata = await db.prepare('SELECT * FROM purkins_manual_sales').first();
  assert.equal(metadata.channel, 'whatsapp');
  assert.equal(metadata.tender, 'airtel_money');
  assert.equal(metadata.recorded_by, 'test-operator');

  const again = await recordManualSale(db, sample, 'zmw', 'test-operator');
  assert.deepEqual(again, { ok: true, orderPublicId: first.orderPublicId, alreadyRecorded: true });
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM orders').first()).n, 1);
  assert.equal((await db.prepare('SELECT stock FROM products WHERE id=1').first()).stock, 1);

  // Two lines targeting the same single remaining stock unit must NOT oversell.
  const insufficient = await recordManualSale(db, {
    ...sample,
    idempotencyKey: '1e8a6ea0-12b5-4e03-a55d-75bd0d9b8304',
    email: 'buyer@example.com',
    items: [
      { productPublicId: 'prod_0123456789', variantPublicId: null, quantity: 1, unitPriceCents: 90000 },
      { productPublicId: 'prod_0123456789', variantPublicId: null, quantity: 1, unitPriceCents: 90000 },
    ],
  }, 'zmw', 'test-operator');
  assert.equal(insufficient.ok, false);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM orders').first()).n, 1);
  assert.equal((await db.prepare('SELECT stock FROM products WHERE id=1').first()).stock, 1);

  // On a metadata constraint error D1.batch rolls back the sale and its stock.
  await assert.rejects(recordManualSale(db, {
    ...sample,
    channel: 'invalid',
    idempotencyKey: '238febc5-b0f6-4e3a-b816-60fda1b45adf',
    items: [{ productPublicId: 'prod_0123456789', variantPublicId: null, quantity: 1, unitPriceCents: 95000 }],
  }, 'zmw', 'test-operator'));
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM orders').first()).n, 1);
  assert.equal((await db.prepare('SELECT stock FROM products WHERE id=1').first()).stock, 1);

  console.log('Purkins manual sales: multi-item, optional customer, idempotency, stock and rollback passed.');
} finally {
  await mf.dispose();
}
