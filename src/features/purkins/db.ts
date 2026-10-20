import type { D1Database } from '@cloudflare/workers-types';
import {
  generateItemSku,
  landedCostCents,
  type IntakeFields,
  type IntakeRecord,
} from './intake';

/**
 * Owner-side intake only. Do NOT join this table in storefront/public routes.
 * The current Minshop admin has one shared credential, not per-user roles;
 * do not invite a partner until role-level permissions are implemented.
 */
export async function getIntake(db: D1Database, productId: number): Promise<IntakeRecord | null> {
  return db.prepare('SELECT * FROM purkins_intake WHERE product_id = ?')
    .bind(productId).first<IntakeRecord>();
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
      `SELECT * FROM purkins_intake WHERE product_id IN (${placeholder})`,
    ).bind(...batch).all<IntakeRecord>();
    for (const row of results ?? []) output.set(row.product_id, row);
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
       markup_percent, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
  ).bind(
    productId, sku, fields.size_label, fields.colour, fields.age_range, fields.storage_location,
    fields.purchase_currency, fields.purchase_cost_minor, fields.zar_to_zmw,
    fields.overhead_zwm_cents, fields.markup_percent,
  ).run();
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
          status='draft', updated_at=datetime('now')
      WHERE product_id=?`,
  ).bind(
    fields.size_label, fields.colour, fields.age_range, fields.storage_location,
    fields.purchase_currency, fields.purchase_cost_minor, fields.zar_to_zmw,
    fields.overhead_zwm_cents, fields.markup_percent, productId,
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
  if (intake.purchase_cost_minor === null) return 'Enter the purchase cost before approving.';
  const landed = landedCostCents(intake);
  if (landed === null) return 'A conversion rate is needed to calculate landed cost.';
  if (product.price_cents <= 0) return 'Set a positive selling price before approving.';
  if (product.price_cents < landed) return 'Selling price cannot be below the estimated landed cost.';
  if (!product.image_key) return 'Add a product photograph before publishing.';

  // Purchasers can choose a variant price instead of the parent price. A
  // below-cost active size/colour option must never bypass the owner review.
  const { results: variants } = await db.prepare(
    'SELECT price_cents FROM product_variants WHERE product_id=? AND active=1',
  ).bind(productId).all<{ price_cents: number }>();
  if ((variants ?? []).some((variant) => variant.price_cents < landed)) {
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
