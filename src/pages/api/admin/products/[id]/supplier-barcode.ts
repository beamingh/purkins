import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getProductByPublicId } from '../../../../../features/products/db';
import { listVariants } from '../../../../../features/products/variants';
import { getIntake, setVariantSupplierBarcode } from '../../../../../features/purkins/db';
import { normalizeSupplierBarcode } from '../../../../../features/purkins/intake';
import { parsePublicId } from '../../../../../features/ids/publicId';

export const prerender = false;

// Admin gate is enforced by middleware, just as for other /api/admin routes.
export const POST: APIRoute = async ({ params, request, redirect }) => {
  const publicId = parsePublicId(params.id, 'product');
  const product = publicId ? await getProductByPublicId(env.DB, publicId) : null;
  if (!publicId || !product || !await getIntake(env.DB, product.id)) {
    return new Response('Not found', { status: 404 });
  }
  const form = await request.formData();
  const variantId = parsePublicId(String(form.get('variant_id') ?? ''), 'variant');
  const variant = variantId
    ? (await listVariants(env.DB, product.id, true)).find((v) => v.public_id === variantId)
    : null;
  if (!variant) return new Response('Variant not found on this product', { status: 400 });
  const raw = String(form.get('supplier_barcode') ?? '');
  try {
    const barcode = normalizeSupplierBarcode(raw);
    await setVariantSupplierBarcode(env.DB, variant.id, barcode);
  } catch (error) {
    return redirect(
      `/admin/products/${publicId}/edit?error=${encodeURIComponent(error instanceof Error ? error.message : 'Invalid barcode.')}`,
      303,
    );
  }
  return redirect(`/admin/products/${publicId}/edit#options`, 303);
};
