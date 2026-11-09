import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import type {D1Database} from '@cloudflare/workers-types';
import {splitPurkinsMigrationSql} from '../purkins/migration-test-sql';
import {
  listRuleCategories,getRuleCategory,createRuleCategory,updateRuleCategory,
  getRuleCategoryVersions,getRuleCategoryVersion,
  getRule,getRuleVersions,getRuleVersion,saveRule,listRules,ruleConfig,ruleReferences,
  effectiveRule,listEffectiveRules,
} from './standards';
import {deleteMediaRecord} from '../media/db';
import {isUnused,mediaUsageForIds} from '../media/usage';

const request_id=()=>crypto.randomUUID();
const actor='owner:rules:test';
const product='prod_0123456789',category='cat_0123456789',media='med_0123456789';
const key={category_slug:'photography',rule_slug:'product-photography',scope:'product' as const,target_id:product};

describe('Purkins general rule registry on an isolated D1',()=>{
  let mf:Miniflare,db:D1Database;
  beforeAll(async()=>{
    mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',
      compatibilityDate:'2026-07-20',d1Databases:['DB']});
    db=await mf.getD1Database('DB');
    await db.exec('CREATE TABLE products(id INTEGER PRIMARY KEY,public_id TEXT UNIQUE,name TEXT,image_key TEXT)');
    await db.exec('CREATE TABLE categories(id INTEGER PRIMARY KEY,public_id TEXT UNIQUE,name TEXT)');
    await db.exec('CREATE TABLE product_categories(product_id INTEGER,category_id INTEGER)');
    await db.exec('CREATE TABLE media(id INTEGER PRIMARY KEY,public_id TEXT UNIQUE,image_key TEXT,original_name TEXT,width INTEGER,height INTEGER)');
    await db.exec('CREATE TABLE product_images(id INTEGER PRIMARY KEY,product_id INTEGER,image_key TEXT)');
    await db.exec('CREATE TABLE page_media(page_id INTEGER,media_id INTEGER)');
    await db.exec('CREATE TABLE pages(id INTEGER PRIMARY KEY,public_id TEXT,title TEXT)');
    await db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
    const migration=readFileSync(new URL('../../../migrations/0065_purkins_rules_and_standards.sql',import.meta.url),'utf8');
    for(const statement of splitPurkinsMigrationSql(migration))await db.prepare(statement).run();
    await db.batch([
      db.prepare('INSERT INTO products(id,public_id,name) VALUES(1,?,?)').bind(product,'Purple travel diaper backpack'),
      db.prepare('INSERT INTO categories(id,public_id,name) VALUES(1,?,?)').bind(category,'Baby bags'),
      db.prepare('INSERT INTO product_categories(product_id,category_id) VALUES(1,1)'),
      db.prepare('INSERT INTO media(id,public_id,image_key,original_name,width,height) VALUES(1,?,?,?,1080,1350)')
        .bind(media,'media/example.jpg','Approved real product'),
    ]);
  },30000);
  afterAll(async()=>{await mf?.dispose()});

  it('seeds 16 built-in categories, a 4:5 photo rule and four photo presets',async()=>{
    const categories=await listRuleCategories(db);
    expect(categories).toHaveLength(16);
    expect(categories.every(c=>c.builtin===1)).toBe(true);
    expect(categories.map(c=>c.slug)).toEqual(expect.arrayContaining([
      'photography','pricing','stock-intake','customer-service','pickup-delivery','ai-automation',
    ]));
    const global=await getRule(db,{category_slug:'photography',rule_slug:'product-photography',
      scope:'global',target_id:''});
    expect(ruleConfig(global)).toMatchObject({aspect_ratio:'4:5',target_width:1080,target_height:1350});
    const rows=await listRules(db,{category_slug:'photography'});
    expect(rows.filter(x=>x.scope==='preset')).toHaveLength(4);
    expect(await getRuleVersions(db,{category_slug:'photography',rule_slug:'product-photography',
      scope:'global',target_id:''})).toHaveLength(1);
  });

  it('creates and edits a custom category with idempotent receipts, without changing defaults',async()=>{
    const input={slug:'supplier-comms',name:'Supplier Communications',group_name:'Inventory & Operations',
      description:'How we speak to wholesalers',actor,request_id:request_id()};
    const saved=await createRuleCategory(db,input);
    expect(saved).toMatchObject({slug:'supplier-comms',builtin:0,active:1});
    expect(await createRuleCategory(db,input)).toMatchObject({slug:'supplier-comms'});
    await expect(createRuleCategory(db,{...input,name:'Different name'})).rejects.toThrow('Request ID reused');
    await expect(createRuleCategory(db,{...input,request_id:request_id()})).rejects.toThrow('already exists');
    const renamed=await updateRuleCategory(db,{slug:'supplier-comms',name:'Supplier Relations',
      group_name:'Operations',description:'Supplier outreach',active:true,
      actor,request_id:request_id(),expected_revision:saved.revision});
    expect(renamed).toMatchObject({name:'Supplier Relations',group_name:'Operations'});
    expect(await getRuleCategory(db,'photography')).toMatchObject({builtin:1,active:1});
    expect((await listRuleCategories(db)).length).toBe(17);
  });

  it('exposes category edits, activation and restoration with the same guarded MCP/Inbox semantics',async()=>{
    const before=(await getRuleCategory(db,'supplier-comms'))!;
    const request=request_id();
    const inactive={slug:'supplier-comms',name:before.name,group_name:before.group_name,
      description:before.description,active:false,actor,request_id:request,
      expected_revision:before.revision};
    const saved=await updateRuleCategory(db,inactive);
    expect(saved.revision).toBe(before.revision+1);
    expect(saved.active).toBe(0);
    expect((await listRuleCategories(db)).map(c=>c.slug)).not.toContain('supplier-comms');
    expect(await updateRuleCategory(db,inactive)).toMatchObject({revision:saved.revision,active:0});
    await expect(updateRuleCategory(db,{...inactive,active:true}))
      .rejects.toThrow('Request ID reused');
    await expect(updateRuleCategory(db,{...inactive,request_id:request_id()}))
      .rejects.toThrow('Category changed');
    const previous=await getRuleCategoryVersion(db,'supplier-comms',before.revision);
    expect(previous).toMatchObject({name:before.name,active:1});
    const restored=await updateRuleCategory(db,{slug:'supplier-comms',
      name:previous!.name,group_name:previous!.group_name,description:previous!.description,
      active:previous!.active===1,actor,request_id:request_id(),expected_revision:saved.revision});
    expect(restored.active).toBe(1);
    expect(restored.revision).toBe(saved.revision+1);
    expect((await getRuleCategoryVersions(db,'supplier-comms')).length).toBe(restored.revision);
    expect((await listRuleCategories(db)).map(c=>c.slug)).toContain('supplier-comms');
  });

  it('allows multiple distinct policies and procedures inside one category',async()=>{
    const first={category_slug:'supplier-comms',rule_slug:'purchase-order-review',scope:'global' as const,target_id:'',
      actor,reference_ids:[],active:true,expected_revision:0};
    const one=await saveRule(db,{...first,request_id:request_id(),rules:{
      kind:'procedure',title:'Verify purchase order',instructions:'Check supplier credentials.',
      actions:['Confirm payment terms','Check stock','Approve purchase order'],
    }});
    const two=await saveRule(db,{...first,rule_slug:'payment-terms',request_id:request_id(),
      rules:{kind:'policy',title:'Payment terms',instructions:'Confirm invoice before payment.',
        fields:{prepayment_allowed:false,min_lead_days:2}}});
    expect(one.revision).toBe(1);
    expect(two.revision).toBe(1);
    expect((await listRules(db,{category_slug:'supplier-comms'})).length).toBe(2);
    expect(ruleConfig(two).fields).toEqual({prepayment_allowed:false,min_lead_days:2});
  });

  it('applies global, preset, product category and product overrides while retaining general guidance',async()=>{
    await saveRule(db,{category_slug:'photography',rule_slug:'product-photography',
      scope:'category',target_id:category,actor,reference_ids:[],active:true,expected_revision:0,
      request_id:request_id(),rules:{background:'Category-specific backdrop'}});
    await saveRule(db,{...key,actor,reference_ids:[media],active:true,expected_revision:0,
      request_id:request_id(),rules:{preferred_preset:'feature-composite',
        accuracy_notes:'Purple fabric, beige zipper, exact YOU ARE MY SUNSHINE label'}});
    const resolved=await effectiveRule(db,{category_slug:'photography',
      rule_slug:'product-photography',product_id:product,origin:'https://purkins.ulwimbo.com'});
    expect(resolved.rules).toMatchObject({
      target_width:1080,target_height:1350,background:'Category-specific backdrop',
      accuracy_notes:expect.stringContaining('YOU ARE MY SUNSHINE'),
    });
    expect(resolved.rules.instructions).toContain('Create accurate 4:5 portraits');
    expect(resolved.rules.instructions).toContain('Combine verified details');
    expect(resolved.sources.map(x=>x.scope)).toEqual(['global','preset','category','product']);
    expect(resolved.reference_images[0]).toMatchObject({
      id:media,image_url:'https://purkins.ulwimbo.com/images/media/example.jpg'});
    expect((await listEffectiveRules(db,{category_slug:'photography',product_id:product}))).toHaveLength(1);
    const usage=(await mediaUsageForIds(db,[1])).get(1);
    expect(usage?.rules).toHaveLength(1);
    expect(isUnused(usage!)).toBe(false);
    expect(await deleteMediaRecord(db,1)).toBeNull();
  });

  it('rejects stale writes and missing media without altering versions',async()=>{
    const rev=(await getRule(db,key))!.revision;
    const before=(await getRuleVersions(db,key)).length;
    const opts={...key,actor,active:true,expected_revision:rev,rules:{title:'Invalid photo'},
      reference_ids:['med_9876543210'],request_id:request_id()};
    await expect(saveRule(db,opts)).rejects.toThrow('Save refused');
    await expect(saveRule(db,{...opts,reference_ids:[media],expected_revision:0,request_id:request_id()}))
      .rejects.toThrow('Save refused');
    expect((await getRuleVersions(db,key)).length).toBe(before);
  });

  it('replays write IDs safely and restores history as an additional revision',async()=>{
    const rev=(await getRule(db,key))!.revision;
    const request=request_id();
    const data={...key,actor,request_id:request,active:true,expected_revision:rev,
      reference_ids:[media],rules:{accuracy_notes:'New approved label text'}};
    const next=await saveRule(db,data);
    expect((await saveRule(db,data)).revision).toBe(next.revision);
    await expect(saveRule(db,{...data,rules:{title:'Not the same'}})).rejects.toThrow('Request ID reused');
    const old=await getRuleVersion(db,key,1);
    const restored=await saveRule(db,{...key,actor,request_id:request_id(),active:true,
      expected_revision:next.revision,reference_ids:ruleReferences(old),rules:ruleConfig(old)});
    expect(restored.revision).toBe(next.revision+1);
    expect(ruleConfig(restored).accuracy_notes).toContain('YOU ARE MY SUNSHINE');
    expect((await getRuleVersions(db,key)).length).toBe(restored.revision);
  });

  it('releases media after the last rule removes its reference',async()=>{
    const rev=(await getRule(db,key))!.revision;
    await saveRule(db,{...key,actor,request_id:request_id(),active:true,
      expected_revision:rev,rules:{accuracy_notes:'No attached photos'},reference_ids:[]});
    expect(await deleteMediaRecord(db,1)).toBe('media/example.jpg');
  });
});
