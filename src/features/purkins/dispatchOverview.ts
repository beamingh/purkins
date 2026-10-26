import type { D1Database } from '@cloudflare/workers-types';
import type { DeliveryStatus } from './courierDelivery';

/** Deliberately a *read-only* overview of request/hold/dispatch/paid records. */
export interface DispatchQueueRow {
  request_public_id:string;
  buyer_name:string;
  phone:string;
  area:string|null;
  request_status:string;
  request_created_at:string;
  quote_total_cents:number;
  currency:string;
  allocation_status:'held'|'released';
  held_at:string;
  delivery_status:DeliveryStatus|null;
  courier:string|null;
  dropoff_location:string|null;
  recipient_name:string|null;
  booking_reference:string|null;
  courier_fee_cents:number|null;
  courier_fee_payer:string|null;
  courier_fee_state:string|null;
  delivery_updated_at:string|null;
  paid_order_public_id:string|null;
  paid_order_fulfillment_status:string|null;
}
export type DispatchBucket =
  'attention'|'awaiting_dispatch'|'with_rider'|'delivered'|'returned';
export interface CategorizedDispatch {
  row:DispatchQueueRow;
  bucket:DispatchBucket;
  reason:string;
}
export const DISPATCH_BUCKETS:Record<DispatchBucket,string>={
  attention:'Needs attention',
  awaiting_dispatch:'Awaiting dispatch',
  with_rider:'With rider',
  delivered:'Delivered and paid',
  returned:'Returned / closed',
};
export const DISPATCH_ORDER:DispatchBucket[]=[
  'attention','with_rider','awaiting_dispatch','delivered','returned',
];

/**
 * A courier update is NOT a funds-received event. In particular, delivery
 * without a canonical paid order is immediately an attention item.
 */
export function categorizeDispatch(row:DispatchQueueRow):CategorizedDispatch|null {
  const held=row.allocation_status==='held';
  const paid=Boolean(row.paid_order_public_id);
  switch(row.delivery_status) {
    case 'delivery_failed':
      return {row,bucket:'attention',reason:'Delivery failed. Confirm where the parcel is.'};
    case 'delivered':
      if (!paid) return {row,bucket:'attention',reason:'Reported delivered, but Purkins has not recorded verified payment.'};
      if (row.paid_order_fulfillment_status!=='fulfilled') {
        return {row,bucket:'attention',reason:'Paid and reported delivered; confirm handover on the paid order.'};
      }
      return {row,bucket:'delivered',reason:'Delivered and linked to a paid order.'};
    case 'returned':
      return held && !paid
        ? {row,bucket:'attention',reason:'Parcel returned. Release the held inventory after checking the goods.'}
        : {row,bucket:'returned',reason:paid?'Returned after payment; handle refunds/returns on paid order.':'Returned and released.'};
    case 'dispatched':
      return {row,bucket:'with_rider',reason:'Parcel with courier. Delivery does not establish payment.'};
    case 'planned':
      return {row,bucket:'awaiting_dispatch',reason:'Courier booking prepared; not yet dispatched.'};
    case null:
      return held
        ? {row,bucket:'awaiting_dispatch',reason:'Stock allocated. Book the delivery and record rider details.'}
        : null;
  }
}
export interface DispatchOverview {
  items:CategorizedDispatch[];
  counts:Record<DispatchBucket,number>;
  truncated:boolean;
}
export async function getDispatchOverview(db:D1Database):Promise<DispatchOverview> {
  // Maximum displayed records, not an all-time company-wide delivery count.
  // Fetch an extra row so the UI accurately reports when results are capped.
  const rows=await db.prepare(
    'SELECT r.public_id AS request_public_id,r.buyer_name,r.phone,r.area,'+
    'r.status AS request_status,r.created_at AS request_created_at,'+
    'q.total_cents AS quote_total_cents,r.currency,'+
    'a.status AS allocation_status,a.held_at,'+
    'd.status AS delivery_status,d.courier,d.dropoff_location,d.recipient_name,'+
    'd.booking_reference,d.courier_fee_cents,d.courier_fee_payer,d.courier_fee_state,'+
    'd.updated_at AS delivery_updated_at,'+
    'o.public_id AS paid_order_public_id,o.fulfillment_status AS paid_order_fulfillment_status '+
    'FROM purkins_order_request_allocations a '+
    'JOIN purkins_order_requests r ON r.id=a.request_id '+
    'JOIN purkins_order_request_quotes q ON q.request_id=r.id '+
    'LEFT JOIN purkins_request_deliveries d ON d.request_id=r.id '+
    'LEFT JOIN purkins_offline_settlements s ON s.request_id=r.id '+
    'LEFT JOIN orders o ON o.id=s.order_id '+
    "WHERE q.fulfillment_method='delivery' AND (a.status='held' OR d.request_id IS NOT NULL) "+
    'ORDER BY COALESCE(d.updated_at,a.held_at) DESC,r.id DESC LIMIT 251',
  ).all<DispatchQueueRow>();
  const fetched=rows.results??[];
  const items=fetched.slice(0,250).map(categorizeDispatch)
    .filter((x):x is CategorizedDispatch=>x!==null);
  items.sort((a,b)=>DISPATCH_ORDER.indexOf(a.bucket)-DISPATCH_ORDER.indexOf(b.bucket));
  const counts:Record<DispatchBucket,number>={
    attention:0,awaiting_dispatch:0,with_rider:0,delivered:0,returned:0,
  };
  for(const item of items)counts[item.bucket]++;
  return {items,counts,truncated:fetched.length>250};
}
