import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { updateOrderRequestStatus } from '../../../../features/purkins/orderRequestDb';
import { REQUEST_STATUSES, type RequestStatus } from '../../../../features/purkins/orderRequests';
import { parsePublicId } from '../../../../features/ids/publicId';
import { parseOfflineQuote } from '../../../../features/purkins/offlineQuote';
import { saveOfflineQuote } from '../../../../features/purkins/offlineQuoteDb';

export const prerender = false;

/** Authenticated Admin-only follow-up. Cannot mark money received or decrement stock. */
export const POST: APIRoute = async ({ request, params, redirect, locals }) => {
  const id = parsePublicId(params.id, 'orderRequest');
  if (!id) return new Response('Not found', { status: 404 });
  const form = await request.formData();
  const back = '/admin/order-requests/' + id;
  if (form.get('_action') === 'save_quote') {
    const parsed = parseOfflineQuote(form);
    if (!parsed.ok) {
      return redirect(back + '?error=' + encodeURIComponent(parsed.error),303);
    }
    const outcome = await saveOfflineQuote(
      env.DB,id,parsed.value,locals.adminEmail ?? 'admin-session',
    );
    return outcome.ok
      ? redirect(back + '?quote_saved=1',303)
      : redirect(back + '?error=' + encodeURIComponent(outcome.error),303);
  }
  const expected = String(form.get('expected_status') ?? '');
  const next = String(form.get('status') ?? '');
  const note = String(form.get('operator_note') ?? '').trim();
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
