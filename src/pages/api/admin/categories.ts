import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createCategoryCommand } from '../../../features/categories/commands';
import { parseCategoryForm } from '../../../features/categories/form';
import { CACHE_TAG } from '../../../features/cache/tags';
import { purgeCacheTags } from '../../../features/cache/purge';

export const prerender = false;

const fail = (msg: string) => `/admin/categories/new?error=${encodeURIComponent(msg)}`;

// Parse user input before the write, so validation failures redirect just as
// before. DB/cache failures deliberately propagate rather than implying that
// a database write was rolled back when only cache invalidation failed.
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const parsed = parseCategoryForm(form);
  if ('error' in parsed) return redirect(fail(parsed.error), 303);

  await createCategoryCommand(env.DB, {
    name: parsed.data.name,
    slug: parsed.data.slugInput,
    parent_id: parsed.data.parentPublicId,
  });
  await purgeCacheTags([CACHE_TAG.catalog]);
  return redirect('/admin/categories', 303);
};
