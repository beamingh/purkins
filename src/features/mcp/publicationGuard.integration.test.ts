import { beforeAll,afterAll,describe,it,expect,vi } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFileSync } from 'node:fs';
import type { D1Database } from '@cloudflare/workers-types';
import { splitPurkinsMigrationSql } from '../purkins/migration-test-sql';
import { applyGuardedPublication } from './publicationGuard';

const actor='owner:client:8da8ea6f-6d5f-4391-8cce-21312f76ca01';
const uuid=()=>crypto.randomUUID();
const product='prod_k7m2qx8vn6';
describe('MCP publish/hide guard against real isolated D1',()=>{
  let mf:Miniflare,db:D1Database;
  const state=async()=>db.prepare(
    'SELECT p.active,p.price_cents,p.mcp_catalog_revision AS revision,'+
    'i.status,i.condition_status FROM products p JOIN purkins_intake i ON i.product_id=p.id '+
    'WHERE p.public_id=?').bind(product).first<{
      active:number;price_cents:number;revision:number;status:string;condition_status:string}>();

  beforeAll(async()=>{
    mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',
      compatibilityDate:'2026-07-20',d1Databases:['DB']});
    db=await mf.getD1Database('DB');
    await db.exec('CREATE TABLE products ('+
      'id INTEGER PRIMARY KEY,public_id TEXT UNIQUE,name TEXT,slug TEXT,description TEXT,'+
      'price_cents INTEGER,currency TEXT,image_key TEXT,stock INTEGER,active INTEGER,'+
      'variant_label TEXT,weight_grams INTEGER,requires_shipping INTEGER)');
    await db.exec('CREATE TABLE product_variants ('+
      'id INTEGER PRIMARY KEY,public_id TEXT UNIQUE,product_id INTEGER,label TEXT,'+
      'price_cents INTEGER,stock INTEGER,sku TEXT,position INTEGER,active INTEGER DEFAULT 1,'+
      'image_id INTEGER,weight_grams INTEGER)');
    await db.exec('CREATE TABLE product_images ('+
      'id INTEGER PRIMARY KEY,public_id TEXT UNIQUE,product_id INTEGER,'+
      'image_key TEXT,position INTEGER,alt TEXT)');
    for(const file of [
      '0040_purkins_intake.sql','0041_purkins_cataloguing.sql',
      '0042_purkins_manual_pricing.sql','0043_purkins_location_tree.sql',
      '0045_purkins_mcp_write_guard.sql','0046_purkins_mcp_stock_guard.sql',
      '0048_purkins_mcp_gallery_guard.sql','0052_purkins_mcp_publication.sql',
    ]){
      const sql=readFileSync(new URL('../../../migrations/'+file,import.meta.url),'utf8');
      for(const statement of splitPurkinsMigrationSql(sql))await db.prepare(statement).run();
    }
    await db.batch([
      db.prepare('INSERT INTO products(id,public_id,name,slug,price_cents,currency,image_key,stock,active,requires_shipping) '+
        "VALUES(1,?,'Trial Babygrow','trial-babygrow',15000,'zmw','media/trial.jpg',4,0,1)").bind(product),
      db.prepare('INSERT INTO purkins_intake(product_id,sku,status,condition_status,pricing_mode,purchase_currency,overhead_zwm_cents) '+
        "VALUES(1,'PUR-000001','draft','complete','manual','ZMW',0)"),
      db.prepare('INSERT INTO product_variants(id,product_id,public_id,label,price_cents,stock,position,active) '+
        "VALUES(1,1,'var_aaaaaaaaaa','Newborn',15000,4,0,1)"),
      db.prepare('INSERT INTO product_images(id,product_id,public_id,image_key,position) '+
        "VALUES(1,1,'pimg_aaaaaaaaaa','media/trial.jpg',0)"),
    ]);
  },30000);
  afterAll(async()=>{await mf?.dispose()});

  it('requires explicit confirmation and refuses a missing cross-Worker purge capability',async()=>{
    const rev=(await state())!.revision;
    expect(await applyGuardedPublication(db,actor,'publish',{
      request_id:uuid(),product_id:product,expected_catalog_revision:rev,
    },vi.fn())).toMatchObject({ok:false,conflict:true});
    expect(await applyGuardedPublication(db,actor,'publish',{
      request_id:uuid(),product_id:product,expected_catalog_revision:rev,confirm_publish:true,
    },null)).toMatchObject({ok:false,conflict:true});
    expect((await state())?.active).toBe(0);
  });

  it('rejects stale reviews after Admin changes price and variant price',async()=>{
    const rev=(await state())!.revision;
    await db.prepare('UPDATE product_variants SET price_cents=0 WHERE product_id=1').run();
    expect((await state())!.revision).toBeGreaterThan(rev);
    expect(await applyGuardedPublication(db,actor,'publish',{
      request_id:uuid(),product_id:product,expected_catalog_revision:rev,confirm_publish:true,
    },vi.fn())).toMatchObject({ok:false,conflict:true});
    const next=(await state())!.revision;
    expect(await applyGuardedPublication(db,actor,'publish',{
      request_id:uuid(),product_id:product,expected_catalog_revision:next,confirm_publish:true,
    },vi.fn())).toMatchObject({ok:false,conflict:true});
    await db.prepare('UPDATE product_variants SET price_cents=15000 WHERE product_id=1').run();
  });

  it('publishes, hides and republishes with receipts and no stock changes',async()=>{
    const purge=vi.fn(async()=>{});
    const original=(await state())!;
    const pub={request_id:uuid(),product_id:product,
      expected_catalog_revision:original.revision,confirm_publish:true};
    const first=await applyGuardedPublication(db,actor,'publish',pub,purge);
    expect(first).toMatchObject({ok:true,published:true,cache_purged:true,replayed:false});
    expect(await state()).toMatchObject({active:1,status:'approved'});
    expect(await applyGuardedPublication(db,actor,'publish',pub,purge))
      .toMatchObject({ok:true,published:true,cache_purged:true,replayed:true});
    expect(purge).toHaveBeenCalledTimes(1);
    expect(await applyGuardedPublication(db,'owner:bearer','publish',pub,purge))
      .toMatchObject({ok:false,conflict:true});
    expect(await applyGuardedPublication(db,actor,'unpublish',{
      request_id:uuid(),product_id:product,
      expected_catalog_revision:(await state())!.revision,
    },purge)).toMatchObject({ok:false,conflict:true});
    expect(await state()).toMatchObject({active:1,status:'approved'});
    const hide={request_id:uuid(),product_id:product,
      expected_catalog_revision:(await state())!.revision,confirm_unpublish:true};
    expect(await applyGuardedPublication(db,actor,'unpublish',hide,purge))
      .toMatchObject({ok:true,published:false,cache_purged:true});
    expect(await state()).toMatchObject({active:0,status:'draft'});
    const re={request_id:uuid(),product_id:product,
      expected_catalog_revision:(await state())!.revision,confirm_publish:true};
    expect(await applyGuardedPublication(db,actor,'publish',re,purge))
      .toMatchObject({ok:true,published:true,cache_purged:true});
    expect((await db.prepare('SELECT stock FROM products WHERE public_id=?').bind(product)
      .first<{stock:number}>())?.stock).toBe(4);
    expect(purge).toHaveBeenCalledTimes(3);
  });

  it('reports committed-but-not-purged, then safely retries only cache invalidation',async()=>{
    const hidden=await applyGuardedPublication(db,actor,'unpublish',{
      request_id:uuid(),product_id:product,
      expected_catalog_revision:(await state())!.revision,confirm_unpublish:true,
    },vi.fn(async()=>{}));
    expect(hidden).toMatchObject({ok:true,published:false,cache_purged:true});
    const input={request_id:uuid(),product_id:product,
      expected_catalog_revision:(await state())!.revision,confirm_publish:true};
    let fail=true;
    const purger=vi.fn(async()=>{if(fail)throw Error('Cloudflare rate-limited purge')});
    expect(await applyGuardedPublication(db,actor,'publish',input,purger))
      .toMatchObject({ok:true,published:true,applied:true,cache_purged:false});
    expect(await state()).toMatchObject({active:1,status:'approved'});
    fail=false;
    expect(await applyGuardedPublication(db,actor,'publish',input,purger))
      .toMatchObject({ok:true,published:true,cache_purged:true,replayed:true});
    expect(purger).toHaveBeenCalledTimes(2);
    const receipt=await db.prepare(
      'SELECT cache_purged FROM purkins_mcp_publication_receipts WHERE request_id=?')
      .bind(input.request_id).first<{cache_purged:number}>();
    expect(receipt?.cache_purged).toBe(1);
  });
});
