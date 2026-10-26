import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getProductByPublicId } from '../../../../../features/products/db';
import { parsePublicId } from '../../../../../features/ids/publicId';
import { parseLiveCopyFields } from '../../../../../features/purkins/liveCopy';
import {
  applyGuardedLiveCopy, retryLiveCopyPurge,
} from '../../../../../features/purkins/liveCopyGuard';
import { publicStorefrontCachePurger } from '../../../../../features/mcp/publicCachePurge';

export const prerender = false;

/** Owner-only Admin form: retain approval for description and a genuine
 * comparison price. Every other edit continues through normal review.
 * Admin authentication + same-origin form checks are enforced in middleware.
 */
export const POST: APIRoute = async ({ request, params, redirect, locals }) => {
  const productId = parsePublicId(params.id, 'product');
  if (!productId) return new Response('Not found', { status: 404 });
  const product = await getProductByPublicId(env.DB, productId);
  if (!product) return new Response('Not found', { status: 404 });

  const form = await request.formData();
  const action = String(form.get('_action') ?? 'save');
  const requestId = String(form.get('request_id') ?? '');
  const actor = locals.adminEmail
    ? 'owner:access:' + locals.adminEmail.trim().toLowerCase()
    : 'owner:bearer';
  const bindings = env as typeof env & {
    STOREFRONT_URL?: string;
    PURKINS_MCP_CACHE_PURGE_SECRET?: string;
  };
  const purge = publicStorefrontCachePurger(
    bindings.STOREFRONT_URL, bindings.PURKINS_MCP_CACHE_PURGE_SECRET,
  );
  const go = (key: string, value: string, retryId?: string) => {
    const qs = new URLSearchParams({ [key]: value, step: 'review' });
    if (retryId) qs.set('live_retry_id', retryId);
    return redirect(`/admin/products/${productId}/edit?${qs}#review`, 303);
  };

  if (action === 'purge_retry') {
    try {
      const result = await retryLiveCopyPurge(env.DB, actor, requestId, productId, purge);
      if (!result.ok) return go('live_error', result.error);
      return result.cache_purged
        ? go('live_saved', '1')
        : go('live_error', result.warning ?? 'Storefront cache has not refreshed.', requestId);
    } catch {
      return go('live_error', 'Cache-refresh outcome uncertain. Review the live listing before retrying.');
    }
  }
  if (action !== 'save') return new Response('Invalid live edit action.', { status: 400 });

  const parsed = parseLiveCopyFields(
    String(form.get('description') ?? ''),
    String(form.get('compare_at_price') ?? ''),
    product.price_cents,
    product.currency,
  );
  if ('error' in parsed) return go('live_error', parsed.error);

  const revision = Number(String(form.get('expected_catalog_revision') ?? ''));
  try {
    const result = await applyGuardedLiveCopy(env.DB, actor, {
      ...parsed.data,
      product_id: productId,
      request_id: requestId,
      expected_catalog_revision: revision,
    }, purge);
    if (!result.ok) return go('live_error', result.error);
    return result.cache_purged
      ? go('live_saved', '1')
      : go('live_error', result.warning ?? 'Storefront cache not refreshed.', requestId);
  } catch {
    return go('live_error', 'Save outcome uncertain. Check the live listing before another edit.');
  }
};
