import type { D1Database } from '@cloudflare/workers-types';
import { generatePublicId, parsePublicId, isPublicIdConflict } from '../ids/publicId';
import type { CartLine } from '../cart/cart';
import { validateRequestCart, type OrderRequestFields, type RequestStatus } from './orderRequests';

export interface OrderRequestRow {
  id: number;
  public_id: string;
  buyer_name: string;
  phone: string;
  email: string | null;
  payment_preference: 'pay_on_delivery' | 'pay_after_instructions' | 'contact_me';
  fulfillment_preference: 'delivery' | 'pickup' | 'discuss';
  area: string | null;
  address_notes: string | null;
  customer_note: string | null;
  subtotal_cents: number;
  currency: string;
  status: RequestStatus;
  operator_note: string | null;
  created_at: string;
  updated_at: string;
}
export interface OrderRequestLine {
  product_name: string;
  unit_price_cents: number;
  quantity: number;
}
export type RequestInsertResult =
  | { ok: true; publicId: string; existing: boolean }
  | { ok: false; error: string };

const linesForDigest = (lines: CartLine[]) => lines.map(l => ({
  productId: l.product.id,
  variantId: l.variant?.id ?? null,
  name: l.product.name + (l.variant ? ' — ' + l.variant.label : '') +
    (l.extras.length ? ' + ' + l.extras.map(e => e.label).join(', ') : ''),
  quantity: l.qty,
  unitPrice: l.unitPriceCents,
})).sort((a,b) => (a.productId - b.productId) ||
  ((a.variantId ?? 0) - (b.variantId ?? 0)) || a.name.localeCompare(b.name));

async function sha(value: unknown) {
  const digest = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function createOrderRequest(
  db: D1Database,
  fields: OrderRequestFields,
  lines: CartLine[],
  subtotalCents: number,
): Promise<RequestInsertResult> {
  const invalid = validateRequestCart(lines, subtotalCents);
  if (invalid) return { ok: false, error: invalid };
  const items = linesForDigest(lines);
  const fingerprint = await sha({ fields, items, subtotalCents });

  const prior = await db.prepare(
    'SELECT public_id,payload_sha256 FROM purkins_order_requests WHERE request_id=?',
  ).bind(fields.requestId).first<{ public_id: string; payload_sha256: string }>();
  if (prior) {
    return prior.payload_sha256 === fingerprint
      ? { ok: true, publicId: prior.public_id, existing: true }
      : { ok: false, error: 'This form was already used for a different request. Reload before sending another.' };
  }

  // Lightweight anti-abuse throttle; not a substitute for edge rate limits.
  // Legitimate retries with the SAME idempotency key are handled above.
  const recent = await db.prepare(
    "SELECT COUNT(*) AS n FROM purkins_order_requests WHERE phone=? " +
    "AND created_at >= datetime('now','-30 minutes')",
  ).bind(fields.phone).first<{ n: number }>();
  if ((recent?.n ?? 0) >= 3) {
    return { ok: false, error: 'Too many recent requests for this number. Please contact Purkins directly.' };
  }

  const targets = new Map<string, { productId: number; variantId: number | null; qty: number }>();
  for (const item of items) {
    const key = item.variantId == null ? 'p:' + item.productId : 'v:' + item.variantId;
    const old = targets.get(key);
    if (old) old.qty += item.quantity;
    else targets.set(key, { productId: item.productId, variantId: item.variantId, qty: item.quantity });
  }
  const conditions: string[] = [];
  const values: number[] = [];
  for (const target of targets.values()) {
    if (target.variantId == null) {
      conditions.push('COALESCE((SELECT stock FROM products WHERE id=? AND active=1 AND currency=\'zmw\'),-1)>=?');
      values.push(target.productId, target.qty);
    } else {
      conditions.push('COALESCE((SELECT v.stock FROM product_variants v JOIN products p ON p.id=v.product_id ' +
        'WHERE v.id=? AND v.product_id=? AND v.active=1 AND p.active=1 AND p.currency=\'zmw\'),-1)>=?');
      values.push(target.variantId, target.productId, target.qty);
    }
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const publicId = generatePublicId('orderRequest');
    const nonce = crypto.randomUUID();
    const insert = db.prepare(
      'INSERT INTO purkins_order_requests ' +
      '(public_id,request_id,payload_sha256,nonce,buyer_name,phone,email,' +
      'fulfillment_preference,payment_preference,area,address_notes,customer_note,' +
      'subtotal_cents,currency) ' +
      'SELECT ?,?,?,?,?,?,?,?,?,?,?,?, ?,\'zmw\' WHERE ' +
      conditions.join(' AND ') +
      ' ON CONFLICT(request_id) DO NOTHING RETURNING id',
    ).bind(publicId,fields.requestId,fingerprint,nonce,fields.name,fields.phone,
      fields.email,fields.fulfillmentPreference,fields.paymentPreference,fields.area,
      fields.addressNotes,fields.customerNote,subtotalCents,...values);

    const writes = [insert];
    for (const item of items) {
      writes.push(db.prepare(
        'INSERT INTO purkins_order_request_items ' +
        '(request_id,product_id,variant_id,product_name,unit_price_cents,quantity) ' +
        'SELECT id,?,?,?,?,? FROM purkins_order_requests ' +
        'WHERE request_id=? AND nonce=?',
      ).bind(item.productId,item.variantId,item.name,item.unitPrice,item.quantity,fields.requestId,nonce));
    }
    try {
      // Atomic: no order request survives with a partial line list.
      const result = await db.batch<{ id?: number }>(writes);
      if (result[0]?.results?.[0]?.id) return { ok: true, publicId, existing: false };
    } catch (e) {
      if (isPublicIdConflict(e)) continue;
      throw e;
    }
    const concurrent = await db.prepare(
      'SELECT public_id,payload_sha256 FROM purkins_order_requests WHERE request_id=?',
    ).bind(fields.requestId).first<{ public_id: string; payload_sha256: string }>();
    if (concurrent) return concurrent.payload_sha256 === fingerprint
      ? { ok: true, publicId: concurrent.public_id, existing: true }
      : { ok: false, error: 'This form was already used. Refresh before submitting a different request.' };
    return { ok: false, error: 'Some items are no longer available. Review your cart and retry.' };
  }
  return { ok: false, error: 'Unable to create a unique request reference. Retry once.' };
}

export async function getOrderRequest(db: D1Database, publicId: string) {
  const normalized = parsePublicId(publicId, 'orderRequest');
  if (!normalized) return null;
  return db.prepare('SELECT * FROM purkins_order_requests WHERE public_id=?')
    .bind(normalized).first<OrderRequestRow>();
}
export async function listRequestLines(db: D1Database, id: number) {
  const rows = await db.prepare(
    'SELECT product_name,unit_price_cents,quantity FROM purkins_order_request_items WHERE request_id=? ORDER BY id',
  ).bind(id).all<OrderRequestLine>();
  return rows.results ?? [];
}
export async function listOrderRequests(db: D1Database, limit=100) {
  const rows = await db.prepare(
    'SELECT * FROM purkins_order_requests ORDER BY ' +
    "CASE status WHEN 'new' THEN 0 WHEN 'contacted' THEN 1 " +
    "WHEN 'awaiting_payment' THEN 2 ELSE 3 END,created_at DESC LIMIT ?",
  ).bind(limit).all<OrderRequestRow>();
  return rows.results ?? [];
}
export async function updateOrderRequestStatus(
  db: D1Database, publicId: string,
  expected: RequestStatus, next: RequestStatus,
  note: string, actor: string,
): Promise<boolean> {
  const normalized = parsePublicId(publicId, 'orderRequest');
  if (!normalized || expected === 'cancelled' || !['contacted','awaiting_payment','cancelled'].includes(next) ||
      note.length > 1000) return false;
  const r = await db.prepare(
    "UPDATE purkins_order_requests SET status=?,operator_note=?,updated_by=?,updated_at=datetime('now') " +
    "WHERE public_id=? AND status=? RETURNING id",
  ).bind(next,note || null,actor.slice(0,200),normalized,expected).first<{ id: number }>();
  return Boolean(r);
}
