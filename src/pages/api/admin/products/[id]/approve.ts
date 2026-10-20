import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getProductByPublicId } from '../../../../../features/products/db';
import { parsePublicId } from '../../../../../features/ids/publicId';
import { approveIntake } from '../../../../../features/purkins/db';
import { CACHE_TAG } from '../../../../../features/cache/tags';
import { purgeCacheTags } from '../../../../../features/cache/purge';

export const prerender = false;

/**
 * Explicit current-admin approval. This is NOT delegated-owner RBAC: Minshop's
 * one shared admin password must remain restricted to the Purkins owner.
 */
export const POST: APIRoute = async ({ params, redirect }) => {
  const publicId = parsePublicId(params.id, 'product');
  if (!publicId) return new Response('Not found', { status: 404 });
  const product = await getProductByPublicId(env.DB, publicId);
  if (!product) return new Response('Not found', { status: 404 });

  const error = await approveIntake(env.DB, product.id);
  if (error) {
    return redirect(`/admin/products/${publicId}/edit?error=${encodeURIComponent(error)}`, 303);
  }
  await purgeCacheTags([CACHE_TAG.catalog, CACHE_TAG.product(publicId)]);
  return redirect(`/admin/products/${publicId}/edit`, 303);
};
