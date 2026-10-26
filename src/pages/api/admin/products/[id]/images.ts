import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  getProductByPublicId,
  listProductImages,
  deleteProductImageRow,
  setProductImageAlt,
  moveProductImage,
  reorderProductImages,
  makeImagePrimary,
  syncPrimaryImage,
} from '../../../../../features/products/db';
import { clearVariantImage } from '../../../../../features/products/variants';
import { validateImage } from '../../../../../features/products/image';
import { optimizeUpload } from '../../../../../features/products/imageOptimize';
import { uploadMedia } from '../../../../../features/media/upload';
import { attachMediaToProduct, getMediaByPublicId } from '../../../../../features/media/db';
import { getStorage } from '../../../../../features/storage';
import { parsePublicId } from '../../../../../features/ids/publicId';
import { CACHE_TAG } from '../../../../../features/cache/tags';
import { purgeCacheTags } from '../../../../../features/cache/purge';

export const prerender = false;

// POST /api/admin/products/:id/images — manage a product's image gallery.
// :id is the prod_ public ID; gallery rows are addressed by their pimg_ public
// IDs and library items by med_ — numeric row ids are not accepted anywhere.
// The PRIMARY image is always the first one (lowest position), so every mutation
// re-syncs products.image_key to the gallery's first image.
//   _action=add      → upload one or more files, append to the gallery
//   _action=attach   → attach library media `media_id` (med_)
//   _action=reorder  → set the full order from drag-and-drop (fetch; 204)
//   _action=primary  → move image `image_id` (pimg_) to the front (→ primary)
//   _action=move     → swap image `image_id` up/down one slot
//   _action=alt      → set image `image_id`'s alt text
//   _action=delete   → remove image `image_id` (association only)
export const POST: APIRoute = async ({ request, params, redirect }) => {
  const publicId = parsePublicId(params.id, 'product');
  const product = publicId ? await getProductByPublicId(env.DB, publicId) : null;
  if (!publicId || !product) return new Response('Not found', { status: 404 });
  const id = product.id;

  // Browser forms keep their existing redirect behavior. Fetch-based gallery
  // controls explicitly request JSON so a redirected HTML/login/error page can
  // never be mistaken for a successful save.
  const wantsJson = request.headers.get('accept')?.includes('application/json') ?? false;
  const back = (msg?: string) =>
    wantsJson
      ? new Response(JSON.stringify(msg ? { ok: false, error: msg } : { ok: true }), {
          status: msg ? 400 : 200,
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
        })
      : redirect(
          `/admin/products/${publicId}/edit${msg ? `?error=${encodeURIComponent(msg)}` : '?gallery_saved=1'}#gallery`,
          303,
        );

  const form = await request.formData();
  const action = String(form.get('_action'));
  const storage = getStorage();
  const purgeProduct = () =>
    purgeCacheTags([CACHE_TAG.catalog, CACHE_TAG.product(publicId)]);

  if (action === 'add') {
    const files = form.getAll('images').filter((f): f is File => f instanceof File && f.size > 0);
    const requestedAlt = String(form.get('photo_alt') ?? '').trim();
    if (requestedAlt.length > 300) return back('Photo description must be 300 characters or shorter.');
    for (const file of files) {
      const imgErr = validateImage(file);
      if (imgErr) return back(imgErr);
    }
    for (const [index, file] of files.entries()) {
      const media = await uploadMedia(env.DB, storage, await optimizeUpload(file), file.name);
      const attached = await attachMediaToProduct(env.DB, id, media.id);
      if (!attached.ok) return back(attached.error);
      // Give new photos meaningful default alternative text immediately. Owners
      // can refine it in the gallery or through guarded MCP metadata tools.
      await env.DB.prepare('UPDATE product_images SET alt=? WHERE product_id=? AND image_key=?')
        .bind((requestedAlt || `${product.name} — product photograph`) + (files.length > 1 ? ` (${index + 1})` : ''), id, attached.imageKey).run();
    }
    await syncPrimaryImage(env.DB, id); // first image stays primary
    await purgeProduct();
    return back();
  }

  // Reuse a file already in the library, addressed by its med_ public ID. Same
  // guarded insert as the upload path, so a stale picker selection can't attach
  // media that has since been deleted.
  if (action === 'attach') {
    const mediaPublicId = parsePublicId(form.get('media_id'), 'media');
    const media = mediaPublicId ? await getMediaByPublicId(env.DB, mediaPublicId) : null;
    if (!media) return back('Choose an image.');
    const attached = await attachMediaToProduct(env.DB, id, media.id);
    if (!attached.ok) return back(attached.error);
    await syncPrimaryImage(env.DB, id);
    await purgeProduct();
    return back();
  }

  // The remaining actions address this product's own gallery rows by pimg_
  // public ID; resolve them to row ids here — the writes stay integer.
  const gallery = await listProductImages(env.DB, id);
  const byPublicId = new Map(gallery.map((img) => [img.public_id ?? '', img]));

  // Bulk reorder from drag-and-drop (fetch). No single image_id; returns 204.
  if (action === 'reorder') {
    const ids = form
      .getAll('order')
      .map((v) => parsePublicId(v, 'productImage'))
      .map((pid) => (pid ? byPublicId.get(pid)?.id : undefined))
      .filter((n): n is number => n !== undefined);
    await reorderProductImages(env.DB, id, ids);
    await syncPrimaryImage(env.DB, id); // new first image becomes primary
    await purgeProduct();
    return wantsJson ? back() : new Response(null, { status: 204 });
  }

  const imagePublicId = parsePublicId(form.get('image_id'), 'productImage');
  const img = imagePublicId ? byPublicId.get(imagePublicId) : undefined;
  if (!img) return back('Image not found.');
  const imageId = img.id;

  if (action === 'alt') {
    await setProductImageAlt(env.DB, imageId, String(form.get('alt') ?? ''));
    await purgeProduct();
    return back();
  }

  if (action === 'primary') {
    await makeImagePrimary(env.DB, id, imageId);
    await purgeProduct();
    return back();
  }

  if (action === 'move') {
    const dir = form.get('direction') === 'up' ? 'up' : 'down';
    await moveProductImage(env.DB, imageId, dir);
    await syncPrimaryImage(env.DB, id);
    await purgeProduct();
    return back();
  }

  if (action === 'delete') {
    // Drops the ASSOCIATION only. The file stays in the media library, where it
    // may still be used by another product, a page, or the logo — and where it
    // is deleted explicitly. Removing an image from one product must never
    // break it somewhere else.
    await deleteProductImageRow(env.DB, imageId);
    await clearVariantImage(env.DB, imageId); // drop dangling variant references
    await syncPrimaryImage(env.DB, id); // promotes the new first image (or null)
    await purgeProduct();
    return back();
  }

  return back('Unknown action.');
};
