import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { D1Database } from '@cloudflare/workers-types';
import { applyGuardedPublication } from '../../src/features/mcp/publicationGuard';

const reply=(body:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(body,null,2)}]});
const requestKey=z.string().uuid();
const prodId=z.string().regex(/^prod_[0-9a-z]+$/);
const version=z.number().int().nonnegative();

export function registerGuardedPublicationTools(
  server:McpServer,db:D1Database,allowed=false,actor?:string,
  purgePublicCache?:(()=>Promise<void>)|null,
):void{
  if(!allowed||!actor||!purgePublicCache)return;
  server.registerTool('publish_guarded_purkins_product',{
    description:'OWNER ONLY: deliberately publish a reviewed private product in the public storefront. Must first review draft, set real ZMW selling/variant prices, attach image, and complete physical condition. Requires confirm_publish=true, latest catalog_revision and unique UUIDv4 request_id. Revalidates all approval checks. Retries with SAME ID after uncertain cache purge. NOT a sale.',
    inputSchema:{
      request_id:requestKey,product_id:prodId,expected_catalog_revision:version,
      confirm_publish:z.literal(true),
    },
  },async(args)=>{
    try{return reply(await applyGuardedPublication(db,actor,'publish',args,purgePublicCache));}
    catch{return reply({error:'Publication outcome uncertain. Refresh product and retry SAME request_id and input. Do not assume success.'});}
  });

  server.registerTool('unpublish_guarded_purkins_product',{
    description:'OWNER ONLY: explicitly HIDE a currently published product, keeping stock, photos and history. Requires confirm_unpublish=true, latest catalog_revision and unique UUIDv4 request_id. Updates permanent D1, then purges separate public Worker cache. Retry SAME ID until cache_purged=true. Never deletes stock or creates sales.',
    inputSchema:{
      request_id:requestKey,product_id:prodId,expected_catalog_revision:version,
      confirm_unpublish:z.literal(true),
    },
  },async(args)=>{
    try{return reply(await applyGuardedPublication(db,actor,'unpublish',args,purgePublicCache));}
    catch{return reply({error:'Unpublication outcome uncertain. Refresh product and retry SAME request_id and input. Do not assume visibility changed.'});}
  });
}
