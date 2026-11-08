import type { D1Database } from '@cloudflare/workers-types';
import { parsePublicId } from '../ids/publicId';
import { editGuardedPurkinsDraft, type DraftEditInput } from './draftEdit';
import { requireVerifiedOwnerActorShape } from './ownerActor';

/** Deliberately narrow bulk edits: never touch price, units, publication or URL. */
export type BulkDraftItem = DraftEditInput & {
  patch: Pick<DraftEditInput['patch'],
    'name'|'description'|'original_supplier_name'|'supplier_reference'>;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const editable = new Set(['name','description','original_supplier_name','supplier_reference']);
const limits:Record<string,number> = {
  name:200, description:5000, original_supplier_name:200, supplier_reference:250,
};
type Snapshot = {
  name:string; slug:string; description:string|null;active:number;
  mcp_catalog_revision:number;status:string;
  original_supplier_name:string|null;supplier_reference:string|null;
};

export function validateBulkDraftItems(items:readonly BulkDraftItem[]):string|null {
  if (!Array.isArray(items) || items.length<1 || items.length>8)
    return 'Select between 1 and 8 products for review.';
  const products=new Set<string>(),requests=new Set<string>();
  for (const item of items) {
    if(!parsePublicId(item.product_id,'product')||!UUID.test(item.request_id)||
       !Number.isSafeInteger(item.expected_catalog_revision)||item.expected_catalog_revision<0)
      return 'Every item needs a prod_ ID, UUIDv4 request ID and current revision.';
    if(products.has(item.product_id)||requests.has(item.request_id.toLowerCase()))
      return 'Duplicate product or request ID in this batch.';
    products.add(item.product_id);requests.add(item.request_id.toLowerCase());
    if(!item.patch || typeof item.patch!=='object' || Array.isArray(item.patch))
      return 'Every item needs a proposed change.';
    const fields=Object.keys(item.patch);
    if(!fields.length||fields.some(k=>!editable.has(k)))
      return 'Bulk edits support titles, descriptions and private supplier references only.';
    for(const [field,value] of Object.entries(item.patch)) {
      if(value===undefined) return 'Omit unchanged fields instead of supplying undefined.';
      if(value===null && field==='name')return 'A product title cannot be empty.';
      if(value!==null && (typeof value!=='string'||value.length>limits[field]!))
        return 'Invalid or oversized value for '+field+'.';
      if(field==='name' && (value as string).trim().length===0)
        return 'A product title cannot be empty.';
    }
  }
  return null;
}

export async function bulkReviewHash(items:readonly BulkDraftItem[]):Promise<string> {
  const payload=items.map(item=>({
    product_id:item.product_id,request_id:item.request_id.toLowerCase(),
    expected_catalog_revision:item.expected_catalog_revision,
    patch:Object.fromEntries(Object.entries(item.patch).sort(([a],[b])=>a.localeCompare(b))),
  }));
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)));
  return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

/** Read-only, explicit before/after diff. No idempotency receipts or stock changes. */
export async function previewGuardedPurkinsBulk(
  db:D1Database,items:readonly BulkDraftItem[],
) {
  const error=validateBulkDraftItems(items);
  if(error)return {ok:false,error};
  const changes=[];
  for (const item of items) {
    const row=await db.prepare(
      'SELECT p.name,p.slug,p.description,p.active,p.mcp_catalog_revision,'+
      'i.status,i.original_supplier_name,i.supplier_reference '+
      'FROM products p JOIN purkins_intake i ON i.product_id=p.id WHERE p.public_id=?',
    ).bind(item.product_id).first<Snapshot>();
    if(!row||row.active!==0||row.status!=='draft')
      return {ok:false,error:'Batch contains a missing or published product: '+item.product_id};
    if(row.mcp_catalog_revision!==item.expected_catalog_revision)
      return {ok:false,error:'Stale product. Refresh revision before reviewing: '+item.product_id};
    const current={
      name:row.name,description:row.description,
      original_supplier_name:row.original_supplier_name,supplier_reference:row.supplier_reference,
    };
    const after={...current,...item.patch};
    changes.push({product_id:item.product_id,slug_unchanged:row.slug,
      expected_catalog_revision:item.expected_catalog_revision,before:current,after});
  }
  return {ok:true,review_hash:await bulkReviewHash(items),changes,
    note:'Preview only. No records changed. Confirm the exact diff before applying.'};
}

/** Sequential, per-item receipt-backed updates, allowing transparent partial outcomes.
 * Repeating the SAME payload and UUIDs replays successful items, rather than
 * editing twice. Failed items report their own conflicts and are never hidden. */
export async function applyGuardedPurkinsBulk(
  db:D1Database,actorValue:string,
  input:{items:BulkDraftItem[];review_hash:string;confirm_apply:true},
) {
  const actor=requireVerifiedOwnerActorShape(actorValue);
  const error=validateBulkDraftItems(input.items);
  if(error)return {ok:false,error};
  const digest=await bulkReviewHash(input.items);
  if(digest!==input.review_hash)
    return {ok:false,error:'Review hash mismatch. Preview this exact batch again; nothing was saved.'};
  if(input.confirm_apply!==true)return {ok:false,error:'Explicit owner confirmation required.'};
  const results=[];
  for(const item of input.items){
    try {
      const saved=await editGuardedPurkinsDraft(db,actor,item);
      results.push({product_id:item.product_id,...saved});
    } catch {
      results.push({product_id:item.product_id,ok:false,
        error:'Outcome uncertain. Inspect this draft and retry with the SAME request ID.'});
    }
  }
  return {ok:results.every(item=>item.ok),results,
    applied:results.filter(item=>item.ok && !item.replayed).length,
    replayed:results.filter(item=>item.ok && item.replayed).length,
    failed:results.filter(item=>!item.ok).length,
    note:'Updates are per-item transactions, not all-or-none. Inspect failures individually.'};
}
