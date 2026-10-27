import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { editGuardedPurkinsDraft } from './draftEdit';

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
    await db.exec('CREATE TABLE products (id INTEGER PRIMARY KEY, public_id TEXT NOT NULL UNIQUE,name TEXT NOT NULL,description TEXT,price_cents INTEGER NOT NULL,active INTEGER NOT NULL,mcp_catalog_revision INTEGER NOT NULL DEFAULT 0,last_mcp_draft_edit_nonce TEXT)');
    await db.exec('CREATE TABLE purkins_intake (product_id INTEGER PRIMARY KEY,status TEXT, purchase_currency TEXT,purchase_cost_minor INTEGER,zar_to_zmw REAL,overhead_zwm_cents INTEGER,pricing_mode TEXT,condition_status TEXT,brand TEXT,retail_tag_minor INTEGER,retail_tag_currency TEXT,internal_notes TEXT,updated_at TEXT)');
    await db.exec('CREATE TABLE categories (id INTEGER PRIMARY KEY,public_id TEXT NOT NULL UNIQUE)');
    await db.exec('CREATE TABLE product_categories (product_id INTEGER,category_id INTEGER,PRIMARY KEY(product_id,category_id))');
    await db.exec('CREATE TABLE purkins_mcp_draft_edit_receipts (request_id TEXT PRIMARY KEY, actor TEXT,product_public_id TEXT,payload_sha256 TEXT,nonce TEXT UNIQUE,expected_revision INTEGER,applied_revision INTEGER,completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)))');
    await db.exec("INSERT INTO products (id,public_id,name,description,price_cents,active) VALUES (1,'prod_0123456789','Blue Bib','Old description',0,0)");
    await db.exec("INSERT INTO purkins_intake VALUES(1,'draft','ZMW',NULL,NULL,0,'manual','review',NULL,NULL,'ZAR',NULL,NULL)");
    await db.exec("INSERT INTO categories VALUES(1,'cat_0123456789')");
  },30000);
  afterAll(async()=>{await mf?.dispose()});

  it('atomically updates draft pricing, purchase cost and category, with durable replay',async()=>{
    const uuid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const patch={name:'Blue Bib Set',price_cents:25000,purchase_cost_minor:12500,
      purchase_currency:'ZMW' as const,condition_status:'complete' as const,
      category_ids:['cat_0123456789']};
    const first=await edit(uuid,0,patch);
    expect(first).toMatchObject({ok:true,product_id:product,replayed:false});
    const replay=await edit(uuid,0,patch);
    expect(replay).toMatchObject({ok:true,product_id:product,replayed:true});
    expect((await db.prepare('SELECT name,price_cents,mcp_catalog_revision FROM products WHERE id=1').first()))
      .toMatchObject({name:'Blue Bib Set',price_cents:25000,mcp_catalog_revision:1});
    expect((await db.prepare('SELECT purchase_cost_minor,condition_status FROM purkins_intake WHERE product_id=1').first()))
      .toMatchObject({purchase_cost_minor:12500,condition_status:'complete'});
    expect((await db.prepare('SELECT COUNT(*) n FROM product_categories WHERE product_id=1').first<{n:number}>())?.n).toBe(1);
  });

  it('refuses to overwrite stale revisions and cannot replay with changed payload',async()=>{
    const key='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    expect(await edit(key,0,{price_cents:900})).toMatchObject({ok:false,conflict:true});
    expect(await edit('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',0,{price_cents:1}))
      .toMatchObject({ok:false,conflict:true});
    expect((await db.prepare('SELECT price_cents FROM products WHERE id=1').first<{price_cents:number}>())?.price_cents).toBe(25000);
  });

  it('does not change already published stock',async()=>{
    await db.prepare('UPDATE products SET active=1 WHERE id=1').run();
    const x=await edit('cccccccc-cccc-4ccc-8ccc-cccccccccccc',1,{price_cents:30000});
    expect(x).toMatchObject({ok:false,conflict:true});
    expect((await db.prepare('SELECT price_cents FROM products WHERE id=1').first<{price_cents:number}>())?.price_cents).toBe(25000);
  });
});
