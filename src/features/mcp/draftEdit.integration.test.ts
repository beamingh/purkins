import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { editGuardedPurkinsDraft } from './draftEdit';
import { previewGuardedPurkinsBulk, applyGuardedPurkinsBulk } from './batchDraftEdit';

describe('Guarded draft edits, isolated Purkins D1',()=>{
  let mf:Miniflare,db:D1Database;
  const actor='owner:bearer';
  const product='prod_0123456789';
  const edit=(key:string,rev:number,patch:Parameters<typeof editGuardedPurkinsDraft>[2]['patch'])=>
    editGuardedPurkinsDraft(db,actor,{request_id:key,product_id:product,expected_catalog_revision:rev,patch});
  beforeAll(async()=>{
    mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',
      compatibilityDate:'2026-07-20',d1Databases:['DB']});
    db=await mf.getD1Database('DB');
    await db.exec('CREATE TABLE products (id INTEGER PRIMARY KEY, public_id TEXT NOT NULL UNIQUE,name TEXT NOT NULL,slug TEXT,description TEXT,price_cents INTEGER NOT NULL,active INTEGER NOT NULL,mcp_catalog_revision INTEGER NOT NULL DEFAULT 0,last_mcp_draft_edit_nonce TEXT)');
    await db.exec('CREATE TABLE purkins_intake (product_id INTEGER PRIMARY KEY,status TEXT, purchase_currency TEXT,purchase_cost_minor INTEGER,zar_to_zmw REAL,overhead_zwm_cents INTEGER,pricing_mode TEXT,condition_status TEXT,brand TEXT,original_supplier_name TEXT,supplier_reference TEXT,retail_tag_minor INTEGER,retail_tag_currency TEXT,internal_notes TEXT,updated_at TEXT)');
    await db.exec('CREATE TABLE categories (id INTEGER PRIMARY KEY,public_id TEXT NOT NULL UNIQUE)');
    await db.exec('CREATE TABLE product_categories (product_id INTEGER,category_id INTEGER,PRIMARY KEY(product_id,category_id))');
    await db.exec('CREATE TABLE purkins_mcp_draft_edit_receipts (request_id TEXT PRIMARY KEY, actor TEXT,product_public_id TEXT,payload_sha256 TEXT,nonce TEXT UNIQUE,expected_revision INTEGER,applied_revision INTEGER,completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)))');
    await db.exec("INSERT INTO products (id,public_id,name,slug,description,price_cents,active) VALUES (1,'prod_0123456789','Blue Bib','blue-bib','Old description',0,0)");
    await db.exec("INSERT INTO purkins_intake VALUES(1,'draft','ZMW',NULL,NULL,0,'manual','review',NULL,NULL,NULL,NULL,'ZAR',NULL,NULL)");
    await db.exec("INSERT INTO categories VALUES(1,'cat_0123456789')");
  },30000);
  afterAll(async()=>{await mf?.dispose()});

  it('atomically updates draft pricing, purchase cost and category, with durable replay',async()=>{
    const uuid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const patch={name:'Blue Bib Set',original_supplier_name:'Supplier Blue Bib 3pk',supplier_reference:'Invoice 000123',
       price_cents:25000,purchase_cost_minor:12500,
      purchase_currency:'ZMW' as const,condition_status:'complete' as const,
      category_ids:['cat_0123456789']};
    const first=await edit(uuid,0,patch);
    expect(first).toMatchObject({ok:true,product_id:product,replayed:false});
    const replay=await edit(uuid,0,patch);
    expect(replay).toMatchObject({ok:true,product_id:product,replayed:true});
    expect((await db.prepare('SELECT name,price_cents,mcp_catalog_revision FROM products WHERE id=1').first()))
      .toMatchObject({name:'Blue Bib Set',price_cents:25000,mcp_catalog_revision:1});
    expect((await db.prepare('SELECT purchase_cost_minor,condition_status,original_supplier_name,supplier_reference FROM purkins_intake WHERE product_id=1').first()))
      .toMatchObject({purchase_cost_minor:12500,condition_status:'complete',
          original_supplier_name:'Supplier Blue Bib 3pk',supplier_reference:'Invoice 000123'});
    expect((await db.prepare('SELECT COUNT(*) n FROM product_categories WHERE product_id=1').first<{n:number}>())?.n).toBe(1);
  });

  it('refuses to overwrite stale revisions and cannot replay with changed payload',async()=>{
    const key='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    expect(await edit(key,0,{price_cents:900})).toMatchObject({ok:false,conflict:true});
    expect(await edit('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0,{price_cents:1}))
      .toMatchObject({ok:false,conflict:true});
    expect((await db.prepare('SELECT price_cents FROM products WHERE id=1').first<{price_cents:number}>())?.price_cents).toBe(25000);
  });

  it('previews a private two-item bulk rename and replays the exact per-item changes',async()=>{
    const other='prod_abcdef1234';
    await db.prepare("INSERT INTO products(id,public_id,name,slug,description,price_cents,active) "+
      "VALUES(2,?,'Old Vest Name','old-vest-name',NULL,12000,0)").bind(other).run();
    await db.prepare("INSERT INTO purkins_intake(product_id,status,purchase_currency,"+
      "overhead_zwm_cents,pricing_mode,condition_status,retail_tag_currency) "+
      "VALUES(2,'draft','ZMW',0,'manual','review','ZAR')").run();
    const items=[
      {request_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',product_id:product,
        expected_catalog_revision:1,patch:{name:'Blue Bibs, 3-Pack',supplier_reference:'INV-88'}},
      {request_id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',product_id:other,
        expected_catalog_revision:0,patch:{name:'Little Castle Cotton Vests',
          original_supplier_name:'Vest 3-Pack'}},
    ];
    const review=await previewGuardedPurkinsBulk(db,items);
    expect(review).toMatchObject({ok:true,changes:[{before:{name:'Blue Bib Set'}},{before:{name:'Old Vest Name'}}]});
    if(!review.ok||!review.review_hash)throw Error('No review hash.');
    expect((await db.prepare('SELECT name FROM products WHERE id=1').first<{name:string}>())?.name).toBe('Blue Bib Set');
    const rejected=await applyGuardedPurkinsBulk(db,actor,{
      items,review_hash:'0'.repeat(64),confirm_apply:true,
    });
    expect(rejected).toMatchObject({ok:false});
    const applied=await applyGuardedPurkinsBulk(db,actor,{
      items,review_hash:review.review_hash,confirm_apply:true,
    });
    expect(applied).toMatchObject({ok:true,applied:2,failed:0});
    expect((await db.prepare('SELECT name,price_cents FROM products WHERE id=2').first()))
      .toMatchObject({name:'Little Castle Cotton Vests',price_cents:12000});
    const repeated=await applyGuardedPurkinsBulk(db,actor,{
      items,review_hash:review.review_hash,confirm_apply:true,
    });
    expect(repeated).toMatchObject({ok:true,replayed:2,applied:0});
    expect((await previewGuardedPurkinsBulk(db,items)).ok).toBe(false);
    expect((await previewGuardedPurkinsBulk(db,[items[0],items[0]])).ok).toBe(false);
  });

  it('does not change already published stock',async()=>{
    await db.prepare('UPDATE products SET active=1 WHERE id=1').run();
    const x=await edit('cccccccc-cccc-4ccc-8ccc-cccccccccccc',1,{price_cents:30000});
    expect(x).toMatchObject({ok:false,conflict:true});
    expect((await db.prepare('SELECT price_cents FROM products WHERE id=1').first<{price_cents:number}>())?.price_cents).toBe(25000);
  });
});
