import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createLocation, locationIdValid, moveLocation } from '../../../features/purkins/locations';

export const prerender = false;

// /api/admin/* is protected by the shared Admin auth + same-origin middleware.
// Neither locations nor internal ancestry are exposed to shoppers.
export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const action = String(form.get('_action') ?? '');
  const parent = String(form.get('parent_id') ?? '').trim() || null;
  if (parent && !locationIdValid(parent)) {
    return redirect('/admin/locations?error=' + encodeURIComponent('Invalid parent reference.'), 303);
  }
  try {
    if (action === 'create') {
      const name = String(form.get('name') ?? '');
      const kind = String(form.get('kind') ?? 'other');
      await createLocation(env.DB, name, kind, parent);
    } else if (action === 'move') {
      const id = String(form.get('location_id') ?? '');
      if (!locationIdValid(id)) throw new Error('Choose a valid location to move.');
      await moveLocation(env.DB, id, parent);
    } else {
      throw new Error('Unknown location action.');
    }
  } catch (error) {
    return redirect('/admin/locations?error=' +
      encodeURIComponent(error instanceof Error ? error.message : 'Unable to update location.'), 303);
  }
  return redirect('/admin/locations?saved=1', 303);
};
