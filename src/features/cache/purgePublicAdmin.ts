import { env } from 'cloudflare:workers';
import { publicStorefrontCachePurger } from '../mcp/publicCachePurge';

/**
 * Product/category/page/navigation updates are made on the ADMIN Worker, but
 * public HTML and catalog APIs are cached by the separate STOREFRONT Worker.
 *
 * Calling purgeCacheTags() inside an Admin handler purges the wrong Worker's
 * cache; the page can then remain stale even though its D1 row is updated.
 *
 * Reuse the signed public-origin purge already required for guarded MCP/Admin
 * publication. It is a full purge for now (low-frequency owner edits); a
 * targeted signed purge can replace this function if the traffic warrants it.
 *
 * Do NOT silently fall back to an Admin-local cache purge: that cannot
 * invalidate the shopper's page and would report a false success.
 */
export async function purgePublicAfterAdminMutation(): Promise<void> {
  const bindings = env as typeof env & {
    STOREFRONT_URL?: string;
    PURKINS_MCP_CACHE_PURGE_SECRET?: string;
  };
  const purge = publicStorefrontCachePurger(
    bindings.STOREFRONT_URL,
    bindings.PURKINS_MCP_CACHE_PURGE_SECRET,
  );
  if (!purge) {
    throw new Error(
      'Changes may have been saved, but public storefront cache invalidation is not configured. ' +
      'Check STOREFRONT_URL and PURKINS_MCP_CACHE_PURGE_SECRET before retrying.',
    );
  }
  try {
    await purge();
  } catch (error) {
    console.error(JSON.stringify({
      event: 'purkins_admin_public_cache_purge_failed',
      message: error instanceof Error ? error.message : String(error),
    }));
    throw new Error(
      'Changes were saved, but the public storefront cache could not be refreshed. ' +
      'Check the live record before retrying.',
    );
  }
}
