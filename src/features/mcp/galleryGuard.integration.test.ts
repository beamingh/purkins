import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { splitPurkinsMigrationSql } from '../purkins/migration-test-sql';
import { applyGuardedGalleryMutation } from './galleryGuard';
import { reviewPurkinsDraft } from '../../../mcp/src/purkins-gallery';

const actor='owner:access:owner@example.com';
const key=()=>crypto.randomUUID();
const product='prod_0123456789';
const otherProduct='prod_abcdefghjk';
const firstMedia='med_0123456789';
const secondMedia='med_abcdefghjk';
const missingMedia='med_zyxwvtsrqp';

describe('Owner guarded gallery edits (real isolated D1)',()=>{
  let mf:Miniflare;
  let db:D1Database;
  async function version():Promise<number>{
    const row=await db.prepare('SELECT mcp_gallery_revision AS revision FROM products WHERE public_id=?')
      .bind(product).first<{revision:number}>();
    return row?.revision??-1;
  }
  async function count(table:'product_images'|'purkins_mcp_gallery_receipts'):Promise<number>{
    const row=await db.prepare('SELECT COUNT(*) AS n FROM '+table).first<{n:number}>();
    return row?.n??-1;
  }
  beforeAll(async()=>{
    mf=new Miniflare({modules:true,script:'export default { fetch(){return new Response("ok")} }',
      compatibilityDate:'2026-07-20',d1Databases:['DB']});
    db=await mf.getD1Database('DB');
    await db.exec(
      'CREATE TABLE products (id INTEGER PRIMARY KEY,public_id TEXT UNIQUE,name TEXT,'+
      'price_cents INTEGER,currency TEXT,stock INTEGER,active INTEGER,'+
      'image_key TEXT,weight_grams INTEGER,requires_shipping INTEGER)'
    );
    await db.exec(
      'CREATE TABLE product_images (id INTEGER PRIMARY KEY AUTOINCREMENT,'+
      'product_id INTEGER,image_key TEXT,position INTEGER,alt TEXT,public_id TEXT UNIQUE)'
    );
    await db.exec('CREATE TABLE media (id INTEGER PRIMARY KEY,public_id TEXT UNIQUE,image_key TEXT)');
    await db.exec(
      'CREATE TABLE purkins_intake (product_id INTEGER PRIMARY KEY,status TEXT,'+
      'condition_status TEXT,pricing_mode TEXT,purchase_currency TEXT,'+
      'purchase_cost_minor INTEGER,zar_to_zmw REAL,overhead_zwm_cents INTEGER,'+
      'markup_percent INTEGER,storage_location TEXT)'
    );
    await db.exec('CREATE TABLE purkins_locations (id TEXT PRIMARY KEY,parent_id TEXT,name TEXT)');
    await db.exec(
      'CREATE TABLE product_variants (id INTEGER PRIMARY KEY,product_id INTEGER,'+
      'active INTEGER,stock INTEGER,price_cents INTEGER,weight_grams INTEGER)'
    );
    const raw=readFileSync(new URL('../../../migrations/0048_purkins_mcp_gallery_guard.sql',import.meta.url),'utf8');
    for(const stmt of splitPurkinsMigrationSql(raw))await db.prepare(stmt).run();
    await db.batch([
      db.prepare('INSERT INTO products (id,public_id,name,price_cents,currency,stock,active,weight_grams,requires_shipping) VALUES (1,?,?,25000,\'zmw\',5,0,NULL,1)').bind(product,'Cotton babygrow'),
      db.prepare('INSERT INTO products (id,public_id,name,price_cents,currency,stock,active,weight_grams,requires_shipping) VALUES (2,?,?,20000,\'zmw\',3,0,NULL,1)').bind(otherProduct,'Second product'),
      db.prepare("INSERT INTO purkins_intake (product_id,status,condition_status,pricing_mode,purchase_currency,purchase_cost_minor,overhead_zwm_cents) VALUES (1,'draft','review','manual','ZAR',NULL,0)"),
      db.prepare("INSERT INTO purkins_intake (product_id,status,condition_status,pricing_mode,purchase_currency,purchase_cost_minor,overhead_zwm_cents) VALUES (2,'draft','complete','manual','ZMW',NULL,0)"),
      db.prepare('INSERT INTO media(id,public_id,image_key) VALUES (1,?,\'media/first.jpg\')').bind(firstMedia),
      db.prepare('INSERT INTO media(id,public_id,image_key) VALUES (2,?,\'media/second.jpg\')').bind(secondMedia),
    ]);
  },30000);
  afterAll(async()=>{await mf?.dispose()});

  it('previews blockers without publishing or changing gallery state',async()=>{
    const before=await version();
    const preview=await reviewPurkinsDraft(db,product);
    expect(preview).toMatchObject({
      active:false,photo_count:0,potentially_ready_for_owner_review:false,
    });
    if('blockers' in preview)expect(preview.blockers).toEqual(expect.arrayContaining([
      'Review physical stock condition.','Attach and select a product photograph.',
    ]));
    expect(await version()).toBe(before);
    expect((await db.prepare('SELECT active FROM products WHERE public_id=?').bind(product)
      .first<{active:number}>())?.active).toBe(0);
  });

  it('attaches library media atomically, sets primary, and records one receipt',async()=>{
    const request_id=key();
    const input={action:'gallery.attach' as const,request_id,product_id:product,
      media_id:firstMedia,expected_revision:0,alt:'Grey newborn cotton babygrow'};
    const result=await applyGuardedGalleryMutation(db,actor,input);
    expect(result).toMatchObject({ok:true,gallery_revision:1,replayed:false,was_unpublished_at_commit:true});
    if(!result.ok)throw Error(result.error);
    expect(result.image_id).toMatch(/^pimg_/);
    expect(await version()).toBe(1);
    const state=await db.prepare('SELECT image_key,active FROM products WHERE public_id=?')
      .bind(product).first<{image_key:string;active:number}>();
    expect(state).toMatchObject({image_key:'media/first.jpg',active:0});
    expect((await db.prepare(
      'SELECT count(*) AS n FROM product_images WHERE product_id=1'
    ).first<{n:number}>())?.n).toBe(1);
    expect((await db.prepare(
      'SELECT completed FROM purkins_mcp_gallery_receipts WHERE request_id=?'
    ).bind(request_id).first<{completed:number}>())?.completed).toBe(1);
    const replay=await applyGuardedGalleryMutation(db,actor,input);
    expect(replay).toMatchObject({ok:true,image_id:result.image_id,replayed:true,gallery_revision:1});
    expect(await count('product_images')).toBe(1);
  });

  it('refuses request ID reuse with a different payload or owner',async()=>{
    const request_id=key();
    const input={action:'gallery.attach' as const,request_id,product_id:product,
      media_id:secondMedia,expected_revision:1};
    const result=await applyGuardedGalleryMutation(db,actor,input);
    expect(result.ok).toBe(true);
    expect(await applyGuardedGalleryMutation(db,actor,{...input,alt:'Different alt'}))
      .toMatchObject({ok:false,conflict:true});
    expect(await applyGuardedGalleryMutation(db,'owner:bearer',input))
      .toMatchObject({ok:false,conflict:true});
    expect(await count('product_images')).toBe(2);
  });

  it('selects a second image as primary and writes alt text only for an unchanged draft',async()=>{
    const rows=await db.prepare(
      'SELECT public_id FROM product_images WHERE product_id=1 ORDER BY position,id'
    ).all<{public_id:string}>();
    const a=rows.results?.[0]?.public_id;
    const b=rows.results?.[1]?.public_id;
    if(!a||!b)throw Error('fixture photos missing');
    const primary=await applyGuardedGalleryMutation(db,actor,{
      action:'gallery.primary',request_id:key(),product_id:product,image_id:b,expected_revision:2,
    });
    expect(primary).toMatchObject({ok:true,gallery_revision:3});
    expect((await db.prepare('SELECT image_key FROM products WHERE public_id=?').bind(product)
      .first<{image_key:string}>())?.image_key).toBe('media/second.jpg');
    const alt=await applyGuardedGalleryMutation(db,actor,{
      action:'gallery.alt',request_id:key(),product_id:product,
      image_id:b,expected_revision:3,alt:'Front view of grey cotton outfit',
    });
    expect(alt).toMatchObject({ok:true,gallery_revision:4});
    expect((await db.prepare('SELECT alt FROM product_images WHERE public_id=?').bind(b)
      .first<{alt:string}>())?.alt).toBe('Front view of grey cotton outfit');
    const noop=await applyGuardedGalleryMutation(db,actor,{
      action:'gallery.primary',request_id:key(),product_id:product,image_id:b,expected_revision:4,
    });
    expect(noop).toMatchObject({ok:false,conflict:true});
    expect(await version()).toBe(4);
  });

  it('rejects stale revisions after a standard Admin gallery change',async()=>{
    const before=await version();
    await db.prepare('UPDATE product_images SET alt=? WHERE product_id=1 AND image_key=?')
      .bind('Admin updated description','media/second.jpg').run();
    expect(await version()).toBe(before+1);
    const n=await count('purkins_mcp_gallery_receipts');
    const failed=await applyGuardedGalleryMutation(db,actor,{
      action:'gallery.alt',request_id:key(),product_id:product,
      image_id:(await db.prepare("SELECT public_id FROM product_images WHERE image_key='media/second.jpg'")
        .first<{public_id:string}>())!.public_id,
      expected_revision:before,alt:'Stale owner edit',
    });
    expect(failed).toMatchObject({ok:false,conflict:true});
    expect(await count('purkins_mcp_gallery_receipts')).toBe(n);
    expect(await version()).toBe(before+1);
  });

  it('rejects absent images and never leaves a receipt or partial gallery row',async()=>{
    const beforePhotos=await count('product_images');
    const beforeReceipts=await count('purkins_mcp_gallery_receipts');
    const failed=await applyGuardedGalleryMutation(db,actor,{
      action:'gallery.attach',request_id:key(),product_id:product,
      media_id:missingMedia,expected_revision:await version(),
    });
    expect(failed).toMatchObject({ok:false,conflict:true});
    expect(await count('product_images')).toBe(beforePhotos);
    expect(await count('purkins_mcp_gallery_receipts')).toBe(beforeReceipts);
  });

  it('cannot attach or change images after the product is published',async()=>{
    await db.prepare('UPDATE products SET active=1 WHERE id=1').run();
    const before=await version();
    expect(await applyGuardedGalleryMutation(db,actor,{
      action:'gallery.attach',request_id:key(),product_id:product,
      media_id:secondMedia,expected_revision:before,
    })).toMatchObject({ok:false,conflict:true});
    const pimg=(await db.prepare('SELECT public_id FROM product_images WHERE product_id=1 LIMIT 1')
      .first<{public_id:string}>())!.public_id;
    expect(await applyGuardedGalleryMutation(db,actor,{
      action:'gallery.alt',request_id:key(),product_id:product,image_id:pimg,
      expected_revision:before,alt:'Published change blocked',
    })).toMatchObject({ok:false,conflict:true});
    expect(await version()).toBe(before);
  });

  it('cannot attach to a non-Purkins product, even with a valid product ID',async()=>{
    const thirdProduct='prod_zyxwvtsrqp';
    await db.prepare('INSERT INTO products(id,public_id,name,price_cents,currency,stock,active,requires_shipping) '+
      "VALUES(3,?,'Generic',10000,'zmw',1,0,1)").bind(thirdProduct).run();
    expect(await applyGuardedGalleryMutation(db,actor,{
      action:'gallery.attach',request_id:key(),product_id:thirdProduct,
      media_id:secondMedia,expected_revision:0,
    })).toMatchObject({ok:false,conflict:true});
  });
});
