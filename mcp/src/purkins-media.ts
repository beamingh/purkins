import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { createR2Storage } from '../../src/features/storage/r2';
import { countMedia, getMediaByPublicId, listMedia, attachMediaToProduct } from '../../src/features/media/db';
import { uploadMedia, validateUpload } from '../../src/features/media/upload';
import { readImageDimensions } from '../../src/features/media/dimensions';
import { getProductByPublicId, getProductBySlug, listProductImages, setProductImageAlt, syncPrimaryImage } from '../../src/features/products/db';
import { getIntake } from '../../src/features/purkins/db';
import { parsePublicId } from '../../src/features/ids/publicId';

const LIMIT = 5 * 1024 * 1024;
const reply = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

/**
 * An operator's image source must be a literal public HTTPS host, never an
 * IP, internal hostname, URL with credentials, or a redirected resource.
 * Blocking redirects closes the common public-URL -> private-target escape.
 */
export function safeImageUrl(input: string): URL | null {
  try {
    const u = new URL(input);
    const h = u.hostname.toLowerCase().replace(/\.$/, '');
    if (u.protocol !== 'https:' || u.username || u.password || u.port && u.port !== '443') return null;
    if (!h.includes('.') || h === 'localhost' || h.endsWith('.localhost') ||
        h.endsWith('.local') || h.endsWith('.internal') ||
        h.endsWith('.test') || h.endsWith('.invalid') ||
        h.endsWith('.example') || h.endsWith('.onion') ||
        h.startsWith('[') || /^\d+(?:\.\d+)*$/.test(h)) return null;
    return u;
  } catch {
    return null;
  }
}

export async function downloadImage(url: string, load: typeof fetch = fetch): Promise<File> {
  const source = safeImageUrl(url);
  if (!source) throw new Error('Use a public HTTPS image URL (no IP addresses, credentials, local hosts, or redirects).');

  const response = await load(source.href, {
    method: 'GET', redirect: 'error',
    headers: { accept: 'image/jpeg, image/png, image/webp, image/gif' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || !response.body) throw new Error('Image source did not return a readable file.');
  const type = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' } as Record<string, string>)[type];
  if (!ext) { await response.body.cancel(); throw new Error('Only JPEG, PNG, WebP or GIF photographs are allowed.'); }

  const announced = Number(response.headers.get('content-length') ?? '0');
  if (announced > LIMIT) { await response.body.cancel(); throw new Error('Image is larger than 5 MB.'); }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > LIMIT) throw new Error('Image is larger than 5 MB.');
      chunks.push(part.value);
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    throw err;
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new Error('The image was empty.');
  const bytes = new Uint8Array(size);
  let i = 0;
  for (const chunk of chunks) { bytes.set(chunk, i); i += chunk.length; }
  // The size parser also checks the magic bytes. Content-Type alone is
  // untrusted, and SVG/HTML must never be hosted on a shop origin.
  if (!readImageDimensions(bytes)) throw new Error('The URL did not contain a valid supported image.');
  const file = new File([bytes.buffer], `purkins-import.${ext}`, { type });
  const invalid = validateUpload(file);
  if (invalid) throw new Error(invalid);
  return file;
}

async function draftProduct(db: D1Database, ref: string) {
  if (/^\d+$/.test(ref.trim())) return {error: 'Use a prod_ public ID or slug, not a numeric ID.'} as const;
  const publicId = parsePublicId(ref, 'product');
  const p = publicId ? await getProductByPublicId(db, publicId) : await getProductBySlug(db, ref.trim());
  if (!p) return {error: 'Product not found.'} as const;
  if (!await getIntake(db, p.id)) return {error: 'This is not a Purkins intake item.'} as const;
  if (p.active !== 0) return {error: 'Edit the published product into a draft before changing its photographs, then approve again.'} as const;
  return {product: p} as const;
}

export function registerPurkinsMediaTools(
  server: McpServer, db: D1Database, bucket: R2Bucket | undefined, allowWrites: boolean,
): void {
  server.registerTool('list_purkins_media', {
    description: 'Operator-only list of media library images. Returns med_ IDs for attaching photos to private stock drafts.',
    inputSchema: {
      limit: z.number().int().min(1).max(48).default(24),
      offset: z.number().int().nonnegative().default(0),
    },
  }, async ({limit, offset}) => {
    const media = await listMedia(db, limit, offset);
    return reply({
      media: media.map(m => ({
        id: m.public_id, name: m.original_name, image_path: '/images/' + m.image_key,
        mime_type: m.mime_type, width: m.width, height: m.height,
      })),
      total: await countMedia(db), limit, offset,
    });
  });

  server.registerTool('get_purkins_gallery', {
    description: 'Operator-only list of current product photographs and alt text, including which image is primary.',
    inputSchema: { product_id: z.string().min(1) },
  }, async ({product_id}) => {
    const id = parsePublicId(product_id, 'product');
    const p = id ? await getProductByPublicId(db, id) : null;
    if (!p) return reply({error: 'Pass a valid prod_ product ID.'});
    const images = await listProductImages(db, p.id);
    return reply({ product_id: id, images: images.map(i => ({
      id: i.public_id, image_path: '/images/' + i.image_key,
      alt: i.alt, primary: i.image_key === p.image_key,
    })) });
  });

  if (!allowWrites) return;

  server.registerTool('attach_purkins_media', {
    description: 'Attach an existing med_ media-library image to an UNPUBLISHED Purkins draft. Does not publish the item.',
    inputSchema: {product_id: z.string().min(1), media_id: z.string().min(1)},
  }, async ({product_id, media_id}) => {
    const d = await draftProduct(db, product_id);
    if ('error' in d) return reply(d);
    const id = parsePublicId(media_id, 'media');
    const media = id ? await getMediaByPublicId(db, id) : null;
    if (!media) return reply({error: 'Invalid or missing med_ image.'});
    const attached = await attachMediaToProduct(db, d.product.id, media.id);
    if (!attached.ok) return reply(attached);
    await syncPrimaryImage(db, d.product.id);
    return reply({attached: id, product_id: d.product.public_id, published: false});
  });

  server.registerTool('import_purkins_image', {
    description: 'Import a public HTTPS JPEG/PNG/WebP/GIF image (up to 5 MB), save to Purkins R2/media library and attach to an UNPUBLISHED draft. Never publishes. No URL redirects, IP hosts or internal addresses.',
    inputSchema: {product_id: z.string().min(1), image_url: z.string().url().max(2048)},
  }, async ({product_id, image_url}) => {
    const d = await draftProduct(db, product_id);
    if ('error' in d) return reply(d);
    if (!bucket) return reply({error: 'R2 BUCKET binding is not configured for this MCP Worker.'});
    const file = await downloadImage(image_url);
    const media = await uploadMedia(db, createR2Storage(bucket), file, file.name);
    const attached = await attachMediaToProduct(db, d.product.id, media.id);
    if (!attached.ok) return reply({error: attached.error, media_id: media.public_id, retained_in_library: true});
    await syncPrimaryImage(db, d.product.id);
    return reply({
      media_id: media.public_id, product_id: d.product.public_id,
      image_path: '/images/' + media.image_key,
      width: media.width, height: media.height, published: false,
    });
  });

  server.registerTool('set_purkins_photo_alt', {
    description: 'Set descriptive alt text for a gallery image on a private Purkins draft (pimg_ image ID).',
    inputSchema: {
      product_id: z.string().min(1), image_id: z.string().min(1),
      alt: z.string().max(300),
    },
  }, async ({product_id, image_id, alt}) => {
    const d = await draftProduct(db, product_id);
    if ('error' in d) return reply(d);
    const id = parsePublicId(image_id, 'productImage');
    const gallery = await listProductImages(db, d.product.id);
    const row = gallery.find(g => g.public_id === id);
    if (!row) return reply({error: 'pimg_ photo not found on that product.'});
    await setProductImageAlt(db, row.id, alt);
    return reply({image_id: id, updated: true, published: false});
  });
}
