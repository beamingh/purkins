import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { parsePublicId } from '../../../../../features/ids/publicId';
import { applyGuardedPublication } from '../../../../../features/mcp/publicationGuard';
import { publicStorefrontCachePurger } from '../../../../../features/mcp/publicCachePurge';

export const prerender = false;

/** Admin owner publication uses the SAME receipt, revision and cross-Worker
 * cache checks as MCP. No direct approveIntake + wrong-Worker cache purge. */
export const POST: APIRoute = async ({ request, params, redirect, locals }) => {
  const product_id = parsePublicId(params.id, 'product');
  if (!product_id) return new Response('Not found', { status: 404 });
  const form = await request.formData();
  const request_id = String(form.get('request_id') ?? '');
  const revision = Number(String(form.get('expected_catalog_revision') ?? ''));
  if (String(form.get('confirm_publish')) !== 'true') {
    return new Response('Explicit owner publication confirmation required.', { status: 400 });
  }
  const secretEnv = env as typeof env & {
    STOREFRONT_URL?: string;
    PURKINS_MCP_CACHE_PURGE_SECRET?: string;
  };
  const purge = publicStorefrontCachePurger(
    secretEnv.STOREFRONT_URL, secretEnv.PURKINS_MCP_CACHE_PURGE_SECRET,
  );
  const errorRedirect = (message: string) =>
    redirect(`/admin/products/${product_id}/edit?error=${encodeURIComponent(message)}`, 303);
  if (!purge) {
    return errorRedirect('Public storefront cache invalidation is not configured; refusing publication.');
  }
  const actor = locals.adminEmail
    ? 'owner:access:' + locals.adminEmail.trim().toLowerCase()
    : 'owner:bearer';
  try {
    const result = await applyGuardedPublication(env.DB, actor, 'publish', {
      request_id, product_id, expected_catalog_revision: revision, confirm_publish: true,
    }, purge);
    if (!result.ok) return errorRedirect(result.error);
    if (!result.cache_purged) {
      const params = new URLSearchParams({
        error: 'Published in D1, but the public cache purge is incomplete. Retry below.',
        purge_request_id: request_id,
        purge_revision: String(revision),
        purge_action: 'publish',
      });
      return redirect(`/admin/products/${product_id}/edit?${params}`, 303);
    }
    return redirect(`/admin/products/${product_id}/edit`, 303);
  } catch {
    return errorRedirect('Publication outcome uncertain. Read the live status before retrying.');
  }
};
