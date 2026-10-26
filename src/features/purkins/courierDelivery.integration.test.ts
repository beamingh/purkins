import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { splitPurkinsMigrationSql } from './migration-test-sql';
import { saveOfflineQuote } from './offlineQuoteDb';
import { holdOfflineRequestStock, releaseOfflineRequestStock } from './offlineStockHoldDb';
import { saveCourierDelivery, getCourierDelivery, listCourierDeliveryEvents } from './courierDeliveryDb';
import {
  parseCourierDelivery,allowedDeliveryTransition,type CourierDeliveryInput,
} from './courierDelivery';

const A='req_0123456789',B='req_012345678a';
const payload=(revision:number,status:CourierDeliveryInput['status']='planned',
  payer:CourierDeliveryInput['courierFeePayer']='customer_to_rider'):CourierDeliveryInput=>({
  nonce:crypto.randomUUID(),expectedRevision:revision,status,
  sourceChannel:'facebook_marketplace',courier:'yango_bike',
  pickupLocation:'Purkins warehouse, Lusaka',
  dropoffLocation:'Woodlands Shopping Centre, Lusaka',
  recipientName:'Sample Customer',recipientPhone:'+260971234567',
  riderName:'Test Rider',riderPhone:'+260971234568',
  bookingReference:'YANGO-TEST-123',courierFeeCents:5000,
  courierFeePayer:payer,courierFeeState:'unconfirmed',operatorNote:status==='returned'
    ? 'Confirmed returned parcel in store and counted all goods.':null,
});
async function seedRequest(db:D1Database,ref:string,fee:number){
  const row=await db.prepare(
    'INSERT INTO purkins_order_requests (public_id,request_id,payload_sha256,nonce,'+
    'buyer_name,phone,fulfillment_preference,payment_preference,subtotal_cents,currency,status) '+
    "VALUES(?,?,?,?,?,?,?, ?,95000,'zmw','contacted') RETURNING id",
  ).bind(ref,crypto.randomUUID(),'a'.repeat(64),crypto.randomUUID(),
    'Customer Example','+260971234567','delivery','pay_on_delivery').first<{id:number}>();
  await db.prepare(
    'INSERT INTO purkins_order_request_items (request_id,product_id,variant_id,'+
    "product_name,unit_price_cents,quantity) VALUES(?,1,NULL,'TY-899',95000,1)",
  ).bind(row!.id).run();
  expect(await saveOfflineQuote(db,ref,{
    nonce:crypto.randomUUID(),expectedRevision:0,feeCents:fee,discountCents:0,
    fulfillmentMethod:'delivery',deliveryDetails:'Confirmed dropoff',ownerNote:null,
  },'owner')).toMatchObject({ok:true,revision:1});
  expect((await holdOfflineRequestStock(db,ref,1,crypto.randomUUID(),'owner')).ok).toBe(true);
  return row!.id;
}

describe('Purkins Yango delivery audit, separate from received money (isolated D1)',()=>{
  let mf:Miniflare,db:D1Database,a:number,b:number;
  beforeAll(async()=>{
    mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',
      compatibilityDate:'2026-07-20',d1Databases:['DB']});
    db=await mf.getD1Database('DB');
    await db.exec('CREATE TABLE products(id INTEGER PRIMARY KEY,active INTEGER,stock INTEGER,currency TEXT)');
    await db.exec('CREATE TABLE product_variants(id INTEGER PRIMARY KEY,product_id INTEGER,active INTEGER,stock INTEGER)');
    await db.exec(
      'CREATE TABLE orders(id INTEGER PRIMARY KEY,provider_session_id TEXT UNIQUE,'+
      'amount_total_cents INTEGER,status TEXT,currency TEXT)',
    );
    for(const name of [
      '0055_purkins_order_requests.sql','0056_purkins_offline_quotes.sql',
      '0057_purkins_offline_stock_allocations.sql','0058_purkins_offline_settlements.sql',
      '0059_purkins_cod_delivery_log.sql',
    ]){
      const sql=readFileSync(new URL('../../../migrations/'+name,import.meta.url),'utf8');
      for(const statement of splitPurkinsMigrationSql(sql))await db.prepare(statement).run();
    }
    await db.exec("INSERT INTO products VALUES(1,1,4,'zmw')");
    a=await seedRequest(db,A,0);
    b=await seedRequest(db,B,5000);
  },30000);
  afterAll(async()=>{await mf?.dispose()});

  it('tracks a planned Yango parcel and immutable event history without recording a sale',async()=>{
    expect(await saveCourierDelivery(db,A,payload(0),'owner')).toMatchObject({
      ok:true,revision:1,alreadyRecorded:false,
    });
    expect((await getCourierDelivery(db,a))?.status).toBe('planned');
    expect((await getCourierDelivery(db,a))?.source_channel).toBe('facebook_marketplace');
    expect((await listCourierDeliveryEvents(db,a)).map(x=>x.revision)).toEqual([1]);
    expect((await db.prepare('SELECT stock FROM products WHERE id=1').first<{stock:number}>())?.stock).toBe(2);
    expect((await db.prepare('SELECT COUNT(*) n FROM orders').first<{n:number}>())?.n).toBe(0);
  });

  it('rejects stale changes, allows dispatch then reports delivery without claiming payment',async()=>{
    const dispatched=payload(1,'dispatched');
    expect(await saveCourierDelivery(db,A,dispatched,'owner')).toMatchObject({ok:true,revision:2});
    expect(await saveCourierDelivery(db,A,dispatched,'owner')).toMatchObject({ok:true,alreadyRecorded:true});
    expect((await saveCourierDelivery(db,A,payload(1,'delivered'),'other')).ok).toBe(false);
    expect(await saveCourierDelivery(db,A,payload(2,'delivered'),'owner')).toMatchObject({ok:true,revision:3});
    expect((await listCourierDeliveryEvents(db,a)).map(x=>x.revision)).toEqual([3,2,1]);
    expect((await db.prepare('SELECT COUNT(*) n FROM orders').first<{n:number}>())?.n).toBe(0);
    await expect(releaseOfflineRequestStock(db,A,'Unsafe stock release','owner')).rejects
      .toThrow(/Confirm physical parcel return/);
  });

  it('returns stock only after the physical return event is recorded',async()=>{
    expect(await saveCourierDelivery(db,A,payload(3,'returned'),'owner')).toMatchObject({ok:true,revision:4});
    expect((await releaseOfflineRequestStock(db,A,'Physically returned by Yango','owner')).ok).toBe(true);
    expect((await db.prepare('SELECT stock FROM products WHERE id=1').first<{stock:number}>())?.stock).toBe(3);
    expect((await db.prepare('SELECT COUNT(*) n FROM orders').first<{n:number}>())?.n).toBe(0);
  });

  it('blocks double collection when customer pays rider directly and quote charges delivery',async()=>{
    const direct=await saveCourierDelivery(db,B,payload(0,'planned','customer_to_rider'),'owner');
    expect(direct).toMatchObject({ok:false});
    expect((direct.ok?null:direct.error)).toMatch(/K0|twice/);
    expect(await getCourierDelivery(db,b)).toBeNull();
    expect(await saveCourierDelivery(db,B,payload(0,'planned','purkins'),'owner')).toMatchObject({
      ok:true,revision:1,
    });
  });
});

describe('Courier intake and proof of parcel return',()=>{
  const parse=(more:Record<string,string>={})=>{
    const f=new FormData();
    const fields={
      delivery_nonce:crypto.randomUUID(),delivery_revision:'0',delivery_status:'planned',
      source_channel:'facebook_page',courier:'yango_bike',
      pickup_location:'Purkins warehouse, Lusaka',dropoff_location:'Woodlands, Lusaka',
      recipient_name:'Customer Example',recipient_phone:'+260971234567',
      courier_fee_payer:'not_agreed',courier_fee_state:'unconfirmed',courier_fee:'45.00',
      ...more,
    };
    for(const [key,value] of Object.entries(fields))f.set(key,value);
    return parseCourierDelivery(f);
  };
  it('validates pickup/dropoff, source, courier fare and contact details',()=>{
    expect(parse().ok).toBe(true);
    expect(parse({dropoff_location:'x'}).ok).toBe(false);
    expect(parse({courier_fee:'45.123'}).ok).toBe(false);
    expect(parse({recipient_phone:'not-a-phone'}).ok).toBe(false);
    expect(parse({delivery_status:'dispatched'}).ok).toBe(false);
    expect(parse({courier_fee_state:'customer_reports_paid'}).ok).toBe(false);
    expect(parse({courier_fee_payer:'customer_to_rider',courier_fee_state:'customer_reports_paid'}).ok).toBe(true);
  });
  it('prevents false returns without evidence, while supporting failed delivery',()=>{
    expect(parse({delivery_status:'returned'}).ok).toBe(false);
    expect(parse({delivery_status:'returned',delivery_note:'Parcel is back at the warehouse.'}).ok).toBe(true);
    expect(allowedDeliveryTransition(null,'dispatched')).toBe(false);
    expect(allowedDeliveryTransition('planned','dispatched')).toBe(true);
    expect(allowedDeliveryTransition('dispatched','delivery_failed')).toBe(true);
    expect(allowedDeliveryTransition('delivery_failed','returned')).toBe(true);
    expect(allowedDeliveryTransition('returned','dispatched')).toBe(false);
  });
});
