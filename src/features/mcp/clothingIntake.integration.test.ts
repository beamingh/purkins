import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { splitPurkinsMigrationSql } from '../purkins/migration-test-sql';
import { parseIntakeFields } from '../purkins/intake';
import { getIntake } from '../purkins/db';
import { getProductByPublicId, getProductBySlug } from '../products/db';
import { stockView } from '../../../mcp/src/purkins';
import { createGuardedClothingBatch, createGuardedClothingDraft, type ClothingDraftInput } from './clothingIntake';

const actor = 'owner:access:owner@example.com';
const uuid = () => crypto.randomUUID();
const intakeForm = new FormData();
intakeForm.set('pricing_mode','manual');
intakeForm.set('brand','Little Castle');
intakeForm.set('purchase_currency','ZAR');
intakeForm.set('purchase_cost','69.99');
intakeForm.set('retail_tag_price','69.99');
intakeForm.set('retail_tag_currency','ZAR');
intakeForm.set('condition_status','review');
const parsed = parseIntakeFields(intakeForm);
if ('error' in parsed) throw Error(parsed.error);

function clothing(name: string, request_id = uuid()): ClothingDraftInput {
  return { request_id, name, description: null, price_cents: 12000,
    location_id:null, intake:parsed.data, variants:[
      {label:'Grey / Newborn',size_label:'Newborn',colour:'Grey',stock:3,
       retail_tag_minor:6999,retail_tag_currency:'ZAR',pack_count:1,
       supplier_barcode:'001234567890'},
      {label:'Grey / 0–3 months',size_label:'0–3 months',colour:'Grey',stock:1,
       retail_tag_minor:6999,retail_tag_currency:'ZAR'},
      {label:'Grey / 3–6 months',size_label:'3–6 months',colour:'Grey',stock:7,
       price_cents:15000,retail_tag_minor:7999,retail_tag_currency:'ZAR'},
    ] };
}

describe('Guarded Purkins multi-variant clothing intake (isolated real D1)', () => {
  let mf: Miniflare;
  let db: D1Database;
  async function migrate(name: string) {
    const raw=readFileSync(new URL('../../../migrations/'+name,import.meta.url),'utf8');
    for(const sql of splitPurkinsMigrationSql(raw)) await db.prepare(sql).run();
  }
  beforeAll(async () => {
    mf=new Miniflare({
      modules:true,script:'export default { fetch() { return new Response("ok") } }',
      compatibilityDate:'2026-07-20',d1Databases:['DB'],
    });
    db=await mf.getD1Database('DB');
    await db.exec('CREATE TABLE products (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT UNIQUE,' +
      'name TEXT NOT NULL,slug TEXT NOT NULL UNIQUE,description TEXT,' +
      'price_cents INTEGER NOT NULL,currency TEXT NOT NULL,image_key TEXT,' +
      'stock INTEGER NOT NULL,active INTEGER NOT NULL,variant_label TEXT,' +
      'weight_grams INTEGER,requires_shipping INTEGER NOT NULL)');
    await db.exec('CREATE TABLE product_variants (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT,public_id TEXT UNIQUE,' +
      'product_id INTEGER NOT NULL,label TEXT NOT NULL,price_cents INTEGER NOT NULL,' +
      'stock INTEGER NOT NULL,sku TEXT,position INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1)');
    for(const name of ['0040_purkins_intake.sql','0041_purkins_cataloguing.sql',
      '0042_purkins_manual_pricing.sql','0043_purkins_location_tree.sql',
      '0045_purkins_mcp_write_guard.sql','0046_purkins_mcp_stock_guard.sql',
      '0047_purkins_mcp_clothing_intake.sql']) await migrate(name);
  },30_000);
  afterAll(async () => { await mf?.dispose(); });

  it('commits all three size variants with private tags, barcodes, costs and a single draft', async () => {
    const input=clothing('Grey Three-Size Babygrow');
    const result=await createGuardedClothingDraft(db,actor,input);
    expect(result).toMatchObject({ok:true,total_units:11,replayed:false});
    if(!result.ok) throw Error(result.error);
    expect(result.variants.map(v=>v.stock)).toEqual([3,1,7]);
    expect(result.variants.map(v=>v.price_cents)).toEqual([12000,12000,15000]);
    expect(result.variants.map(v=>v.sku)).toEqual([
      result.sku+'-V01',result.sku+'-V02',result.sku+'-V03',
    ]);
    const product=await getProductByPublicId(db,result.id);
    expect(product).toMatchObject({active:0,stock:11,variant_label:'Size / Colour',currency:'zmw'});
    const privateView = await stockView(db, product!);
    expect(privateView?.active).toBe(false);
    expect(privateView?.variants[0]).toMatchObject({
      label: 'Grey / Newborn', supplier_barcode: '001234567890',
      size_label: 'Newborn', colour: 'Grey',
      retail_tag_minor: 6999, retail_tag_currency: 'ZAR', pack_count: 1,
    });
    expect(privateView?.variants[2]).toMatchObject({
      stock: 7, price_cents: 15000, retail_tag_minor: 7999,
    });
    const fields=await getIntake(db,product!.id);
    expect(fields).toMatchObject({status:'draft',brand:'Little Castle',
      purchase_currency:'ZAR',purchase_cost_minor:6999,retail_tag_minor:6999});
    const {results:variants}=await db.prepare(
      'SELECT v.public_id,v.stock,v.sku,d.size_label,d.colour,d.retail_tag_minor,' +
      'd.retail_tag_currency,d.pack_count,c.supplier_barcode ' +
      'FROM product_variants v JOIN purkins_variant_intake_details d ON d.variant_id=v.id ' +
      'LEFT JOIN purkins_variant_identifiers c ON c.variant_id=v.id ' +
      'WHERE v.product_id=? ORDER BY v.position',
    ).bind(product!.id).all<Record<string,unknown>>();
    expect(variants).toHaveLength(3);
    expect(variants?.[0]).toMatchObject({
      size_label:'Newborn',colour:'Grey',retail_tag_minor:6999,
      retail_tag_currency:'ZAR',pack_count:1,supplier_barcode:'001234567890',
    });
    expect(variants?.[2]).toMatchObject({size_label:'3–6 months',retail_tag_minor:7999});
    expect((await db.prepare(
      'SELECT completed,variant_count,total_units FROM purkins_mcp_clothing_receipts WHERE request_id=?',
    ).bind(input.request_id).first())).toMatchObject({completed:1,variant_count:3,total_units:11});
  });

  it('replays the same UUID without creating more products or variants', async () => {
    const key=uuid(), input=clothing('Reusable Grey Cotton Set',key);
    const first=await createGuardedClothingDraft(db,actor,input);
    expect(first.ok).toBe(true);
    const second=await createGuardedClothingDraft(db,actor,input);
    expect(second).toMatchObject({ok:true,replayed:true});
    if(!first.ok||!second.ok) throw Error('fixture create failed');
    expect(second.id).toBe(first.id);
    const product=await getProductByPublicId(db,first.id);
    const {results}=await db.prepare(
      'SELECT id FROM product_variants WHERE product_id=?',
    ).bind(product!.id).all();
    expect(results).toHaveLength(3);
    expect(await createGuardedClothingDraft(db,actor,{...input,price_cents:20000}))
      .toMatchObject({ok:false,conflict:true});
    expect(await createGuardedClothingDraft(db,'owner:bearer',input))
      .toMatchObject({ok:false,conflict:true});
  });

  it('rejects duplicate size labels, invalid tags, and absurd stock before any write', async () => {
    const name='Bad Variant Duplicate Clothing';
    await expect(createGuardedClothingDraft(db,actor,{
      ...clothing(name),variants:[
        {label:'Grey / newborn',stock:1},
        {label:'GREY / NEWBORN',stock:2},
      ],
    })).rejects.toThrow(/Duplicate/);
    await expect(createGuardedClothingDraft(db,actor,{
      ...clothing('Bad Price Tag Clothing'),
      variants:[{label:'Newborn',stock:2,retail_tag_minor:-5}],
    })).rejects.toThrow(/retailer tag/);
    await expect(createGuardedClothingDraft(db,actor,{
      ...clothing('Huge Stock Clothing'),variants:[
        {label:'A',stock:900000},{label:'B',stock:900000},
      ],
    })).rejects.toThrow(/Total stock/);
    expect(await getProductBySlug(db,'bad-variant-duplicate-clothing')).toBeNull();
  });

  it('rolls back the entire product, intake, receipt and earlier variants if one variant fails', async () => {
    await db.prepare(
      "CREATE TRIGGER block_clothing_variant BEFORE INSERT ON product_variants " +
      "WHEN NEW.label='BLOCKED' BEGIN SELECT RAISE(ABORT,'blocked test variant'); END;",
    ).run();
    const request_id=uuid();
    try {
      await expect(createGuardedClothingDraft(db,actor,{
        ...clothing('Atomic Rollback Clothing',request_id),
        variants:[{label:'First',stock:2},{label:'BLOCKED',stock:1}],
      })).rejects.toThrow(/blocked test variant/i);
    } finally {
      await db.prepare('DROP TRIGGER block_clothing_variant').run();
    }
    expect(await getProductBySlug(db,'atomic-rollback-clothing')).toBeNull();
    expect(await db.prepare('SELECT request_id FROM purkins_mcp_clothing_receipts WHERE request_id=?')
      .bind(request_id).first()).toBeNull();
    expect((await db.prepare('SELECT count(*) AS n FROM purkins_variant_intake_details')
      .first<{n:number}>())?.n).toBe(6);
  });

  it('validates stable location references and does not invent new storage hierarchy', async () => {
    const missing=clothing('Missing Sack Clothing');
    missing.location_id='loc_0123456789abcdef01234567';
    const refused=await createGuardedClothingDraft(db,actor,missing);
    expect(refused).toMatchObject({ok:false,conflict:true});
    expect(await getProductBySlug(db,'missing-sack-clothing')).toBeNull();
    const location='loc_aaaaaaaaaaaaaaaaaaaaaaaa';
    await db.prepare(
      "INSERT INTO purkins_locations (id,name,kind,parent_id) VALUES (?,'Grey Sack','sack',NULL)",
    ).bind(location).run();
    const item=clothing('Assigned Sack Clothing');
    item.location_id=location;
    const saved=await createGuardedClothingDraft(db,actor,item);
    if(!saved.ok) throw Error(saved.error);
    const p=await getProductByPublicId(db,saved.id);
    expect((await getIntake(db,p!.id))?.location_id).toBe(location);
  });

  it('processes a bulk submission per item and safely resumes after conflicts', async () => {
    const a=clothing('Batch Clothing First');
    const b=clothing('Batch Clothing Second');
    const c=clothing('Batch Clothing Third');
    await createGuardedClothingDraft(db,actor,b); // preexisting, another request_id
    const first=await createGuardedClothingBatch(db,actor,[a,b,c]);
    expect(first.stopped_early).toBe(false);
    expect(first.results.map(r=>r.ok)).toEqual([true,false,true]);
    const second=await createGuardedClothingBatch(db,actor,[a,b,c]);
    expect(second.results.map(r=>r.ok)).toEqual([true,false,true]);
    expect(second.results[0]).toMatchObject({ok:true,replayed:true});
    expect(second.results[2]).toMatchObject({ok:true,replayed:true});
    expect((await db.prepare(
      "SELECT count(*) AS n FROM products WHERE name LIKE 'Batch Clothing %'",
    ).first<{n:number}>())?.n).toBe(3);
  });

  it('rejects duplicate IDs and names within the same batch before writing', async () => {
    const a=clothing('Invalid Batch A');
    await expect(createGuardedClothingBatch(db,actor,[a,{...clothing('Invalid Batch B'),request_id:a.request_id}]))
      .rejects.toThrow(/Duplicate/);
    await expect(createGuardedClothingBatch(db,actor,[a,clothing('Invalid Batch A')]))
      .rejects.toThrow(/Duplicate/);
    expect(await getProductBySlug(db,'invalid-batch-a')).toBeNull();
  });
});
