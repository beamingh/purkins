import { beforeAll,afterAll,describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { splitPurkinsMigrationSql } from './migration-test-sql';
import {
  categorizeDispatch,getDispatchOverview,
  type DispatchQueueRow,
} from './dispatchOverview';

const row=(overrides:Partial<DispatchQueueRow>={}):DispatchQueueRow=>({
  request_public_id:'req_0123456789',buyer_name:'Demo customer',phone:'+260971234567',
  area:'Lusaka',request_status:'contacted',request_created_at:'2026-10-26 17:00:00',
  quote_total_cents:95000,currency:'zmw',allocation_status:'held',
  held_at:'2026-10-26 17:00:00',delivery_status:null,courier:null,
  dropoff_location:null,recipient_name:null,booking_reference:null,
  courier_fee_cents:null,courier_fee_payer:null,courier_fee_state:null,
  delivery_updated_at:null,paid_order_public_id:null,paid_order_fulfillment_status:null,
  ...overrides,
});

describe('COD dispatch dashboard classification: delivery never means funds',()=>{
  it('flags delivered unpaid parcels and failed deliveries for attention',()=>{
    expect(categorizeDispatch(row({delivery_status:'delivered'}))?.bucket).toBe('attention');
    expect(categorizeDispatch(row({delivery_status:'delivery_failed'}))?.bucket).toBe('attention');
    expect(categorizeDispatch(row({delivery_status:'returned'}))?.bucket).toBe('attention');
  });
  it('keeps in-transit and not yet dispatched stock separately',()=>{
    expect(categorizeDispatch(row())?.bucket).toBe('awaiting_dispatch');
    expect(categorizeDispatch(row({delivery_status:'planned'}))?.bucket).toBe('awaiting_dispatch');
    expect(categorizeDispatch(row({delivery_status:'dispatched'}))?.bucket).toBe('with_rider');
    expect(categorizeDispatch(row({delivery_status:null,allocation_status:'released'}))).toBeNull();
  });
  it('requires a paid order and handover before a delivery is marked complete',()=>{
    expect(categorizeDispatch(row({delivery_status:'delivered',
      paid_order_public_id:'ord_0123456789',paid_order_fulfillment_status:'unfulfilled'}))?.bucket).toBe('attention');
    expect(categorizeDispatch(row({delivery_status:'delivered',
      paid_order_public_id:'ord_0123456789',paid_order_fulfillment_status:'fulfilled'}))?.bucket).toBe('delivered');
    expect(categorizeDispatch(row({delivery_status:'returned',allocation_status:'released'}))?.bucket).toBe('returned');
  });
});

describe('Read-only live-schema dispatch query (isolated Miniflare D1)',()=>{
  let mf:Miniflare,db:D1Database;
  beforeAll(async()=>{
    mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',
      compatibilityDate:'2026-07-20',d1Databases:['DB']});
    db=await mf.getD1Database('DB');
    await db.exec('CREATE TABLE products(id INTEGER PRIMARY KEY,active INTEGER,stock INTEGER,currency TEXT)');
    await db.exec('CREATE TABLE product_variants(id INTEGER PRIMARY KEY,product_id INTEGER,active INTEGER,stock INTEGER)');
    await db.exec('CREATE TABLE orders(id INTEGER PRIMARY KEY,public_id TEXT,provider_session_id TEXT UNIQUE,amount_total_cents INTEGER,status TEXT,currency TEXT,fulfillment_status TEXT)');
    for(const name of [
      '0055_purkins_order_requests.sql','0056_purkins_offline_quotes.sql',
      '0057_purkins_offline_stock_allocations.sql','0058_purkins_offline_settlements.sql',
      '0059_purkins_cod_delivery_log.sql',
    ]) {
      const sql=readFileSync(new URL('../../../migrations/'+name,import.meta.url),'utf8');
      for(const statement of splitPurkinsMigrationSql(sql)) await db.prepare(statement).run();
    }
    const fixtures=[
      {ref:'req_0000000001',status:null,paid:false,fulfilled:false,allocation:'held'},
      {ref:'req_0000000002',status:'dispatched',paid:false,fulfilled:false,allocation:'held'},
      {ref:'req_0000000003',status:'delivered',paid:false,fulfilled:false,allocation:'held'},
      {ref:'req_0000000004',status:'delivered',paid:true,fulfilled:true,allocation:'held'},
      {ref:'req_0000000005',status:'returned',paid:false,fulfilled:false,allocation:'released'},
      {ref:'req_0000000006',status:'returned',paid:false,fulfilled:false,allocation:'held'},
    ] as const;
    for(const f of fixtures){
      const id=(await db.prepare(
        'INSERT INTO purkins_order_requests (public_id,request_id,payload_sha256,nonce,buyer_name,phone,fulfillment_preference,payment_preference,subtotal_cents,currency,status) '+
        "VALUES(?,?,?,?,?,?,?, ?,95000,'zmw','contacted') RETURNING id",
      ).bind(f.ref,crypto.randomUUID(),'a'.repeat(64),crypto.randomUUID(),
        'Test buyer','+260971234567','delivery','pay_on_delivery').first<{id:number}>())!.id;
      await db.prepare(
        'INSERT INTO purkins_order_request_quotes '+
        '(request_id,subtotal_cents,delivery_fee_cents,discount_cents,total_cents,fulfillment_method,revision,change_nonce,updated_by) '+
        "VALUES(?,95000,0,0,95000,'delivery',1,?,'operator')",
      ).bind(id,crypto.randomUUID()).run();
      await db.prepare(
        'INSERT INTO purkins_order_request_allocations '+
        '(request_id,quote_revision,lines_json,status,hold_nonce,held_by,released_at) '+
        "VALUES(?,1,'[{\"product_id\":1,\"quantity\":1}]',?,?,?,?)",
      ).bind(id,f.allocation,crypto.randomUUID(),'operator',
        f.allocation==='released'?'2026-10-26 16:00:00':null).run();
      if(f.status){
        await db.prepare(
          'INSERT INTO purkins_request_deliveries '+
          '(request_id,status,source_channel,courier,pickup_location,dropoff_location,recipient_name,recipient_phone,courier_fee_payer,courier_fee_state,change_nonce,updated_by) '+
          "VALUES(? ,? ,'facebook_marketplace','yango_bike','Purkins Lusaka','Woodlands Lusaka','Test buyer','+260971234567','customer_to_rider','unconfirmed',?,'operator')",
        ).bind(id,f.status,crypto.randomUUID()).run();
      }
      if(f.paid){
        const ord=(await db.prepare(
          "INSERT INTO orders (public_id,provider_session_id,amount_total_cents,status,currency,fulfillment_status) VALUES(? ,?,95000,'paid','zmw',?) RETURNING id",
        ).bind('ord_0000000004','offline-req:'+f.ref,f.fulfilled?'fulfilled':'unfulfilled').first<{id:number}>())!.id;
        await db.prepare(
          'INSERT INTO purkins_offline_settlements (request_id,order_id,confirmation_nonce,quote_revision,tender,amount_received_cents,fulfillment_status,confirmation_note,recorded_by) '+
          "VALUES(?,?,?,1,'cash',95000,'fulfilled','Counted money in person','operator')",
        ).bind(id,ord,crypto.randomUUID()).run();
      }
    }
  },30000);
  afterAll(async()=>{await mf?.dispose();});

  it('lists status queues, joining payment separately with no mutation',async()=>{
    const overview=await getDispatchOverview(db);
    expect(overview.truncated).toBe(false);
    expect(overview.items).toHaveLength(6);
    expect(overview.counts).toEqual({
      attention:2,awaiting_dispatch:1,with_rider:1,delivered:1,returned:1,
    });
    expect(overview.items[0]?.bucket).toBe('attention');
    expect(overview.items.find(x=>x.row.request_public_id==='req_0000000003')?.reason)
      .toMatch(/not recorded verified payment/);
    const stock=(await db.prepare('SELECT COUNT(*) AS n FROM orders').first<{n:number}>())?.n;
    expect(stock).toBe(1);
  });
});
