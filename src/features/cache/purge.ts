import { cache } from 'cloudflare:workers';
import { normalizeCacheTags, productCacheTags } from './tags';

export interface CachePurger {
  purge(options: CachePurgeOptions): Promise<CachePurgeResult>;
}

function purgeFailure(
  mode: 'tags' | 'stock-tags' | 'everything',
  errors: CachePurgeError[] | unknown,
): void {
  console.error(
    JSON.stringify({
      event: 'workers_cache_purge_failed',
      mode,
      errors,
    }),
  );
}

// Miniflare's local Worker (and a Worker with caching disabled) may expose
// `cache` without a `purge` method. Neither has a Workers Cache to invalidate.
// Keep real purge rejections fatal for low-frequency mutations.
let unavailablePurgeLogged = false;
function skipUnavailableMutationPurge(purger: CachePurger): boolean {
  if (typeof purger?.purge === 'function') return false;
  if (!unavailablePurgeLogged) {
    console.info(JSON.stringify({ event: 'workers_cache_purge_unavailable', action: 'skip' }));
    unavailablePurgeLogged = true;
  }
  return true;
}

/**
 * Invalidate low-frequency content mutations synchronously after their D1
 * write. If the runtime provides no purge API, there is no Workers Cache
 * available to invalidate. An available API that rejects the tag purge falls
 * back to purge-everything; if both fail, this handler fails closed.
 */
export async function purgeCacheTags(
  tags: Iterable<string>,
  purger: CachePurger = cache,
): Promise<void> {
  const normalized = normalizeCacheTags(tags);
  if (normalized.length === 0) return;
  if (skipUnavailableMutationPurge(purger)) return;

  try {
    const result = await purger.purge({ tags: normalized });
    if (result.success) return;
    purgeFailure('tags', result.errors);
  } catch (error) {
    purgeFailure('tags', error instanceof Error ? error.message : String(error));
  }

  try {
    const fallback = await purger.purge({ purgeEverything: true });
    if (fallback.success) return;
    purgeFailure('everything', fallback.errors);
  } catch (error) {
    purgeFailure('everything', error instanceof Error ? error.message : String(error));
  }

  throw new Error('The data was saved, but the Workers cache could not be invalidated.');
}

export function purgeProductCache(
  productPublicIds: Iterable<string | null | undefined>,
  purger?: CachePurger,
): Promise<void> {
  return purgeCacheTags(productCacheTags(productPublicIds), purger);
}

/** Purge the owning Worker entrypoint's complete cache after a deployment. */
export async function purgeEntireCache(
  purger: CachePurger = cache,
): Promise<void> {
  // A deployment-wide purge must never pretend to succeed when unsupported.
  if (typeof purger?.purge !== 'function') {
    throw new Error('The Workers cache purge API is unavailable.');
  }

  try {
    const result = await purger.purge({ purgeEverything: true });
    if (result.success) return;
    purgeFailure('everything', result.errors);
  } catch (error) {
    purgeFailure('everything', error instanceof Error ? error.message : String(error));
  }
  throw new Error('The Workers cache could not be purged.');
}

/**
 * Inventory transitions are checkout-frequency events. Purge only the narrow
 * product tags and never fall back to purge-everything: if Cloudflare rate
 * limits this best-effort request, the bounded shared TTL is the safety net.
 */
export async function purgeStockProductCache(
  productPublicIds: Iterable<string | null | undefined>,
  purger: CachePurger = cache,
): Promise<void> {
  const tags = productCacheTags(productPublicIds);
  if (tags.length === 0) return;
  if (skipUnavailableMutationPurge(purger)) return;

  try {
    const result = await purger.purge({ tags });
    if (result.success) return;
    purgeFailure('stock-tags', result.errors);
  } catch (error) {
    purgeFailure('stock-tags', error instanceof Error ? error.message : String(error));
  }
}
