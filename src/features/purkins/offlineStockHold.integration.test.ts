import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { splitPurkinsMigrationSql } from './migration-test-sql';
import { getOfflineQuote, saveOfflineQuote } from './offlineQuoteDb';
import { getOfflineStockHold, holdOfflineRequestStock, releaseOfflineRequestStock } from './offlineStockHoldDb';
import { getOrderRequest } from './orderRequestDb';

const A='req_0123456789',B='req_012345678a',C='req_012345678b';
const request = async (db:D1Database,id:string,qty:number,productId=1,variantId:number|null=null)=>{
  const price=95000;
  const subtotal=qty*price;
  const ins=await db.prepare(
    'INSERT INTO purkins_order_requests (public_id,request_id,payload_sha256,nonce,' +
    'buyer_name,phone,fulfillment_preference,payment_preference,subtotal_cents,currency,status) ' +
    "VALUES(?,?,?,?,?,?,?, ?,?,'zmw','contacted') RETURNING id",
  ).bind(id,crypto.randomUUID(),'a'.repeat(64),crypto.randomUUID(),
    'Test buyer','+260970000222','delivery','pay_on_delivery',subtotal).first<{id:number}>();
  await db.prepare(
    'INSERT INTO purkins_order_request_items ' +
    '(request_id,product_id,variant_id,product_name,unit_price_cents,quantity) ' +
    'VALUES(?,?,?,?,?,?)',
  ).bind(ins!.id,productId,variantId,'TY-899 sample',price,qty).run();
  const quote=await saveOfflineQuote(db,id,{
    nonce:crypto.randomUUID(),expectedRevision:0,feeCents:5000,discountCents:0,
    fulfillmentMethod:'delivery',deliveryDetails:'Buyer confirmed city',ownerNote:null,
  },'owner');
  expect(quote.ok).toBe(true);
  return ins!.id;
};
const stock=async(db:D1Database,table:'products'|'product_variants',id:number)=>{
  const r=await db.prepare('SELECT stock FROM '+table+' WHERE id=?')
    .bind(id).first<{stock:number}>();
  return r?.stock;
};

describe('Purkins manual COD stock hold (isolated D1)',()=>{
  let mf:Miniflare,db:D1Database,idA:number,idB:number,idC:number;
  beforeAll(async()=>{
    mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',
      compatibilityDate:'2026-07-20',d1Databases:['DB']});
    db=await mf.getD1Database('DB');
    await db.exec('CREATE TABLE products (id INTEGER PRIMARY KEY,active INTEGER,stock INTEGER,currency TEXT)');
    await db.exec('CREATE TABLE product_variants (id INTEGER PRIMARY KEY,product_id INTEGER,active INTEGER,stock INTEGER)');
    for(const name of ['0055_purkins_order_requests.sql','0056_purkins_offline_quotes.sql',
      '0057_purkins_offline_stock_allocations.sql']){
      const sql=readFileSync(new URL('../../../migrations/'+name,import.meta.url),'utf8');
      for(const statement of splitPurkinsMigrationSql(sql)) await db.prepare(statement).run();
    }
    await db.exec("INSERT INTO products VALUES(1,1,4,'zmw')");
    await db.exec("INSERT INTO products VALUES(2,1,0,'zmw')");
    await db.exec('INSERT INTO product_variants VALUES(10,2,1,2)');
    idA=await request(db,A,3);
    idB=await request(db,B,2);
    idC=await request(db,C,2,2,10);
  },30000);
  afterAll(async()=>{await mf?.dispose()});

  it('allocates once from shared sellable stock; competing buyer cannot take last units',async()=>{
    const nonce=crypto.randomUUID();
    expect(await holdOfflineRequestStock(db,A,1,nonce,'owner')).toMatchObject({
      ok:true,alreadyApplied:false,
    });
    expect(await stock(db,'products',1)).toBe(1);
    expect(await holdOfflineRequestStock(db,A,1,nonce,'owner')).toMatchObject({
      ok:true,alreadyApplied:true,
    });
    expect(await stock(db,'products',1)).toBe(1);
    expect(await holdOfflineRequestStock(db,B,1,crypto.randomUUID(),'owner')).toMatchObject({
      ok:false,
    });
    expect(await stock(db,'products',1)).toBe(1);
    expect(await getOfflineStockHold(db,idB)).toBeNull();
    const hold=await getOfflineStockHold(db,idA);
    expect(hold).toMatchObject({status:'held',quote_revision:1});
  });

  it('locks agreed prices and prevents cancellation while stock is held',async()=>{
    await expect(saveOfflineQuote(db,A,{
      nonce:crypto.randomUUID(),expectedRevision:1,feeCents:9000,discountCents:0,
      fulfillmentMethod:'delivery',deliveryDetails:null,ownerNote:null,
    },'owner')).rejects.toThrow(/Release allocated stock/);
    await expect(db.prepare(
      "UPDATE purkins_order_requests SET status='cancelled' WHERE public_id=?",
    ).bind(A).run()).rejects.toThrow(/Release allocated stock/);
    expect((await getOrderRequest(db,A))?.status).toBe('contacted');
    expect((await getOfflineQuote(db,idA))?.revision).toBe(1);
  });

  it('reserves size-specific variant units independently from product stock',async()=>{
    expect((await holdOfflineRequestStock(db,C,1,crypto.randomUUID(),'owner')).ok).toBe(true);
    expect(await stock(db,'product_variants',10)).toBe(0);
    expect(await stock(db,'products',2)).toBe(0);
    expect((await releaseOfflineRequestStock(db,C,'Customer no longer wants item','owner')).ok).toBe(true);
    expect(await stock(db,'product_variants',10)).toBe(2);
  });

  it('releases only once, then allows cancellation and quote revisions',async()=>{
    const previous=await stock(db,'products',1);
    expect(previous).toBe(1);
    expect(await releaseOfflineRequestStock(db,A,'Buyer cancelled the request','owner')).toMatchObject({
      ok:true,alreadyApplied:false,
    });
    expect(await stock(db,'products',1)).toBe(4);
    expect((await releaseOfflineRequestStock(db,A,'Duplicate release','owner')).ok).toBe(false);
    expect(await stock(db,'products',1)).toBe(4);
    await db.prepare("UPDATE purkins_order_requests SET status='cancelled' WHERE public_id=?")
      .bind(A).run();
    expect((await getOrderRequest(db,A))?.status).toBe('cancelled');
    expect((await holdOfflineRequestStock(db,A,1,crypto.randomUUID(),'owner')).ok).toBe(false);
    // A different request can now allocate available stock.
    expect((await holdOfflineRequestStock(db,B,1,crypto.randomUUID(),'owner')).ok).toBe(true);
    expect(await stock(db,'products',1)).toBe(2);
  });
});
