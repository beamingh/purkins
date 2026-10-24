import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { updateCategoryCommand, deleteCategoryCommand, CategoryValidationError } from '../../../../features/categories/commands';
import { getCategoryByPublicId } from '../../../../features/categories/db';
import { parseCategoryForm } from '../../../../features/categories/form';
import { parsePublicId } from '../../../../features/ids/publicId';
import { CACHE_TAG } from '../../../../features/cache/tags';
import { purgeCacheTags } from '../../../../features/cache/purge';

export const prerender = false;

export const POST: APIRoute = async ({ request, params, redirect }) => {
  const publicId = parsePublicId(params.id, 'category');
  const category = publicId ? await getCategoryByPublicId(env.DB, publicId) : null;
  if (!category || !publicId) return new Response('Not found', { status: 404 });

  const form = await request.formData();
  const isDelete = String(form.get('_action')) === 'delete';
  if (isDelete) {
    await deleteCategoryCommand(env.DB, publicId);
  } else {
    const parsed = parseCategoryForm(form);
    if ('error' in parsed) {
      return redirect(`/admin/categories/${publicId}/edit?error=${encodeURIComponent(parsed.error)}`, 303);
    }
    try {
      await updateCategoryCommand(env.DB, publicId, {
        name: parsed.data.name,
        slug: parsed.data.slugInput,
        parent_id: parsed.data.parentPublicId,
      });
    } catch (error) {
      if (error instanceof CategoryValidationError) {
        return redirect(`/admin/categories/${publicId}/edit?error=${encodeURIComponent(error.message)}`, 303);
      }
      throw error;
    }
  }
  // Intentionally outside a catch: if cache invalidation fails, do not
  // tell the operator the DB write failed and invite a duplicate retry.
  await purgeCacheTags([CACHE_TAG.catalog]);
  return redirect('/admin/categories', 303);
};
