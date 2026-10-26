import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { splitPurkinsMigrationSql } from './migration-test-sql';
import { saveOfflineQuote } from './offlineQuoteDb';
import { holdOfflineRequestStock, releaseOfflineRequestStock } from './offlineStockHoldDb';
import { settleHeldOfflineOrder, getOfflineSettlement } from './offlineSettlementDb';
import { parseOfflineSettlement, type OfflineSettlementInput } from './offlineSettlement';

const A='req_0123456789', B='req_012345678a';
const payment=(ref:string|null,nonce=crypto.randomUUID()):OfflineSettlementInput=>({
  nonce,quoteRevision:1,tender:ref?'mtn_momo':'cash',channel:'whatsapp',
  paymentReference:ref,confirmationNote:'Confirmed funds in receiving account or cash counted.',
  fulfillment:'unfulfilled',
});
async function addRequest(db:D1Database,ref:string,qty:number) {
  const row=await db.prepare(
    'INSERT INTO purkins_order_requests (public_id,request_id,payload_sha256,nonce,'+
    'buyer_name,phone,fulfillment_preference,payment_preference,subtotal_cents,currency,status) '+
    "VALUES(?,?,?,?,?,?,?, ?,?,'zmw','contacted') RETURNING id",
  ).bind(ref,crypto.randomUUID(),'a'.repeat(64),crypto.randomUUID(),
    'Example buyer','+260970000222','delivery','pay_on_delivery',qty*95000).first<{id:number}>();
  await db.prepare(
    'INSERT INTO purkins_order_request_items '+
    '(request_id,product_id,variant_id,product_name,unit_price_cents,quantity) '+
    "VALUES(?,1,NULL,'TY-899 unit',95000,?)",
  ).bind(row!.id,qty).run();
  expect(await saveOfflineQuote(db,ref,{
    nonce:crypto.randomUUID(),expectedRevision:0,feeCents:5000,
    discountCents:2000,fulfillmentMethod:'delivery',
    deliveryDetails:'Confirmed drop-off',ownerNote:null,
  },'owner')).toMatchObject({ok:true,revision:1});
  expect((await holdOfflineRequestStock(db,ref,1,crypto.randomUUID(),'owner')).ok).toBe(true);
  return row!.id;
}

describe('Purkins verified full offline payments — isolated D1',()=>{
  let mf:Miniflare,db:D1Database,idA:number,idB:number;
  beforeAll(async()=>{
    mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',
      compatibilityDate:'2026-07-20',d1Databases:['DB']});
    db=await mf.getD1Database('DB');
    await db.exec("CREATE TABLE products(id INTEGER PRIMARY KEY,active INTEGER,stock INTEGER,currency TEXT)");
    await db.exec('CREATE TABLE product_variants(id INTEGER PRIMARY KEY,product_id INTEGER,active INTEGER,stock INTEGER)');
    await db.exec(
      'CREATE TABLE orders (id INTEGER PRIMARY KEY,provider_session_id TEXT UNIQUE,'+
      'public_id TEXT,email TEXT,amount_total_cents INTEGER,shipping_cents INTEGER,'+
      'discount_cents INTEGER,currency TEXT,status TEXT,payment_method TEXT,'+
      'settlement_token TEXT,fulfillment_status TEXT,fulfilled_at TEXT,delivery_method TEXT)',
    );
    await db.exec(
      'CREATE TABLE order_items (id INTEGER PRIMARY KEY,order_id INTEGER REFERENCES orders(id),'+
      'product_id INTEGER,variant_id INTEGER,name TEXT,price_cents INTEGER,quantity INTEGER,public_id TEXT)',
    );
    await db.exec('CREATE TABLE order_item_ids(public_id TEXT PRIMARY KEY,order_public_id TEXT)');
    await db.exec(
      'CREATE TABLE purkins_manual_sales(order_id INTEGER PRIMARY KEY REFERENCES orders(id),'+
      "channel TEXT,tender TEXT,customer_name TEXT,note TEXT,recorded_by TEXT)",
    );
    for(const name of ['0055_purkins_order_requests.sql','0056_purkins_offline_quotes.sql',
      '0057_purkins_offline_stock_allocations.sql','0058_purkins_offline_settlements.sql']){
      const sql=readFileSync(new URL('../../../migrations/'+name,import.meta.url),'utf8');
      for(const statement of splitPurkinsMigrationSql(sql)) await db.prepare(statement).run();
    }
    await db.exec("INSERT INTO products VALUES(1,1,4,'zmw')");
    idA=await addRequest(db,A,1);
    idB=await addRequest(db,B,1);
  },30000);
  afterAll(async()=>{await mf?.dispose()});

  it('converts ONE existing stock hold into a paid order with fee/discount and no extra stock decrement',async()=>{
    const before=(await db.prepare('SELECT stock FROM products WHERE id=1').first<{stock:number}>())?.stock;
    expect(before).toBe(2);
    const form=payment('MTN-RECEIVER-12345');
    const outcome=await settleHeldOfflineOrder(db,A,form,'owner@example.test');
    expect(outcome).toMatchObject({ok:true,alreadyRecorded:false});
    if(!outcome.ok)return;
    const receipt=await getOfflineSettlement(db,idA);
    expect(receipt).toMatchObject({
      payment_reference:'MTN-RECEIVER-12345',amount_received_cents:98000,
      tender:'mtn_momo',order_public_id:outcome.orderPublicId,
    });
    const order=await db.prepare(
      'SELECT amount_total_cents,shipping_cents,discount_cents,status,delivery_method,fulfillment_status '+
      'FROM orders WHERE public_id=?',
    ).bind(outcome.orderPublicId).first();
    expect(order).toMatchObject({amount_total_cents:98000,shipping_cents:5000,discount_cents:2000,
      status:'paid',delivery_method:'shipping',fulfillment_status:'unfulfilled'});
    const items=await db.prepare('SELECT quantity,price_cents FROM order_items').all();
    expect(items.results).toHaveLength(1);
    expect(items.results[0]).toMatchObject({quantity:1,price_cents:95000});
    expect((await db.prepare('SELECT COUNT(*) n FROM purkins_manual_sales').first<{n:number}>())?.n).toBe(1);
    expect((await db.prepare('SELECT stock FROM products WHERE id=1').first<{stock:number}>())?.stock).toBe(before);
    expect(await settleHeldOfflineOrder(db,A,form,'owner')).toMatchObject({
      ok:true,alreadyRecorded:true,orderPublicId:outcome.orderPublicId,
    });
    expect((await settleHeldOfflineOrder(db,A,payment('DIFFERENT-ID'),'owner')).ok).toBe(false);
    expect((await db.prepare('SELECT COUNT(*) n FROM orders').first<{n:number}>())?.n).toBe(1);
  });

  it('cannot release a sold hold, cancel the request, or erase a settlement receipt',async()=>{
    await expect(releaseOfflineRequestStock(db,A,'Do not release sold stock','owner'))
      .rejects.toThrow(/Paid stock cannot be released/);
    await expect(db.prepare(
      "UPDATE purkins_order_requests SET status='cancelled' WHERE public_id=?",
    ).bind(A).run()).rejects.toThrow(/Paid request cannot be changed/);
    await expect(db.prepare('DELETE FROM purkins_offline_settlements WHERE request_id=?')
      .bind(idA).run()).rejects.toThrow(/immutable/);
    expect((await db.prepare('SELECT stock FROM products WHERE id=1').first<{stock:number}>())?.stock).toBe(2);
  });

  it('rejects duplicate receiving-account references atomically, without orphan orders',async()=>{
    await expect(settleHeldOfflineOrder(db,B,payment('MTN-RECEIVER-12345'),'owner'))
      .rejects.toThrow(/UNIQUE/);
    expect(await getOfflineSettlement(db,idB)).toBeNull();
    expect((await db.prepare('SELECT COUNT(*) n FROM orders').first<{n:number}>())?.n).toBe(1);
    const r=await settleHeldOfflineOrder(db,B,payment('MTN-RECEIVER-56789'),'owner');
    expect(r).toMatchObject({ok:true,alreadyRecorded:false});
    expect((await db.prepare('SELECT stock FROM products WHERE id=1').first<{stock:number}>())?.stock).toBe(2);
    expect((await db.prepare('SELECT COUNT(*) n FROM orders').first<{n:number}>())?.n).toBe(2);
  });
});

describe('Offline paid-conversion form guardrails',()=>{
  const parse=(extra:Record<string,string>={})=>{
    const d=new FormData();
    const entries={
      payment_nonce:crypto.randomUUID(),payment_quote_revision:'1',tender:'mtn_momo',
      channel:'whatsapp',payment_reference:'MTN-RECEIVER-12345',
      payment_confirmation_note:'I checked the receiving wallet transaction history.',
      fulfillment:'unfulfilled',recipient_verified:'yes',verified_received:'yes',...extra,
    };
    for(const [key,value] of Object.entries(entries))d.set(key,value);
    return parseOfflineSettlement(d);
  };
  it('requires full receipt attestation and recipient-side verification',()=>{
    expect(parse().ok).toBe(true);
    expect(parse({recipient_verified:'no'}).ok).toBe(false);
    expect(parse({verified_received:'no'}).ok).toBe(false);
    expect(parse({payment_reference:''}).ok).toBe(false);
    expect(parse({payment_quote_revision:'0'}).ok).toBe(false);
    expect(parse({payment_confirmation_note:'ok'}).ok).toBe(false);
  });
  it('does not count COD promises as paid cash and forbids fabricated references for cash',()=>{
    expect(parse({tender:'cash',payment_reference:'',cash_counted:'no'}).ok).toBe(false);
    expect(parse({tender:'cash',payment_reference:'',cash_counted:'yes'}).ok).toBe(true);
    expect(parse({tender:'cash',cash_counted:'yes'}).ok).toBe(false);
  });
});
