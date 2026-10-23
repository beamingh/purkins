import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { splitPurkinsMigrationSql } from './migration-test-sql';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { createProduct, getProduct, listProducts, updateProduct } from '../products/db';
import { parseProductForm } from '../products/form';
import { reserveInventory, getActiveReservationItems } from '../orders/reservations';
import { recordPaidOrder } from '../orders/db';
import { parseIntakeFields, generateItemSku } from './intake';
import { approveIntake, getIntake, getIntakesForProducts, insertIntake, saveIntakeDraft, getVariantSupplierBarcodes, setVariantSupplierBarcode, listStorageLocations } from './db';
import { createLocation, moveLocation, assignIntakeLocation, listLocationTree, locationFromForm } from './locations';

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
    for (const name of ['0040_purkins_intake.sql', '0041_purkins_cataloguing.sql', '0042_purkins_manual_pricing.sql', '0043_purkins_location_tree.sql']) {
      const migrationSql = readFileSync(new URL('../../../migrations/' + name, import.meta.url), 'utf8');
      // D1 test adapter executes one statement at a time. Keep the CREATE
      // TRIGGER block (with its internal semicolon) as a single statement.
      for (const statement of splitPurkinsMigrationSql(migrationSql)) {
        await db.prepare(statement).run();
      }
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

  it('supports manual selling prices without purchase cost, while keeping drafts private until approval', async () => {
    const { id, fields } = await createDraft('Manual Price Cream Babygrow');
    const manuallyPriced = { ...fields, pricing_mode: 'manual' as const,
      purchase_cost_minor: null, zar_to_zmw: null, markup_percent: null,
      overhead_zwm_cents: 0, condition_status: 'complete' as const,
    };
    await saveIntakeDraft(db, id, manuallyPriced);
    expect((await getIntake(db, id))?.pricing_mode).toBe('manual');
    expect((await getIntake(db, id))?.purchase_cost_minor).toBeNull();
    expect((await listProducts(db, 100)).some((p) => p.id === id)).toBe(false);
    expect(await approveIntake(db, id)).toMatch(/photograph/);
    await db.prepare("UPDATE products SET image_key='media/manual.webp' WHERE id=?").bind(id).run();
    expect(await approveIntake(db, id)).toBeNull();
    expect((await listProducts(db, 100)).some((p) => p.id === id)).toBe(true);
  });

  it('keeps cost-based approval blocked when cost is missing and protects manual known costs', async () => {
    const { id, fields } = await createDraft('Mixed Price Safety Romper');
    await db.prepare("UPDATE products SET image_key='media/safety.webp' WHERE id=?").bind(id).run();
    await saveIntakeDraft(db, id, { ...fields, purchase_cost_minor: null });
    expect(await approveIntake(db, id)).toMatch(/purchase cost/);
    await saveIntakeDraft(db, id, { ...fields, pricing_mode: 'manual', purchase_cost_minor: 16000 });
    expect(await approveIntake(db, id)).toMatch(/below the estimated landed cost/);
    await saveIntakeDraft(db, id, { ...fields, pricing_mode: 'manual', purchase_cost_minor: null,
      condition_status: 'review' });
    expect(await approveIntake(db, id)).toMatch(/incomplete or unchecked/);
  });

  it('rejects zero-priced active size variants even with manual pricing and unknown costs', async () => {
    const { id, fields } = await createDraft('Manual Variant Price Romper');
    await saveIntakeDraft(db, id, { ...fields, pricing_mode: 'manual', purchase_cost_minor: null });
    await db.prepare("UPDATE products SET image_key='media/manual-size.webp' WHERE id=?").bind(id).run();
    await db.prepare(
      "INSERT INTO product_variants (product_id, label, price_cents, stock, active) VALUES (?, '3-6m', 0, 1, 1)",
    ).bind(id).run();
    expect(await approveIntake(db, id)).toMatch(/positive selling price for every active/);
    await db.prepare("UPDATE product_variants SET price_cents=14500 WHERE product_id=?").bind(id).run();
    expect(await approveIntake(db, id)).toBeNull();
  });

  it('moves a containing sack and dynamically resolves the child bag path for stock', async () => {
    const house = await createLocation(db, 'House', 'site', null);
    const room = await createLocation(db, 'Bedroom', 'room', house);
    const storeroom = await createLocation(db, 'Storeroom', 'room', house);
    const sack = await createLocation(db, 'Grey Sack', 'sack', room);
    const bag = await createLocation(db, 'Blue PEP Bag', 'bag', sack);
    const { id } = await createDraft('Tree-Test Bibs');
    await assignIntakeLocation(db, id, bag);
    const before = await getIntake(db, id);
    expect(before?.location_id).toBe(bag);
    expect(before?.storage_location).toBe('House / Bedroom / Grey Sack / Blue PEP Bag');
    await moveLocation(db, sack, storeroom);
    const after = await getIntake(db, id);
    expect(after?.location_id).toBe(bag);
    expect(after?.storage_location).toBe('House / Storeroom / Grey Sack / Blue PEP Bag');
    expect((await getIntakesForProducts(db, [id])).get(id)?.storage_location)
      .toBe('House / Storeroom / Grey Sack / Blue PEP Bag');
    expect((await getProduct(db, id))).not.toHaveProperty('location_id');
    expect((await listLocationTree(db)).find((l) => l.id === bag)?.depth).toBe(3);
  });

  it('creates child stock locations directly from Admin form inputs', async () => {
    const sack = await createLocation(db, 'Intake Form Sack', 'sack', null);
    const form = new FormData();
    form.set('location_id', '');
    form.set('storage_location_new', 'New Blue Bag');
    form.set('storage_location_parent_id', sack);
    form.set('storage_location_kind', 'bag');
    const id = await locationFromForm(db, form);
    expect(id).toMatch(/^loc_[0-9a-f]{24}$/);
    const bag = (await listLocationTree(db)).find((l) => l.id === id);
    expect(bag).toMatchObject({ parent_id: sack, kind: 'bag', path: 'Intake Form Sack / New Blue Bag' });
    const form2 = new FormData();
    form2.set('location_id', id!);
    expect(await locationFromForm(db, form2)).toBe(id);
    form2.set('location_id', 'loc_000000000000000000000000');
    await expect(locationFromForm(db, form2)).rejects.toThrow(/does not exist/);
  });

  it('prevents cycles, self-parenting and case-insensitive duplicate siblings', async () => {
    const top = await createLocation(db, 'Cycle Root', 'room', null);
    const sack = await createLocation(db, 'Cycle Sack', 'sack', top);
    const bag = await createLocation(db, 'Cycle Bag', 'bag', sack);
    await expect(moveLocation(db, sack, bag)).rejects.toThrow(/descendant/);
    await expect(moveLocation(db, top, top)).rejects.toThrow(/itself/);
    await expect(createLocation(db, 'cycle sack', 'sack', top)).rejects.toThrow(/already exists/);
    await expect(createLocation(db, 'cycle root', 'room', null)).rejects.toThrow(/already exists/);
    // Database trigger also protects against another writer bypassing the service.
    await expect(db.prepare('UPDATE purkins_locations SET parent_id=? WHERE id=?')
      .bind(bag, top).run()).rejects.toThrow();
    expect((await listLocationTree(db)).find((l) => l.id === top)?.parent_id).toBeNull();
  });

  it('updates the location ID when legacy draft text changes, and allows unassigning', async () => {
    const { id, fields } = await createDraft('Legacy Text Move Romper');
    const original = await getIntake(db, id);
    expect(original?.storage_location).toBe('Sack A');
    expect(original?.location_id).toMatch(/^loc_[0-9a-f]{24}$/);

    await saveIntakeDraft(db, id, { ...fields, storage_location: 'New Red Sack' });
    const moved = await getIntake(db, id);
    expect(moved?.storage_location).toBe('New Red Sack');
    expect(moved?.location_id).not.toBe(original?.location_id);
    expect((await listLocationTree(db)).find((l) => l.id === moved?.location_id)?.path)
      .toBe('New Red Sack');

    await saveIntakeDraft(db, id, { ...fields, storage_location: null });
    const unassigned = await getIntake(db, id);
    expect(unassigned?.location_id).toBeNull();
    expect(unassigned?.storage_location).toBeNull();
    expect((await getProduct(db, id))).not.toHaveProperty('storage_location');
  });

  it('preserves the stable nested location on metadata-only edits, even after a parent moves', async () => {
    const left = await createLocation(db, 'Edit Source Room', 'room', null);
    const right = await createLocation(db, 'Edit Destination Room', 'room', null);
    const container = await createLocation(db, 'Edit Sack', 'sack', left);
    const bag = await createLocation(db, 'Edit Blue Bag', 'bag', container);
    const { id, fields } = await createDraft('Nested Metadata Edit Vest');
    await assignIntakeLocation(db, id, bag);
    await moveLocation(db, container, right);
    const current = await getIntake(db, id);
    expect(current?.storage_location).toBe('Edit Destination Room / Edit Sack / Edit Blue Bag');

    await saveIntakeDraft(db, id, { ...fields, storage_location: current!.storage_location, colour: 'Blue' });
    const updated = await getIntake(db, id);
    expect(updated?.location_id).toBe(bag);
    expect(updated?.storage_location).toBe(current?.storage_location);
    expect(updated?.colour).toBe('Blue');
    // A live hierarchy must not be duplicated as a root text path.
    expect((await listLocationTree(db)).filter((loc) => loc.name === current?.storage_location)).toHaveLength(0);
  });

  it('offers existing private stock locations and newly saved ones for subsequent intake', async () => {
    const { id, fields } = await createDraft('Location Picker Test Vest');
    await saveIntakeDraft(db, id, { ...fields, storage_location: 'Grey Sack / Blue PEP Bag' });
    const choices = await listStorageLocations(db);
    expect(choices).toContain('Grey Sack / Blue PEP Bag');
    // Existing selected locations must remain available even when not among
    // the first 200 suggestions (e.g. when editing old stock).
    expect(await listStorageLocations(db, 'Archived Sack / Loose Items'))
      .toContain('Archived Sack / Loose Items');
    const saved = await getIntake(db, id);
    expect(saved?.storage_location).toBe('Grey Sack / Blue PEP Bag');
    expect((await getProduct(db, id))).not.toHaveProperty('storage_location');
  });

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
