import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createCategoryCommand } from '../../../features/categories/commands';
import { CACHE_TAG } from '../../../features/cache/tags';
import { purgeCacheTags } from '../../../features/cache/purge';

export const prerender = false;
const fail = (msg: string) => `/admin/categories/new?error=${encodeURIComponent(msg)}`;

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  try {
    await createCategoryCommand(env.DB, {
      name: String(form.get('name') ?? ''),
      slug: String(form.get('slug') ?? ''),
      parent_id: String(form.get('parent_id') ?? '') || null,
    });
    await purgeCacheTags([CACHE_TAG.catalog]);
    return redirect('/admin/categories', 303);
  } catch (error) {
    return redirect(fail(error instanceof Error ? error.message : 'Unable to create category.'), 303);
  }
};
