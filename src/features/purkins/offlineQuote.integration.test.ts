import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { splitPurkinsMigrationSql } from './migration-test-sql';
import { getOfflineQuote, listOfflineQuoteEvents, saveOfflineQuote } from './offlineQuoteDb';
import { parseOfflineQuote, quoteTotalCents, type OfflineQuoteInput } from './offlineQuote';

const reference = 'req_0123456789';
const input = (expectedRevision: number, feeCents = 5000): OfflineQuoteInput => ({
  nonce: crypto.randomUUID(),expectedRevision,feeCents,discountCents:0,
  fulfillmentMethod:'delivery',deliveryDetails:'Lusaka, agreed with buyer',
  ownerNote:'Prepared; buyer not yet confirmed',
});

describe('Purkins owner-prepared offline quotes (isolated D1)', () => {
  let mf: Miniflare;
  let db: D1Database;
  beforeAll(async () => {
    mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',
      compatibilityDate:'2026-07-20',d1Databases:['DB']});
    db=await mf.getD1Database('DB');
    await db.exec('CREATE TABLE products (id INTEGER PRIMARY KEY,stock INTEGER)');
    await db.exec('CREATE TABLE product_variants (id INTEGER PRIMARY KEY,product_id INTEGER)');
    for (const name of ['0055_purkins_order_requests.sql','0056_purkins_offline_quotes.sql']) {
      const file=readFileSync(new URL('../../../migrations/'+name,import.meta.url),'utf8');
      for (const statement of splitPurkinsMigrationSql(file)) await db.prepare(statement).run();
    }
    await db.prepare('INSERT INTO products(id,stock) VALUES(1,4)').run();
    await db.prepare(
      'INSERT INTO purkins_order_requests (public_id,request_id,payload_sha256,nonce,' +
      'buyer_name,phone,fulfillment_preference,payment_preference,subtotal_cents,currency) ' +
      "VALUES(?,?,?,?,?,?,?, ?, 95000,'zmw')",
    ).bind(reference,crypto.randomUUID(),'a'.repeat(64),crypto.randomUUID(),
      'Example buyer','+260971111111','delivery','pay_on_delivery').run();
  },30000);
  afterAll(async () => { await mf?.dispose() });

  it('prepares a positive exact ZMW final quote with an immutable audit record',async()=>{
    const r=await saveOfflineQuote(db,reference,input(0),'owner@example.test');
    expect(r).toMatchObject({ok:true,revision:1,totalCents:100000});
    const q=await getOfflineQuote(db,1);
    expect(q).toMatchObject({subtotal_cents:95000,delivery_fee_cents:5000,
      total_cents:100000,revision:1});
    expect(await listOfflineQuoteEvents(db,1)).toMatchObject([{revision:1,total_cents:100000}]);
    const stock=await db.prepare('SELECT stock FROM products WHERE id=1').first<{stock:number}>();
    expect(stock?.stock).toBe(4);
  });
  it('audits an update and rejects stale concurrent edits',async()=>{
    const newer=input(1,10000);
    newer.discountCents=5000;
    const r=await saveOfflineQuote(db,reference,newer,'owner@example.test');
    expect(r).toMatchObject({ok:true,revision:2,totalCents:100000});
    const stale=await saveOfflineQuote(db,reference,input(1),'other-owner');
    expect(stale.ok).toBe(false);
    expect((await listOfflineQuoteEvents(db,1)).map(e=>e.revision)).toEqual([2,1]);
  });
  it('cannot quote a cancelled request or forge a paid status',async()=>{
    await db.prepare("UPDATE purkins_order_requests SET status='cancelled' WHERE public_id=?")
      .bind(reference).run();
    expect((await saveOfflineQuote(db,reference,input(2),'owner')).ok).toBe(false);
    expect((await db.prepare('SELECT stock FROM products WHERE id=1')
      .first<{stock:number}>())?.stock).toBe(4);
  });
});

describe('Offline quote form and money safety',()=>{
  const parse = (extra: Record<string,string>={})=>{
    const d=new FormData();
    const fields={
      quote_nonce:crypto.randomUUID(),quote_revision:'0',delivery_fee:'50.00',
      discount:'0',fulfillment_method:'delivery', ...extra,
    };
    for (const [key,value] of Object.entries(fields))d.set(key,value);
    return parseOfflineQuote(d);
  };
  it('parses amounts exactly and rejects invalid revision, negative discount and paid-on-pickup fee',()=>{
    expect(parse().ok).toBe(true);
    expect(parse({quote_revision:'-1'}).ok).toBe(false);
    expect(parse({discount:'-3'}).ok).toBe(false);
    expect(parse({delivery_fee:'10',fulfillment_method:'pickup'}).ok).toBe(false);
    expect(parse({delivery_fee:'5.001'}).ok).toBe(false);
  });
  it('never permits a zero/negative final quote',()=>{
    expect(quoteTotalCents(95000,0,95000)).toBeNull();
    expect(quoteTotalCents(95000,0,95001)).toBeNull();
    expect(quoteTotalCents(95000,5000,3000)).toBe(97000);
  });
});
