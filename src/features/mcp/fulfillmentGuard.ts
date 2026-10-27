import type { D1Database } from '@cloudflare/workers-types';
import { parseOrderOrLegacyPublicId } from '../ids/publicId';
import { requireVerifiedOwnerActorShape } from './ownerActor';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONFLICT=(error:string)=>({ok:false,error,conflict:true});
type Receipt={actor:string;payload_sha256:string;order_public_id:string;completed:number};
export interface HandoverInput {
  request_id:string;order_public_id:string;
  tracking_carrier:string|null;tracking_number:string|null;
  confirm_handed_over:true;
}
/** Exactly-once owner-attested fulfillment; never presumes rider delivery is paid. */
export async function fulfillGuardedPurkinsOrder(db:D1Database,actorRaw:string,input:HandoverInput){
  const actor=requireVerifiedOwnerActorShape(actorRaw);
  const id=parseOrderOrLegacyPublicId(input.order_public_id,'order');
  if(!UUID.test(input.request_id)||!id||input.confirm_handed_over!==true)
    return CONFLICT('Explicit confirmed handover, UUIDv4 and valid paid order reference required.');
  const carrier=input.tracking_carrier?.trim()||null;
  const tracking=input.tracking_number?.trim()||null;
  if((carrier?.length??0)>100||(tracking?.length??0)>150)
    return CONFLICT('Invalid carrier or tracking reference.');
  const key=input.request_id.toLowerCase();
  const raw=JSON.stringify({order:id,carrier,tracking,confirmed:true});
  const dig=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
  const hash=Array.from(new Uint8Array(dig),b=>b.toString(16).padStart(2,'0')).join('');
  const prior=await db.prepare('SELECT actor,payload_sha256,order_public_id,completed '+
    'FROM purkins_mcp_fulfillment_receipts WHERE request_id=?').bind(key).first<Receipt>();
  if(prior){
    if(prior.actor!==actor||prior.payload_sha256!==hash||prior.order_public_id!==id)
      return CONFLICT('Request ID used with different handover details or operator.');
    return prior.completed===1?{ok:true,order_public_id:id,replayed:true}:
      CONFLICT('Previous handover receipt incomplete; inspect the order before retrying.');
  }
  const nonce=crypto.randomUUID();
  try{
    const results=await db.batch([
      db.prepare('INSERT INTO purkins_mcp_fulfillment_receipts '+
        '(request_id,actor,payload_sha256,order_public_id,nonce) VALUES(?,?,?,?,?) '+
        'ON CONFLICT(request_id) DO NOTHING RETURNING request_id')
        .bind(key,actor,hash,id,nonce),
      db.prepare("UPDATE orders SET fulfillment_status='fulfilled',fulfilled_at=datetime('now'),"+
        'tracking_carrier=?,tracking_number=?,last_mcp_fulfillment_nonce=? WHERE public_id=? '+
        "AND status='paid' AND fulfillment_status='unfulfilled' "+
        'AND EXISTS (SELECT 1 FROM purkins_mcp_fulfillment_receipts r '+
        'WHERE r.request_id=? AND r.nonce=?) RETURNING public_id')
        .bind(carrier,tracking,nonce,id,key,nonce),
      db.prepare('UPDATE purkins_mcp_fulfillment_receipts SET completed=CASE WHEN EXISTS('+
        "SELECT 1 FROM orders WHERE public_id=? AND status='paid' AND fulfillment_status='fulfilled' AND last_mcp_fulfillment_nonce=? "+
        ') THEN 1 ELSE -1 END WHERE request_id=? AND nonce=? RETURNING completed')
        .bind(id,nonce,key,nonce),
    ]);
    if(results[1]?.results?.length&&
      (results[2]?.results?.[0] as {completed?:number}|undefined)?.completed===1)
      return {ok:true,order_public_id:id,replayed:false};
    return CONFLICT('Order was not paid, already fulfilled or changed; refresh order status.');
  }catch(error){
    if(/CHECK|constraint|UNIQUE/i.test(String(error)))
      return CONFLICT('Order changed or was not eligible. No fulfillment was applied.');
    throw error;
  }
}
