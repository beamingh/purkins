import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { D1Database } from '@cloudflare/workers-types';
import { z } from 'zod';
import { uploadGuardedPurkinsMedia } from '../../src/features/mcp/photoUploadGuard';

const reply=(data:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(data,null,2)}]});
export function registerGuardedPurkinsPhotoUpload(
  server:McpServer,db:D1Database,bucket:Parameters<typeof uploadGuardedPurkinsMedia>[1]|undefined,
  actor:string|undefined,allowed:boolean,
){
  if(!allowed||!actor||!bucket)return;
  server.registerTool('upload_guarded_purkins_photo',{
    description:'OWNER ONLY: Upload actual base64 JPEG/PNG/WebP/GIF bytes, up to 5 MB, to Purkins private media library for an unpublished draft. A receipt protects identical UUID retries. Does NOT attach or publish; use attach_guarded_purkins_photo with returned med_ ID and a fresh gallery revision. Avoid gigantic files; Admin Media is an alternative.',
    inputSchema:{
      request_id:z.string().uuid(),
      product_id:z.string().regex(/^prod_[0-9a-z]+$/),
      original_name:z.string().min(1).max(100),
      mime_type:z.enum(['image/jpeg','image/png','image/webp','image/gif']),
      image_base64:z.string().min(16).max(7_000_000),
      confirm_upload:z.literal(true),
    },
  },async(args)=>{
    try{return reply(await uploadGuardedPurkinsMedia(db,bucket,actor,args));}
    catch{return reply({error:'Image upload uncertain. Check the media library and retry the SAME UUID and bytes; an unused private media row may need cleanup.'});}
  });
}
