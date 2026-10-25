import { requireVerifiedOwnerActorShape } from './ownerActor';
import type { D1Database } from '@cloudflare/workers-types';
import { generatePublicId } from '../ids/publicId';
import { slugify } from '../products/slug';
import { normalizeSupplierBarcode, type IntakeFields } from '../purkins/intake';
import { locationIdValid } from '../purkins/locations';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_UNITS = 1_000_000;
const MAX_PRICE_CENTS = 99_999_999_999;
const MAX_VARIANTS = 20;
const MAX_ITEMS = 8;

export interface ClothingVariantInput {
  label: string;
  size_label?: string | null;
  colour?: string | null;
  stock: number;
  price_cents?: number;
  supplier_barcode?: string | null;
  retail_tag_minor?: number | null;
  retail_tag_currency?: 'ZAR' | 'ZMW';
  pack_count?: number | null;
}
export interface ClothingDraftInput {
  request_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  location_id: string | null;
  intake: IntakeFields;
  variants: ClothingVariantInput[];
}
export interface CreatedClothingVariant {
  id: string;
  label: string;
  sku: string;
  stock: number;
  price_cents: number;
}
export type ClothingDraftResult =
  | { ok: true; request_id: string; id: string; sku: string; total_units: number; variants: CreatedClothingVariant[]; replayed: boolean }
  | { ok: false; request_id: string; error: string; conflict: boolean };

interface Receipt {
  request_id: string;
  actor: string;
  payload_sha256: string;
  nonce: string;
  product_public_id: string;
  total_units: number;
  variant_count: number;
  barcode_count: number;
  completed: number;
}
type NormalizedVariant = Required<Omit<ClothingVariantInput, 'price_cents'>> & { price_cents: number };
type NormalizedItem = Omit<ClothingDraftInput, 'variants'> & {
  request_id: string;
  name: string;
  variants: NormalizedVariant[];
  total_units: number;
  slug: string;
};

function isCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_UNITS;
}
function isMoney(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_PRICE_CENTS;
}
function normalizedName(value: string, limit: number, field: string): string {
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text || text.length > limit) throw Error(field + ' must be 1–' + limit + ' characters.');
  return text;
}
function normalizeItem(input: ClothingDraftInput): NormalizedItem {
  if (!UUID_V4.test(input.request_id)) throw Error('A UUIDv4 request_id is required for each clothing product.');
  const request_id = input.request_id.toLowerCase();
  const name = normalizedName(input.name, 200, 'Product name');
  const slug = slugify(name);
  if (!slug) throw Error('Product name cannot be converted to a slug.');
  if (input.description !== null && input.description.length > 5000) throw Error('Description too long.');
  if (!isMoney(input.price_cents)) throw Error('Invalid ZMW selling price.');
  if (input.location_id !== null && !locationIdValid(input.location_id)) throw Error('Invalid storage location ID.');
  if (input.intake.storage_location != null) throw Error('Use an existing loc_ ID; do not infer storage hierarchy.');
  if (input.variants.length < 1 || input.variants.length > MAX_VARIANTS) {
    throw Error('Each clothing listing needs 1–20 size/colour variants.');
  }
  normalizeSupplierBarcode(input.intake.supplier_barcode);
  let total_units = 0;
  const labels = new Set<string>();
  const variants = input.variants.map((v): NormalizedVariant => {
    const label = normalizedName(v.label, 100, 'Size/colour label');
    const key = label.toLocaleLowerCase('en');
    if (labels.has(key)) throw Error('Duplicate size/colour label: ' + label);
    labels.add(key);
    if (!isCount(v.stock)) throw Error('Invalid quantity for ' + label);
    total_units += v.stock;
    if (!isCount(total_units)) throw Error('Total stock is too large.');
    const price_cents = v.price_cents ?? input.price_cents;
    if (!isMoney(price_cents)) throw Error('Invalid ZMW price for ' + label);
    const size_label = v.size_label == null ? null : v.size_label.trim();
    const colour = v.colour == null ? null : v.colour.trim();
    if ((size_label !== null && size_label.length > 60) ||
        (colour !== null && colour.length > 60)) throw Error('Size/colour detail is too long.');
    const retail_tag_minor = v.retail_tag_minor ?? null;
    if (retail_tag_minor !== null && !isMoney(retail_tag_minor)) throw Error('Invalid retailer tag amount.');
    const retail_tag_currency = v.retail_tag_currency ?? 'ZAR';
    if (retail_tag_currency !== 'ZAR' && retail_tag_currency !== 'ZMW') throw Error('Invalid retailer tag currency.');
    const pack_count = v.pack_count ?? null;
    if (pack_count !== null &&
        (!Number.isSafeInteger(pack_count) || pack_count < 1 || pack_count > 999)) {
      throw Error('Pack count must be 1–999.');
    }
    return {
      label, size_label, colour, stock: v.stock, price_cents,
      supplier_barcode: normalizeSupplierBarcode(v.supplier_barcode),
      retail_tag_minor, retail_tag_currency, pack_count,
    };
  });
  return {
    request_id, name, slug, description: input.description,
    price_cents: input.price_cents, location_id: input.location_id,
    intake: input.intake, variants, total_units,
  };
}
function owner(actor: string): string {
  return requireVerifiedOwnerActorShape(actor);
}
async function hashPayload(item: NormalizedItem): Promise<string> {
  const text = JSON.stringify({
    operation: 'clothing.create_draft',
    name: item.name, description: item.description, price_cents: item.price_cents,
    location_id: item.location_id, intake: item.intake, variants: item.variants,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
async function receipt(db: D1Database, requestId: string): Promise<Receipt | null> {
  return db.prepare('SELECT * FROM purkins_mcp_clothing_receipts WHERE request_id=?')
    .bind(requestId).first<Receipt>();
}
async function resultFor(
  db: D1Database, row: Receipt, replayed: boolean,
): Promise<ClothingDraftResult> {
  const product = await db.prepare(
    'SELECT i.sku FROM purkins_intake i JOIN products p ON p.id=i.product_id WHERE p.public_id=?',
  ).bind(row.product_public_id).first<{ sku: string }>();
  const { results } = await db.prepare(
    'SELECT v.public_id AS id,v.label,v.sku,v.stock,v.price_cents ' +
    'FROM product_variants v JOIN products p ON p.id=v.product_id ' +
    'WHERE p.public_id=? ORDER BY v.position, v.id',
  ).bind(row.product_public_id).all<CreatedClothingVariant>();
  if (row.completed !== 1 || !product ||
      (results?.length ?? 0) !== row.variant_count ||
      results?.some(v => !v.id || !v.sku)) {
    return { ok: false, request_id: row.request_id, error: 'Saved draft verification failed; do not create a second request. Investigate this receipt.', conflict: true };
  }
  return { ok: true, request_id: row.request_id, id: row.product_public_id,
    sku: product.sku, total_units: row.total_units, variants: results ?? [], replayed };
}
async function priorResult(
  db: D1Database, requestId: string, actor: string, hash: string,
): Promise<ClothingDraftResult | null> {
  const row = await receipt(db, requestId);
  if (!row) return null;
  if (row.actor !== actor || row.payload_sha256 !== hash) {
    return { ok: false, request_id: requestId, error: 'Request ID was already used for different stock or another owner identity.', conflict: true };
  }
  return resultFor(db, row, true);
}

/** Atomic per-PRODUCT transaction, including 1–20 size variants and private tags. */
export async function createGuardedClothingDraft(
  db: D1Database, actorRaw: string, input: ClothingDraftInput,
): Promise<ClothingDraftResult> {
  const actor = owner(actorRaw);
  const item = normalizeItem(input);
  const digest = await hashPayload(item);
  const previous = await priorResult(db, item.request_id, actor, digest);
  if (previous) return previous;
  const existing = await db.prepare('SELECT public_id FROM products WHERE slug=?')
    .bind(item.slug).first<{ public_id: string }>();
  if (existing) {
    return { ok: false, request_id: item.request_id, conflict: true,
      error: 'Product name already exists. Search stock and use a distinguishable product name.' };
  }
  if (item.location_id) {
    const location = await db.prepare('SELECT id FROM purkins_locations WHERE id=?')
      .bind(item.location_id).first();
    if (!location) {
      return { ok: false, request_id: item.request_id, conflict: true, error: 'Storage location not found.' };
    }
  }
  const productId = generatePublicId('product');
  const nonce = crypto.randomUUID();
  const stmts = [
    db.prepare(
      'INSERT INTO purkins_mcp_clothing_receipts ' +
      '(request_id,actor,payload_sha256,nonce,product_public_id,total_units,variant_count,barcode_count) ' +
      'SELECT ?,?,?,?,?,?,?,? WHERE (? IS NULL OR EXISTS (' +
      'SELECT 1 FROM purkins_locations WHERE id=?)) ' +
      'ON CONFLICT(request_id) DO NOTHING RETURNING request_id',
    ).bind(item.request_id, actor, digest, nonce, productId, item.total_units,
      item.variants.length, item.variants.filter(v => v.supplier_barcode !== null).length,
      item.location_id, item.location_id),
    db.prepare(
      'INSERT INTO products (name,slug,description,price_cents,currency,image_key,stock,' +
      'active,variant_label,weight_grams,requires_shipping,public_id,last_mcp_stock_request) ' +
      "SELECT ?,?,?,?,'zmw',NULL,?,0,'Size / Colour',NULL,1,?,? " +
      'FROM purkins_mcp_clothing_receipts r WHERE r.request_id=? AND r.nonce=? RETURNING id',
    ).bind(item.name,item.slug,item.description,item.price_cents,item.total_units,productId,
      nonce,item.request_id,nonce),
  ];
  const f = item.intake;
  const fields = [
    'product_id','sku','size_label','colour','age_range','storage_location',
    'location_id','purchase_currency','purchase_cost_minor','zar_to_zmw',
    'overhead_zwm_cents','markup_percent','brand','supplier_barcode',
    'retail_tag_minor','retail_tag_currency','pack_count','condition_status',
    'internal_notes','pricing_mode','status',
  ];
  const expressions = ["p.id","printf('PUR-%06d',p.id)",'?','?','?','NULL',
    '?','?','?','?','?','?','?','?','?','?','?','?','?','?',"'draft'"];
  const values = [
    f.size_label,f.colour,f.age_range,item.location_id,f.purchase_currency,
    f.purchase_cost_minor,f.zar_to_zmw,f.overhead_zwm_cents,f.markup_percent,
    f.brand ?? null,f.supplier_barcode ?? null,f.retail_tag_minor ?? null,
    f.retail_tag_currency ?? 'ZAR',f.pack_count ?? null,f.condition_status ?? 'review',
    f.internal_notes ?? null,f.pricing_mode ?? 'manual',
  ];
  stmts.push(db.prepare(
    'INSERT INTO purkins_intake (' + fields.join(',') + ') ' +
    'SELECT ' + expressions.join(',') + ' FROM products p ' +
    'WHERE p.public_id=? AND p.last_mcp_stock_request=?',
  ).bind(...values,productId,nonce));

  for (const [position,v] of item.variants.entries()) {
    const variantId = generatePublicId('variant');
    stmts.push(db.prepare(
      'INSERT INTO product_variants (product_id,label,price_cents,stock,sku,position,public_id,active) ' +
      "SELECT p.id,?,?,?,printf('PUR-%06d-V%02d',p.id,?),?,?,1 FROM products p " +
      'WHERE p.public_id=? AND p.last_mcp_stock_request=?',
    ).bind(v.label,v.price_cents,v.stock,position+1,position,variantId,productId,nonce));
    if (v.supplier_barcode !== null) {
      stmts.push(db.prepare(
        'INSERT INTO purkins_variant_identifiers (variant_id,supplier_barcode) ' +
        'SELECT v.id,? FROM product_variants v JOIN products p ON p.id=v.product_id ' +
        'WHERE v.public_id=? AND p.public_id=? AND p.last_mcp_stock_request=?',
      ).bind(v.supplier_barcode,variantId,productId,nonce));
    }
    stmts.push(db.prepare(
      'INSERT INTO purkins_variant_intake_details ' +
      '(variant_id,size_label,colour,retail_tag_minor,retail_tag_currency,pack_count) ' +
      'SELECT v.id,?,?,?,?,? FROM product_variants v ' +
      'JOIN products p ON p.id=v.product_id ' +
      'WHERE v.public_id=? AND p.public_id=? AND p.last_mcp_stock_request=?',
    ).bind(v.size_label,v.colour,v.retail_tag_minor,v.retail_tag_currency,
      v.pack_count,variantId,productId,nonce));
  }
  // The CHECK(completed IN (0,1)) constraint aborts and rolls back the ENTIRE
  // batch if either the intake or the full expected variant/detail set is absent.
  stmts.push(db.prepare(
    'UPDATE purkins_mcp_clothing_receipts SET completed = CASE WHEN ' +
    'EXISTS(SELECT 1 FROM purkins_intake i JOIN products p ON p.id=i.product_id ' +
    'WHERE p.public_id=? AND p.last_mcp_stock_request=?) AND ' +
    '(SELECT count(*) FROM product_variants v JOIN products p ON p.id=v.product_id ' +
    'WHERE p.public_id=? AND p.last_mcp_stock_request=?)=variant_count AND ' +
    '(SELECT count(*) FROM purkins_variant_intake_details d ' +
    'JOIN product_variants v ON v.id=d.variant_id JOIN products p ON p.id=v.product_id ' +
    'WHERE p.public_id=? AND p.last_mcp_stock_request=?)=variant_count AND ' +
    '(SELECT count(*) FROM purkins_variant_identifiers b ' +
    'JOIN product_variants v ON v.id=b.variant_id JOIN products p ON p.id=v.product_id ' +
    'WHERE p.public_id=? AND p.last_mcp_stock_request=?)=barcode_count ' +
    'THEN 1 ELSE -1 END WHERE request_id=? AND nonce=? RETURNING completed',
  ).bind(productId,nonce,productId,nonce,productId,nonce,
    productId,nonce,item.request_id,nonce));

  try {
    const results = await db.batch(stmts);
    if (results[1]?.results?.length && results.at(-1)?.results?.length) {
      const saved = await receipt(db,item.request_id);
      if (!saved) throw Error('Completed receipt not found after commit.');
      return resultFor(db,saved,false);
    }
    const other = await priorResult(db,item.request_id,actor,digest);
    return other ?? { ok: false, request_id: item.request_id, conflict: true,
      error: 'Draft was not created; location or request changed. Refresh before retrying.' };
  } catch (error) {
    if (/UNIQUE|constraint/i.test(String(error))) {
      const other = await priorResult(db,item.request_id,actor,digest);
      return other ?? { ok: false, request_id: item.request_id, conflict: true,
        error: 'Duplicate name, identifier or concurrent change. Review the existing catalogue.' };
    }
    throw error; // caller must retry same request_id when a write result is uncertain
  }
}

/**
 * Resumable bulk intake. Every item is its own atomic transaction and has an
 * independent client UUID; a batch can be partially successful and safely
 * resumed by reusing the original IDs. No cross-product all-or-nothing claim.
 */
export async function createGuardedClothingBatch(
  db: D1Database, actorRaw: string, inputs: ClothingDraftInput[],
): Promise<{ results: ClothingDraftResult[]; stopped_early: boolean }> {
  owner(actorRaw);
  if (inputs.length < 1 || inputs.length > MAX_ITEMS) throw Error('Provide 1–8 products per bulk request.');
  const ids = new Set<string>(), slugs = new Set<string>();
  for (const input of inputs) {
    const normalized = normalizeItem(input);
    if (ids.has(normalized.request_id) || slugs.has(normalized.slug)) {
      throw Error('Duplicate request_id or product name within this batch.');
    }
    ids.add(normalized.request_id);
    slugs.add(normalized.slug);
  }
  const results: ClothingDraftResult[] = [];
  for (const input of inputs) {
    try {
      results.push(await createGuardedClothingDraft(db,actorRaw,input));
    } catch {
      results.push({ ok: false, request_id: input.request_id, conflict: false,
        error: 'Database result uncertain. Retry this SAME request_id; do not create a new one.' });
      return {results,stopped_early:true};
    }
  }
  return {results,stopped_early:false};
}
