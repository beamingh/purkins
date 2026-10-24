import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { D1Database } from '@cloudflare/workers-types';
import { getProductByPublicId, listProductImages } from '../../src/features/products/db';
import { getIntake } from '../../src/features/purkins/db';
import { landedCostCents } from '../../src/features/purkins/intake';
import { listVariants } from '../../src/features/products/variants';
import { parsePublicId } from '../../src/features/ids/publicId';
import { applyGuardedGalleryMutation } from '../../src/features/mcp/galleryGuard';

const reply=(data: unknown) => ({
  content:[{type:'text' as const,text:JSON.stringify(data,null,2)}],
});
const requestKey=z.string().uuid();
const id=z.string().min(1);
const revision=z.number().int().nonnegative();

/** Read-only checklist, never grants publication approval or changes product state. */
export async function reviewPurkinsDraft(db: D1Database, productId: string) {
  const canonical=parsePublicId(productId,'product');
  if(!canonical) return {error:'Provide a prod_ public ID.'};
  const product=await getProductByPublicId(db,canonical);
  if(!product) return {error:'Product not found.'};
  const intake=await getIntake(db,product.id);
  if(!intake) return {error:'This product has no Purkins intake record.'};
  const variants=await listVariants(db,product.id,true);
  const images=await listProductImages(db,product.id);
  const landed=landedCostCents(intake);
  const blockers:string[]=[];
  const notes:string[]=[];
  if(product.active!==0 || intake.status!=='draft') {
    blockers.push('This item is not currently an unpublished draft; use the separate owner publication workflow.');
  }
  if(product.currency.toLowerCase()!=='zmw') blockers.push('Selling currency must be ZMW.');
  if((intake.condition_status??'complete')!=='complete') blockers.push('Review physical stock condition.');
  if(intake.pricing_mode!=='manual' && intake.purchase_cost_minor===null) {
    blockers.push('Cost-based pricing requires the actual purchase cost.');
  }
  if(intake.pricing_mode!=='manual' && landed===null) {
    blockers.push('Supply purchase cost and, for ZAR costs, the ZMW-per-rand rate.');
  }
  if(product.price_cents<=0) blockers.push('Set a positive selling price.');
  if(landed!==null && product.price_cents<landed) {
    blockers.push('Product selling price is below estimated landed cost.');
  }
  if(!product.image_key || images.length===0) blockers.push('Attach and select a product photograph.');
  const active=variants.filter(v=>v.active===1);
  if(active.some(v=>v.price_cents<=0)) blockers.push('Every active size/colour needs a positive selling price.');
  if(landed!==null && active.some(v=>v.price_cents<landed)) {
    blockers.push('At least one active size/colour is below estimated landed cost.');
  }
  if(product.requires_shipping && product.weight_grams===null && active.every(v=>v.weight_grams===null)) {
    notes.push('Packed weight is missing; shipping checkout may require it.');
  }
  return {
    id:canonical, name:product.name, active:product.active===1,
    intake_status:intake.status, condition_status:intake.condition_status,
    pricing_mode:intake.pricing_mode, purchase_currency:intake.purchase_currency,
    purchase_cost_minor:intake.purchase_cost_minor, landed_cost_zwm_cents:landed,
    selling_price_zwm_cents:product.price_cents,
    gallery_revision:(product as typeof product & {mcp_gallery_revision?:number}).mcp_gallery_revision??0,
    photo_count:images.length, primary_photo_present:Boolean(product.image_key),
    size_variant_count:variants.length, total_size_units:active.reduce((n,v)=>n+v.stock,0),
    blockers,notes,potentially_ready_for_owner_review:blockers.length===0,
    caveat:'This is a read-only checklist, not approval. The authoritative publication flow must recheck every condition and purge the public storefront cache.',
  };
}

export function registerGuardedPurkinsGalleryTools(
  server: McpServer, db: D1Database, allowWrites=false, actor?:string,
):void {
  server.registerTool('review_purkins_draft',{
    description:'Owner-only read-only pre-publication checklist: missing photo, price, actual cost, condition, variants and possible shipping-weight concerns. NEVER publishes, and is not a publication authorization.',
    inputSchema:{product_id:id},
  },async ({product_id})=>reply(await reviewPurkinsDraft(db,product_id)));

  if(!allowWrites||!actor)return;
  server.registerTool('attach_guarded_purkins_photo',{
    description:'Attach one existing med_ library image to an UNPUBLISHED draft only. Owner-only, idempotent UUIDv4 request_id and expected gallery_revision from get_purkins_gallery. Upload the actual image to protected Admin Media first. Does not publish.',
    inputSchema:{request_id:requestKey,product_id:id,media_id:id,
      expected_revision:revision,alt:z.string().max(300).optional()},
  },async (args)=>{
    try {return reply(await applyGuardedGalleryMutation(db,actor,{...args,action:'gallery.attach'}));}
    catch{return reply({error:'Gallery operation uncertain. Refresh/retry with the SAME request_id; do not assume failure.'});}
  });

  server.registerTool('set_guarded_purkins_photo_alt',{
    description:'Update descriptive alt text for a pimg_ photo on an UNPUBLISHED draft. Requires current gallery_revision and retry-safe UUIDv4 request_id. Does not publish.',
    inputSchema:{request_id:requestKey,product_id:id,image_id:id,
      expected_revision:revision,alt:z.string().max(300)},
  },async (args)=>{
    try {return reply(await applyGuardedGalleryMutation(db,actor,{...args,action:'gallery.alt'}));}
    catch{return reply({error:'Gallery operation uncertain. Refresh/retry with the SAME request_id.'});}
  });

  server.registerTool('make_guarded_purkins_photo_primary',{
    description:'Select a pimg_ gallery image as the first/primary photograph of an UNPUBLISHED draft. Requires current gallery_revision and idempotent UUIDv4 request_id. Rejects stale and already-primary changes.',
    inputSchema:{request_id:requestKey,product_id:id,image_id:id,expected_revision:revision},
  },async (args)=>{
    try {return reply(await applyGuardedGalleryMutation(db,actor,{...args,action:'gallery.primary'}));}
    catch{return reply({error:'Gallery operation uncertain. Refresh/retry with the SAME request_id.'});}
  });
}
