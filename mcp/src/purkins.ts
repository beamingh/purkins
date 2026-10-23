import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { D1Database } from '@cloudflare/workers-types';
import {
  createProduct, deleteProduct, getProductByPublicId, getProductBySlug,
  listAllProducts, updateProduct, type Product,
} from '../../src/features/products/db';
import { listVariants, updateVariant } from '../../src/features/products/variants';
import { slugify, uniqueSlug } from '../../src/features/products/slug';
import { parsePublicId, withPublicId } from '../../src/features/ids/publicId';
import {
  approveIntake, getIntake, getVariantSupplierBarcodes, insertIntake,
  removeIntake, saveIntakeDraft, setVariantSupplierBarcode,
} from '../../src/features/purkins/db';
import {
  generateItemSku, normalizeSupplierBarcode, parseIntakeFields,
  type IntakeFields, type IntakeRecord,
} from '../../src/features/purkins/intake';

// Never send private cost, location or supplier codes to the buyer tier.
// These registrations are invoked ONLY behind the MCP operator-token gate.
const reply = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

const money = z.number().int().min(0).max(99_999_999_999);
const detailsSchema = z.object({
  brand: z.string().max(100).nullable().optional(),
  supplier_barcode: z.string().max(80).nullable().optional(),
  size_label: z.string().max(60).nullable().optional(),
  colour: z.string().max(60).nullable().optional(),
  age_range: z.string().max(60).nullable().optional(),
  storage_location: z.string().max(100).nullable().optional(),
  retail_tag_minor: money.nullable().optional(),
  retail_tag_currency: z.enum(['ZAR', 'ZMW']).optional(),
  pack_count: z.number().int().min(1).max(999).nullable().optional(),
  condition_status: z.enum(['complete', 'incomplete', 'review']).optional(),
  internal_notes: z.string().max(2000).nullable().optional(),
  purchase_currency: z.enum(['ZMW', 'ZAR']).optional(),
  purchase_cost_minor: money.nullable().optional(),
  zar_to_zmw: z.number().positive().max(9999).nullable().optional(),
  overhead_zwm_cents: money.optional(),
  markup_percent: z.number().int().min(0).max(500).nullable().optional(),
});

type DetailsInput = z.infer<typeof detailsSchema>;

const variantSchema = z.object({
  label: z.string().trim().min(1).max(100),
  stock: z.number().int().nonnegative(),
  price_cents: money.optional(),
  sku: z.string().max(80).nullable().optional(),
  supplier_barcode: z.string().max(80).nullable().optional(),
});

function parseDetails(input: DetailsInput): IntakeFields {
  const f = new FormData();
  for (const key of ['brand', 'supplier_barcode', 'size_label', 'colour',
    'age_range', 'storage_location', 'condition_status', 'internal_notes',
    'purchase_currency', 'retail_tag_currency'] as const) {
    const value = input[key];
    if (value != null) f.set(key, value);
  }
  if (input.purchase_cost_minor != null) f.set('purchase_cost', (input.purchase_cost_minor / 100).toFixed(2));
  if (input.retail_tag_minor != null) f.set('retail_tag_price', (input.retail_tag_minor / 100).toFixed(2));
  if (input.overhead_zwm_cents != null) f.set('overhead_zwm', (input.overhead_zwm_cents / 100).toFixed(2));
  if (input.zar_to_zmw != null) f.set('zar_to_zmw', String(input.zar_to_zmw));
  if (input.pack_count != null) f.set('pack_count', String(input.pack_count));
  if (input.markup_percent != null) f.set('markup_percent', String(input.markup_percent));
  const parsed = parseIntakeFields(f);
  if ('error' in parsed) throw new Error(parsed.error);
  return parsed.data;
}

async function resolve(db: D1Database, ref: string): Promise<Product | null> {
  const id = ref.trim();
  if (/^\d+$/.test(id)) throw new Error('Numeric row IDs are not accepted. Use a prod_ ID or slug.');
  const publicId = parsePublicId(id, 'product');
  return publicId ? getProductByPublicId(db, publicId) : getProductBySlug(db, id);
}

async function stockView(db: D1Database, product: Product) {
  const intake = await getIntake(db, product.id);
  if (!intake) return null;
  const { product_id: _internalRowId, ...privateIntake } = intake;
  void _internalRowId;
  const variantCodes = await getVariantSupplierBarcodes(db, product.id);
  const variants = await listVariants(db, product.id, true);
  return {
    id: product.public_id, slug: product.slug, name: product.name,
    description: product.description, stock: variants.length ? variants.filter((v) => v.active === 1).reduce((sum, v) => sum + v.stock, 0) : product.stock,
    price_cents: product.price_cents, currency: product.currency,
    active: product.active === 1, intake: privateIntake,
    variants: variants.map((v) => ({
      id: v.public_id, label: v.label, sku: v.sku, stock: v.stock,
      price_cents: v.price_cents, active: v.active === 1,
      supplier_barcode: variantCodes.get(v.id) ?? null,
    })),
  };
}

async function addVariant(
  db: D1Database, productId: number, fields: z.infer<typeof variantSchema>, sku: string,
) {
  // Use the standard var_ public ID scheme; return the inserted internal id only
  // for the private supplier-code association, never in MCP tool responses.
  return withPublicId('variant', async (publicId) => {
    const row = await db.prepare(
      'INSERT INTO product_variants (product_id, label, price_cents, stock, sku, position, public_id) ' +
      'VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM product_variants WHERE product_id = ?), ?) RETURNING id',
    ).bind(productId, fields.label, fields.price_cents ?? 0, fields.stock, sku, productId, publicId)
      .first<{ id: number }>();
    if (!row) throw new Error('Failed to add stock variant.');
    if (fields.supplier_barcode) {
      await setVariantSupplierBarcode(db, row.id, fields.supplier_barcode);
    }
    return publicId;
  });
}

export function registerPurkinsTools(server: McpServer, db: D1Database, allowWrites = false): void {
  server.registerTool('list_purkins_stock', {
    description: 'Operator-only Purkins intake records, including drafts, private costs, supplier tags, barcodes, storage and size stocks. Never exposed to shoppers.',
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().nonnegative().default(0),
    },
  }, async ({limit, offset}) => {
    const products = await listAllProducts(db, limit, offset);
    const stock = await Promise.all(products.map((p) => stockView(db, p)));
    return reply({stock: stock.filter((s) => s !== null), limit, offset});
  });

  server.registerTool('search_purkins_stock', {
    description: 'Find private Purkins stock by product name, brand, internal SKU, supplier barcode (product or size), or bag/sack location. Preserves leading-zero codes.',
    inputSchema: {
      q: z.string().trim().min(1).max(100),
      limit: z.number().int().min(1).max(50).default(20),
    },
  }, async ({q, limit}) => {
    const {results} = await db.prepare(
      'SELECT DISTINCT p.public_id FROM products p ' +
      'JOIN purkins_intake i ON i.product_id=p.id ' +
      'LEFT JOIN product_variants v ON v.product_id=p.id ' +
      'LEFT JOIN purkins_variant_identifiers vi ON vi.variant_id=v.id ' +
      'WHERE instr(lower(p.name),lower(?))>0 OR instr(lower(COALESCE(i.brand,\'\')),lower(?))>0 ' +
      'OR instr(lower(i.sku),lower(?))>0 ' +
      'OR instr(lower(COALESCE(v.sku,\'\')),lower(?))>0 ' +
      'OR instr(lower(COALESCE(i.supplier_barcode,\'\')),lower(?))>0 ' +
      'OR instr(lower(COALESCE(vi.supplier_barcode,\'\')),lower(?))>0 ' +
      'OR instr(lower(COALESCE(i.storage_location,\'\')),lower(?))>0 ' +
      'ORDER BY p.public_id LIMIT ?',
    ).bind(q,q,q,q,q,q,q,limit).all<{public_id:string}>();
    const stock = await Promise.all((results ?? []).map(async (row) => {
      const product = await getProductByPublicId(db, row.public_id);
      return product ? stockView(db, product) : null;
    }));
    return reply({matches: stock.filter((s) => s !== null), q});
  });

  server.registerTool('get_purkins_stock', {
    description: 'Operator-only full item record with separate Purkins SKU and supplier barcode; accepts prod_ ID or slug.',
    inputSchema: {id: z.string().min(1)},
  }, async ({id}) => {
    const product = await resolve(db, id);
    return reply(product ? (await stockView(db, product) ?? {error: 'No Purkins intake record.'}) : {error: 'Product not found.'});
  });

  // Read-only is the safe default, even with a valid operator token. Owner writes
  // require a separate, explicit instance-level switch after review.
  if (!allowWrites) return;

  server.registerTool('create_purkins_stock', {
    description: 'Create PRIVATE, unpublished Purkins stock (including multiple sizes); never publish or infer selling price, costs or conversion. Each pack is one sellable stock unit.',
    inputSchema: {
      name: z.string().trim().min(1).max(200),
      description: z.string().max(5000).optional(),
      stock: z.number().int().nonnegative().default(0),
      price_cents: money.default(0),
      intake: detailsSchema,
      variants: z.array(variantSchema).max(100).default([]),
    },
  }, async ({name, description, stock, price_cents, intake, variants}) => {
    // Validate all inputs, including barcodes, before the first D1 write.
    const fields = parseDetails({...intake, condition_status: intake.condition_status ?? 'review'});
    const names = variants.map((v) => v.label.trim().toLowerCase());
    if (new Set(names).size !== names.length) throw new Error('Duplicate variant labels. Include both size and colour in each label.');
    for (const v of variants) normalizeSupplierBarcode(v.supplier_barcode);
    const expectedSlug = slugify(name);
    const prior = await getProductBySlug(db, expectedSlug);
    if (prior) return reply({error:'An item with this name already exists; search and update it instead of creating duplicate stock.', existing: prior.public_id});
    const slug = await uniqueSlug(db, expectedSlug);
    const id = await createProduct(db, {
      name, slug, description: description ?? null, price_cents, stock: variants.length
        ? variants.reduce((sum, v) => sum + v.stock, 0) : stock,
      currency: 'zmw', active: 0, image_key: null, weight_grams: null, requires_shipping: 1,
    });
    try {
      await insertIntake(db, id, fields);
      for (let i = 0; i < variants.length; i++) {
        const v = variants[i]!;
        const sku = v.sku?.trim() || generateItemSku(id) + '-V' + String(i + 1).padStart(2, '0');
        await addVariant(db, id, {...v, price_cents: v.price_cents ?? price_cents}, sku);
      }
      if (variants.length) await db.prepare("UPDATE products SET variant_label='Size / Colour' WHERE id=?").bind(id).run();
    } catch (error) {
      // Only unwind this newly created draft; never touch existing stock.
      await db.prepare('DELETE FROM purkins_variant_identifiers WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id=?)').bind(id).run();
      await db.prepare('DELETE FROM product_variants WHERE product_id=?').bind(id).run();
      await removeIntake(db, id);
      await deleteProduct(db, id);
      throw error;
    }
    const created = await getProductBySlug(db, slug);
    return reply({created: created?.public_id, sku: generateItemSku(id), slug, active: false,
      variants: (await listVariants(db, id, true)).map((v) => ({id: v.public_id, label: v.label, sku: v.sku}))});
  });

  server.registerTool('update_purkins_stock', {
    description: 'Update draft product and/or private intake metadata. Every edit revokes approval and unpublishes. Omitted fields stay unchanged. Actual purchase cost and original retailer price tag are separate.',
    inputSchema: {
      id: z.string().min(1),
      name: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(5000).nullable().optional(),
      price_cents: money.optional(),
      stock: z.number().int().nonnegative().optional(),
      intake: detailsSchema.optional(),
    },
  }, async ({id, name, description, price_cents, stock, intake: patch}) => {
    const p = await resolve(db, id);
    if (!p) return reply({error:'Product not found.'});
    const old = await getIntake(db, p.id);
    if (!old) return reply({error:'No Purkins intake record.'});
    const fields = parseDetails({
      ...(old as IntakeRecord),
      ...patch,
      condition_status: patch?.condition_status ?? old.condition_status ?? 'review',
    });
    await updateProduct(db, p.id, {
      name: name ?? p.name, slug: p.slug, description: description === undefined ? p.description : description,
      price_cents: price_cents ?? p.price_cents, stock: stock ?? p.stock,
      currency: p.currency, active: 0, image_key: p.image_key,
      weight_grams: p.weight_grams, requires_shipping: p.requires_shipping,
    });
    await saveIntakeDraft(db, p.id, fields);
    return reply({updated:p.public_id, active:false, status:'draft'});
  });

  server.registerTool('set_purkins_variant', {
    description: 'Create or edit one private size/colour stock unit. Provide variant_id (var_…) to edit; omit it to add. Supplier barcode is distinct from internal SKU. Any change revokes publication.',
    inputSchema: {
      product_id: z.string().min(1),
      variant_id: z.string().optional(),
      label: z.string().trim().min(1).max(100),
      stock: z.number().int().nonnegative(),
      price_cents: money.optional(),
      sku: z.string().max(80).nullable().optional(),
      supplier_barcode: z.string().max(80).nullable().optional(),
    },
  }, async ({product_id, variant_id, label, stock, price_cents, sku, supplier_barcode}) => {
    const p = await resolve(db, product_id);
    if (!p || !await getIntake(db, p.id)) return reply({error:'Purkins stock item not found.'});
    const barcode = normalizeSupplierBarcode(supplier_barcode);
    const all = await listVariants(db, p.id, true);
    const existing = variant_id ? all.find((v) => v.public_id === parsePublicId(variant_id, 'variant')) : null;
    if (variant_id && !existing) return reply({error:'Variant not found on this item.'});
    if (all.some((v) => v.id !== existing?.id && v.label.trim().toLowerCase() === label.toLowerCase())) {
      return reply({error:'Duplicate variant label. Include size and colour.'});
    }
    // First unpublish, so a failed stock/price edit cannot remain customer-visible.
    await db.batch([
      db.prepare('UPDATE products SET active=0, variant_label=? WHERE id=?').bind('Size / Colour', p.id),
      db.prepare("UPDATE purkins_intake SET status='draft' WHERE product_id=?").bind(p.id),
    ]);
    if (existing) {
      const current = (await getVariantSupplierBarcodes(db, p.id)).get(existing.id) ?? null;
      await updateVariant(db, existing.id, {
        label, stock, price_cents: price_cents ?? existing.price_cents,
        sku: sku === undefined ? existing.sku : (sku?.trim() || null),
        image_id: existing.image_id, weight_grams: existing.weight_grams,
      });
      if (supplier_barcode !== undefined && barcode !== current) await setVariantSupplierBarcode(db, existing.id, barcode);
    } else {
      const nextSku = sku?.trim() || generateItemSku(p.id) + '-V' + String(all.length + 1).padStart(2,'0');
      await addVariant(db, p.id, {label, stock, price_cents, sku: nextSku, supplier_barcode: barcode}, nextSku);
    }
    return reply({updated:p.public_id, active:false, status:'draft'});
  });

  server.registerTool('approve_purkins_stock', {
    description: 'Explicitly publish only after owner confirmation. Requires real landed cost, positive selling price, photo, complete condition and all active variant prices above cost.',
    inputSchema: {id: z.string().min(1), confirm_publish: z.literal(true)},
  }, async ({id}) => {
    const p = await resolve(db, id);
    if (!p || !await getIntake(db, p.id)) return reply({error:'Purkins stock item not found.'});
    const error = await approveIntake(db, p.id);
    return reply(error ? {published:false, error} : {published:true, id:p.public_id});
  });
}
