import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { D1Database } from '@cloudflare/workers-types';
import { reviewPurkinsDraft } from '../../src/features/purkins/draftReview';
// Keep existing importers compatible while the Admin consumes the shared helper.
export { reviewPurkinsDraft } from '../../src/features/purkins/draftReview';
import { applyGuardedGalleryMutation } from '../../src/features/mcp/galleryGuard';

const reply=(data: unknown) => ({
  content:[{type:'text' as const,text:JSON.stringify(data,null,2)}],
});
const requestKey=z.string().uuid();
const id=z.string().min(1);
const revision=z.number().int().nonnegative();

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
