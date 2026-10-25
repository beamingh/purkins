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
import { issueMcpClientToken, authenticateMcpClientToken, revokeMcpClientToken } from './clientTokens';
import { canWriteAsOperator } from './clientScope';
import { reconcileGuardedVariant } from './variantReconcile';

const actor = 'owner:client:8da8ea6f-6d5f-4391-8cce-21312f76ca01';
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
const intakeData = parsed.data; // Narrow the discriminated result outside the fixture closure.

function clothing(name: string, request_id = uuid()): ClothingDraftInput {
  return { request_id, name, description: null, price_cents: 12000,
    location_id:null, intake:intakeData, variants:[
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
      '0047_purkins_mcp_clothing_intake.sql','0049_purkins_mcp_connections.sql',
      '0050_purkins_mcp_tool_permissions.sql',
      '0051_purkins_mcp_variant_reconcile.sql']) await migrate(name);
  },30_000);
  afterAll(async () => { await mf?.dispose(); });

  it('authenticates a real owner-issued client token before writing one private draft', async () => {
    const now=Math.floor(Date.now()/1000);
    const issued=await issueMcpClientToken(db,{
      ownerEmail:'owner@example.com',name:'Guarded MCP smoke',expiryDays:30,
      requestId:uuid(),now,
      toolPermissions:['get_purkins_stock','bulk_create_guarded_clothing_drafts'],
    });
    expect(issued.ok).toBe(true);
    if(!issued.ok)throw Error(issued.message);
    const authenticated=await authenticateMcpClientToken(
      db,'Bearer '+issued.token,'owner@example.com',now+1,
    );
    expect(authenticated?.actor).toBe('owner:client:'+issued.id);
    expect(authenticated?.toolPermissions).toContain('bulk_create_guarded_clothing_drafts');
    expect(canWriteAsOperator(authenticated,'true')).toBe(true);
    if(!authenticated)throw Error('Owner token authentication failed');
    const input=clothing('Authenticated Owner Token Clothing');
    const created=await createGuardedClothingDraft(db,authenticated.actor,input);
    expect(created).toMatchObject({ok:true,total_units:11,replayed:false});
    if(!created.ok)throw Error(created.error);
    expect(await getProductByPublicId(db,created.id)).toMatchObject({active:0,stock:11});
    expect(await createGuardedClothingDraft(db,authenticated.actor,input))
      .toMatchObject({ok:true,id:created.id,replayed:true});
    const audit=await db.prepare(
      'SELECT actor FROM purkins_mcp_clothing_receipts WHERE request_id=?'
    ).bind(input.request_id).first<{actor:string}>();
    expect(audit?.actor).toBe(authenticated.actor);

    const readOnly=await issueMcpClientToken(db,{
      ownerEmail:'owner@example.com',name:'Read-only smoke',expiryDays:30,
      requestId:uuid(),now,
    });
    if(!readOnly.ok)throw Error(readOnly.message);
    const reader=await authenticateMcpClientToken(
      db,'Bearer '+readOnly.token,'owner@example.com',now+1,
    );
    expect(reader?.readOnly).toBe(true);
    expect(reader?.toolPermissions).not.toContain('bulk_create_guarded_clothing_drafts');
    expect(canWriteAsOperator(reader,'true')).toBe(false);

    const revoked=await revokeMcpClientToken(db,{
      id:issued.id,ownerEmail:'owner@example.com',now:now+2,
    });
    expect(revoked.ok).toBe(true);
    expect(await authenticateMcpClientToken(
      db,'Bearer '+issued.token,'owner@example.com',now+3,
    )).toBeNull();
  });

  it('atomically reconciles a draft size count, parent total, price and private barcode', async () => {
    const created=await createGuardedClothingDraft(db,actor,clothing('Variant Reconcile Fixture'));
    if(!created.ok)throw Error(created.error);
    const product=await getProductByPublicId(db,created.id);
    const view=await stockView(db,product!);
    const v=view!.variants[2]!;
    // The database DTO allows a missing public ID, but reconciliation never does.
    // Assert the test fixture has the persisted public ID before invoking the guard.
    const variantId = v.id;
    if (!variantId) throw Error('Variant fixture has no public ID.');
    const input={
      request_id:uuid(),product_id:created.id,variant_id:variantId,
      expected_parent_stock:11,expected_parent_revision:0,
      expected_variant_stock:v.stock,expected_variant_revision:0,
      expected_price_cents:v.price_cents,expected_supplier_barcode:null,
      new_stock:8,new_price_cents:16000,new_supplier_barcode:'001234567890',
    };
    const changed=await reconcileGuardedVariant(db,actor,input);
    expect(changed).toMatchObject({ok:true,parent_stock:12,variant_stock:8,replayed:false});
    expect(await getProductByPublicId(db,created.id)).toMatchObject({stock:12,active:0});
    const reread=await stockView(db,(await getProductByPublicId(db,created.id))!);
    expect(reread?.variants[2]).toMatchObject({
      stock:8,price_cents:16000,supplier_barcode:'001234567890',
    });
    expect(await reconcileGuardedVariant(db,actor,input))
      .toMatchObject({ok:true,replayed:true,parent_stock:12,variant_stock:8});
    expect(await reconcileGuardedVariant(db,actor,{
      ...input,request_id:uuid(),
    })).toMatchObject({ok:false,conflict:true});
    expect(await reconcileGuardedVariant(db,'owner:bearer',input))
      .toMatchObject({ok:false,conflict:true});
    const receipts=await db.prepare(
      'SELECT COUNT(*) AS n FROM purkins_mcp_variant_reconcile_receipts WHERE completed=1 AND product_public_id=?'
    ).bind(created.id).first<{n:number}>();
    expect(receipts?.n).toBe(1);
    await db.prepare('UPDATE products SET active=1 WHERE public_id=?').bind(created.id).run();
    const stale=await reconcileGuardedVariant(db,actor,{
      ...input,request_id:uuid(),expected_parent_stock:12,expected_parent_revision:1,
      expected_variant_stock:8,expected_variant_revision:1,
      expected_price_cents:16000,expected_supplier_barcode:'001234567890',
      new_stock:9,new_price_cents:17000,
    });
    expect(stale).toMatchObject({ok:false,conflict:true});
    expect((await getProductByPublicId(db,created.id))?.stock).toBe(12);
  });

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
    const input={
      ...clothing('Atomic Rollback Clothing',request_id),
      variants:[{label:'First',stock:2},{label:'BLOCKED',stock:1}],
    };
    // The database trigger raises SQLITE_CONSTRAINT. The service deliberately
    // translates constraint failures into an operator-visible conflict result.
    // Assert both that contract AND transaction rollback, not a thrown error.
    const beforeVariants=(await db.prepare('SELECT count(*) AS n FROM product_variants')
      .first<{n:number}>())?.n;
    const beforeDetails=(await db.prepare('SELECT count(*) AS n FROM purkins_variant_intake_details')
      .first<{n:number}>())?.n;
    let result;
    try {
      result=await createGuardedClothingDraft(db,actor,input);
      expect(result).toMatchObject({ok:false,conflict:true,request_id});
    } finally {
      await db.prepare('DROP TRIGGER block_clothing_variant').run();
    }
    expect(await getProductBySlug(db,'atomic-rollback-clothing')).toBeNull();
    expect(await db.prepare('SELECT request_id FROM purkins_mcp_clothing_receipts WHERE request_id=?')
      .bind(request_id).first()).toBeNull();
    expect((await db.prepare('SELECT count(*) AS n FROM product_variants')
      .first<{n:number}>())?.n).toBe(beforeVariants);
    expect((await db.prepare('SELECT count(*) AS n FROM purkins_variant_intake_details')
      .first<{n:number}>())?.n).toBe(beforeDetails);
    // The original UUID was rolled back, so retrying that exact request after
    // the temporary constraint is removed must succeed exactly once.
    const retry=await createGuardedClothingDraft(db,actor,input);
    expect(retry).toMatchObject({ok:true,request_id,total_units:3,replayed:false});
    const replay=await createGuardedClothingDraft(db,actor,input);
    expect(replay).toMatchObject({ok:true,replayed:true});
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
    // An unrelated request already created the SAME product name; using b's
    // original UUID would be a valid idempotent replay, not a conflict.
    const preexisting=await createGuardedClothingDraft(db,actor,clothing(b.name));
    expect(preexisting.ok).toBe(true);
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
