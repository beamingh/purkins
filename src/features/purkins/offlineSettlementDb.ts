import type { D1Database } from '@cloudflare/workers-types';
import { generatePublicId, parsePublicId } from '../ids/publicId';
import { getOfflineQuote } from './offlineQuoteDb';
import { getOfflineStockHold } from './offlineStockHoldDb';
import { getOrderRequest } from './orderRequestDb';
import type { OfflineSettlementInput } from './offlineSettlement';

interface HeldLine {
  product_id:number|null;
  variant_id:number|null;
  product_name:string;
  unit_price_cents:number;
  quantity:number;
}
export interface OfflineSettlementRow {
  request_id:number;
  order_id:number;
  confirmation_nonce:string;
  quote_revision:number;
  tender:OfflineSettlementInput['tender'];
  payment_reference:string|null;
  amount_received_cents:number;
  fulfillment_status:'fulfilled'|'unfulfilled';
  confirmation_note:string;
  recorded_by:string;
  recorded_at:string;
  order_public_id?:string;
}
export type SettlementResult=
  | {ok:true;orderPublicId:string;alreadyRecorded:boolean}
  | {ok:false;error:string};

function validateHeldLines(value:string,expectedSubtotal:number):HeldLine[]|null {
  let lines:HeldLine[];
  try { lines=JSON.parse(value) as HeldLine[]; } catch {return null;}
  if (!Array.isArray(lines)||!lines.length||lines.length>25) return null;
  let total=0,qty=0;
  for (const l of lines) {
    if (!l||!Number.isSafeInteger(l.product_id)|| (l.product_id??0)<1 ||
        (l.variant_id!=null&&(!Number.isSafeInteger(l.variant_id)||l.variant_id<1))||
        !Number.isSafeInteger(l.unit_price_cents)||l.unit_price_cents<0||
        !Number.isSafeInteger(l.quantity)||l.quantity<1||l.quantity>50||
        typeof l.product_name!=='string'||!l.product_name.trim()) return null;
    total+=l.quantity*l.unit_price_cents;
    qty+=l.quantity;
  }
  return Number.isSafeInteger(total)&&total===expectedSubtotal&&qty<=50?lines:null;
}

export async function getOfflineSettlement(db:D1Database,requestId:number) {
  return db.prepare(
    'SELECT s.*,o.public_id AS order_public_id FROM purkins_offline_settlements s '+
    'JOIN orders o ON o.id=s.order_id WHERE s.request_id=?',
  ).bind(requestId).first<OfflineSettlementRow>();
}

/**
 * Owner-attested fully received funds, not a provider-webhook confirmation.
 * Converts exactly one allocated request into one canonical PAID order.
 * Inventory was already deducted on hold; this transaction NEVER changes it.
 */
export async function settleHeldOfflineOrder(
  db:D1Database,requestPublicId:string,
  input:OfflineSettlementInput,operator:string,
):Promise<SettlementResult> {
  const publicId=parsePublicId(requestPublicId,'orderRequest');
  if (!publicId) return {ok:false,error:'Invalid order request reference.'};
  const request=await getOrderRequest(db,publicId);
  if (!request) return {ok:false,error:'Order request not found.'};
  const prior=await getOfflineSettlement(db,request.id);
  if (prior) {
    return prior.confirmation_nonce===input.nonce && prior.tender===input.tender &&
      prior.payment_reference===input.paymentReference &&
      prior.quote_revision===input.quoteRevision && prior.fulfillment_status===input.fulfillment
      ? {ok:true,orderPublicId:prior.order_public_id!,alreadyRecorded:true}
      : {ok:false,error:'This request has already been recorded as paid. Do not record it again.'};
  }
  if (!['contacted','awaiting_payment'].includes(request.status)) {
    return {ok:false,error:'Contact the buyer and confirm arrangements before recording payment.'};
  }
  const quote=await getOfflineQuote(db,request.id);
  const hold=await getOfflineStockHold(db,request.id);
  if (!quote||!hold||hold.status!=='held'||quote.revision!==input.quoteRevision||
      hold.quote_revision!==quote.revision||quote.total_cents<=0||
      quote.subtotal_cents!==request.subtotal_cents) {
    return {ok:false,error:'The agreed quote and current stock hold must match before settlement.'};
  }
  const lines=validateHeldLines(hold.lines_json,request.subtotal_cents);
  if (!lines) return {ok:false,error:'Allocated item snapshot does not match the original request.'};
  const by=operator.trim().slice(0,200)||'admin-session';
  const session='offline-req:'+request.public_id;
  const publicOrderId=generatePublicId('order');
  const settlementToken=crypto.randomUUID();
  const guard='EXISTS (SELECT 1 FROM orders WHERE provider_session_id=? AND settlement_token=?)';
  const insert=db.prepare(
    'INSERT INTO orders (provider_session_id,public_id,email,amount_total_cents,shipping_cents,discount_cents,'+
    'currency,status,payment_method,settlement_token,fulfillment_status,fulfilled_at,delivery_method) '+
    "SELECT ?,?,?,q.total_cents,q.delivery_fee_cents,q.discount_cents,'zmw','paid',?,?,?, "+
    "CASE WHEN ?='fulfilled' THEN datetime('now') ELSE NULL END, "+
    "CASE WHEN q.fulfillment_method='delivery' THEN 'shipping' ELSE 'pickup' END "+
    'FROM purkins_order_request_quotes q '+
    'JOIN purkins_order_requests r ON r.id=q.request_id '+
    'JOIN purkins_order_request_allocations a ON a.request_id=r.id '+
    "WHERE r.public_id=? AND r.status IN ('contacted','awaiting_payment') "+
    "AND a.status='held' AND a.quote_revision=q.revision AND q.revision=? "+
    'AND NOT EXISTS (SELECT 1 FROM purkins_offline_settlements s WHERE s.request_id=r.id) '+
    'ON CONFLICT(provider_session_id) DO NOTHING RETURNING id',
  ).bind(session,publicOrderId,request.email,input.tender,settlementToken,
    input.fulfillment,input.fulfillment,request.public_id,input.quoteRevision);
  const stmts=[insert];
  for (const line of lines) {
    const itemId=generatePublicId('orderItem');
    stmts.push(db.prepare(
      'INSERT INTO order_item_ids (public_id,order_public_id) '+
      'SELECT ?,? WHERE '+guard,
    ).bind(itemId,publicOrderId,session,settlementToken));
    stmts.push(db.prepare(
      'INSERT INTO order_items (order_id,product_id,variant_id,name,price_cents,quantity,public_id) '+
      'SELECT id,?,?,?,?,?,? FROM orders WHERE provider_session_id=? AND settlement_token=?',
    ).bind(line.product_id,line.variant_id,line.product_name,line.unit_price_cents,
      line.quantity,itemId,session,settlementToken));
  }
  stmts.push(db.prepare(
    'INSERT INTO purkins_manual_sales (order_id,channel,tender,customer_name,note,recorded_by) '+
    'SELECT id,?,?,?,?,? FROM orders WHERE provider_session_id=? AND settlement_token=?',
  ).bind(input.channel,input.tender,request.buyer_name,
    'Settled from customer request '+request.public_id,by,session,settlementToken));
  stmts.push(db.prepare(
    'INSERT INTO purkins_offline_settlements '+
    '(request_id,order_id,confirmation_nonce,quote_revision,tender,payment_reference,'+
    'amount_received_cents,fulfillment_status,confirmation_note,recorded_by) '+
    'SELECT r.id,o.id,?,?,?,?,q.total_cents,?,?,? '+
    'FROM purkins_order_requests r JOIN purkins_order_request_quotes q ON q.request_id=r.id '+
    'JOIN orders o ON o.provider_session_id=? AND o.settlement_token=? '+
    'WHERE r.public_id=? AND q.revision=? '+
    'ON CONFLICT(request_id) DO NOTHING RETURNING order_id',
  ).bind(input.nonce,input.quoteRevision,input.tender,input.paymentReference,
    input.fulfillment,input.confirmationNote,by,session,settlementToken,
    request.public_id,input.quoteRevision));
  const results=await db.batch<{id?:number;order_id?:number}>(stmts);
  if (results[0]?.results?.[0]?.id&&results.at(-1)?.results?.[0]?.order_id) {
    return {ok:true,orderPublicId:publicOrderId,alreadyRecorded:false};
  }
  const saved=await getOfflineSettlement(db,request.id);
  if (saved) {
    return saved.confirmation_nonce===input.nonce
      ? {ok:true,orderPublicId:saved.order_public_id!,alreadyRecorded:true}
      : {ok:false,error:'This request was recorded as paid in another session.'};
  }
  return {ok:false,error:'Quote, stock hold or payment record changed. Refresh before retrying.'};
}
