import type { D1Database } from '@cloudflare/workers-types';
import { parsePublicId } from '../ids/publicId';
import { requireVerifiedOwnerActorShape } from './ownerActor';
import { recordManualSale } from '../purkins/manualSaleDb';
import { parseManualSaleForm } from '../purkins/manualSale';
import { saveCourierDelivery } from '../purkins/courierDeliveryDb';
import { parseCourierDelivery } from '../purkins/courierDelivery';
import { settleHeldOfflineOrder } from '../purkins/offlineSettlementDb';
import { parseOfflineSettlement } from '../purkins/offlineSettlement';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha=async(value:unknown)=>{
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
};
const conflict=(error:string)=>({ok:false,error,conflict:true});
type Receipt={actor:string;payload_sha256:string;completed:number;
  order_public_id?:string|null;applied_revision?:number|null;request_public_id?:string};
type Channel='walk_in'|'whatsapp'|'facebook'|'phone'|'other';
type Tender='cash'|'airtel_money'|'mtn_momo'|'zamtel_money'|'bank_transfer'|'other';
const claim=async(
  db:D1Database,table:'purkins_mcp_paid_sale_receipts'|'purkins_mcp_dispatch_receipts'|
    'purkins_mcp_settlement_receipts',
  key:string,actor:string,hash:string,publicId?:string,
):Promise<Receipt|null>=>{
  const previous=await db.prepare('SELECT * FROM '+table+' WHERE request_id=?').bind(key).first<Receipt>();
  if(previous)return previous;
  const names=publicId?'request_id,actor,payload_sha256,request_public_id':'request_id,actor,payload_sha256';
  const values=publicId?'?,?,?,?':'?,?,?';
  await db.prepare('INSERT INTO '+table+' ('+names+') VALUES ('+values+') ON CONFLICT(request_id) DO NOTHING')
    .bind(...(publicId?[key,actor,hash,publicId]:[key,actor,hash])).run();
  return db.prepare('SELECT * FROM '+table+' WHERE request_id=?').bind(key).first<Receipt>();
};
function assertReceipt(r:Receipt|null,actor:string,hash:string,publicId?:string){
  if(!r||r.actor!==actor||r.payload_sha256!==hash||
     (publicId&&r.request_public_id!==publicId))return conflict('Request ID belongs to a different operation, payload or operator.');
  return null;
}
export interface PaidItem{product_id:string;variant_id:string|null;quantity:number;unit_price_cents:number}
export interface PaidSaleInput {
  request_id:string;channel:Channel;tender:Tender;customer_name:string|null;
  email:string|null;note:string|null;fulfillment:'fulfilled'|'unfulfilled';
  delivery_method:'pickup'|'shipping';items:PaidItem[];
  expected_total_cents:number;confirm_funds_received:true;
}
/** Explicitly VERIFIED already-received payment, not a pending COD dispatch. */
export async function recordGuardedPaidSale(db:D1Database,actorRaw:string,input:PaidSaleInput){
  const actor=requireVerifiedOwnerActorShape(actorRaw);
  if(!UUID.test(input.request_id)||input.confirm_funds_received!==true)throw Error('Confirm received funds and UUIDv4 request ID.');
  if(!Number.isSafeInteger(input.expected_total_cents)||input.expected_total_cents<=0||
    !Array.isArray(input.items)||!input.items.length||input.items.length>30)throw Error('Invalid sale total or order lines.');
  const f=new FormData();
  const set=(k:string,v:unknown)=>f.set(k,String(v??''));
  set('idempotency_key',input.request_id.toLowerCase());
  set('channel',input.channel);set('tender',input.tender);
  set('customer_name',input.customer_name);set('email',input.email);set('note',input.note);
  set('fulfillment',input.fulfillment);set('delivery_method',input.delivery_method);
  let total=0;
  for(const l of input.items){
    if(!parsePublicId(l.product_id,'product')||
      (l.variant_id!==null&&!parsePublicId(l.variant_id,'variant'))||
      !Number.isSafeInteger(l.quantity)||l.quantity<1||l.quantity>9999||
      !Number.isSafeInteger(l.unit_price_cents)||l.unit_price_cents<0||l.unit_price_cents>999_999_999)
      return conflict('Invalid product, variant, quantity or unit price.');
    total+=l.quantity*l.unit_price_cents;
    f.append('item',l.product_id+'|'+(l.variant_id??''));
    f.append('quantity',String(l.quantity));
    f.append('unit_price',(l.unit_price_cents/100).toFixed(2));
  }
  if(total!==input.expected_total_cents)return conflict('Expected and entered paid totals do not match.');
  const parsed=parseManualSaleForm(f);
  if(!parsed.ok)return conflict(parsed.error);
  const key=input.request_id.toLowerCase(),hash=await sha(input);
  const r=await claim(db,'purkins_mcp_paid_sale_receipts',key,actor,hash);
  const invalid=assertReceipt(r,actor,hash);if(invalid)return invalid;
  if(r!.completed===1)return {ok:true,order_public_id:r!.order_public_id,replayed:true};
  const out=await recordManualSale(db,parsed.value,'zmw',actor);
  if(!out.ok)return conflict(out.error);
  await db.prepare('UPDATE purkins_mcp_paid_sale_receipts SET completed=1,order_public_id=? '+
    'WHERE request_id=? AND actor=? AND payload_sha256=? AND completed=0')
    .bind(out.orderPublicId,key,actor,hash).run();
  return {ok:true,order_public_id:out.orderPublicId,replayed:out.alreadyRecorded};
}
export interface DispatchInput {
  request_id:string;request_public_id:string;expected_revision:number;
  status:string;source_channel:string;courier:string;pickup_location:string;
  dropoff_location:string;recipient_name:string;recipient_phone:string;
  rider_name:string|null;rider_phone:string|null;booking_reference:string|null;
  courier_fee_cents:number|null;courier_fee_payer:string;courier_fee_state:string;
  operator_note:string|null;
}
/** Calls the existing append-only courier-event workflow. Never marks paid. */
export async function recordGuardedDispatch(db:D1Database,actorRaw:string,input:DispatchInput){
  const actor=requireVerifiedOwnerActorShape(actorRaw);
  const req=parsePublicId(input.request_public_id,'orderRequest');
  if(!UUID.test(input.request_id)||!req)return conflict('Valid UUIDv4 and req_ reference required.');
  const f=new FormData(),set=(k:string,v:unknown)=>f.set(k,String(v??''));
  set('delivery_nonce',input.request_id.toLowerCase());
  set('delivery_revision',input.expected_revision);set('delivery_status',input.status);
  set('source_channel',input.source_channel);set('courier',input.courier);
  set('pickup_location',input.pickup_location);set('dropoff_location',input.dropoff_location);
  set('recipient_name',input.recipient_name);set('recipient_phone',input.recipient_phone);
  set('rider_name',input.rider_name);set('rider_phone',input.rider_phone);
  set('booking_reference',input.booking_reference);
  set('courier_fee',input.courier_fee_cents==null?'':(input.courier_fee_cents/100).toFixed(2));
  set('courier_fee_payer',input.courier_fee_payer);set('courier_fee_state',input.courier_fee_state);
  set('delivery_note',input.operator_note);
  const parsed=parseCourierDelivery(f);
  if(!parsed.ok)return conflict(parsed.error);
  const key=input.request_id.toLowerCase(),hash=await sha(input);
  const r=await claim(db,'purkins_mcp_dispatch_receipts',key,actor,hash,req);
  const invalid=assertReceipt(r,actor,hash,req);if(invalid)return invalid;
  if(r!.completed===1)return {ok:true,request_public_id:req,revision:r!.applied_revision,replayed:true,paid:false};
  const out=await saveCourierDelivery(db,req,parsed.value,actor);
  if(!out.ok)return conflict(out.error);
  await db.prepare('UPDATE purkins_mcp_dispatch_receipts SET completed=1,applied_revision=? '+
    'WHERE request_id=? AND actor=? AND payload_sha256=? AND completed=0')
    .bind(out.revision,key,actor,hash).run();
  return {ok:true,request_public_id:req,revision:out.revision,replayed:out.alreadyRecorded,paid:false};
}
export interface SettlementInput {
  request_id:string;request_public_id:string;quote_revision:number;
  tender:Tender;channel:Channel;payment_reference:string|null;confirmation_note:string;
  fulfillment:'fulfilled'|'unfulfilled';confirm_funds_received:true;
  confirm_recipient_account_verified:true;
}
/** Validates actual recipient-side funds confirmation; no buyer screenshot trust. */
export async function settleGuardedCodPayment(db:D1Database,actorRaw:string,input:SettlementInput){
  const actor=requireVerifiedOwnerActorShape(actorRaw);
  const req=parsePublicId(input.request_public_id,'orderRequest');
  if(!UUID.test(input.request_id)||!req||input.confirm_funds_received!==true||
    input.confirm_recipient_account_verified!==true)return conflict('Confirm verified recipient funds and valid request ID.');
  const form=new FormData(),set=(k:string,v:unknown)=>form.set(k,String(v??''));
  set('payment_nonce',input.request_id.toLowerCase());
  set('payment_quote_revision',input.quote_revision);set('tender',input.tender);
  set('channel',input.channel);set('payment_reference',input.payment_reference);
  set('payment_confirmation_note',input.confirmation_note);set('fulfillment',input.fulfillment);
  set('verified_received','yes');
  set(input.tender==='cash'?'cash_counted':'recipient_verified','yes');
  const parsed=parseOfflineSettlement(form);
  if(!parsed.ok)return conflict(parsed.error);
  const key=input.request_id.toLowerCase(),hash=await sha(input);
  const r=await claim(db,'purkins_mcp_settlement_receipts',key,actor,hash,req);
  const invalid=assertReceipt(r,actor,hash,req);if(invalid)return invalid;
  if(r!.completed===1)return {ok:true,request_public_id:req,order_public_id:r!.order_public_id,replayed:true};
  const out=await settleHeldOfflineOrder(db,req,parsed.value,actor);
  if(!out.ok)return conflict(out.error);
  await db.prepare('UPDATE purkins_mcp_settlement_receipts SET completed=1,order_public_id=? '+
    'WHERE request_id=? AND actor=? AND payload_sha256=? AND completed=0')
    .bind(out.orderPublicId,key,actor,hash).run();
  return {ok:true,request_public_id:req,order_public_id:out.orderPublicId,replayed:out.alreadyRecorded};
}
