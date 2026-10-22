import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { createProduct, getProduct, listProducts, updateProduct } from '../products/db';
import { parseProductForm } from '../products/form';
import { reserveInventory, getActiveReservationItems } from '../orders/reservations';
import { recordPaidOrder } from '../orders/db';
import { parseIntakeFields, generateItemSku } from './intake';
import { approveIntake, getIntake, insertIntake, saveIntakeDraft, getVariantSupplierBarcodes, setVariantSupplierBarcode } from './db';

/* Isolated in-memory D1; no Wrangler state, remote D1, or real payments.
 * Executes the actual Purkins migration plus Minshop product/order functions.
 */
describe('Purkins stock intake through demo settlement', () => {
  let mf: Miniflare;
  let db: D1Database;

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
      compatibilityDate: '2026-07-20',
      d1Databases: ['DB'],
    });
    db = await mf.getD1Database('DB');
    const schema = [
      "CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT UNIQUE, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT, price_cents INTEGER NOT NULL, currency TEXT NOT NULL, image_key TEXT, stock INTEGER NOT NULL, active INTEGER NOT NULL, variant_label TEXT, weight_grams INTEGER, requires_shipping INTEGER NOT NULL, file_key TEXT, file_name TEXT, file_mime TEXT, file_size_bytes INTEGER, created_at TEXT DEFAULT (datetime('now')))",
      "CREATE TABLE product_variants (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, label TEXT NOT NULL, price_cents INTEGER NOT NULL, stock INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1)",
      "CREATE TABLE checkout_reservations (public_id TEXT PRIMARY KEY, items TEXT NOT NULL, payment_method TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', expires_at TEXT NOT NULL, terminal_at TEXT, created_at TEXT DEFAULT (datetime('now')))",
      "CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, provider_session_id TEXT NOT NULL UNIQUE, public_id TEXT NOT NULL UNIQUE, email TEXT, amount_total_cents INTEGER NOT NULL, shipping_cents INTEGER NOT NULL DEFAULT 0, shipping_label TEXT, shipping_weight_grams INTEGER, delivery_method TEXT, discount_cents INTEGER NOT NULL DEFAULT 0, tax_cents INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL, ship_address TEXT, status TEXT NOT NULL, payment_method TEXT, settlement_token TEXT, provider_payment_id TEXT)",
      "CREATE TABLE order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_id INTEGER, variant_id INTEGER, name TEXT NOT NULL, price_cents INTEGER NOT NULL, quantity INTEGER NOT NULL, public_id TEXT UNIQUE, file_key TEXT, file_name TEXT, file_mime TEXT, file_size_bytes INTEGER, downloads INTEGER NOT NULL DEFAULT 0)",
      "CREATE TABLE order_item_ids (public_id TEXT PRIMARY KEY, order_public_id TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))",
      "CREATE TABLE order_inventory_exceptions (id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT UNIQUE, order_id INTEGER, product_id INTEGER, variant_id INTEGER, requested_qty INTEGER, consumed_qty INTEGER, shortfall_qty INTEGER, resolved_at TEXT, created_at TEXT DEFAULT (datetime('now')))",
      "CREATE TABLE order_notifications (order_id INTEGER NOT NULL, kind TEXT NOT NULL, state TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0, lease_expires_at TEXT, last_error TEXT, created_at TEXT DEFAULT (datetime('now')), sent_at TEXT, PRIMARY KEY (order_id, kind))",
      "CREATE TABLE pending_payments (payment_hash TEXT PRIMARY KEY, status TEXT DEFAULT 'pending')",
    ];
    for (const sql of schema) await db.exec(sql);
    // D1's exec() treats comment-only fragments as empty statements. Run each
    // real statement separately so the migration is exercised unchanged.
    for (const name of ['0040_purkins_intake.sql', '0041_purkins_cataloguing.sql']) {
      const migrationSql = readFileSync(new URL('../../../migrations/' + name, import.meta.url), 'utf8');
      const statements = migrationSql
        .replace(/^\s*--.*$/gm, '')
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean);
      for (const statement of statements) await db.prepare(statement).run();
    }
  }, 30_000);

  afterAll(async () => { await mf?.dispose(); });

  const form = (fields: Record<string, string>): FormData => {
    const f = new FormData();
    for (const [key, value] of Object.entries(fields)) f.set(key, value);
    return f;
  };

  async function createDraft(name: string, stock = 2) {
    const product = parseProductForm(form({
      name, price: '150', stock: String(stock), currency: 'ZMW',
      active: 'on', requires_shipping: 'on',
    }));
    if (!('data' in product)) throw new Error(product.error);
    const intake = parseIntakeFields(form({
      size_label: '6-9 months', colour: 'Cream', age_range: '6-9 months',
      storage_location: 'Sack A', purchase_currency: 'ZMW',
      purchase_cost: '100', overhead_zwm: '10', markup_percent: '40',
    }));
    if (!('data' in intake)) throw new Error(intake.error);
    // The API forces inactive regardless of forged active checkbox.
    const id = await createProduct(db, {
      ...product.data, active: 0, slug: name.toLowerCase().replaceAll(' ', '-'), image_key: null,
    });
    await insertIntake(db, id, intake.data);
    return { id, fields: intake.data };
  }

  const stock = async (id: number) =>
    (await db.prepare('SELECT stock FROM products WHERE id=?').bind(id).first<{ stock: number }>())?.stock;
  const item = (id: number, qty = 1, variantId?: number) =>
    ({ productId: id, variantId, name: 'Purkins test romper', priceCents: 15000, quantity: qty });

  it('records each size barcode privately and blocks an incomplete pack from publication', async () => {
    const { id } = await createDraft('Tagged Incomplete Pack');
    const variant = await db.prepare(
      "INSERT INTO product_variants (product_id, label, price_cents, stock, active) VALUES (?, '3-6m', 15000, 2, 1) RETURNING id",
    ).bind(id).first<{ id: number }>();
    if (!variant) throw new Error('Variant missing');
    await setVariantSupplierBarcode(db, variant.id, '000111992810002');
    expect((await getVariantSupplierBarcodes(db, id)).get(variant.id)).toBe('000111992810002');
    await db.prepare("UPDATE products SET image_key='media/fake-test.webp' WHERE id=?").bind(id).run();
    await db.prepare("UPDATE purkins_intake SET condition_status='incomplete', retail_tag_minor=6999 WHERE product_id=?").bind(id).run();
    expect((await getIntake(db, id))?.retail_tag_minor).toBe(6999);
    expect(await approveIntake(db, id)).toMatch(/Review incomplete/);
    expect((await db.prepare('SELECT active FROM products WHERE id=?').bind(id).first<{active:number}>())?.active).toBe(0);
  });

  it('saves a coded draft, hides it from public results, and rejects stock reservation', async () => {
    const { id } = await createDraft('Private Cream Romper');
    expect(await getIntake(db, id)).toMatchObject({
      sku: generateItemSku(id), status: 'draft', size_label: '6-9 months',
      storage_location: 'Sack A', purchase_cost_minor: 10000, overhead_zwm_cents: 1000,
    });
    expect((await listProducts(db, 100)).some((p) => p.id === id)).toBe(false);
    expect(await reserveInventory(db, crypto.randomUUID(), [item(id)], 600, 'demo')).toBe(false);
    expect(await stock(id)).toBe(2);
    expect(await getProduct(db, id)).not.toHaveProperty('purchase_cost_minor');
    expect(await getProduct(db, id)).not.toHaveProperty('storage_location');
  });

  it('blocks under-cost/no-photo publication; revokes approval on edit', async () => {
    const { id, fields } = await createDraft('Yellow Test Romper');
    await db.prepare('UPDATE products SET price_cents=10500 WHERE id=?').bind(id).run();
    expect(await approveIntake(db, id)).toMatch(/below.*landed cost/);
    await db.prepare('UPDATE products SET price_cents=15000 WHERE id=?').bind(id).run();
    expect(await approveIntake(db, id)).toMatch(/photograph/);
    // Simulate successfully promoted gallery image; R2 upload itself is not tested here.
    await db.prepare("UPDATE products SET image_key='media/fake-test.webp' WHERE id=?").bind(id).run();
    expect(await approveIntake(db, id)).toBeNull();
    expect((await listProducts(db, 100)).some((p) => p.id === id)).toBe(true);

    const original = await getProduct(db, id);
    if (!original) throw new Error('Missing product');
    await updateProduct(db, id, {
      name: original.name, slug: original.slug, description: original.description,
      price_cents: original.price_cents, currency: original.currency,
      image_key: original.image_key, stock: original.stock,
      active: 0, weight_grams: original.weight_grams,
      requires_shipping: original.requires_shipping,
    });
    await saveIntakeDraft(db, id, { ...fields, colour: 'Yellow' });
    expect((await getIntake(db, id))?.status).toBe('draft');
    expect((await listProducts(db, 100)).some((p) => p.id === id)).toBe(false);
    expect(await reserveInventory(db, crypto.randomUUID(), [item(id)], 600, 'demo')).toBe(false);
    expect(await approveIntake(db, id)).toBeNull();
  });

  it('blocks below-cost variants and variants belonging to unpublished parents', async () => {
    const { id } = await createDraft('Variant Test Romper');
    const variant = await db.prepare(
      "INSERT INTO product_variants (product_id, label, price_cents, stock, active) VALUES (?, 'size 1', 9000, 2, 1) RETURNING id",
    ).bind(id).first<{ id: number }>();
    if (!variant) throw new Error('Variant missing');
    expect(await reserveInventory(db, crypto.randomUUID(), [item(id, 1, variant.id)], 600, 'demo')).toBe(false);
    await db.prepare("UPDATE products SET image_key='media/fake-variant.webp' WHERE id=?").bind(id).run();
    expect(await approveIntake(db, id)).toMatch(/variant price.*below/);
    await db.prepare('UPDATE product_variants SET price_cents=15000 WHERE id=?').bind(variant.id).run();
    expect(await approveIntake(db, id)).toBeNull();
  });

  it('reserves demo stock once, records a paid demo order, and is idempotent', async () => {
    const { id } = await createDraft('Sold Test Romper', 2);
    await db.prepare("UPDATE products SET image_key='media/fake-sale.webp' WHERE id=?").bind(id).run();
    expect(await approveIntake(db, id)).toBeNull();
    const reservationId = crypto.randomUUID();
    expect(await reserveInventory(db, reservationId, [item(id, 2)], 600, 'demo')).toBe(true);
    expect(await stock(id)).toBe(0);
    expect(await reserveInventory(db, crypto.randomUUID(), [item(id)], 600, 'demo')).toBe(false);
    const snapshot = await getActiveReservationItems(db, reservationId);
    expect(snapshot).toHaveLength(1);
    const payment = {
      providerSessionId: 'test-demo-' + reservationId,
      publicId: reservationId, reservationId,
      email: 'test@example.invalid', amountTotalCents: 30000, currency: 'zmw',
      paymentMethod: 'demo' as const, items: snapshot!,
    };
    expect(await recordPaidOrder(db, payment)).toBeGreaterThan(0);
    expect(await stock(id)).toBe(0);
    expect(await recordPaidOrder(db, payment)).toBeNull();
    expect(await stock(id)).toBe(0);
    expect((await db.prepare('SELECT status FROM checkout_reservations WHERE public_id=?')
      .bind(reservationId).first<{ status: string }>())?.status).toBe('settled');
    const rows = await db.prepare('SELECT quantity, price_cents FROM order_items WHERE product_id=?')
      .bind(id).all<{ quantity: number; price_cents: number }>();
    expect(rows.results).toEqual([{ quantity: 2, price_cents: 15000 }]);
  });
});
