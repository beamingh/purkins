import type { D1Database } from '@cloudflare/workers-types';
import { parsePublicId } from '../ids/publicId';
import { requireVerifiedOwnerActorShape } from '../mcp/ownerActor';
import type { LiveCopyFields } from './liveCopy';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface LiveEditReceipt {
  request_id: string;
  actor: string;
  product_public_id: string;
  payload_sha256: string;
  nonce: string;
  expected_revision: number;
  completed: number;
  cache_purged: number;
}
export interface LiveEditInput extends LiveCopyFields {
  request_id: string;
  product_id: string;
  expected_catalog_revision: number;
}
export type LiveEditResult =
  | { ok: true; cache_purged: boolean; replayed: boolean; warning?: string }
  | { ok: false; error: string };

const fail = (error: string): LiveEditResult => ({ ok: false, error });

async function receipt(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM purkins_live_edit_receipts WHERE request_id=?')
    .bind(id).first<LiveEditReceipt>();
}
async function digest(data: unknown) {
  const bytes = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(JSON.stringify(data)),
  );
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Apply an APPROVED listing's description/previous-price change only.
 * The existing catalog revision trigger protects concurrent edits to all
 * other Admin product, variant, gallery and intake fields.
 *
 * A receipt + product compare-and-swap + receipt completion are in one
 * atomic D1.batch. On purge failure, replay the same request instead of
 * applying the product mutation a second time.
 */
export async function applyGuardedLiveCopy(
  db: D1Database,
  actorValue: string,
  input: LiveEditInput,
  purgePublicCache: (() => Promise<void>) | null,
): Promise<LiveEditResult> {
  const actor = requireVerifiedOwnerActorShape(actorValue);
  const id = input.request_id.toLowerCase();
  const product = parsePublicId(input.product_id, 'product');
  if (!UUID.test(id) || !product ||
      !Number.isSafeInteger(input.expected_catalog_revision) ||
      input.expected_catalog_revision < 0) {
    return fail('Invalid edit request or catalog revision. Reload and retry.');
  }
  if (!purgePublicCache) return fail('Public storefront cache refresh is not configured. No changes saved.');
  if (input.description !== null && input.description.length > 8000) {
    return fail('Description exceeds the 8,000-character limit.');
  }
  if (input.compare_at_price_cents !== null &&
      (!Number.isSafeInteger(input.compare_at_price_cents) || input.compare_at_price_cents <= 0)) {
    return fail('Invalid original price.');
  }

  const hash = await digest({
    product, revision: input.expected_catalog_revision,
    description: input.description,
    compare_at_price_cents: input.compare_at_price_cents,
  });
  const prior = await receipt(db, id);
  if (prior && (prior.actor !== actor || prior.product_public_id !== product ||
    prior.payload_sha256 !== hash || prior.expected_revision !== input.expected_catalog_revision)) {
    return fail('This save request was already used with different details. Reload before editing.');
  }
  if (prior && prior.completed !== 1) {
    return fail('The earlier save outcome is uncertain. Inspect the live listing first.');
  }

  if (!prior) {
    const row = await db.prepare(
      'SELECT p.id,p.active,p.price_cents,p.currency,p.mcp_catalog_revision AS revision, ' +
      'i.status,i.condition_status FROM products p JOIN purkins_intake i ON i.product_id=p.id ' +
      'WHERE p.public_id=?',
    ).bind(product).first<{
      id: number; active: number; price_cents: number; currency: string;
      revision: number; status: string; condition_status: string | null;
    }>();
    if (!row || row.active !== 1 || row.status !== 'approved' ||
        row.condition_status !== 'complete') {
      return fail('This product is no longer published and approved. Use Review & publish.');
    }
    if (row.revision !== input.expected_catalog_revision) {
      return fail('Product changed in another tab. Reload before saving.');
    }
    if (row.currency.toLowerCase() !== 'zmw' ||
       (input.compare_at_price_cents !== null &&
        input.compare_at_price_cents <= row.price_cents)) {
      return fail('Original price must be higher than the current ZMW selling price.');
    }

    const nonce = crypto.randomUUID();
    try {
      const result = await db.batch([
        db.prepare('INSERT INTO purkins_live_edit_receipts ' +
          '(request_id,actor,product_public_id,payload_sha256,nonce,expected_revision) ' +
          'VALUES (?,?,?,?,?,?) ON CONFLICT(request_id) DO NOTHING RETURNING request_id')
          .bind(id, actor, product, hash, nonce, input.expected_catalog_revision),
        db.prepare('UPDATE products SET description=?, compare_at_price_cents=?, ' +
          'last_purkins_live_edit_nonce=? ' +
          'WHERE public_id=? AND active=1 AND mcp_catalog_revision=? AND currency=\'zmw\' ' +
          'AND (? IS NULL OR ? > price_cents) ' +
          'AND EXISTS(SELECT 1 FROM purkins_intake i WHERE i.product_id=products.id ' +
          'AND i.status=\'approved\' AND i.condition_status=\'complete\') ' +
          'AND EXISTS(SELECT 1 FROM purkins_live_edit_receipts r ' +
          'WHERE r.request_id=? AND r.nonce=?) RETURNING id')
          .bind(input.description, input.compare_at_price_cents, nonce, product,
            input.expected_catalog_revision,
            input.compare_at_price_cents, input.compare_at_price_cents, id, nonce),
        // If the CAS failed, -1 violates the completed CHECK and rolls the
        // WHOLE batch back, including the receipt inserted above.
        db.prepare('UPDATE purkins_live_edit_receipts SET completed=CASE WHEN EXISTS(' +
          'SELECT 1 FROM products WHERE public_id=? AND active=1 ' +
          'AND last_purkins_live_edit_nonce=?) THEN 1 ELSE -1 END ' +
          'WHERE request_id=? AND nonce=? RETURNING completed')
          .bind(product, nonce, id, nonce),
      ]);
      if (!result[1]?.results?.length ||
          (result[2]?.results?.[0] as { completed?: number } | undefined)?.completed !== 1) {
        return fail('Product changed during save. Reload and try again.');
      }
    } catch (error) {
      const committed = await receipt(db, id);
      if (!committed || committed.completed !== 1 ||
          committed.actor !== actor || committed.payload_sha256 !== hash) {
        if (/CHECK|constraint|UNIQUE/i.test(String(error))) {
          return fail('Product changed during save. Reload and retry.');
        }
        throw error;
      }
    }
  }

  const completed = await retryLiveCopyPurge(db, actor, id, product, purgePublicCache);
  return completed.ok ? { ...completed, replayed: Boolean(prior) } : completed;
}

/** Only retries cache refresh; NEVER repeats a committed live edit. */
export async function retryLiveCopyPurge(
  db: D1Database, actorValue: string, requestId: string,
  productPublicId: string, purgePublicCache: (() => Promise<void>) | null,
): Promise<LiveEditResult> {
  const actor = requireVerifiedOwnerActorShape(actorValue);
  const id = requestId.toLowerCase();
  const product = parsePublicId(productPublicId, 'product');
  if (!UUID.test(id) || !product) return fail('Invalid cache-refresh request.');
  const saved = await receipt(db, id);
  if (!saved || saved.actor !== actor || saved.product_public_id !== product ||
      saved.completed !== 1) return fail('No completed live edit found for this request.');
  if (saved.cache_purged === 1) return { ok: true, replayed: true, cache_purged: true };
  if (!purgePublicCache) return { ok: true, replayed: true, cache_purged: false,
    warning: 'Listing saved, but public cache refresh is not configured.' };
  try {
    await purgePublicCache();
    await db.prepare('UPDATE purkins_live_edit_receipts SET cache_purged=1 ' +
      'WHERE request_id=? AND actor=? AND completed=1')
      .bind(id, actor).run();
    return { ok: true, replayed: true, cache_purged: true };
  } catch (error) {
    console.error(JSON.stringify({
      event: 'purkins_live_edit_cache_purge_failed',
      product_id: product,
      message: error instanceof Error ? error.message : String(error),
    }));
    return { ok: true, replayed: true, cache_purged: false,
      warning: 'Changes saved, but the public storefront cache has not refreshed. Retry the cache refresh only.' };
  }
}
