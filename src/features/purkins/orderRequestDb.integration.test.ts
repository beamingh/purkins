import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { splitPurkinsMigrationSql } from './migration-test-sql';
import { createOrderRequest, getOrderRequest, listRequestLines, updateOrderRequestStatus } from './orderRequestDb';
import type { CartLine } from '../cart/cart';
import type { OrderRequestFields } from './orderRequests';

const fields = (requestId = crypto.randomUUID()): OrderRequestFields => ({
  requestId,name:'Customer Example',phone:'+260970001111',email:null,
  paymentPreference:'pay_on_delivery', fulfillmentPreference:'delivery',
  area:'Lusaka', addressNotes:null,customerNote:null,
});
const line = (qty = 2): CartLine => ({
  product:{id:1,public_id:'prod_0123456789',name:'TY-899',
    currency:'zmw',active:1,stock:4,price_cents:95000},
  variant:null,extras:[],qty,unitPriceCents:95000,
  lineTotalCents:95000*qty,availableStock:4,key:'prod_0123456789',
} as CartLine);

describe('Unpaid Purkins order request ledger (isolated Miniflare D1)',()=>{
  let mf: Miniflare;
  let db: D1Database;
  beforeAll(async()=>{
    mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',
      compatibilityDate:'2026-07-20',d1Databases:['DB']});
    db=await mf.getD1Database('DB');
    await db.exec("CREATE TABLE products (id INTEGER PRIMARY KEY,active INTEGER,stock INTEGER,currency TEXT,name TEXT)");
    await db.exec("CREATE TABLE product_variants (id INTEGER PRIMARY KEY,product_id INTEGER,active INTEGER,stock INTEGER)");
    const sql=readFileSync(new URL('../../../migrations/0055_purkins_order_requests.sql',import.meta.url),'utf8');
    for(const statement of splitPurkinsMigrationSql(sql))await db.prepare(statement).run();
    await db.prepare("INSERT INTO products(id,active,stock,currency,name) VALUES(1,1,4,'zmw','TY-899')").run();
  },30000);
  afterAll(async()=>{await mf?.dispose()});

  it('creates an unpaid enquiry with snapshot but DOES NOT touch product stock',async()=>{
    const request=fields();
    const result=await createOrderRequest(db,request,[line()],190000);
    expect(result).toMatchObject({ok:true,existing:false});
    if(!result.ok)return;
    const saved=await getOrderRequest(db,result.publicId);
    expect(saved).toMatchObject({status:'new',payment_preference:'pay_on_delivery',
      subtotal_cents:190000,phone:'+260970001111'});
    expect(await listRequestLines(db,saved!.id)).toMatchObject([
      {product_name:'TY-899',unit_price_cents:95000,quantity:2},
    ]);
    const stock=await db.prepare('SELECT stock FROM products WHERE id=1').first<{stock:number}>();
    expect(stock?.stock).toBe(4);
    const retry=await createOrderRequest(db,request,[line()],190000);
    expect(retry).toMatchObject({ok:true,existing:true,publicId:result.publicId});
    const counts=await db.prepare('SELECT COUNT(*) n FROM purkins_order_request_items').first<{n:number}>();
    expect(counts?.n).toBe(1);
    expect((await createOrderRequest(db,{...request,phone:'+260970001112'},[line()],190000)).ok).toBe(false);
  });

  it('rejects a stale stock change at the database insert boundary',async()=>{
    await db.prepare('UPDATE products SET stock=1 WHERE id=1').run();
    const r=await createOrderRequest(db,fields(),[line()],190000);
    expect(r).toMatchObject({ok:false});
    await db.prepare('UPDATE products SET stock=4 WHERE id=1').run();
  });

  it('changes follow-up status using compare-and-swap; cannot mark paid',async()=>{
    const r=await createOrderRequest(db,fields(),[line(1)],95000);
    expect(r.ok).toBe(true);
    if(!r.ok)return;
    expect(await updateOrderRequestStatus(db,r.publicId,'new','contacted',
      'Spoke to customer.','owner')).toBe(true);
    expect(await updateOrderRequestStatus(db,r.publicId,'new','awaiting_payment',
      'Stale browser','owner')).toBe(false);
    expect(await updateOrderRequestStatus(db,r.publicId,'contacted','paid' as never,
      'Cannot mark paid','owner')).toBe(false);
    expect(await updateOrderRequestStatus(db,r.publicId,'contacted','cancelled',
      'Customer cancelled.','owner')).toBe(true);
    expect(await updateOrderRequestStatus(db,r.publicId,'cancelled','contacted',
      'Reopen','owner')).toBe(false);
  });

  it('throttles repeated public requests against one phone without registering sales',async()=>{
    // Request from first test plus previous update test = 2 in 30 minutes.
    expect((await createOrderRequest(db,fields(),[line(1)],95000)).ok).toBe(true);
    expect((await createOrderRequest(db,fields(),[line(1)],95000)).ok).toBe(false);
    expect((await db.prepare('SELECT stock FROM products WHERE id=1')
      .first<{stock:number}>())?.stock).toBe(4);
  });
});
