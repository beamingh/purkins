import type { D1Database } from '@cloudflare/workers-types';
import { getOrderRequest } from './orderRequestDb';
import { getOfflineQuote } from './offlineQuoteDb';
import { visibleStockChanged } from '../products/stock';

export type HoldStatus = 'held' | 'released';
export interface OfflineStockHold {
  request_id: number;
  quote_revision: number;
  lines_json: string;
  status: HoldStatus;
  hold_nonce: string;
  held_by: string;
  held_at: string;
  released_by: string | null;
  released_at: string | null;
  release_reason: string | null;
}
interface RequestedLine {
  product_id: number | null;
  variant_id: number | null;
  product_name: string;
  quantity: number;
  unit_price_cents: number;
}
interface Target { productId: number; variantId: number | null; quantity: number }
export type HoldOutcome =
  | { ok: true; alreadyApplied: boolean; changedProductIds: number[] }
  | { ok: false; error: string };

const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getOfflineStockHold(db: D1Database, requestId: number) {
  return db.prepare(
    'SELECT * FROM purkins_order_request_allocations WHERE request_id=?',
  ).bind(requestId).first<OfflineStockHold>();
}

function aggregate(lines: RequestedLine[]): Target[] | null {
  if (lines.length === 0 || lines.length > 25) return null;
  const targets = new Map<string, Target>();
  let quantityTotal = 0;
  for (const line of lines) {
    if (!Number.isSafeInteger(line.product_id) || (line.product_id ?? 0) <= 0 ||
        (line.variant_id != null && (!Number.isSafeInteger(line.variant_id) || line.variant_id <= 0)) ||
        !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 50 ||
        !Number.isSafeInteger(line.unit_price_cents) || line.unit_price_cents < 0) return null;
    quantityTotal += line.quantity;
    const key = line.variant_id == null ? 'p:' + line.product_id : 'v:' + line.variant_id;
    const current = targets.get(key);
    if (current) current.quantity += line.quantity;
    else targets.set(key,{
      productId: line.product_id!,variantId: line.variant_id,quantity:line.quantity,
    });
  }
  if (quantityTotal > 50) return null;
  return [...targets.values()];
}

function snapshotTargets(value: string): Target[] | null {
  try {
    const lines = JSON.parse(value) as RequestedLine[];
    if (!Array.isArray(lines)) return null;
    return aggregate(lines);
  } catch {
    return null;
  }
}

export async function holdOfflineRequestStock(
  db: D1Database, publicId: string, quoteRevision: number,
  nonce: string, actor: string,
): Promise<HoldOutcome> {
  if (!UUID4.test(nonce) || !Number.isSafeInteger(quoteRevision) || quoteRevision < 1) {
    return { ok: false, error:'Invalid or stale hold form.' };
  }
  const request = await getOrderRequest(db,publicId);
  if (!request || !['contacted','awaiting_payment'].includes(request.status)) {
    return { ok:false,error:'Contact the customer before allocating stock.' };
  }
  const prior = await getOfflineStockHold(db,request.id);
  if (prior) {
    return prior.status === 'held' && prior.hold_nonce === nonce &&
      prior.quote_revision === quoteRevision
      ? { ok:true,alreadyApplied:true,changedProductIds:[] }
      : { ok:false,error:'Stock was already allocated or released for this request.' };
  }
  const quote = await getOfflineQuote(db,request.id);
  if (!quote || quote.revision !== quoteRevision ||
      quote.subtotal_cents !== request.subtotal_cents) {
    return { ok:false,error:'A current prepared quote is required before stock can be held.' };
  }
  const read = await db.prepare(
    'SELECT product_id,variant_id,product_name,quantity,unit_price_cents ' +
    'FROM purkins_order_request_items WHERE request_id=? ORDER BY id',
  ).bind(request.id).all<RequestedLine>();
  const lines = read.results ?? [];
  const targets = aggregate(lines);
  if (!targets) return {ok:false,error:'Invalid or removed request items; cannot allocate stock.'};
  const subtotal = lines.reduce((sum,l)=>sum+l.unit_price_cents*l.quantity,0);
  if (!Number.isSafeInteger(subtotal) || subtotal !== request.subtotal_cents) {
    return {ok:false,error:'The original line-item subtotal no longer reconciles.'};
  }
  const checks: string[] = [];
  const params: number[] = [];
  for (const target of targets) {
    if (target.variantId == null) {
      checks.push(
        "COALESCE((SELECT stock FROM products WHERE id=? AND active=1 AND lower(currency)='zmw'),-1)>=?",
      );
      params.push(target.productId,target.quantity);
    } else {
      checks.push(
        "COALESCE((SELECT v.stock FROM product_variants v JOIN products p ON p.id=v.product_id " +
        "WHERE v.id=? AND v.product_id=? AND v.active=1 AND p.active=1 AND lower(p.currency)='zmw'),-1)>=?",
      );
      params.push(target.variantId,target.productId,target.quantity);
    }
  }
  const by = actor.trim().slice(0,200) || 'admin-session';
  const statement = db.prepare(
    'INSERT INTO purkins_order_request_allocations ' +
    '(request_id,quote_revision,lines_json,status,hold_nonce,held_by) ' +
    'SELECT q.request_id,q.revision,?,\'held\',?,? ' +
    'FROM purkins_order_request_quotes q JOIN purkins_order_requests r ON r.id=q.request_id ' +
    "WHERE r.public_id=? AND r.status IN ('contacted','awaiting_payment') " +
    'AND q.revision=? AND q.subtotal_cents=? AND ' +
    checks.join(' AND ') +
    ' ON CONFLICT(request_id) DO NOTHING RETURNING request_id',
  ).bind(JSON.stringify(lines),nonce,by,request.public_id,quoteRevision,request.subtotal_cents,...params);
  const gate = "EXISTS (SELECT 1 FROM purkins_order_request_allocations WHERE request_id=? AND status='held' AND hold_nonce=?)";
  const writes = [statement];
  for (const target of targets) {
    if (target.variantId == null) {
      writes.push(db.prepare(
        'UPDATE products SET stock=stock-? WHERE id=? AND stock>=? AND ' +
        gate + ' RETURNING stock',
      ).bind(target.quantity,target.productId,target.quantity,request.id,nonce));
    } else {
      writes.push(db.prepare(
        'UPDATE product_variants SET stock=stock-? WHERE id=? AND product_id=? AND stock>=? AND ' +
        gate + ' RETURNING stock',
      ).bind(target.quantity,target.variantId,target.productId,target.quantity,request.id,nonce));
    }
  }
  const result = await db.batch<{request_id?:number;stock?:number}>(writes);
  if (!result[0]?.results?.[0]?.request_id) {
    return {ok:false,error:'Stock or quote changed, or this request has an existing hold. Refresh.'};
  }
  // This should always be true: the insert predicates checked every target
  // under the same D1 transaction. Fail closed if a backend invariant breaks.
  if (result.slice(1).some(r=>r.results.length!==1)) {
    throw new Error('Stock hold invariant violation; reconcile request allocation.');
  }
  const changedProductIds = targets.flatMap((target,index)=>{
    const after=result[index+1]?.results?.[0]?.stock;
    return typeof after==='number' &&
      visibleStockChanged(target.variantId!=null,after+target.quantity,after)
      ? [target.productId] : [];
  });
  return {ok:true,alreadyApplied:false,changedProductIds};
}

/** Return held stock to sellable inventory at most once; leave original snapshot. */
export async function releaseOfflineRequestStock(
  db:D1Database, publicId:string, reason:string, actor:string,
):Promise<HoldOutcome> {
  if (reason.trim().length<4 || reason.length>500) {
    return {ok:false,error:'Explain why the stock hold is being released (4–500 characters).'};
  }
  const request=await getOrderRequest(db,publicId);
  if (!request) return {ok:false,error:'Request not found.'};
  const hold=await getOfflineStockHold(db,request.id);
  if (!hold || hold.status!=='held') {
    return {ok:false,error:'No active stock hold exists for this request.'};
  }
  const targets=snapshotTargets(hold.lines_json);
  if (!targets) throw new Error('Cannot release invalid stock snapshot safely.');
  const gate="EXISTS (SELECT 1 FROM purkins_order_request_allocations WHERE request_id=? AND status='held' AND hold_nonce=?)";
  const writes=[];
  for (const target of targets) {
    if (target.variantId == null) {
      writes.push(db.prepare(
        'UPDATE products SET stock=stock+? WHERE id=? AND ' + gate + ' RETURNING stock',
      ).bind(target.quantity,target.productId,request.id,hold.hold_nonce));
    } else {
      writes.push(db.prepare(
        'UPDATE product_variants SET stock=stock+? WHERE id=? AND product_id=? AND ' +
        gate + ' RETURNING stock',
      ).bind(target.quantity,target.variantId,target.productId,request.id,hold.hold_nonce));
    }
  }
  writes.push(db.prepare(
    'UPDATE purkins_order_request_allocations SET status=\'released\', ' +
    "released_at=datetime('now'),released_by=?,release_reason=? " +
    'WHERE request_id=? AND status=\'held\' AND hold_nonce=? RETURNING request_id',
  ).bind(actor.trim().slice(0,200)||'admin-session',reason.trim(),request.id,hold.hold_nonce));
  const results=await db.batch<{stock?:number;request_id?:number}>(writes);
  const changed=Boolean(results.at(-1)?.results?.[0]?.request_id);
  if (!changed) return {ok:false,error:'The stock hold changed or was released elsewhere.'};
  if (results.slice(0,-1).some(r=>r.results.length!==1)) {
    throw new Error('Stock release invariant violation; reconcile before further action.');
  }
  const changedProductIds=targets.flatMap((target,index)=>{
    const after=results[index]?.results?.[0]?.stock;
    return typeof after==='number' &&
      visibleStockChanged(target.variantId!=null,after-target.quantity,after)
      ? [target.productId] : [];
  });
  return {ok:true,alreadyApplied:false,changedProductIds};
}
