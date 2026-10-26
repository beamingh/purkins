import type { D1Database } from '@cloudflare/workers-types';
import { getOrderRequest } from './orderRequestDb';
import { getOfflineStockHold } from './offlineStockHoldDb';
import { getOfflineQuote } from './offlineQuoteDb';
import {
  allowedDeliveryTransition,
  type CourierDeliveryInput, type DeliveryStatus,
} from './courierDelivery';

export interface CourierDeliveryRow {
  request_id:number;
  revision:number;
  status:DeliveryStatus;
  source_channel:CourierDeliveryInput['sourceChannel'];
  courier:CourierDeliveryInput['courier'];
  pickup_location:string;
  dropoff_location:string;
  recipient_name:string;
  recipient_phone:string;
  rider_name:string|null;
  rider_phone:string|null;
  booking_reference:string|null;
  courier_fee_cents:number|null;
  courier_fee_payer:CourierDeliveryInput['courierFeePayer'];
  courier_fee_state:CourierDeliveryInput['courierFeeState'];
  operator_note:string|null;
  change_nonce:string;
  updated_by:string;
  created_at:string;
  updated_at:string;
}

export async function getCourierDelivery(db:D1Database,requestId:number) {
  return db.prepare(
    'SELECT * FROM purkins_request_deliveries WHERE request_id=?',
  ).bind(requestId).first<CourierDeliveryRow>();
}

export async function listCourierDeliveryEvents(db:D1Database,requestId:number) {
  const rows=await db.prepare(
    'SELECT revision,status,source_channel,courier,pickup_location,dropoff_location,'+
    'recipient_name,recipient_phone,rider_name,rider_phone,booking_reference,'+
    'courier_fee_cents,courier_fee_payer,courier_fee_state,operator_note,changed_by,created_at '+
    'FROM purkins_request_delivery_events WHERE request_id=? ORDER BY revision DESC LIMIT 30',
  ).bind(requestId).all<{
    revision:number; status:DeliveryStatus; changed_by:string; created_at:string;
    courier_fee_cents:number|null; courier_fee_payer:string; courier_fee_state:string; booking_reference:string|null;
  }>();
  return rows.results??[];
}

export type DeliverySaveResult =
 | {ok:true;revision:number;alreadyRecorded:boolean}
 | {ok:false;error:string};

/**
 * A private courier-operation log, not a payment receipt or order fulfillment.
 * Persists a version and a matching event atomically, without touching stock,
 * the paid order, or the customer-facing checkout.
 */
export async function saveCourierDelivery(
  db:D1Database,publicId:string,input:CourierDeliveryInput,actor:string,
):Promise<DeliverySaveResult> {
  const request=await getOrderRequest(db,publicId);
  if(!request||request.status==='cancelled') {
    return {ok:false,error:'Request does not exist or is cancelled.'};
  }
  const hold=await getOfflineStockHold(db,request.id);
  if(!hold||hold.status!=='held') {
    return {ok:false,error:'Allocate the quoted stock before preparing courier dispatch.'};
  }
  const quote=await getOfflineQuote(db,request.id);
  if(!quote||quote.fulfillment_method!=='delivery'||quote.revision!==hold.quote_revision) {
    return {ok:false,error:'A current, agreed delivery quote and stock hold are required.'};
  }
  if(input.courierFeePayer==='customer_to_rider'&&quote.delivery_fee_cents!==0) {
    return {ok:false,error:'If the customer pays Yango directly, set the Purkins quote delivery fee to K0 before allocating stock. Do not charge delivery twice.'};
  }
  const prior=await getCourierDelivery(db,request.id);
  if(prior&&prior.revision===input.expectedRevision+1&&prior.change_nonce===input.nonce) {
    return {ok:true,revision:prior.revision,alreadyRecorded:true};
  }
  if((prior?.revision??0)!==input.expectedRevision||
     !allowedDeliveryTransition(prior?.status??null,input.status)) {
    return {ok:false,error:'This dispatch was changed in another tab, or the requested status transition is invalid. Reload.'};
  }
  const by=actor.trim().slice(0,200)||'admin-session';
  const params=[
    input.status,input.sourceChannel,input.courier,input.pickupLocation,input.dropoffLocation,
    input.recipientName,input.recipientPhone,input.riderName,input.riderPhone,
    input.bookingReference,input.courierFeeCents,input.courierFeePayer,input.courierFeeState,input.operatorNote,
    input.nonce,by,
  ];
  const guard="EXISTS (SELECT 1 FROM purkins_order_request_allocations a "+
    "JOIN purkins_order_request_quotes q ON q.request_id=a.request_id "+
    "WHERE a.request_id=? AND a.status='held' AND q.revision=a.quote_revision "+
    "AND q.fulfillment_method='delivery' AND "+
    "(? <> 'customer_to_rider' OR q.delivery_fee_cents=0))";
  const claim=input.expectedRevision===0
    ? db.prepare(
      'INSERT INTO purkins_request_deliveries '+
      '(request_id,revision,status,source_channel,courier,pickup_location,dropoff_location,'+
      'recipient_name,recipient_phone,rider_name,rider_phone,booking_reference,'+
      'courier_fee_cents,courier_fee_payer,courier_fee_state,operator_note,change_nonce,updated_by) '+
      'SELECT r.id,1,'+Array(16).fill('?').join(',')+
      ' FROM purkins_order_requests r WHERE r.public_id=? AND '+guard+
      ' ON CONFLICT(request_id) DO NOTHING RETURNING revision',
    ).bind(...params,request.public_id,request.id,input.courierFeePayer)
    : db.prepare(
      'UPDATE purkins_request_deliveries SET revision=revision+1,'+
      'status=?,source_channel=?,courier=?,pickup_location=?,dropoff_location=?,'+
      'recipient_name=?,recipient_phone=?,rider_name=?,rider_phone=?,booking_reference=?,'+
      'courier_fee_cents=?,courier_fee_payer=?,courier_fee_state=?,operator_note=?,change_nonce=?,updated_by=?,'+
      "updated_at=datetime('now') WHERE request_id=? AND revision=? AND "+guard+
      ' RETURNING revision',
    ).bind(...params,request.id,input.expectedRevision,request.id,input.courierFeePayer);
  const revision=input.expectedRevision+1;
  const audit=db.prepare(
    'INSERT INTO purkins_request_delivery_events '+
    '(request_id,revision,status,source_channel,courier,pickup_location,dropoff_location,'+
    'recipient_name,recipient_phone,rider_name,rider_phone,booking_reference,'+
    'courier_fee_cents,courier_fee_payer,courier_fee_state,operator_note,changed_by) '+
    'SELECT request_id,revision,status,source_channel,courier,pickup_location,dropoff_location,'+
    'recipient_name,recipient_phone,rider_name,rider_phone,booking_reference,'+
    'courier_fee_cents,courier_fee_payer,courier_fee_state,operator_note,updated_by '+
    'FROM purkins_request_deliveries WHERE request_id=? AND revision=? AND change_nonce=? '+
    'ON CONFLICT(request_id,revision) DO NOTHING',
  ).bind(request.id,revision,input.nonce);
  const results=await db.batch<{revision?:number}>([claim,audit]);
  if(results[0]?.results?.[0]?.revision===revision&&results[1]?.meta?.changes===1) {
    return {ok:true,revision,alreadyRecorded:false};
  }
  return {ok:false,error:'Dispatch details changed. Reload before making another update.'};
}
