import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { updateOrderRequestStatus } from '../../../../features/purkins/orderRequestDb';
import { REQUEST_STATUSES, type RequestStatus } from '../../../../features/purkins/orderRequests';
import { parsePublicId } from '../../../../features/ids/publicId';
import { parseOfflineQuote } from '../../../../features/purkins/offlineQuote';
import { saveOfflineQuote } from '../../../../features/purkins/offlineQuoteDb';
import { holdOfflineRequestStock, releaseOfflineRequestStock } from '../../../../features/purkins/offlineStockHoldDb';
import { purgePublicAfterAdminMutation } from '../../../../features/cache/purgePublicAdmin';
import { parseOfflineSettlement } from '../../../../features/purkins/offlineSettlement';
import { settleHeldOfflineOrder } from '../../../../features/purkins/offlineSettlementDb';
import { parseCourierDelivery } from '../../../../features/purkins/courierDelivery';
import { saveCourierDelivery } from '../../../../features/purkins/courierDeliveryDb';

export const prerender = false;

/** Authenticated Admin-only follow-up. Cannot mark money received or decrement stock. */
export const POST: APIRoute = async ({ request, params, redirect, locals }) => {
  const id = parsePublicId(params.id, 'orderRequest');
  if (!id) return new Response('Not found', { status: 404 });
  const form = await request.formData();
  const back = '/admin/order-requests/' + id;
  const fail = (message: string) => redirect(back + '?error=' + encodeURIComponent(message),303);
  if (form.get('_action') === 'save_courier_delivery') {
    const parsed = parseCourierDelivery(form);
    if (!parsed.ok) return fail(parsed.error);
    const outcome = await saveCourierDelivery(
      env.DB,id,parsed.value,locals.adminEmail ?? 'admin-session',
    );
    return outcome.ok
      ? redirect(back + '?delivery_saved=1',303)
      : fail(outcome.error);
  }
  if (form.get('_action') === 'record_received_payment') {
    const parsed = parseOfflineSettlement(form);
    if (!parsed.ok) return fail(parsed.error);
    try {
      const saved = await settleHeldOfflineOrder(
        env.DB,id,parsed.value,locals.adminEmail ?? 'admin-session',
      );
      return saved.ok
        ? redirect('/admin/orders/' + saved.orderPublicId +
          (saved.alreadyRecorded
            ? '?notice=Payment%20was%20already%20recorded'
            : '?notice=Verified%20offline%20payment%20recorded'),303)
        : fail(saved.error);
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed') ||
          String(error).includes('idx_purkins_offline_payment_reference')) {
        return fail('This transaction reference has already been recorded. Check the existing payment before trying again.');
      }
      throw error;
    }
  }
  if (form.get('_action') === 'hold_stock') {
    if (form.get('buyer_confirmed') !== 'yes') {
      return fail('Confirm that you have contacted the buyer and they agreed to this quote.');
    }
    const revision = Number(form.get('hold_revision'));
    const nonce = String(form.get('hold_nonce') ?? '');
    const outcome = await holdOfflineRequestStock(
      env.DB,id,revision,nonce,locals.adminEmail ?? 'admin-session',
    );
    if (!outcome.ok) return fail(outcome.error);
    if (!outcome.alreadyApplied) {
      try { await purgePublicAfterAdminMutation(); }
      catch (e) { console.error('Offline stock held but cache purge requires attention:',e); }
    }
    return redirect(back + '?hold_saved=1',303);
  }
  if (form.get('_action') === 'release_hold') {
    const reason = String(form.get('release_reason') ?? '').trim();
    let outcome: Awaited<ReturnType<typeof releaseOfflineRequestStock>>;
    try {
      outcome = await releaseOfflineRequestStock(
        env.DB,id,reason,locals.adminEmail ?? 'admin-session',
      );
    } catch (error) {
      if (String(error).includes('Paid stock cannot be released')) {
        return fail('The items were already sold through the linked paid order. Use the paid order for refunds or returns.');
      }
      throw error;
    }
    if (!outcome.ok) return fail(outcome.error);
    try { await purgePublicAfterAdminMutation(); }
    catch (e) { console.error('Offline stock released but cache purge requires attention:',e); }
    return redirect(back + '?hold_released=1',303);
  }
  if (form.get('_action') === 'save_quote') {
    const parsed = parseOfflineQuote(form);
    if (!parsed.ok) {
      return redirect(back + '?error=' + encodeURIComponent(parsed.error),303);
    }
    let outcome: Awaited<ReturnType<typeof saveOfflineQuote>>;
    try {
      outcome = await saveOfflineQuote(
        env.DB,id,parsed.value,locals.adminEmail ?? 'admin-session',
      );
    } catch (e) {
      if (String(e).includes('Release allocated stock before revising quote')) {
        return fail('Release the existing stock hold before revising this quote.');
      }
      throw e;
    }
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
  let saved: boolean;
  try {
    saved = await updateOrderRequestStatus(
      env.DB,id,expected as RequestStatus,next as RequestStatus,note,
      locals.adminEmail ?? 'admin-session',
    );
  } catch (e) {
    if (String(e).includes('Release allocated stock before cancelling request')) {
      return fail('Release the allocated stock before cancelling this request.');
    }
    if (String(e).includes('Paid request cannot be changed')) {
      return fail('This request has already been converted to a paid order. Update the paid order instead.');
    }
    throw e;
  }
  return saved ? redirect(back + '?saved=1',303)
    : redirect(back + '?error=' + encodeURIComponent(
      'This request changed elsewhere or is already closed. Reload before updating.',
    ),303);
};
