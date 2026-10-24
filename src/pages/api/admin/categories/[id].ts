import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { updateCategoryCommand, deleteCategoryCommand } from '../../../../features/categories/commands';
import { parsePublicId } from '../../../../features/ids/publicId';
import { getCategoryByPublicId } from '../../../../features/categories/db';
import { CACHE_TAG } from '../../../../features/cache/tags';
import { purgeCacheTags } from '../../../../features/cache/purge';

export const prerender = false;

export const POST: APIRoute = async ({ request, params, redirect }) => {
  const publicId = parsePublicId(params.id, 'category');
  if (!publicId || !await getCategoryByPublicId(env.DB, publicId)) {
    return new Response('Not found', { status: 404 });
  }
  const form = await request.formData();
  const isDelete = String(form.get('_action')) === 'delete';
  try {
    if (isDelete) {
      await deleteCategoryCommand(env.DB, publicId);
    } else {
      await updateCategoryCommand(env.DB, publicId, {
        name: String(form.get('name') ?? ''),
        slug: String(form.get('slug') ?? ''),
        parent_id: String(form.get('parent_id') ?? '') || null,
      });
    }
    await purgeCacheTags([CACHE_TAG.catalog]);
    return redirect('/admin/categories', 303);
  } catch (error) {
    const msg = encodeURIComponent(error instanceof Error ? error.message : 'Unable to update category.');
    return redirect(`/admin/categories/${publicId}/edit?error=${msg}`, 303);
  }
};
