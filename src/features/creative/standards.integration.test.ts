import { beforeAll,afterAll,describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types';
import { splitPurkinsMigrationSql } from '../purkins/migration-test-sql';
import {
  getCreativeRule,getCreativeVersions,getCreativeVersion,effectiveCreativeRule,
  saveCreativeRule,ruleConfig,ruleReferences,
} from './standards';
import { deleteMediaRecord } from '../media/db';
import { mediaUsageForIds,isUnused } from '../media/usage';

const id=()=>crypto.randomUUID();
const product='prod_0123456789';
const category='cat_0123456789';
const approved='med_0123456789';
const missing='med_9876543210';
const actor='owner:test:creative';
const key={domain:'photography' as const,scope:'product' as const,target_id:product};

describe('creative standards in real isolated D1',()=>{
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
    const sql=readFileSync(new URL('../../../migrations/0065_purkins_creative_standards.sql',import.meta.url),'utf8');
    for(const stmt of splitPurkinsMigrationSql(sql))await db.prepare(stmt).run();
    await db.batch([
      db.prepare('INSERT INTO products(id,public_id,name) VALUES(1,?,?)').bind(product,'Diaper backpack'),
      db.prepare('INSERT INTO categories(id,public_id,name) VALUES(1,?,?)').bind(category,'Bags & Organisers'),
      db.prepare('INSERT INTO product_categories(product_id,category_id) VALUES(1,1)'),
      db.prepare('INSERT INTO media(id,public_id,image_key,original_name,width,height) VALUES(1,?,?,?,1080,1350)')
        .bind(approved,'media/example.png','Verified studio photo'),
    ]);
  },30000);
  afterAll(async()=>{await mf?.dispose()});

  it('seeds an editable 4:5 global standard and four creative presets with history',async()=>{
    const global=await getCreativeRule(db,{domain:'photography',scope:'global',target_id:''});
    expect(global).toMatchObject({active:1,revision:1});
    expect(ruleConfig(global)).toMatchObject({aspect_ratio:'4:5',target_width:1080,target_height:1350});
    const {results}=await db.prepare("SELECT target_id FROM purkins_creative_standards WHERE domain='photography' AND scope='preset' ORDER BY target_id").all<{target_id:string}>();
    expect((results??[]).map(r=>r.target_id)).toEqual(
      ['feature-composite','lifestyle','purkins-kitchen','studio-product']);
    expect(await getCreativeVersions(db,{domain:'photography',scope:'global',target_id:''})).toHaveLength(1);
  });

  it('merges global, preset, category and product without losing approved reference URLs',async()=>{
    await saveCreativeRule(db,{
      domain:'photography',scope:'category',target_id:category,request_id:id(),actor,expected_revision:0,active:true,
      rules:{background:'Category background'},reference_ids:[],
    });
    const saved=await saveCreativeRule(db,{
      ...key,request_id:id(),actor,expected_revision:0,active:true,
      rules:{accuracy_notes:'Purple fabric, beige zippers, exact YOU ARE MY SUNSHINE label',
        preferred_preset:'feature-composite'},reference_ids:[approved],
    });
    expect(saved.revision).toBe(1);
    const effective=await effectiveCreativeRule(db,{domain:'photography',product_id:product,
      origin:'https://purkins.ulwimbo.com'});
    expect(effective.rules).toMatchObject({aspect_ratio:'4:5',target_width:1080,
      background:'Category background',accuracy_notes:expect.stringContaining('YOU ARE MY SUNSHINE')});
    expect(effective.preferred_preset).toBe('feature-composite');
    expect(effective.rules.instructions).toContain('Use 4:5 portrait photographs');
    expect(effective.rules.instructions).toContain('Combine authentic views');
    expect(effective.rules.required_shots).toContain('Primary full product');
    expect(effective.sources.map(s=>s.scope)).toEqual(['global','preset','category','product']);
    expect(effective.reference_images).toMatchObject([{
      id:approved,image_url:'https://purkins.ulwimbo.com/images/media/example.png',
    }]);
    const usage=(await mediaUsageForIds(db,[1])).get(1);
    expect(usage?.creative).toHaveLength(1);
    expect(isUnused(usage!)).toBe(false);
    expect(await deleteMediaRecord(db,1)).toBeNull();
  });

  it('rejects missing media and stale writes without making history entries',async()=>{
    const revision=(await getCreativeRule(db,key))!.revision;
    const before=(await getCreativeVersions(db,key)).length;
    await expect(saveCreativeRule(db,{...key,request_id:id(),actor,expected_revision:revision,
      active:true,rules:{title:'Unapproved'},reference_ids:[missing]})).rejects.toThrow('Save refused');
    await expect(saveCreativeRule(db,{...key,request_id:id(),actor,expected_revision:0,
      active:true,rules:{title:'Stale'},reference_ids:[approved]})).rejects.toThrow('Save refused');
    expect((await getCreativeVersions(db,key)).length).toBe(before);
  });

  it('retries idempotently and restores an older revision as a new version',async()=>{
    const revision=(await getCreativeRule(db,key))!.revision;
    const request_id=id();
    const next={...key,request_id,actor,expected_revision:revision,active:true,
      rules:{accuracy_notes:'New packaging checked'},reference_ids:[approved]};
    const one=await saveCreativeRule(db,next);
    const replay=await saveCreativeRule(db,next);
    expect(one.revision).toBe(revision+1);
    expect(replay.revision).toBe(one.revision);
    await expect(saveCreativeRule(db,{...next,rules:{title:'Different content'}}))
      .rejects.toThrow('Request ID reused');
    const v1=await getCreativeVersion(db,key,1);
    expect(v1).not.toBeNull();
    const restored=await saveCreativeRule(db,{...key,request_id:id(),actor,expected_revision:one.revision,
      active:true,rules:ruleConfig(v1),reference_ids:ruleReferences(v1)});
    expect(restored.revision).toBe(one.revision+1);
    expect(ruleConfig(restored).accuracy_notes).toContain('YOU ARE MY SUNSHINE');
    expect(await getCreativeVersions(db,key)).toHaveLength(restored.revision);
  });

  it('releases media for deletion after reference removal',async()=>{
    const revision=(await getCreativeRule(db,key))!.revision;
    await saveCreativeRule(db,{...key,request_id:id(),actor,expected_revision:revision,
      active:true,rules:{accuracy_notes:'Reference retired'},reference_ids:[]});
    expect(await deleteMediaRecord(db,1)).toBe('media/example.png');
  });
});
