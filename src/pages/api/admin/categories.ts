import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createCategoryCommand, CategoryValidationError } from '../../../features/categories/commands';
import { parseCategoryForm } from '../../../features/categories/form';
import { purgePublicAfterAdminMutation } from '../../../features/cache/purgePublicAdmin';

export const prerender = false;

const fail = (msg: string) => `/admin/categories/new?error=${encodeURIComponent(msg)}`;

// Parse user input before the write, so validation failures redirect just as
// before. DB/cache failures deliberately propagate rather than implying that
// a database write was rolled back when only cache invalidation failed.
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const parsed = parseCategoryForm(form);
  if ('error' in parsed) return redirect(fail(parsed.error), 303);

  try {
    await createCategoryCommand(env.DB, {
      name: parsed.data.name,
      slug: parsed.data.slugInput,
      parent_id: parsed.data.parentPublicId,
    });
  } catch (error) {
    if (error instanceof CategoryValidationError) return redirect(fail(error.message), 303);
    throw error; // DB faults must not be presented as validation errors.
  }
  await purgePublicAfterAdminMutation();
  return redirect('/admin/categories', 303);
};
