import type { D1Database } from '@cloudflare/workers-types';
import { getProductByPublicId, listProductImages } from '../products/db';
import { getIntake } from './db';
import { landedCostCents } from './intake';
import { listVariants } from '../products/variants';
import { parsePublicId } from '../ids/publicId';

/**
 * Pure, read-only product readiness evaluation reused by the Admin editor
 * and the MCP facade. Kept inside src/features so the isolated Admin Worker
 * never needs to import code from the separately bundled mcp/ workspace.
 */
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
    catalog_revision:(product as typeof product & {mcp_catalog_revision?:number}).mcp_catalog_revision??0,
    photo_count:images.length, primary_photo_present:Boolean(product.image_key),
    size_variant_count:variants.length, total_size_units:active.reduce((n,v)=>n+v.stock,0),
    blockers,notes,potentially_ready_for_owner_review:blockers.length===0,
    caveat:'This is a read-only checklist, not approval. The authoritative publication flow must recheck every condition and purge the public storefront cache.',
  };
}

