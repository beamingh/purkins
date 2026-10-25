import type { D1Database } from '@cloudflare/workers-types';
import { requireVerifiedOwnerActorShape } from './ownerActor';
import { parsePublicId } from '../ids/publicId';
import { normalizeSupplierBarcode } from '../purkins/intake';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_STOCK = 1_000_000;
const MAX_PRICE = 99_999_999_999;
export interface VariantReconcileInput {
  request_id: string;
  product_id: string;
  variant_id: string;
  expected_parent_stock: number;
  expected_parent_revision: number;
  expected_variant_stock: number;
  expected_variant_revision: number;
  expected_price_cents: number;
  expected_supplier_barcode: string | null;
  new_stock: number;
  new_price_cents: number;
  new_supplier_barcode: string | null;
}
type Receipt = {
  request_id: string; actor: string; payload_sha256: string;
  product_public_id: string; variant_public_id: string;
  expected_parent_stock: number; expected_parent_revision: number;
  expected_variant_stock: number; expected_variant_revision: number;
  new_variant_stock: number; completed: number;
};
type Result =
  | { ok: true; product_id: string; variant_id: string; parent_stock: number;
      variant_stock: number; parent_revision: number; variant_revision: number; replayed: boolean }
  | { ok: false; conflict: true; error: string };

const conflict = (error: string): Result => ({ ok: false, conflict: true, error });
const validStock = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= MAX_STOCK;
const validPrice = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= MAX_PRICE;
async function digest(input: object): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function priorReceipt(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM purkins_mcp_variant_reconcile_receipts WHERE request_id=?')
    .bind(id).first<Receipt>();
}

/**
 * Draft-only correction of one existing size/colour. The parent stock total is
 * adjusted by the same delta in ONE D1.batch, and a CHECK(completed IN (0,1))
 * aborts every statement if either CAS or the barcode association did not
 * finish. No mutation of published inventory or paid orders is possible.
 */
export async function reconcileGuardedVariant(
  db: D1Database, actorValue: string, input: VariantReconcileInput,
): Promise<Result> {
  const actor = requireVerifiedOwnerActorShape(actorValue);
  if (!UUID.test(input.request_id)) throw new Error('Use a UUIDv4 request_id.');
  const id = input.request_id.toLowerCase();
  const product = parsePublicId(input.product_id, 'product');
  const variant = parsePublicId(input.variant_id, 'variant');
  if (!product || !variant) throw new Error('Valid prod_ and var_ identifiers required.');
  if (![input.expected_parent_stock,input.expected_variant_stock,input.new_stock].every(validStock) ||
      ![input.expected_parent_revision,input.expected_variant_revision].every(x=>Number.isSafeInteger(x)&&x>=0) ||
      !validPrice(input.expected_price_cents) || !validPrice(input.new_price_cents)) {
    throw new Error('Invalid stock, price or revision.');
  }
  const beforeCode = normalizeSupplierBarcode(input.expected_supplier_barcode);
  const afterCode = normalizeSupplierBarcode(input.new_supplier_barcode);
  if (input.expected_variant_stock === input.new_stock &&
      input.expected_price_cents === input.new_price_cents &&
      beforeCode === afterCode) return conflict('No change requested.');
  const delta=input.new_stock-input.expected_variant_stock;
  const newParent=input.expected_parent_stock+delta;
  if(!validStock(newParent)) return conflict('Parent inventory would become invalid.');
  const hash=await digest({product,variant,...input,
    request_id:undefined,expected_supplier_barcode:beforeCode,new_supplier_barcode:afterCode});
  const replay=async():Promise<Result|null>=>{
    const receipt=await priorReceipt(db,id);
    if(!receipt)return null;
    if(receipt.actor!==actor||receipt.payload_sha256!==hash||
       receipt.product_public_id!==product||receipt.variant_public_id!==variant) {
      return conflict('Request ID already used for a different actor or payload.');
    }
    if(receipt.completed!==1)return conflict('Previous request incomplete; investigate before retrying.');
    return {ok:true,product_id:product,variant_id:variant,
      parent_stock:receipt.expected_parent_stock+receipt.new_variant_stock-receipt.expected_variant_stock,
      variant_stock:receipt.new_variant_stock,
      parent_revision:receipt.expected_parent_revision+(receipt.expected_variant_stock===receipt.new_variant_stock?0:1),
      variant_revision:receipt.expected_variant_revision+(receipt.expected_variant_stock===receipt.new_variant_stock?0:1),
      replayed:true};
  };
  const existing=await replay();
  if(existing)return existing;
  const nonce=crypto.randomUUID();
  const statements=[
    db.prepare('INSERT INTO purkins_mcp_variant_reconcile_receipts '+
      '(request_id,actor,payload_sha256,nonce,product_public_id,variant_public_id,'+
      'expected_parent_stock,expected_parent_revision,expected_variant_stock,'+
      'expected_variant_revision,new_variant_stock) VALUES (?,?,?,?,?,?,?,?,?,?,?) '+
      'ON CONFLICT(request_id) DO NOTHING RETURNING request_id')
      .bind(id,actor,hash,nonce,product,variant,input.expected_parent_stock,
        input.expected_parent_revision,input.expected_variant_stock,input.expected_variant_revision,input.new_stock),
    db.prepare('UPDATE product_variants SET stock=?,price_cents=?,last_mcp_stock_request=? '+
      'WHERE public_id=? AND stock=? AND price_cents=? AND mcp_stock_revision=? '+
      'AND (SELECT supplier_barcode FROM purkins_variant_identifiers WHERE variant_id=product_variants.id) IS ? '+
      'AND EXISTS(SELECT 1 FROM products p JOIN purkins_intake i ON i.product_id=p.id '+
      "WHERE p.id=product_variants.product_id AND p.public_id=? AND p.active=0 AND i.status='draft' "+ 
      'AND p.stock=? AND p.mcp_stock_revision=? '+
      'AND p.stock=(SELECT COALESCE(SUM(x.stock),0) FROM product_variants x WHERE x.product_id=p.id AND x.active=1)) '+
      'AND EXISTS(SELECT 1 FROM purkins_mcp_variant_reconcile_receipts r WHERE r.request_id=? AND r.nonce=?) '+
      'RETURNING id')
      .bind(input.new_stock,input.new_price_cents,nonce,variant,
        input.expected_variant_stock,input.expected_price_cents,input.expected_variant_revision,
        beforeCode,product,input.expected_parent_stock,input.expected_parent_revision,id,nonce),
    db.prepare('UPDATE products SET stock=stock+?,last_mcp_stock_request=? '+
      'WHERE public_id=? AND active=0 AND stock=? AND mcp_stock_revision=? '+
      'AND EXISTS(SELECT 1 FROM purkins_intake i WHERE i.product_id=products.id '+ 
      "AND i.status='draft') "+
      'AND EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=products.id '+
      'AND v.public_id=? AND v.last_mcp_stock_request=?) RETURNING id')
      .bind(delta,nonce,product,input.expected_parent_stock,input.expected_parent_revision,variant,nonce),
  ];
  if(afterCode===null){
    statements.push(db.prepare(
      'DELETE FROM purkins_variant_identifiers WHERE variant_id IN '+
      '(SELECT v.id FROM product_variants v WHERE v.public_id=? AND v.last_mcp_stock_request=?)'
    ).bind(variant,nonce));
  } else {
    statements.push(db.prepare(
      'INSERT INTO purkins_variant_identifiers (variant_id,supplier_barcode) '+
      'SELECT v.id,? FROM product_variants v WHERE v.public_id=? AND v.last_mcp_stock_request=? '+
      'ON CONFLICT(variant_id) DO UPDATE SET supplier_barcode=excluded.supplier_barcode'
    ).bind(afterCode,variant,nonce));
  }
  // If a concurrent edit, stale expected state, or missing location/variant
  // prevents any phase, -1 violates the CHECK and rolls back all four writes.
  statements.push(db.prepare(
    'UPDATE purkins_mcp_variant_reconcile_receipts SET completed=CASE WHEN EXISTS('+
    'SELECT 1 FROM product_variants v JOIN products p ON p.id=v.product_id '+
    'JOIN purkins_intake i ON i.product_id=p.id '+
    'WHERE v.public_id=? AND v.last_mcp_stock_request=? AND v.stock=? AND v.price_cents=? '+
    'AND (SELECT supplier_barcode FROM purkins_variant_identifiers WHERE variant_id=v.id) IS ? '+
    "AND p.public_id=? AND p.active=0 AND i.status='draft' "+
    'AND p.stock=? AND p.last_mcp_stock_request=? '+
    'AND p.stock=(SELECT COALESCE(SUM(x.stock),0) FROM product_variants x WHERE x.product_id=p.id AND x.active=1)) '+
    'THEN 1 ELSE -1 END WHERE request_id=? AND nonce=? RETURNING completed')
    .bind(variant,nonce,input.new_stock,input.new_price_cents,afterCode,
      product,newParent,nonce,id,nonce));
  try {
    const result=await db.batch(statements);
    if(result[1]?.results?.length && result[2]?.results?.length &&
       (result[4]?.results?.[0] as {completed?:number}|undefined)?.completed===1){
      return {ok:true,product_id:product,variant_id:variant,parent_stock:newParent,
        variant_stock:input.new_stock,
        parent_revision:input.expected_parent_revision+(delta===0?0:1),
        variant_revision:input.expected_variant_revision+(delta===0?0:1),replayed:false};
    }
    return (await replay()) ?? conflict('Stale stock/price/barcode. Refresh and retry using a new request ID.');
  } catch(error) {
    const previous=await replay();
    if(previous)return previous;
    if(/constraint|CHECK|UNIQUE/i.test(String(error))) {
      return conflict('Stale draft, invalid barcode, changed stock or conflicting variant. No changes committed.');
    }
    throw error; // Infrastructure uncertainty: retry same UUID and payload.
  }
}
