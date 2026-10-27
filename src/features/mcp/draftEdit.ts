import type { D1Database } from '@cloudflare/workers-types';
import { parsePublicId } from '../ids/publicId';
import { requireVerifiedOwnerActorShape } from './ownerActor';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const money=(n:number|null)=>n===null||(Number.isSafeInteger(n)&&n>=0&&n<=99_999_999_999);
const conflict=(error:string)=>({ok:false,conflict:true,error});
const sha=async (data:unknown)=>{
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data)));
  return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
};

export interface DraftPatch {
  name?:string;
  description?:string|null;
  price_cents?:number;
  purchase_currency?:'ZMW'|'ZAR';
  purchase_cost_minor?:number|null;
  zar_to_zmw?:number|null;
  overhead_zwm_cents?:number;
  pricing_mode?:'manual'|'cost_based';
  condition_status?:'complete'|'review'|'incomplete';
  brand?:string|null;
  retail_tag_minor?:number|null;
  retail_tag_currency?:'ZMW'|'ZAR';
  internal_notes?:string|null;
  category_ids?:string[];
}
export interface DraftEditInput {
  request_id:string;
  product_id:string;
  expected_catalog_revision:number;
  patch:DraftPatch;
}
type Current={
  id:number;public_id:string;name:string;description:string|null;price_cents:number;
  active:number;mcp_catalog_revision:number;status:string;
  purchase_currency:'ZMW'|'ZAR';purchase_cost_minor:number|null;zar_to_zmw:number|null;
  overhead_zwm_cents:number;pricing_mode:'manual'|'cost_based';
  condition_status:'complete'|'review'|'incomplete';brand:string|null;
  retail_tag_minor:number|null;retail_tag_currency:'ZMW'|'ZAR';internal_notes:string|null;
};
type Receipt={actor:string;payload_sha256:string;completed:number;applied_revision:number|null;product_public_id:string};

/**
 * Edit only UNPUBLISHED drafts, including private cost and original retailer
 * tags, with an atomic optimistic revision check and durable idempotency receipt.
 * Categories use public IDs. Selling currency remains ZMW; this never publishes.
 */
export async function editGuardedPurkinsDraft(
  db:D1Database,actorRaw:string,input:DraftEditInput,
){
  const actor=requireVerifiedOwnerActorShape(actorRaw);
  if(!uuid.test(input.request_id)||!Number.isSafeInteger(input.expected_catalog_revision)||
     input.expected_catalog_revision<0)throw Error('Valid UUIDv4 and catalog revision required.');
  const product=parsePublicId(input.product_id,'product');
  if(!product)throw Error('A prod_ product ID is required.');
  const p=input.patch;
  const fields=Object.keys(p);
  const valid=new Set(['name','description','price_cents','purchase_currency','purchase_cost_minor',
    'zar_to_zmw','overhead_zwm_cents','pricing_mode','condition_status','brand',
    'retail_tag_minor','retail_tag_currency','internal_notes','category_ids']);
  if(!fields.length||fields.some(k=>!valid.has(k)))throw Error('Provide supported changes only.');
  if(p.name!==undefined&&(!p.name.trim()||p.name.length>200))throw Error('Name must be 1–200 characters.');
  if(p.description!==undefined&&p.description!==null&&p.description.length>5000)throw Error('Description too long.');
  if(p.brand!==undefined&&p.brand!==null&&p.brand.length>100)throw Error('Brand too long.');
  if(p.internal_notes!==undefined&&p.internal_notes!==null&&p.internal_notes.length>2000)throw Error('Notes too long.');
  if((p.price_cents!==undefined&&!money(p.price_cents))||
     (p.purchase_cost_minor!==undefined&&!money(p.purchase_cost_minor))||
     (p.retail_tag_minor!==undefined&&!money(p.retail_tag_minor))||
     (p.overhead_zwm_cents!==undefined&&!money(p.overhead_zwm_cents)))throw Error('Invalid monetary amount in minor units.');
  if(p.zar_to_zmw!==undefined&&p.zar_to_zmw!==null&&
    (!Number.isFinite(p.zar_to_zmw)||p.zar_to_zmw<=0||p.zar_to_zmw>1000))throw Error('Invalid saved ZMW-per-rand rate.');
  if(p.purchase_currency!==undefined&&!['ZMW','ZAR'].includes(p.purchase_currency))throw Error('Unsupported purchase currency.');
  if(p.retail_tag_currency!==undefined&&!['ZMW','ZAR'].includes(p.retail_tag_currency))throw Error('Unsupported tag currency.');
  if(p.pricing_mode!==undefined&&!['manual','cost_based'].includes(p.pricing_mode))throw Error('Invalid pricing mode.');
  if(p.condition_status!==undefined&&!['complete','review','incomplete'].includes(p.condition_status))throw Error('Invalid condition.');
  if(p.category_ids!==undefined&&(!Array.isArray(p.category_ids)||p.category_ids.length>15||
      new Set(p.category_ids).size!==p.category_ids.length||
      p.category_ids.some(id=>!parsePublicId(id,'category'))))throw Error('Invalid category IDs.');
  const key=input.request_id.toLowerCase();
  const hash=await sha({product,revision:input.expected_catalog_revision,patch:p});
  const prior=await db.prepare('SELECT actor,payload_sha256,completed,applied_revision,product_public_id '+
    'FROM purkins_mcp_draft_edit_receipts WHERE request_id=?')
    .bind(key).first<Receipt>();
  if(prior){
    if(prior.actor!==actor||prior.payload_sha256!==hash||prior.product_public_id!==product)
      return conflict('Request ID was used for a different owner or payload.');
    return prior.completed===1
      ? {ok:true,product_id:product,applied_revision:prior.applied_revision,replayed:true}
      : conflict('Previous edit is incomplete; inspect before proceeding.');
  }
  const row=await db.prepare('SELECT p.id,p.public_id,p.name,p.description,p.price_cents,'+
    'p.active,p.mcp_catalog_revision,i.status,i.purchase_currency,i.purchase_cost_minor,'+
    'i.zar_to_zmw,i.overhead_zwm_cents,i.pricing_mode,i.condition_status,'+
    'i.brand,i.retail_tag_minor,i.retail_tag_currency,i.internal_notes '+
    'FROM products p JOIN purkins_intake i ON i.product_id=p.id WHERE p.public_id=?')
    .bind(product).first<Current>();
  if(!row||row.active!==0||row.status!=='draft')return conflict('Only unpublished Purkins drafts can be edited.');
  if(row.mcp_catalog_revision!==input.expected_catalog_revision)return conflict('Catalog changed. Refresh draft and revision.');
  let categoryIds:number[]=[];
  if(p.category_ids!==undefined){
    for(const publicId of p.category_ids){
      const cat=await db.prepare('SELECT id FROM categories WHERE public_id=?')
        .bind(publicId).first<{id:number}>();
      if(!cat)return conflict('Category no longer exists. Refresh available categories.');
      categoryIds.push(cat.id);
    }
  }
  const nonce=crypto.randomUUID();
  const currentPurchase=p.purchase_currency??row.purchase_currency;
  const currentCost=p.purchase_cost_minor===undefined?row.purchase_cost_minor:p.purchase_cost_minor;
  const currentRate=p.zar_to_zmw===undefined?row.zar_to_zmw:p.zar_to_zmw;
  const currentMode=p.pricing_mode??row.pricing_mode;
  if(currentCost!==null&&currentPurchase==='ZAR'&&currentRate===null&&currentMode==='cost_based')
    return conflict('Cost-based rand inventory requires an entered historical ZMW-per-rand rate.');
  const ensure=db.prepare('INSERT INTO purkins_mcp_draft_edit_receipts '+
    '(request_id,actor,product_public_id,payload_sha256,nonce,expected_revision) '+
    'VALUES(?,?,?,?,?,?) ON CONFLICT(request_id) DO NOTHING RETURNING request_id')
    .bind(key,actor,product,hash,nonce,input.expected_catalog_revision);
  const updateProduct=db.prepare('UPDATE products SET name=?,description=?,price_cents=?,'+
    'mcp_catalog_revision=mcp_catalog_revision+1,last_mcp_draft_edit_nonce=? '+
    'WHERE public_id=? AND active=0 AND mcp_catalog_revision=? '+
    "AND EXISTS(SELECT 1 FROM purkins_intake i WHERE i.product_id=products.id AND i.status='draft') "+
    'AND EXISTS(SELECT 1 FROM purkins_mcp_draft_edit_receipts r WHERE r.request_id=? AND r.nonce=?) RETURNING id')
    .bind(p.name??row.name,p.description===undefined?row.description:p.description,
      p.price_cents??row.price_cents,nonce,product,input.expected_catalog_revision,key,nonce);
  const updateIntake=db.prepare('UPDATE purkins_intake SET purchase_currency=?,purchase_cost_minor=?,'+
    'zar_to_zmw=?,overhead_zwm_cents=?,pricing_mode=?,condition_status=?,'+
    'brand=?,retail_tag_minor=?,retail_tag_currency=?,internal_notes=?,updated_at=datetime(\'now\') '+
    'WHERE product_id=(SELECT id FROM products WHERE public_id=? AND last_mcp_draft_edit_nonce=?) '+
    "AND status='draft' RETURNING product_id")
    .bind(currentPurchase,currentCost,currentRate,p.overhead_zwm_cents??row.overhead_zwm_cents,
      currentMode,p.condition_status??row.condition_status,p.brand===undefined?row.brand:p.brand,
      p.retail_tag_minor===undefined?row.retail_tag_minor:p.retail_tag_minor,
      p.retail_tag_currency??row.retail_tag_currency,
      p.internal_notes===undefined?row.internal_notes:p.internal_notes,
      product,nonce);
  const statements=[ensure,updateProduct,updateIntake];
  if(p.category_ids!==undefined){
    statements.push(db.prepare('DELETE FROM product_categories WHERE product_id IN '+
      '(SELECT id FROM products WHERE public_id=? AND last_mcp_draft_edit_nonce=?)')
      .bind(product,nonce));
    for(const id of categoryIds)statements.push(
      db.prepare('INSERT INTO product_categories(product_id,category_id) '+
        'SELECT id,? FROM products WHERE public_id=? AND last_mcp_draft_edit_nonce=?')
        .bind(id,product,nonce));
  }
  statements.push(db.prepare('UPDATE purkins_mcp_draft_edit_receipts SET '+
    'completed=CASE WHEN EXISTS(SELECT 1 FROM products p JOIN purkins_intake i ON i.product_id=p.id '+
    "WHERE p.public_id=? AND p.last_mcp_draft_edit_nonce=? AND p.active=0 AND i.status='draft') "+
    'THEN 1 ELSE -1 END,'+
    'applied_revision=(SELECT mcp_catalog_revision FROM products WHERE public_id=? AND last_mcp_draft_edit_nonce=?) '+
    'WHERE request_id=? AND nonce=? RETURNING completed,applied_revision')
    .bind(product,nonce,product,nonce,key,nonce));
  try{
    const results=await db.batch(statements);
    const latest=results[results.length-1]?.results?.[0] as {completed?:number;applied_revision?:number}|undefined;
    if(results[1]?.results?.length&&results[2]?.results?.length&&latest?.completed===1)
      return {ok:true,product_id:product,applied_revision:latest.applied_revision,replayed:false};
    return conflict('Stale draft or concurrent edit. Refresh before retrying.');
  }catch(error){
    if(/CHECK|UNIQUE|constraint/i.test(String(error)))
      return conflict('Edit not applied. Draft changed or a receipt conflicted.');
    throw error;
  }
}
