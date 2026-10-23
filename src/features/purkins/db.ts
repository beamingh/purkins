import type { D1Database } from '@cloudflare/workers-types';
import { assignIntakeLocation, resolveLegacyLocation } from './locations';
import {
  normalizeSupplierBarcode,
  generateItemSku,
  landedCostCents,
  type IntakeFields,
  type IntakeRecord,
} from './intake';

/** Read paths through the live location tree. The legacy text snapshot is only a fallback.
 * Moving a sack automatically changes all child paths without touching product rows. */
const LOCATION_CTE = `WITH RECURSIVE location_paths(id, path) AS (
  SELECT id, name FROM purkins_locations WHERE parent_id IS NULL
  UNION ALL
  SELECT child.id, location_paths.path || ' / ' || child.name
  FROM purkins_locations child JOIN location_paths ON child.parent_id = location_paths.id
)`;

/**
 * Existing private storage paths, to power the Admin intake selector.
 * A new path is recorded with an item and appears in future selections:
 * no separate master-data table or public endpoint is needed.
 */
export async function listStorageLocations(
  db: D1Database,
  selectedLocation: string | null = null,
): Promise<string[]> {
  const { results } = await db.prepare(
    `SELECT MIN(TRIM(storage_location)) AS location
       FROM purkins_intake
      WHERE storage_location IS NOT NULL AND TRIM(storage_location) <> ''
      GROUP BY TRIM(storage_location) COLLATE NOCASE
      ORDER BY location COLLATE NOCASE
      LIMIT 200`,
  ).all<{ location: string }>();
  const values = (results ?? []).map((row) => row.location);
  if (selectedLocation && !values.some((location) => location.toLowerCase() === selectedLocation.toLowerCase())) {
    values.push(selectedLocation);
    values.sort((a, b) => a.localeCompare(b));
  }
  return values;
}

/**
 * Owner-side intake only. Do NOT join this table in storefront/public routes.
 * The current Minshop admin has one shared credential, not per-user roles;
 * do not invite a partner until role-level permissions are implemented.
 */
export async function getIntake(db: D1Database, productId: number): Promise<IntakeRecord | null> {
  // SELECT i.* already includes the legacy storage_location column. Use a
  // distinct SQL alias: duplicate output names can otherwise hide the new path.
  const row = await db.prepare(
    LOCATION_CTE + ` SELECT i.*, COALESCE(lp.path, i.storage_location) AS current_location
      FROM purkins_intake i LEFT JOIN location_paths lp ON lp.id=i.location_id
      WHERE i.product_id=?`,
  ).bind(productId).first<IntakeRecord & { current_location: string | null }>();
  if (!row) return null;
  const { current_location, ...intake } = row;
  return { ...intake, storage_location: current_location };
}

export async function getIntakesForProducts(
  db: D1Database,
  productIds: number[],
): Promise<Map<number, IntakeRecord>> {
  if (productIds.length === 0) return new Map();
  // Admin page size is limited, but chunk if reused for larger selections.
  const output = new Map<number, IntakeRecord>();
  for (let i = 0; i < productIds.length; i += 100) {
    const batch = productIds.slice(i, i + 100);
    const placeholder = batch.map(() => '?').join(',');
    const { results } = await db.prepare(
      LOCATION_CTE + ` SELECT i.*, COALESCE(lp.path, i.storage_location) AS current_location
        FROM purkins_intake i LEFT JOIN location_paths lp ON lp.id=i.location_id
        WHERE i.product_id IN (${placeholder})`,
    ).bind(...batch).all<IntakeRecord & { current_location: string | null }>();
    for (const row of results ?? []) {
      const { current_location, ...intake } = row;
      output.set(row.product_id, { ...intake, storage_location: current_location });
    }
  }
  return output;
}

export async function insertIntake(
  db: D1Database,
  productId: number,
  fields: IntakeFields,
): Promise<void> {
  const sku = generateItemSku(productId);
  await db.prepare(
    `INSERT INTO purkins_intake
      (product_id, sku, size_label, colour, age_range, storage_location,
       purchase_currency, purchase_cost_minor, zar_to_zmw, overhead_zwm_cents,
       markup_percent, brand, supplier_barcode, retail_tag_minor, retail_tag_currency,
       pack_count, condition_status, internal_notes, pricing_mode, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
  ).bind(
    productId, sku, fields.size_label, fields.colour, fields.age_range, fields.storage_location,
    fields.purchase_currency, fields.purchase_cost_minor, fields.zar_to_zmw,
    fields.overhead_zwm_cents, fields.markup_percent,
    fields.brand ?? null, fields.supplier_barcode ?? null, fields.retail_tag_minor ?? null,
    fields.retail_tag_currency ?? 'ZAR', fields.pack_count ?? null,
    fields.condition_status ?? 'complete', fields.internal_notes ?? null,
    fields.pricing_mode ?? 'cost_based',
  ).run();
  if (fields.storage_location) {
    const locationId = await resolveLegacyLocation(db, fields.storage_location);
    await assignIntakeLocation(db, productId, locationId);
  }
}

/** Saving an intake item always revokes approval. Update product.active=0 first. */
export async function saveIntakeDraft(
  db: D1Database,
  productId: number,
  fields: IntakeFields,
): Promise<void> {
  await db.prepare(
    `UPDATE purkins_intake
      SET size_label=?, colour=?, age_range=?, storage_location=?, purchase_currency=?,
          purchase_cost_minor=?, zar_to_zmw=?, overhead_zwm_cents=?, markup_percent=?,
          brand=?, supplier_barcode=?, retail_tag_minor=?, retail_tag_currency=?,
          pack_count=?, condition_status=?, internal_notes=?, pricing_mode=?,
          status='draft', updated_at=datetime('now')
      WHERE product_id=?`,
  ).bind(
    fields.size_label, fields.colour, fields.age_range, fields.storage_location,
    fields.purchase_currency, fields.purchase_cost_minor, fields.zar_to_zmw,
    fields.overhead_zwm_cents, fields.markup_percent,
    fields.brand ?? null, fields.supplier_barcode ?? null, fields.retail_tag_minor ?? null,
    fields.retail_tag_currency ?? 'ZAR', fields.pack_count ?? null,
    fields.condition_status ?? 'complete', fields.internal_notes ?? null,
    fields.pricing_mode ?? 'cost_based', productId,
  ).run();
}

export async function removeIntake(db: D1Database, productId: number): Promise<void> {
  await db.prepare('DELETE FROM purkins_intake WHERE product_id=?').bind(productId).run();
}

export async function approveIntake(
  db: D1Database,
  productId: number,
): Promise<string | null> {
  const intake = await getIntake(db, productId);
  if (!intake) return 'This product has no Purkins intake record.';
  const product = await db.prepare(
    'SELECT price_cents, currency, image_key FROM products WHERE id=?',
  ).bind(productId).first<{ price_cents: number; currency: string; image_key: string | null }>();
  if (!product) return 'Product not found.';
  if (product.currency.toLowerCase() !== 'zmw') return 'Purkins approvals require ZMW selling prices.';
  if ((intake.condition_status ?? 'complete') !== 'complete') {
    return 'Review incomplete or unchecked stock before publishing.';
  }
  const manual = intake.pricing_mode === 'manual';
  if (!manual && intake.purchase_cost_minor === null) {
    return 'Enter the purchase cost before approving, or select manual pricing.';
  }
  const landed = landedCostCents(intake);
  if (!manual && landed === null) return 'A conversion rate is needed to calculate landed cost.';
  if (product.price_cents <= 0) return 'Set a positive selling price before approving.';
  // If usable cost is known, never silently approve an under-cost manual price.
  // Without usable cost, manual approval is explicit but cost recovery is unverified.
  if (landed !== null && product.price_cents < landed) {
    return 'Selling price cannot be below the estimated landed cost.';
  }
  if (!product.image_key) return 'Add a product photograph before publishing.';

  // Purchasers can choose a variant price instead of the parent price. A
  // below-cost active size/colour option must never bypass the owner review.
  const { results: variants } = await db.prepare(
    'SELECT price_cents FROM product_variants WHERE product_id=? AND active=1',
  ).bind(productId).all<{ price_cents: number }>();
  if ((variants ?? []).some((variant) => variant.price_cents <= 0)) {
    return 'Set a positive selling price for every active size or colour variant.';
  }
  if (landed !== null && (variants ?? []).some((variant) => variant.price_cents < landed)) {
    return 'An active variant price is below the estimated landed cost.';
  }

  // Batch is transactional. Approval status and public visibility move together.
  await db.batch([
    db.prepare("UPDATE purkins_intake SET status='approved', updated_at=datetime('now') WHERE product_id=?")
      .bind(productId),
    db.prepare('UPDATE products SET active=1 WHERE id=?').bind(productId),
  ]);
  return null;
}

/** Supplier codes stay in Purkins-private tables, not in public variant DTOs. */
export async function getVariantSupplierBarcodes(
  db: D1Database, productId: number,
): Promise<Map<number, string>> {
  const { results } = await db.prepare(
    `SELECT v.id AS variant_id, i.supplier_barcode
       FROM product_variants v
       LEFT JOIN purkins_variant_identifiers i ON i.variant_id = v.id
      WHERE v.product_id = ?`,
  ).bind(productId).all<{variant_id: number; supplier_barcode: string | null}>();
  return new Map((results ?? []).filter(
    (r): r is {variant_id: number; supplier_barcode: string} => r.supplier_barcode !== null,
  ).map((r) => [r.variant_id, r.supplier_barcode]));
}

export async function setVariantSupplierBarcode(
  db: D1Database, variantId: number, raw: string | null | undefined,
): Promise<void> {
  const barcode = normalizeSupplierBarcode(raw);
  if (barcode === null) {
    await db.prepare('DELETE FROM purkins_variant_identifiers WHERE variant_id=?')
      .bind(variantId).run();
    return;
  }
  await db.prepare(
    `INSERT INTO purkins_variant_identifiers (variant_id, supplier_barcode)
     VALUES (?, ?) ON CONFLICT(variant_id)
     DO UPDATE SET supplier_barcode=excluded.supplier_barcode`,
  ).bind(variantId, barcode).run();
}
