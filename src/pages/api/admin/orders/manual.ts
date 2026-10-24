import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getConfig } from '../../../../config';
import { parseManualSaleForm } from '../../../../features/purkins/manualSale';
import { recordManualSale } from '../../../../features/purkins/manualSaleDb';
import { CACHE_TAG } from '../../../../features/cache/tags';
import { purgeCacheTags } from '../../../../features/cache/purge';

export const prerender = false;

/**
 * Paid offline/WhatsApp/Facebook sales only. /api/admin/* is authenticated by
 * middleware and the Admin Worker is separately protected by Cloudflare Access.
 */
export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const fail = (message: string) =>
    redirect('/admin/orders/new?error=' + encodeURIComponent(message), 303);

  const form = await request.formData();
  const parsed = parseManualSaleForm(form);
  if (!parsed.ok) return fail(parsed.error);

  const sale = await recordManualSale(
    env.DB,
    parsed.value,
    getConfig().currency,
    locals.adminEmail ?? 'admin-session',
  );
  if (!sale.ok) return fail(sale.error);

  // Prelaunch Workers have caching disabled. If caching is enabled later,
  // this invalidates the Admin Worker tags; the public Worker will also need
  // a cross-Worker invalidation strategy before enabling public edge caches.
  if (!sale.alreadyRecorded) {
    try {
      await purgeCacheTags([CACHE_TAG.catalog]);
    } catch (error) {
      console.error('Manual sale saved; catalog cache purge needs reconciliation', error);
    }
  }
  return redirect(
    '/admin/orders/' + sale.orderPublicId +
    (sale.alreadyRecorded ? '?notice=This%20sale%20was%20already%20recorded' : '?notice=Manual%20sale%20recorded'),
    303,
  );
};
