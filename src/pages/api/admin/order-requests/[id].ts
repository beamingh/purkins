import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { updateOrderRequestStatus } from '../../../../features/purkins/orderRequestDb';
import { REQUEST_STATUSES, type RequestStatus } from '../../../../features/purkins/orderRequests';
import { parsePublicId } from '../../../../features/ids/publicId';

export const prerender = false;

/** Authenticated Admin-only follow-up. Cannot mark money received or decrement stock. */
export const POST: APIRoute = async ({ request, params, redirect, locals }) => {
  const id = parsePublicId(params.id, 'orderRequest');
  if (!id) return new Response('Not found', { status: 404 });
  const form = await request.formData();
  const expected = String(form.get('expected_status') ?? '');
  const next = String(form.get('status') ?? '');
  const note = String(form.get('operator_note') ?? '').trim();
  const back = '/admin/order-requests/' + id;
  if (!Object.prototype.hasOwnProperty.call(REQUEST_STATUSES, expected) ||
      !Object.prototype.hasOwnProperty.call(REQUEST_STATUSES, next) || note.length > 1000) {
    return redirect(back + '?error=' + encodeURIComponent('Invalid status or note.'),303);
  }
  const saved = await updateOrderRequestStatus(
    env.DB,id,expected as RequestStatus,next as RequestStatus,note,
    locals.adminEmail ?? 'admin-session',
  );
  return saved ? redirect(back + '?saved=1',303)
    : redirect(back + '?error=' + encodeURIComponent(
      'This request changed elsewhere or is already closed. Reload before updating.',
    ),303);
};
