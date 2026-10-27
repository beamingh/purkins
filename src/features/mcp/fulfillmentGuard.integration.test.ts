import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import {Miniflare} from 'miniflare';
import type {D1Database} from '@cloudflare/workers-types';
import {fulfillGuardedPurkinsOrder} from './fulfillmentGuard';

describe('MCP paid handover atomic guard in D1',()=>{
  let mf:Miniflare,db:D1Database;
  beforeAll(async()=>{
    mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',
      compatibilityDate:'2026-07-20',d1Databases:['DB']});
    db=await mf.getD1Database('DB');
    await db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY,public_id TEXT UNIQUE,status TEXT,fulfillment_status TEXT,fulfilled_at TEXT,tracking_carrier TEXT,tracking_number TEXT,last_mcp_fulfillment_nonce TEXT)');
    await db.exec('CREATE TABLE purkins_mcp_fulfillment_receipts (request_id TEXT PRIMARY KEY,actor TEXT,payload_sha256 TEXT,order_public_id TEXT,nonce TEXT,completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN(0,1)))');
    await db.exec("INSERT INTO orders VALUES(1,'ord_0123456789','paid','unfulfilled',NULL,NULL,NULL,NULL)");
    await db.exec("INSERT INTO orders VALUES(2,'ord_abcdefghj','pending','unfulfilled',NULL,NULL,NULL,NULL)");
  },30000);
  afterAll(async()=>{await mf?.dispose()});
  const arg=(request_id:string,order_public_id='ord_0123456789')=>({
    request_id,order_public_id,tracking_carrier:'Yango Bike',
    tracking_number:'YB-2026-001',confirm_handed_over:true as const,
  });
  it('marks only a paid order as fulfilled and replays the exact UUID once',async()=>{
    const x=arg('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(await fulfillGuardedPurkinsOrder(db,'owner:bearer',x))
      .toMatchObject({ok:true,replayed:false});
    expect(await fulfillGuardedPurkinsOrder(db,'owner:bearer',x))
      .toMatchObject({ok:true,replayed:true});
    const o=await db.prepare('SELECT fulfillment_status,tracking_carrier FROM orders WHERE id=1').first();
    expect(o).toMatchObject({fulfillment_status:'fulfilled',tracking_carrier:'Yango Bike'});
    expect(await fulfillGuardedPurkinsOrder(db,'owner:bearer',{...x,tracking_number:'different'}))
      .toMatchObject({ok:false,conflict:true});
  });
  it('rolls back receipt when a pending/unpaid order cannot be fulfilled',async()=>{
    const x=arg('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ord_abcdefghj');
    expect(await fulfillGuardedPurkinsOrder(db,'owner:bearer',x))
      .toMatchObject({ok:false,conflict:true});
    const receipt=await db.prepare('SELECT request_id FROM purkins_mcp_fulfillment_receipts WHERE request_id=?')
      .bind(x.request_id).first();
    expect(receipt).toBeNull();
    expect((await db.prepare('SELECT fulfillment_status FROM orders WHERE id=2').first<{fulfillment_status:string}>())?.fulfillment_status).toBe('unfulfilled');
  });
});
