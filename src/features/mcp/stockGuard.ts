import { requireVerifiedOwnerActorShape } from './ownerActor';
import type { D1Database } from '@cloudflare/workers-types';
import { generatePublicId, parsePublicId } from '../ids/publicId';
import { slugify } from '../products/slug';
import { normalizeSupplierBarcode, type IntakeFields } from '../purkins/intake';
import { locationIdValid } from '../purkins/locations';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STOCK_LIMIT = 1_000_000;
const PRICE_LIMIT = 99_999_999_999;
type Action = 'product.create_draft' | 'stock.adjust';
type Receipt = {
  request_id: string;
  actor: string;
  action: Action;
  payload_sha256: string;
  nonce: string;
  target_id: string;
  before_stock: number | null;
  after_stock: number | null;
  expected_revision: number | null;
  outcome: 'pending' | 'applied' | 'rejected';
};
export type StockGuardResult =
  | { ok: true; id: string; stock: number; revision: number; replayed: boolean }
  | { ok: false; error: string; conflict: boolean };
export interface StockDraftInput {
  request_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  stock: number;
  location_id: string | null;
  intake: IntakeFields;
}
export interface StockAdjustInput {
  request_id: string;
  product_id: string;
  variant_id: string | null;
  expected_stock: number;
  expected_revision: number;
  new_stock: number;
}

function validatedActor(actor: string): string {
  return requireVerifiedOwnerActorShape(actor);
}
function requestId(input: string): string {
  if (!UUID_V4.test(input)) throw new Error('Use a valid UUIDv4 request_id.');
  return input.toLowerCase();
}
function quantity(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0 && n <= STOCK_LIMIT;
}
async function payloadHash(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function priorReceipt(db: D1Database, requestId: string): Promise<Receipt | null> {
  return db.prepare('SELECT * FROM purkins_mcp_stock_mutations WHERE request_id = ?')
    .bind(requestId).first<Receipt>();
}
async function replay(
  db: D1Database, requestId: string, actor: string, action: Action, hash: string,
): Promise<StockGuardResult | null> {
  const prior = await priorReceipt(db, requestId);
  if (!prior) return null;
  if (prior.actor !== actor || prior.action !== action || prior.payload_sha256 !== hash) {
    return { ok: false, conflict: true, error: 'Request ID already used for another operation or actor.' };
  }
  if (prior.outcome !== 'applied') {
    return { ok: false, conflict: true, error: 'This request was rejected. Refresh the stock and use a new request ID.' };
  }
  // Return the historical committed result, not current stock, even if
  // another owner action or checkout changed the quantity since this write.
  return {
    ok: true, id: prior.target_id, stock: prior.after_stock ?? 0,
    revision: action === 'stock.adjust' ? (prior.expected_revision ?? 0) + 1 : 0,
    replayed: true,
  };
}
function receiptInsert(db: D1Database, r: Receipt, expectedRevision: number | null) {
  return db.prepare(
    'INSERT INTO purkins_mcp_stock_mutations ' +
    '(request_id,actor,action,payload_sha256,nonce,target_id,before_stock,after_stock,expected_revision) ' +
    'VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(request_id) DO NOTHING RETURNING request_id',
  ).bind(
    r.request_id,r.actor,r.action,r.payload_sha256,r.nonce,r.target_id,
    r.before_stock,r.after_stock,expectedRevision,
  );
}
function auditOutcome(db: D1Database, r: Receipt, existsSql: string, args: unknown[]) {
  return db.prepare(
    "UPDATE purkins_mcp_stock_mutations SET outcome = CASE WHEN EXISTS (" +
    existsSql + ") THEN 'applied' ELSE 'rejected' END WHERE request_id = ? AND nonce = ?",
  ).bind(...args, r.request_id, r.nonce);
}
function collision(error: unknown): StockGuardResult {
  if (/UNIQUE|constraint/i.test(String(error))) {
    return { ok:false, conflict:true, error:'Duplicate name/SKU or concurrent stock change. Refresh before retrying.' };
  }
  throw error;
}

/**
 * Creates ONE non-variant, unpublished product AND its private intake row in
 * a single database transaction. A retry cannot leave orphaned products or
 * duplicate units. More complex multi-variant inserts remain disabled.
 */
export async function createGuardedStockDraft(
  db: D1Database, actorRaw: string, input: StockDraftInput,
): Promise<StockGuardResult> {
  const actor = validatedActor(actorRaw);
  const key = requestId(input.request_id);
  const name = input.name.trim().replace(/\s+/g,' ');
  if (!name || name.length > 200 || (input.description !== null && input.description.length > 5000) ||
      !quantity(input.stock) || !Number.isSafeInteger(input.price_cents) ||
      input.price_cents < 0 || input.price_cents > PRICE_LIMIT) {
    throw new Error('Invalid draft name, description, stock or selling price.');
  }
  if (input.location_id !== null && !locationIdValid(input.location_id)) throw new Error('Invalid location reference.');
  if (input.intake.storage_location != null) throw new Error('Use location_id, never an inferred free-text location.');
  normalizeSupplierBarcode(input.intake.supplier_barcode);
  const slug = slugify(name);
  if (!slug) throw new Error('Name does not form a usable product slug.');
  const hash = await payloadHash({
    action: 'product.create_draft', name, description: input.description,
    price: input.price_cents, stock: input.stock,
    location: input.location_id, intake: input.intake,
  });
  const previous = await replay(db, key, actor, 'product.create_draft', hash);
  if (previous) return previous;
  const existing = await db.prepare('SELECT public_id FROM products WHERE slug=?')
    .bind(slug).first<{ public_id: string }>();
  if (existing) return { ok:false, conflict:true, error:'A product with that name already exists. Search before creating another.' };
  if (input.location_id) {
    const parent = await db.prepare('SELECT id FROM purkins_locations WHERE id=?')
      .bind(input.location_id).first();
    if (!parent) return { ok:false, conflict:true, error:'Stock location no longer exists.' };
  }
  const productId = generatePublicId('product');
  const r: Receipt = {
    request_id:key, actor, action:'product.create_draft',payload_sha256:hash,
    nonce:crypto.randomUUID(),target_id:productId,before_stock:null,
    after_stock:input.stock,expected_revision:0,outcome:'pending',
  };
  const f = input.intake;
  try {
    const result = await db.batch([
      receiptInsert(db,r,0),
      db.prepare(
        'INSERT INTO products (name,slug,description,price_cents,currency,image_key,' +
        'stock,active,weight_grams,requires_shipping,public_id,last_mcp_stock_request) ' +
        "SELECT ?,?,?,?,'zmw',NULL,?,0,NULL,1,?,? WHERE EXISTS (" +
        'SELECT 1 FROM purkins_mcp_stock_mutations WHERE request_id=? AND nonce=?) ' +
        'AND (? IS NULL OR EXISTS (SELECT 1 FROM purkins_locations WHERE id=?)) RETURNING id',
      ).bind(name,slug,input.description,input.price_cents,input.stock,productId,r.nonce,key,r.nonce,
        input.location_id,input.location_id),
      db.prepare(
        'INSERT INTO purkins_intake (product_id,sku,size_label,colour,age_range,storage_location,' +
        'location_id,purchase_currency,purchase_cost_minor,zar_to_zmw,overhead_zwm_cents,' +
        'markup_percent,brand,supplier_barcode,retail_tag_minor,retail_tag_currency,' +
        'pack_count,condition_status,internal_notes,pricing_mode,status) ' +
        "SELECT p.id,printf('PUR-%06d',p.id),?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft' " +
        'FROM products p WHERE p.public_id=? AND p.last_mcp_stock_request=? ' +
        'AND EXISTS (SELECT 1 FROM purkins_mcp_stock_mutations WHERE request_id=? AND nonce=?) ' +
        'AND (? IS NULL OR EXISTS (SELECT 1 FROM purkins_locations WHERE id=?))',
      ).bind(
        f.size_label, f.colour, f.age_range, input.location_id,
        f.purchase_currency,f.purchase_cost_minor,f.zar_to_zmw,f.overhead_zwm_cents,
        f.markup_percent,f.brand??null,f.supplier_barcode??null,f.retail_tag_minor??null,
        f.retail_tag_currency??'ZAR',f.pack_count??null,
        f.condition_status??'review',f.internal_notes??null,f.pricing_mode??'manual',
        productId,r.nonce,key,r.nonce,input.location_id,input.location_id,
      ),
      auditOutcome(db,r,
        'SELECT 1 FROM products p JOIN purkins_intake i ON i.product_id=p.id ' +
        'WHERE p.public_id=? AND p.last_mcp_stock_request=?',
        [productId,r.nonce],
      ),
    ]);
    if (result[1]?.results?.length && result[2]?.meta?.changes === 1) {
      return {ok:true,id:productId,stock:input.stock,revision:0,replayed:false};
    }
    const concurrentlyRecorded = await replay(db,key,actor,'product.create_draft',hash);
    if (concurrentlyRecorded) return concurrentlyRecorded;
    return {ok:false,conflict:true,error:'Draft was not created. Refresh before trying again.'};
  } catch (error) { return collision(error); }
}

/**
 * Compare-and-swap stock CORRECTION, not a sale. Only draft/unpublished
 * Purkins items qualify; published items and paid order accounting stay in
 * their existing checkout/manual-sale flows.
 */
export async function adjustGuardedDraftStock(
  db: D1Database, actorRaw: string, input: StockAdjustInput,
): Promise<StockGuardResult> {
  const actor=validatedActor(actorRaw), key=requestId(input.request_id);
  const product = parsePublicId(input.product_id,'product');
  const variant = input.variant_id === null ? null : parsePublicId(input.variant_id,'variant');
  if (!product || (input.variant_id !== null && !variant) ||
      !quantity(input.expected_stock) || !quantity(input.new_stock) ||
      !Number.isSafeInteger(input.expected_revision) || input.expected_revision < 0 ||
      input.new_stock === input.expected_stock) {
    throw new Error('Invalid stock reference, expected state or revised quantity.');
  }
  const target=variant??product;
  const hash=await payloadHash({
    action:'stock.adjust', product,variant, before:input.expected_stock,
    after:input.new_stock,rev:input.expected_revision,
  });
  const previous=await replay(db,key,actor,'stock.adjust',hash);
  if(previous) return previous;
  const r:Receipt={
    request_id:key,actor,action:'stock.adjust',payload_sha256:hash,
    nonce:crypto.randomUUID(),target_id:target,
    before_stock:input.expected_stock,after_stock:input.new_stock,
    expected_revision:input.expected_revision,outcome:'pending',
  };
  const statement=variant
    ? db.prepare(
      'UPDATE product_variants SET stock=?,last_mcp_stock_request=? ' +
      'WHERE public_id=? AND stock=? AND mcp_stock_revision=? ' +
      'AND EXISTS (SELECT 1 FROM products p JOIN purkins_intake i ON i.product_id=p.id ' +
      "WHERE p.id=product_variants.product_id AND p.public_id=? AND p.active=0 AND i.status='draft') " +
      'AND EXISTS (SELECT 1 FROM purkins_mcp_stock_mutations WHERE request_id=? AND nonce=?) ' +
      'RETURNING id',
    ).bind(input.new_stock,r.nonce,variant,input.expected_stock,input.expected_revision,product,key,r.nonce)
    : db.prepare(
      'UPDATE products SET stock=?,last_mcp_stock_request=? ' +
      'WHERE public_id=? AND stock=? AND mcp_stock_revision=? AND active=0 ' +
      "AND EXISTS (SELECT 1 FROM purkins_intake i WHERE i.product_id=products.id AND i.status='draft') " +
      'AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id=products.id) ' +
      'AND EXISTS (SELECT 1 FROM purkins_mcp_stock_mutations WHERE request_id=? AND nonce=?) ' +
      'RETURNING id',
    ).bind(input.new_stock,r.nonce,product,input.expected_stock,input.expected_revision,key,r.nonce);
  try {
    const result=await db.batch([
      receiptInsert(db,r,input.expected_revision),
      statement,
      auditOutcome(db,r,
        variant
          ? "SELECT 1 FROM product_variants WHERE public_id=? AND last_mcp_stock_request=?"
          : "SELECT 1 FROM products WHERE public_id=? AND last_mcp_stock_request=?",
        [target,r.nonce],
      ),
    ]);
    if(result[1]?.results?.length) {
      return {ok:true,id:target,stock:input.new_stock,revision:input.expected_revision+1,replayed:false};
    }
    const concurrent=await replay(db,key,actor,'stock.adjust',hash);
    if(concurrent) return concurrent;
    return {ok:false,conflict:true,error:'Stale stock, published product or invalid variant. Refresh before retrying.'};
  } catch(error) {return collision(error);}
}
