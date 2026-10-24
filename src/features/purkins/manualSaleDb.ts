import type { D1Database } from '@cloudflare/workers-types';
import { getProductByPublicId } from '../products/db.ts';
import { generatePublicId } from '../ids/publicId.ts';
import { getOrderByProviderSessionId } from '../orders/db.ts';
import type { ManualSaleForm } from './manualSale';

interface ResolvedLine {
  productId: number;
  variantId: number | null;
  name: string;
  quantity: number;
  unitPriceCents: number;
}
interface VariantRow {
  id: number;
  public_id: string | null;
  label: string;
}
interface Target {
  productId: number;
  variantId: number | null;
  quantity: number;
}
export type ManualSaleResult =
  | { ok: true; orderPublicId: string; alreadyRecorded: boolean }
  | { ok: false; error: string };

/**
 * Admin-only fully paid manual sale. Header, items, identity claims, metadata
 * and stock changes commit in one D1 transaction. No paid order is created
 * if any aggregated stock target is short at the time of the transaction.
 */
export async function recordManualSale(
  db: D1Database,
  form: ManualSaleForm,
  currency: string,
  recordedBy: string | null,
): Promise<ManualSaleResult> {
  const session = 'manual:' + form.idempotencyKey;
  const prior = await getOrderByProviderSessionId(db, session);
  if (prior?.public_id) {
    return { ok: true, orderPublicId: prior.public_id, alreadyRecorded: true };
  }

  const lines: ResolvedLine[] = [];
  const products = new Map<string, Awaited<ReturnType<typeof getProductByPublicId>>>();
  const variants = new Map<string, VariantRow[]>();
  for (const item of form.items) {
    let product = products.get(item.productPublicId);
    if (product === undefined) {
      product = await getProductByPublicId(db, item.productPublicId);
      products.set(item.productPublicId, product);
    }
    if (!product || product.currency.toLowerCase() !== currency.toLowerCase()) {
      return { ok: false, error: 'Product not found or currency differs from the store currency.' };
    }
    let productVariants = variants.get(item.productPublicId);
    if (!productVariants) {
      // Include unpublished/inactive variants: owner-entered sales may use
      // stock awaiting storefront approval.
      const found = await db.prepare(
        'SELECT id, public_id, label FROM product_variants WHERE product_id = ? ORDER BY position, id',
      ).bind(product.id).all<VariantRow>();
      productVariants = found.results ?? [];
      variants.set(item.productPublicId, productVariants);
    }
    const variant = item.variantPublicId
      ? productVariants.find(v => v.public_id === item.variantPublicId)
      : null;
    if (productVariants.length > 0 && !variant) {
      return { ok: false, error: 'Choose the correct size or variant for each product.' };
    }
    if (item.variantPublicId && !variant) {
      return { ok: false, error: 'Selected variant does not belong to this product.' };
    }
    lines.push({
      productId: product.id,
      variantId: variant?.id ?? null,
      name: product.name + (variant ? ' — ' + variant.label : ''),
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
    });
  }

  const targets = new Map<string, Target>();
  let totalCents = 0;
  for (const line of lines) {
    totalCents += line.unitPriceCents * line.quantity;
    if (!Number.isSafeInteger(totalCents)) return { ok: false, error: 'Order total is too large.' };
    const key = line.variantId != null ? 'v:' + line.variantId : 'p:' + line.productId;
    const old = targets.get(key);
    if (old) old.quantity += line.quantity;
    else targets.set(key, { productId: line.productId, variantId: line.variantId, quantity: line.quantity });
  }
  if (totalCents <= 0) {
    return { ok: false, error: 'A paid sale must have a positive total.' };
  }

  const conditions: string[] = [];
  const params: number[] = [];
  for (const target of targets.values()) {
    if (target.variantId != null) {
      conditions.push('EXISTS (SELECT 1 FROM product_variants WHERE id = ? AND product_id = ? AND stock >= ?)');
      params.push(target.variantId, target.productId, target.quantity);
    } else {
      conditions.push('EXISTS (SELECT 1 FROM products WHERE id = ? AND stock >= ?)');
      params.push(target.productId, target.quantity);
    }
  }

  // Manual ord_ identifiers are operator-facing only, with no guest-access
  // token minted and no automatic customer notification.
  const publicId = generatePublicId('order');
  const token = crypto.randomUUID();
  const guard = "EXISTS (SELECT 1 FROM orders WHERE provider_session_id = ? AND settlement_token = ?)";
  const insertSql = [
    'INSERT INTO orders (provider_session_id, public_id, email, amount_total_cents, currency,',
    'status, payment_method, settlement_token, fulfillment_status, fulfilled_at, delivery_method)',
    "SELECT ?, ?, ?, ?, ?, 'paid', ?, ?, ?,",
    "CASE WHEN ? = 'fulfilled' THEN datetime('now') ELSE NULL END, ?",
    'WHERE ' + conditions.join(' AND '),
    'ON CONFLICT(provider_session_id) DO NOTHING RETURNING id',
  ].join(' ');
  const stmts = [
    db.prepare(insertSql).bind(
      session, publicId, form.email, totalCents, currency.toLowerCase(),
      form.tender, token, form.fulfillment, form.fulfillment, form.deliveryMethod, ...params,
    ),
  ];
  for (const target of targets.values()) {
    if (target.variantId == null) {
      stmts.push(db.prepare(
        'UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ? AND ' +
        guard + ' RETURNING stock',
      ).bind(target.quantity, target.productId, target.quantity, session, token));
    } else {
      stmts.push(db.prepare(
        'UPDATE product_variants SET stock = stock - ? WHERE id = ? AND product_id = ? AND stock >= ? AND ' +
        guard + ' RETURNING stock',
      ).bind(target.quantity, target.variantId, target.productId, target.quantity, session, token));
    }
  }
  for (const line of lines) {
    const itemId = generatePublicId('orderItem');
    stmts.push(db.prepare(
      'INSERT INTO order_item_ids (public_id, order_public_id) SELECT ?, ? WHERE ' + guard,
    ).bind(itemId, publicId, session, token));
    stmts.push(db.prepare(
      'INSERT INTO order_items (order_id, product_id, variant_id, name, price_cents, quantity, public_id) ' +
      'SELECT id, ?, ?, ?, ?, ?, ? FROM orders WHERE provider_session_id = ? AND settlement_token = ?',
    ).bind(line.productId, line.variantId, line.name, line.unitPriceCents,
      line.quantity, itemId, session, token));
  }
  stmts.push(db.prepare(
    'INSERT INTO purkins_manual_sales (order_id, channel, tender, customer_name, note, recorded_by) ' +
    'SELECT id, ?, ?, ?, ?, ? FROM orders WHERE provider_session_id = ? AND settlement_token = ?',
  ).bind(form.channel, form.tender, form.customerName, form.note, recordedBy, session, token));

  // D1.batch is atomic. An empty conditional INSERT is an out-of-stock sale;
  // subsequent statements are guarded by its unique settlement token.
  const result = await db.batch<{ id?: number }>(stmts);
  if (result[0]?.results?.[0]?.id) {
    return { ok: true, orderPublicId: publicId, alreadyRecorded: false };
  }
  const concurrent = await getOrderByProviderSessionId(db, session);
  if (concurrent?.public_id) {
    return { ok: true, orderPublicId: concurrent.public_id, alreadyRecorded: true };
  }
  return { ok: false, error: 'Insufficient stock for one or more items. Refresh the form to check quantities.' };
}
