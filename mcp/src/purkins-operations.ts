import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { D1Database } from '@cloudflare/workers-types';
import { z } from 'zod';
import { getStockValuation } from '../../src/features/purkins/stockValuation';
import { editGuardedPurkinsDraft } from '../../src/features/mcp/draftEdit';
import { getProductByPublicId } from '../../src/features/products/db';
import { categoriesForProduct } from '../../src/features/categories/db';
import { parsePublicId } from '../../src/features/ids/publicId';

const reply=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value,null,2)}]});
const cents=z.number().int().min(0).max(99_999_999_999);
const patch=z.object({
  name:z.string().trim().min(1).max(200).optional(),
  description:z.string().max(5000).nullable().optional(),
  price_cents:cents.optional(),
  purchase_currency:z.enum(['ZMW','ZAR']).optional(),
  purchase_cost_minor:cents.nullable().optional(),
  zar_to_zmw:z.number().positive().max(1000).nullable().optional(),
  overhead_zwm_cents:cents.optional(),
  pricing_mode:z.enum(['manual','cost_based']).optional(),
  condition_status:z.enum(['complete','review','incomplete']).optional(),
  brand:z.string().max(100).nullable().optional(),
  retail_tag_minor:cents.nullable().optional(),
  retail_tag_currency:z.enum(['ZMW','ZAR']).optional(),
  internal_notes:z.string().max(2000).nullable().optional(),
  category_ids:z.array(z.string().regex(/^cat_[0-9a-z]+$/)).max(15).optional(),
}).strict();

export function registerPurkinsOperationsReads(server:McpServer,db:D1Database):void {
  server.registerTool('get_purkins_stock_valuation',{
    description:'Read the complete private recorded-stock valuation: entered units, known ZMW selling totals, confirmed cost coverage, separate original ZAR/ZMW tag reference totals, missing values, and at most 150 detailed stock lines. Unknown costs never become zero. No financial or stock writes.',
    inputSchema:{},
  },async()=>{
    const data=await getStockValuation(db);
    return reply({...data,lines:data.lines.map(({product_id:ignored,...line})=>line)});
  });
  server.registerTool('get_purkins_private_preview',{
    description:'Provide the existing authenticated Admin storefront preview URL for a prod_ product. This is NOT a public sharing link and never makes a draft publicly visible. Includes current category IDs and publication status.',
    inputSchema:{product_id:z.string().regex(/^prod_[0-9a-z]+$/)},
  },async({product_id})=>{
    const id=parsePublicId(product_id,'product');
    const product=id?await getProductByPublicId(db,id):null;
    if(!product)return reply({error:'Product not found.'});
    const categories=await categoriesForProduct(db,product.id);
    return reply({product_id:id,published:product.active===1,catalog_revision:
      (product as typeof product & {mcp_catalog_revision?:number}).mcp_catalog_revision??0,
      category_ids:categories.map(c=>c.public_id),
      preview_url:'https://admin.purkins.ulwimbo.com/admin/products/'+id+'/preview',
      private:true,requires_admin_login:true,no_purchase:true,
      note:'The preview only works while signed in to Purkins Admin. Do not send it to customers.'});
  });
}
export function registerGuardedPurkinsDraftEdits(
  server:McpServer,db:D1Database,allowed=false,actor?:string,
):void{
  if(!allowed||!actor)return;
  server.registerTool('edit_guarded_purkins_draft',{
    description:'OWNER ONLY: atomically edit an UNPUBLISHED Purkins product\'s name, description, ZMW selling price, original purchase cost/currency, historical rand exchange rate, conditions, tags, notes, and optional complete category set. Size prices use reconcile_guarded_purkins_variant separately. Requires current catalog revision and retry-safe UUIDv4 request_id; never publishes, adjusts units or records sales.',
    inputSchema:{
      request_id:z.string().uuid(),product_id:z.string().regex(/^prod_[0-9a-z]+$/),
      expected_catalog_revision:z.number().int().nonnegative(),patch,
    },
  },async(args)=>{
    try{return reply(await editGuardedPurkinsDraft(db,actor,args));}
    catch{return reply({error:'Draft edit uncertain; refresh the product and retry with the SAME request_id before creating another operation.'});}
  });
}
