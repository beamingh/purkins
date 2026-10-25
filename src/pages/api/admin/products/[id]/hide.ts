import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { parsePublicId } from '../../../../../features/ids/publicId';
import { applyGuardedPublication } from '../../../../../features/mcp/publicationGuard';
import { publicStorefrontCachePurger } from '../../../../../features/mcp/publicCachePurge';

export const prerender=false;
/** Admin is protected by the existing /api/admin middleware (session or
 * verified Cloudflare Access). A new user-visible hide action has a stable
 * request_id so any incomplete cross-Worker cache purge can be retried. */
export const POST:APIRoute=async({request,params,redirect,locals})=>{
  const product_id=parsePublicId(params.id,'product');
  if(!product_id)return new Response('Not found',{status:404});
  const form=await request.formData();
  const request_id=String(form.get('request_id')??'');
  const revision=Number(String(form.get('expected_catalog_revision')??''));
  if(String(form.get('confirm_unpublish'))!=='true'){
    return new Response('Explicit hide confirmation required.',{status:400});
  }
  const secretEnv=env as typeof env &{
    STOREFRONT_URL?:string;PURKINS_MCP_CACHE_PURGE_SECRET?:string;
  };
  const purge=publicStorefrontCachePurger(
    secretEnv.STOREFRONT_URL,secretEnv.PURKINS_MCP_CACHE_PURGE_SECRET,
  );
  if(!purge){
    return redirect(`/admin/products/${product_id}/edit?error=`+
      encodeURIComponent('Storefront cache invalidation is not configured; cannot safely hide product.'),303);
  }
  const owner=locals.adminEmail
    ? 'owner:access:'+locals.adminEmail.trim().toLowerCase()
    : 'owner:bearer'; // Protected Admin password-session owner.
  try{
    const result=await applyGuardedPublication(env.DB,owner,'unpublish',{
      request_id,product_id,expected_catalog_revision:revision,
    },purge);
    if(!result.ok){
      return redirect(`/admin/products/${product_id}/edit?error=`+
        encodeURIComponent(result.error),303);
    }
    if(!result.cache_purged){
      const params=new URLSearchParams({
        error:'Product hidden in inventory but public cache purge is incomplete. Retry below.',
        purge_request_id:request_id,purge_revision:String(revision),purge_action:'unpublish',
      });
      return redirect(`/admin/products/${product_id}/edit?`+params,303);
    }
    return redirect(`/admin/products/${product_id}/edit`,303);
  }catch{
    return redirect(`/admin/products/${product_id}/edit?error=`+
      encodeURIComponent('Hide outcome uncertain. Check the product status before retrying.'),303);
  }
};
