import type { D1Database } from '@cloudflare/workers-types';
import { getOrderRequest } from './orderRequestDb';
import { quoteTotalCents, type OfflineQuoteInput } from './offlineQuote';

export interface OfflineQuoteRow {
  request_id: number;
  subtotal_cents: number;
  delivery_fee_cents: number;
  discount_cents: number;
  total_cents: number;
  fulfillment_method: 'delivery' | 'pickup';
  delivery_details: string | null;
  owner_note: string | null;
  revision: number;
  updated_by: string;
  updated_at: string;
}

export async function getOfflineQuote(db: D1Database, requestId: number) {
  return db.prepare(
    'SELECT * FROM purkins_order_request_quotes WHERE request_id=?',
  ).bind(requestId).first<OfflineQuoteRow>();
}

export type SaveQuoteResult =
  | { ok: true; revision: number; totalCents: number }
  | { ok: false; error: string };

/**
 * This only prepares an owner's private offline quote, not a payment or a
 * guaranteed reservation. Every successful revision has an audit event in
 * the SAME atomic D1 batch. All prices are integer ZMW minor units.
 */
export async function saveOfflineQuote(
  db: D1Database, requestPublicId: string,
  input: OfflineQuoteInput, actor: string,
): Promise<SaveQuoteResult> {
  const request = await getOrderRequest(db, requestPublicId);
  if (!request || request.status === 'cancelled') {
    return { ok: false, error: 'Request not found or already cancelled.' };
  }
  const total = quoteTotalCents(request.subtotal_cents, input.feeCents, input.discountCents);
  if (total === null) {
    return { ok: false, error: 'The discount must leave a positive final total.' };
  }
  if (input.fulfillmentMethod === 'pickup' && input.feeCents !== 0) {
    return { ok: false, error: 'Pickup cannot include a delivery fee.' };
  }
  const by = actor.trim().slice(0, 200) || 'admin-session';
  const stmt = input.expectedRevision === 0
    ? db.prepare(
        'INSERT INTO purkins_order_request_quotes ' +
        '(request_id,subtotal_cents,delivery_fee_cents,discount_cents,total_cents,' +
        'fulfillment_method,delivery_details,owner_note,revision,change_nonce,updated_by) ' +
        'SELECT id,subtotal_cents,?,?,?,?,?,?,1,?,? FROM purkins_order_requests ' +
        "WHERE public_id=? AND status IN ('new','contacted','awaiting_payment') AND subtotal_cents=? " +
        'ON CONFLICT(request_id) DO NOTHING RETURNING revision',
      ).bind(input.feeCents,input.discountCents,total,input.fulfillmentMethod,
        input.deliveryDetails,input.ownerNote,input.nonce,by,request.public_id,request.subtotal_cents)
    : db.prepare(
        'UPDATE purkins_order_request_quotes SET delivery_fee_cents=?, discount_cents=?, ' +
        'total_cents=?,fulfillment_method=?,delivery_details=?,owner_note=?, ' +
        "revision=revision+1,change_nonce=?,updated_by=?,updated_at=datetime('now') " +
        'WHERE request_id=(SELECT id FROM purkins_order_requests WHERE public_id=? ' +
        "AND status IN ('new','contacted','awaiting_payment') AND subtotal_cents=?) " +
        'AND revision=? RETURNING revision',
      ).bind(input.feeCents,input.discountCents,total,input.fulfillmentMethod,
        input.deliveryDetails,input.ownerNote,input.nonce,by,request.public_id,
        request.subtotal_cents,input.expectedRevision);

  const revision = input.expectedRevision + 1;
  const audit = db.prepare(
    'INSERT INTO purkins_order_request_quote_events ' +
    '(request_id,revision,subtotal_cents,delivery_fee_cents,discount_cents,total_cents,' +
    'fulfillment_method,delivery_details,owner_note,changed_by) ' +
    'SELECT request_id,revision,subtotal_cents,delivery_fee_cents,discount_cents,total_cents,' +
    'fulfillment_method,delivery_details,owner_note,updated_by ' +
    'FROM purkins_order_request_quotes WHERE request_id=? AND revision=? AND change_nonce=? ' +
    'ON CONFLICT(request_id,revision) DO NOTHING',
  ).bind(request.id,revision,input.nonce);
  const results = await db.batch<{ revision?: number }>([stmt,audit]);
  if (results[0]?.results?.[0]?.revision === revision &&
      results[1]?.meta?.changes === 1) {
    return { ok: true, revision, totalCents: total };
  }
  return { ok: false, error: 'The quote changed in another session. Reload to review the latest amounts.' };
}

export async function listOfflineQuoteEvents(db: D1Database, requestId: number) {
  const events = await db.prepare(
    'SELECT revision,subtotal_cents,delivery_fee_cents,discount_cents,total_cents,' +
    'fulfillment_method,delivery_details,owner_note,changed_by,created_at ' +
    'FROM purkins_order_request_quote_events WHERE request_id=? ORDER BY revision DESC LIMIT 20',
  ).bind(requestId).all<{
    revision: number;
    subtotal_cents: number;
    delivery_fee_cents: number;
    discount_cents: number;
    total_cents: number;
    fulfillment_method: string;
    delivery_details: string | null;
    owner_note: string | null;
    changed_by: string;
    created_at: string;
  }>();
  return events.results ?? [];
}
