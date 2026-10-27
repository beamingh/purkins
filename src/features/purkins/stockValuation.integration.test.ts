import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { getStockValuation } from './stockValuation';

describe('Purkins stock valuation (isolated D1, no financial writes)',()=>{
  let mf:Miniflare,db:D1Database;
  beforeAll(async()=>{
    mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',
      compatibilityDate:'2026-07-20',d1Databases:['DB']});
    db=await mf.getD1Database('DB');
    await db.exec('CREATE TABLE products(id INTEGER PRIMARY KEY,public_id TEXT,name TEXT,active INTEGER,currency TEXT,stock INTEGER,price_cents INTEGER)');
    await db.exec('CREATE TABLE product_variants(id INTEGER PRIMARY KEY,product_id INTEGER,label TEXT,stock INTEGER,price_cents INTEGER,active INTEGER)');
    await db.exec('CREATE TABLE purkins_intake(product_id INTEGER PRIMARY KEY,purchase_cost_minor INTEGER,purchase_currency TEXT,zar_to_zmw REAL,overhead_zwm_cents INTEGER,status TEXT,retail_tag_minor INTEGER,retail_tag_currency TEXT)');
    await db.exec('CREATE TABLE purkins_variant_intake_details(variant_id INTEGER PRIMARY KEY,retail_tag_minor INTEGER,retail_tag_currency TEXT)');
    await db.exec("INSERT INTO products VALUES (1,'prod_ehv9cq044g','TY-899 warmer',1,'zmw',4,95000)");
    await db.exec("INSERT INTO products VALUES (2,'prod_1111111111','Baby leggings with sizes',0,'zmw',2,0)");
    await db.exec("INSERT INTO products VALUES (3,'prod_2222222222','Unpriced baby garments',0,'zmw',3,0)");
    await db.exec("INSERT INTO product_variants VALUES(11,2,'0–3 months',1,35000,1)");
    await db.exec("INSERT INTO product_variants VALUES(12,2,'3–6 months',1,35000,1)");
    await db.exec("INSERT INTO purkins_intake VALUES(1,NULL,'ZMW',NULL,0,'approved',NULL,'ZAR')");
    await db.exec("INSERT INTO purkins_intake VALUES(2,12000,'ZAR',1.56,3000,'draft',6999,'ZAR')");
    await db.exec("INSERT INTO purkins_intake VALUES(3,NULL,'ZMW',NULL,0,'draft',NULL,'ZAR')");
    await db.exec("INSERT INTO purkins_variant_intake_details VALUES(11,6499,'ZAR')");
  },30000);
  afterAll(async()=>{await mf?.dispose()});

  it('counts sized clothing only once and never assumes missing cost is zero',async()=>{
    const v=await getStockValuation(db);
    expect(v).toMatchObject({
      productCount:3,lineCount:4,totalUnits:9,publishedUnits:4,
      pricedUnits:6,unpricedUnits:3,costedUnits:2,missingCostUnits:7,
      taggedUnits:2,untaggedUnits:7,taggedProductCount:1,taggedValueZarMinor:13498,
      taggedValueZmwMinor:0,taggedValueUsdMinor:0,
      matchedUnits:2,pricedValueCents:450000,
      knownCostValueCents:43440,comparableRevenueCents:70000,
      comparableCostCents:43440,comparableGrossProfitCents:26560,
      completePotentialRevenueCents:null,completeInventoryCostCents:null,
      completePotentialGrossProfitCents:null,detailTruncated:false,
    });
    const sized=v.lines.filter(x=>x.product_id===2);
    expect(sized).toHaveLength(2);
    expect(sized.map(x=>x.units)).toEqual([1,1]);
    expect(sized.every(x=>x.landed_unit_cost_cents===21720)).toBe(true);
    expect(sized.map(x=>x.original_tag_minor).sort()).toEqual([6499,6999]);
    expect(v.lines.filter(x=>x.price_cents===0).length).toBe(1);
  });

  it('recalculates full cost and potential profit only when all values exist',async()=>{
    await db.prepare('UPDATE purkins_intake SET purchase_cost_minor=50000 WHERE product_id=1').run();
    await db.prepare('UPDATE purkins_intake SET purchase_cost_minor=10000 WHERE product_id=3').run();
    await db.prepare('UPDATE products SET price_cents=25000 WHERE id=3').run();
    const v=await getStockValuation(db);
    expect(v.completePotentialRevenueCents).toBe(525000);
    expect(v.completeInventoryCostCents).toBe(273440);
    expect(v.completePotentialGrossProfitCents).toBe(251560);
    expect(v.pricedUnits).toBe(9);
    expect(v.costedUnits).toBe(9);
    expect(v.missingCostUnits).toBe(0);
    expect(v.unpricedUnits).toBe(0);
    expect(v.lines.find(x=>x.product_id===1)?.landed_unit_cost_cents).toBe(50000);
  });

  it('does not invent a ZAR rate for missing currency conversion',async()=>{
    await db.prepare('UPDATE purkins_intake SET zar_to_zmw=NULL WHERE product_id=2').run();
    const v=await getStockValuation(db);
    expect(v.missingCostUnits).toBe(2);
    expect(v.completePotentialGrossProfitCents).toBeNull();
    expect(v.completeInventoryCostCents).toBeNull();
  });

  it('separates R and K tags without reclassifying them as purchase costs',async()=>{
    await db.prepare("INSERT INTO purkins_variant_intake_details VALUES(12,7499,'ZMW')").run();
    const v=await getStockValuation(db);
    expect(v.taggedUnits).toBe(2);
    expect(v.untaggedUnits).toBe(7);
    expect(v.taggedValueZarMinor).toBe(6499);
    expect(v.taggedValueZmwMinor).toBe(7499);
    expect(v.taggedValueUsdMinor).toBe(0);
    expect(v.knownCostValueCents).toBe(230000);
  });
});
