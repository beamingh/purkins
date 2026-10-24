import type { D1Database } from '@cloudflare/workers-types';
import { generatePublicId, parsePublicId } from '../ids/publicId';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type GalleryInput =
  | { action: 'gallery.attach'; request_id: string; product_id: string;
      media_id: string; expected_revision: number; alt?: string }
  | { action: 'gallery.alt'; request_id: string; product_id: string;
      image_id: string; expected_revision: number; alt: string }
  | { action: 'gallery.primary'; request_id: string; product_id: string;
      image_id: string; expected_revision: number };
type Receipt = {
  request_id: string;
  actor: string;
  action: GalleryInput['action'];
  payload_sha256: string;
  nonce: string;
  product_public_id: string;
  image_public_id: string;
  expected_revision: number;
  completed: number;
};
export type GalleryWriteResult =
  | { ok: true; product_id: string; image_id: string; gallery_revision: number;
      replayed: boolean; published: false }
  | { ok: false; conflict: boolean; error: string };

function ownerActor(actor: string): string {
  if (!actor || actor.length > 254 ||
    !(actor === 'owner:bearer' || /^owner:access:[^\s@]+@[^\s@]+$/.test(actor))) {
    throw new Error('Authenticated Purkins owner identity is required.');
  }
  return actor;
}
function keyOf(value: string): string {
  if (!UUID_V4.test(value)) throw new Error('Use a UUIDv4 request_id for each change.');
  return value.toLowerCase();
}
function normalizeAlt(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > 300) throw new Error('Photo description must be 300 characters or shorter.');
  return trimmed;
}
async function digest(input: GalleryInput, productId: string, imageId: string,
  alt: string | null): Promise<string> {
  const json = JSON.stringify({
    action: input.action, product: productId, image: imageId,
    expected_revision: input.expected_revision,
    ...(alt === null ? {} : { alt }),
  });
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
  return [...new Uint8Array(buffer)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function findReceipt(db: D1Database, requestId: string): Promise<Receipt | null> {
  return db.prepare('SELECT * FROM purkins_mcp_gallery_receipts WHERE request_id=?')
    .bind(requestId).first<Receipt>();
}
function conflict(message: string): GalleryWriteResult {
  return {ok:false,conflict:true,error:message};
}

/**
 * A gallery change is one D1.batch: unique request receipt, conditional
 * mutation, denormalized thumbnail sync, and completion assertion.
 *
 * The completion CHECK forces a rollback if the media row was concurrently
 * removed, the draft was published, an image disappeared, or the expected
 * revision became stale. Existing Admin edits also increment revisions via
 * migration 0048 triggers.
 */
export async function applyGuardedGalleryMutation(
  db: D1Database, actorInput: string, input: GalleryInput,
): Promise<GalleryWriteResult> {
  const actor=ownerActor(actorInput);
  const key=keyOf(input.request_id);
  const product=parsePublicId(input.product_id,'product');
  const image=input.action==='gallery.attach'
    ? parsePublicId(input.media_id,'media')
    : parsePublicId(input.image_id,'productImage');
  if (!product || !image) throw new Error('A valid prod_ and med_/pimg_ ID are required.');
  if (!Number.isSafeInteger(input.expected_revision) || input.expected_revision<0) {
    throw new Error('Read the current gallery_revision before updating.');
  }
  const alt=input.action==='gallery.primary'
    ? null : normalizeAlt(input.alt ?? '');
  const hash=await digest(input,product,image,alt);
  const prior=await findReceipt(db,key);
  if(prior) {
    if(prior.actor!==actor || prior.action!==input.action ||
       prior.payload_sha256!==hash || prior.product_public_id!==product) {
      return conflict('This request_id was already used by another actor or for a different change.');
    }
    if(prior.completed!==1) return conflict('Previous request is incomplete. Investigate before retrying.');
    return {ok:true,product_id:prior.product_public_id,
      image_id:prior.image_public_id,gallery_revision:prior.expected_revision+1,
      replayed:true,published:false};
  }

  // Only an existing media claim is supported here. Upload photo bytes through
  // the protected Admin media endpoint first; do not accept untrusted URLs.
  const resultingImageId=input.action==='gallery.attach'
    ? generatePublicId('productImage') : image;
  const nonce=crypto.randomUUID();
  const statements = [
    db.prepare('INSERT INTO purkins_mcp_gallery_receipts ' +
      '(request_id,actor,action,payload_sha256,nonce,product_public_id,' +
      'image_public_id,expected_revision) VALUES (?,?,?,?,?,?,?,?) ' +
      'ON CONFLICT(request_id) DO NOTHING RETURNING request_id')
      .bind(key,actor,input.action,hash,nonce,product,resultingImageId,input.expected_revision),
  ];

  if(input.action==='gallery.attach') {
    statements.push(db.prepare(
      'INSERT INTO product_images (product_id,image_key,position,public_id,alt,last_mcp_gallery_nonce) ' +
      'SELECT p.id,m.image_key, ' +
      '(SELECT COALESCE(MAX(pi.position),-1)+1 FROM product_images pi WHERE pi.product_id=p.id), ' +
      '?,?,? FROM products p JOIN purkins_intake i ON i.product_id=p.id ' +
      'JOIN media m ON m.public_id=? WHERE p.public_id=? AND p.active=0 ' +
      "AND i.status='draft' AND p.mcp_gallery_revision=? " +
      'AND NOT EXISTS(SELECT 1 FROM product_images pi WHERE pi.product_id=p.id ' +
      'AND pi.image_key=m.image_key) AND EXISTS(SELECT 1 FROM purkins_mcp_gallery_receipts r ' +
      'WHERE r.request_id=? AND r.nonce=?) RETURNING public_id',
    ).bind(resultingImageId,alt||null,nonce,image,product,input.expected_revision,key,nonce));
  } else if(input.action==='gallery.alt') {
    statements.push(db.prepare(
      'UPDATE product_images SET alt=?,last_mcp_gallery_nonce=? ' +
      'WHERE public_id=? AND COALESCE(alt,\'\')<>? ' +
      'AND EXISTS(SELECT 1 FROM products p JOIN purkins_intake i ON i.product_id=p.id ' +
      'WHERE p.id=product_images.product_id AND p.public_id=? AND p.active=0 ' +
      "AND i.status='draft' AND p.mcp_gallery_revision=?) " +
      'AND EXISTS(SELECT 1 FROM purkins_mcp_gallery_receipts r WHERE r.request_id=? AND r.nonce=?) ' +
      'RETURNING public_id',
    ).bind(alt||null,nonce,image,alt,product,input.expected_revision,key,nonce));
  } else {
    statements.push(db.prepare(
      'UPDATE product_images AS target SET position=(' +
      'SELECT COALESCE(MIN(pi.position),0)-1 FROM product_images pi ' +
      'WHERE pi.product_id=target.product_id),last_mcp_gallery_nonce=? ' +
      'WHERE public_id=? AND id<>(SELECT pi.id FROM product_images pi ' +
      'WHERE pi.product_id=target.product_id ORDER BY pi.position,pi.id LIMIT 1) ' +
      'AND EXISTS(SELECT 1 FROM products p JOIN purkins_intake i ON i.product_id=p.id ' +
      'WHERE p.id=target.product_id AND p.public_id=? AND p.active=0 ' +
      "AND i.status='draft' AND p.mcp_gallery_revision=?) " +
      'AND EXISTS(SELECT 1 FROM purkins_mcp_gallery_receipts r WHERE r.request_id=? AND r.nonce=?) ' +
      'RETURNING public_id',
    ).bind(nonce,image,product,input.expected_revision,key,nonce));
  }

  statements.push(db.prepare(
    'UPDATE products SET image_key=(SELECT pi.image_key FROM product_images pi ' +
    'WHERE pi.product_id=products.id ORDER BY pi.position,pi.id LIMIT 1) ' +
    'WHERE public_id=? AND active=0 AND mcp_gallery_revision=? ' +
    'AND EXISTS(SELECT 1 FROM product_images pi ' +
    'WHERE pi.product_id=products.id AND pi.last_mcp_gallery_nonce=?)',
  ).bind(product,input.expected_revision+1,nonce));

  // Incomplete operations abort atomically, including their receipt.
  statements.push(db.prepare(
    'UPDATE purkins_mcp_gallery_receipts SET completed=CASE WHEN ' +
    'EXISTS(SELECT 1 FROM product_images pi JOIN products p ON p.id=pi.product_id ' +
    'JOIN purkins_intake i ON i.product_id=p.id ' +
    'WHERE pi.public_id=? AND pi.last_mcp_gallery_nonce=? ' +
    "AND p.public_id=? AND p.active=0 AND i.status='draft' " +
    'AND p.mcp_gallery_revision=? ' +
    'AND p.image_key IS (SELECT q.image_key FROM product_images q ' +
    'WHERE q.product_id=p.id ORDER BY q.position,q.id LIMIT 1)) ' +
    'THEN 1 ELSE -1 END WHERE request_id=? AND nonce=? RETURNING completed',
  ).bind(resultingImageId,nonce,product,input.expected_revision+1,key,nonce));

  try {
    const results=await db.batch(statements);
    if(results[1]?.results?.length && results[3]?.results?.length) {
      return {ok:true,product_id:product,image_id:resultingImageId,
        gallery_revision:input.expected_revision+1,replayed:false,published:false};
    }
    const concurrent=await findReceipt(db,key);
    if(concurrent?.completed===1 && concurrent.actor===actor && concurrent.payload_sha256===hash) {
      return {ok:true,product_id:product,image_id:concurrent.image_public_id,
        gallery_revision:concurrent.expected_revision+1,replayed:true,published:false};
    }
    return conflict('Gallery changed during this operation. Refresh and retry with a new request ID.');
  } catch(error) {
    const previous=await findReceipt(db,key);
    if(previous) {
      if(previous.actor!==actor || previous.payload_sha256!==hash || previous.action!==input.action) {
        return conflict('This request ID belongs to another change.');
      }
      if(previous.completed===1) {
        return {ok:true,product_id:product,image_id:previous.image_public_id,
          gallery_revision:previous.expected_revision+1,replayed:true,published:false};
      }
    }
    if(/constraint|UNIQUE|CHECK/i.test(String(error))) {
      return conflict('Stale gallery revision, already attached image, unchanged value, or product is not a draft. Refresh gallery before retrying.');
    }
    throw error; // Uncertain infrastructure failure: retry SAME UUID.
  }
}
