import { signDeployPurgeAuthorization } from '../cache/deployPurgeAuth';

/** Cross-Worker invalidation: the Admin/MCP Worker cannot purge the PUBLIC
 * Worker's cross-version cache itself. Reuse the existing signed, short-lived
 * internal deployment-purge endpoint. This is deliberately a FULL purge: it
 * must evict cached catalog pages, product HTML and query-dependent menus.
 *
 * Provision PURKINS_MCP_CACHE_PURGE_SECRET on Admin with the SAME secret as
 * the public Worker's CACHE_PURGE_SECRET. No secret goes to client tools.
 */
export function publicStorefrontCachePurger(
  storefrontOrigin: string | undefined,
  sharedSecret: string | undefined,
  send: typeof fetch = fetch,
): (()=>Promise<void>) | null {
  if(!storefrontOrigin||!sharedSecret)return null;
  const origin=new URL(storefrontOrigin.trim());
  if(origin.protocol!=='https:'||origin.username||origin.password||
    origin.pathname!=='/'||origin.search||origin.hash) {
    throw Error('STOREFRONT_URL must be one HTTPS origin.');
  }
  return async()=>{
    const authorization=await signDeployPurgeAuthorization(
      sharedSecret,Date.now()/1000,
    );
    const response=await send(new URL('/api/internal/cache-purge',origin),{
      method:'POST',
      headers:{authorization,'content-type':'application/json'},
      body:'{}',
    });
    if(!response.ok)throw Error('Public storefront cache purge failed (HTTP '+response.status+').');
    const payload:unknown=await response.json();
    if(!payload||typeof payload!=='object'||!('success' in payload)||
      (payload as {success:unknown}).success!==true){
      throw Error('Public storefront cache purge was not confirmed.');
    }
  };
}
