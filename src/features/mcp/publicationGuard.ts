import type { D1Database } from '@cloudflare/workers-types';
import { parsePublicId } from '../ids/publicId';
import { checkIntakeForApproval } from '../purkins/db';
import { requireVerifiedOwnerActorShape } from './ownerActor';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Action='publish'|'unpublish';
type Receipt={
  request_id:string;actor:string;action:Action;payload_sha256:string;
  nonce:string;product_public_id:string;expected_revision:number;
  completed:number;cache_purged:number;
};
export interface PublicationInput {
  request_id:string;product_id:string;expected_catalog_revision:number;
  confirm_publish?:boolean;
}
export type PublicationResult=
  | {ok:true;product_id:string;published:boolean;applied:boolean;
      cache_purged:boolean;replayed:boolean;warning?:string}
  | {ok:false;conflict:boolean;error:string};
const conflict=(error:string):PublicationResult=>({ok:false,conflict:true,error});
async function sha(data:unknown){
  const buffer=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data)));
  return [...new Uint8Array(buffer)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
async function receipt(db:D1Database,id:string) {
  return db.prepare('SELECT * FROM purkins_mcp_publication_receipts WHERE request_id=?')
    .bind(id).first<Receipt>();
}
type Purge=()=>Promise<void>;

/**
 * Publish and hide operations are audited, idempotent and compare-and-swap.
 * The SAME revision covers Admin price, intake, photo and variant updates by
 * database triggers. Validation happens before the commit, then the revision
 * predicate in the atomic D1 batch rejects any intervening edits.
 *
 * The public storefront is a SEPARATE Worker with a cross-version cache. An
 * authorized public Worker purge is required; this function never reports
 * cache_purged:true until the public Worker confirms it. If a post-commit purge
 * fails, retry the SAME request_id to complete the purge without re-mutating D1.
 */
export async function applyGuardedPublication(
  db:D1Database, actorValue:string, action:Action, input:PublicationInput,
  purgePublicCache:Purge | null,
):Promise<PublicationResult>{
  const actor=requireVerifiedOwnerActorShape(actorValue);
  if(!UUID.test(input.request_id))throw Error('UUIDv4 request_id required.');
  const id=input.request_id.toLowerCase(), product=parsePublicId(input.product_id,'product');
  if(!product||!Number.isSafeInteger(input.expected_catalog_revision)||
     input.expected_catalog_revision<0)throw Error('Use prod_ ID and nonnegative catalog_revision.');
  if(action==='publish' && input.confirm_publish!==true) {
    return conflict('Explicit confirm_publish: true is required before publication.');
  }
  if(!purgePublicCache)return conflict('Public storefront cache purge is not configured. Publication disabled.');
  const hash=await sha({action,product,revision:input.expected_catalog_revision,
    confirm_publish:action==='publish'?true:undefined});
  const prior=await receipt(db,id);
  if(prior && (prior.actor!==actor || prior.action!==action ||
     prior.payload_sha256!==hash || prior.product_public_id!==product)) {
    return conflict('Request ID belongs to a different publication operation or owner.');
  }
  if(prior && prior.completed!==1) {
    return conflict('Incomplete publication receipt; investigate before another change.');
  }

  let replayed=Boolean(prior);
  if(!prior){
    const item=await db.prepare('SELECT p.id,p.active,p.mcp_catalog_revision AS revision,i.status '+
      'FROM products p JOIN purkins_intake i ON i.product_id=p.id WHERE p.public_id=?')
      .bind(product).first<{id:number;active:number;revision:number;status:string}>();
    if(!item)return conflict('Purkins stock item not found.');
    if(item.revision!==input.expected_catalog_revision) {
      return conflict('Catalog data has changed. Review the latest draft and revision.');
    }
    const targetBefore=action==='publish'?0:1;
    const currentStatus=action==='publish'?'draft':'approved';
    if(item.active!==targetBefore||item.status!==currentStatus) {
      return conflict('Product is already in another publication state; refresh.');
    }
    if(action==='publish'){
      // Reuses the authoritative Admin approval checks. Revision triggers
      // invalidate this decision if any relevant data changes before commit.
      const reason=await checkIntakeForApproval(db,item.id);
      if(reason)return conflict(reason);
    }
    const nonce=crypto.randomUUID(), newActive=action==='publish'?1:0;
    const newStatus=action==='publish'?'approved':'draft';
    try{
      const result=await db.batch([
        db.prepare('INSERT INTO purkins_mcp_publication_receipts '+
          '(request_id,actor,action,payload_sha256,nonce,product_public_id,expected_revision) '+
          'VALUES (?,?,?,?,?,?,?) ON CONFLICT(request_id) DO NOTHING RETURNING request_id')
          .bind(id,actor,action,hash,nonce,product,input.expected_catalog_revision),
        db.prepare('UPDATE products SET active=?,last_mcp_publication_nonce=? '+
          'WHERE public_id=? AND active=? AND mcp_catalog_revision=? '+
          'AND EXISTS(SELECT 1 FROM purkins_intake i WHERE i.product_id=products.id AND i.status=?) '+
          'AND EXISTS(SELECT 1 FROM purkins_mcp_publication_receipts r '+
          'WHERE r.request_id=? AND r.nonce=?) RETURNING id')
          .bind(newActive,nonce,product,targetBefore,input.expected_catalog_revision,currentStatus,id,nonce),
        db.prepare('UPDATE purkins_intake SET status=?,updated_at=datetime(\'now\') '+
          'WHERE status=? AND product_id IN '+
          '(SELECT p.id FROM products p WHERE p.public_id=? AND p.active=? '+
          'AND p.last_mcp_publication_nonce=?) RETURNING product_id')
          .bind(newStatus,currentStatus,product,newActive,nonce),
        db.prepare('UPDATE purkins_mcp_publication_receipts SET completed=CASE WHEN EXISTS('+
          'SELECT 1 FROM products p JOIN purkins_intake i ON i.product_id=p.id '+
          'WHERE p.public_id=? AND p.active=? AND i.status=? '+
          'AND p.last_mcp_publication_nonce=?) THEN 1 ELSE -1 END '+
          'WHERE request_id=? AND nonce=? RETURNING completed')
          .bind(product,newActive,newStatus,nonce,id,nonce),
      ]);
      if(!result[1]?.results?.length||!result[2]?.results?.length||
        (result[3]?.results?.[0] as {completed?:number}|undefined)?.completed!==1){
        return conflict('Publication did not commit; refresh catalog and retry with a new UUID.');
      }
    }catch(error){
      const existing=await receipt(db,id);
      if(existing?.completed===1 && existing.actor===actor && existing.payload_sha256===hash) {
        replayed=true;
      }else if(/constraint|CHECK|UNIQUE/i.test(String(error))) {
        return conflict('Catalog changed while publishing. No state transition committed.');
      }else throw error;
    }
  }

  // Repeatable after partial success. Any failure here is explicitly reported:
  // the D1 operation is already committed and must NEVER be blindly retried
  // with a new request ID.
  const saved=await receipt(db,id);
  if(!saved||saved.completed!==1)return conflict('Publication receipt not confirmed; inspect D1 before retry.');
  if(saved.cache_purged===1) {
    return {ok:true,product_id:product,published:action==='publish',
      applied:true,cache_purged:true,replayed};
  }
  try {
    await purgePublicCache();
    await db.prepare('UPDATE purkins_mcp_publication_receipts SET cache_purged=1 '+
      'WHERE request_id=? AND nonce=? AND completed=1')
      .bind(id,saved.nonce).run();
    return {ok:true,product_id:product,published:action==='publish',
      applied:true,cache_purged:true,replayed};
  }catch {
    return {ok:true,product_id:product,published:action==='publish',
      applied:true,cache_purged:false,replayed,
      warning:'D1 state changed, but the separate public Worker cache purge FAILED. Retry SAME request_id and payload until cache_purged=true; do not claim storefront visibility is current.'};
  }
}
