import type { D1Database } from '@cloudflare/workers-types';
import { parsePublicId } from '../ids/publicId';
import { mediaUrl } from '../media/url';

export const RULE_SCOPES = ['global', 'preset', 'category', 'product'] as const;
export const RULE_KINDS = ['guidance', 'policy', 'procedure'] as const;
export type RuleScope = typeof RULE_SCOPES[number];
export type RuleKind = typeof RULE_KINDS[number];

export interface RuleCategory {
  slug: string;
  name: string;
  group_name: string;
  description: string;
  builtin: number;
  active: number;
  position: number;
  revision: number;
  updated_by: string;
  updated_at: string;
  last_request_id?: string | null;
}
export interface RuleCategoryVersion extends RuleCategory { created_at:string }
export type RuleConfig = {
  title?: string;
  kind?: RuleKind;
  instructions?: string;
  criteria?: string;
  actions?: string[];
  tags?: string[];
  fields?: Record<string, string | number | boolean>;
  aspect_ratio?: string;
  target_width?: number;
  target_height?: number;
  background?: string;
  composite_allowed?: boolean;
  required_shots?: string[];
  accuracy_notes?: string;
  preferred_preset?: string;
};
export interface RuleKey {
  category_slug: string;
  rule_slug: string;
  scope: RuleScope;
  target_id: string;
}
export interface RuleRow extends RuleKey {
  rules_json: string;
  reference_ids: string;
  active: number;
  revision: number;
  updated_by: string;
  updated_at: string;
  last_request_id?: string | null;
}
export interface RuleVersion extends RuleRow { created_at: string }
export interface RuleEdit extends RuleKey {
  rules: RuleConfig;
  reference_ids: string[];
  active: boolean;
  expected_revision: number;
  request_id: string;
  actor: string;
}

export const DEFAULT_PHOTOGRAPHY_RULE = {category_slug:'photography',rule_slug:'product-photography'} as const;
const SLUG = /^[a-z][a-z0-9-]{1,59}$/;
const REQ_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const label = (value:unknown, name:string, length=100):string => {
  if (typeof value !== 'string') throw new Error(name+' is required.');
  const s=value.trim();
  if (!s || s.length > length) throw new Error('Invalid '+name+'.');
  return s;
};
export const validSlug = (value:unknown):value is string => typeof value==='string' && SLUG.test(value);
export const isRuleScope = (v:unknown):v is RuleScope =>
  typeof v==='string' && (RULE_SCOPES as readonly string[]).includes(v);

export function normalizeRuleKey(
  category: unknown, slug: unknown, scope: unknown, target: unknown,
):RuleKey {
  if (!validSlug(category) || !validSlug(slug) || !isRuleScope(scope)) {
    throw new Error('Choose a valid rule category, rule slug and scope.');
  }
  const t=String(target??'').trim();
  let target_id=t;
  if (scope==='product') target_id=parsePublicId(t,'product') ?? t;
  if (scope==='category') target_id=parsePublicId(t,'category') ?? t;
  if (scope==='global' && target_id!=='') throw new Error('Global rules cannot have a target.');
  if (scope==='preset' && !validSlug(target_id)) throw new Error('Preset targets must use a lowercase slug.');
  if (scope==='product' && !parsePublicId(target_id,'product')) throw new Error('Choose a prod_ product ID.');
  if (scope==='category' && !parsePublicId(target_id,'category')) throw new Error('Choose a cat_ product-category ID.');
  return {category_slug:category,rule_slug:slug,scope,target_id};
}
export function validateRuleConfig(input:unknown):RuleConfig {
  if(!input || typeof input!=='object' || Array.isArray(input)) throw new Error('Rules must be an object.');
  const value=input as Record<string,unknown>;
  const supported=['title','kind','instructions','criteria','actions','tags','fields','aspect_ratio',
    'target_width','target_height','background','composite_allowed','required_shots','accuracy_notes','preferred_preset'];
  if (Object.keys(value).some(k=>!supported.includes(k))) throw new Error('Unknown rule field.');
  const output:RuleConfig={};
  const strings=[
    ['title',200],['instructions',12000],['criteria',5000],['aspect_ratio',12],
    ['background',600],['accuracy_notes',1200],['preferred_preset',60],
  ] as const;
  for(const [field,max] of strings) {
    const v=value[field];
    if(v===undefined || v==='') continue;
    if(typeof v!=='string' || v.length>max)throw new Error('Invalid '+field+'.');
    output[field]=v.trim();
  }
  if(value.kind!==undefined) {
    if(typeof value.kind!=='string' || !(RULE_KINDS as readonly string[]).includes(value.kind)) throw new Error('Invalid rule kind.');
    output.kind=value.kind as RuleKind;
  }
  if(output.aspect_ratio && !/^[1-9][0-9]?:[1-9][0-9]?$/.test(output.aspect_ratio))throw new Error('Aspect ratio should look like 4:5.');
  if(output.preferred_preset && !validSlug(output.preferred_preset))throw new Error('Invalid preset identifier.');
  for(const field of ['target_width','target_height'] as const){
    const v=value[field];
    if(v===undefined || v==='')continue;
    if(!Number.isInteger(v) || (v as number)<64 || (v as number)>8000)throw new Error('Invalid '+field+'.');
    output[field]=v as number;
  }
  if(value.composite_allowed!==undefined) {
    if(typeof value.composite_allowed!=='boolean')throw new Error('Invalid composite setting.');
    output.composite_allowed=value.composite_allowed;
  }
  for(const field of ['actions','tags','required_shots'] as const){
    const list=value[field];
    if(list===undefined)continue;
    if(!Array.isArray(list) || list.length>30 || list.some(v=>typeof v!=='string' || !v.trim() || v.length>250)){
      throw new Error('Invalid '+field+' list.');
    }
    output[field]=[...new Set((list as string[]).map(v=>v.trim()))];
  }
  if(value.fields!==undefined){
    const f=value.fields;
    if(!f || typeof f!=='object' || Array.isArray(f) || Object.keys(f).length>30)throw new Error('Invalid structured rule fields.');
    const result:NonNullable<RuleConfig['fields']>={};
    for(const [k,v] of Object.entries(f)){
      if(!/^[a-z][a-z0-9_]{0,60}$/.test(k) ||
        !(['string','boolean'].includes(typeof v) || (typeof v==='number' && Number.isFinite(v))) ||
        (typeof v==='string' && v.length>1000))throw new Error('Invalid structured field '+k+'.');
      result[k]=v as string|number|boolean;
    }
    output.fields=result;
  }
  return output;
}
export function normalizeReferenceIds(input:readonly string[],max=12):string[]{
  if(!Array.isArray(input) || input.length>max)throw new Error('Too many reference photos (maximum '+max+').');
  const all=input.map(v=>String(v).trim()).filter(Boolean);
  if(all.some(v=>!parsePublicId(v,'media')))throw new Error('Use approved med_ Media Library IDs only.');
  return [...new Set(all.map(v=>parsePublicId(v,'media')!))];
}
function validateCategoryFields(input:{slug:string;name:string;group_name:string;description?:string}) {
  if(!validSlug(input.slug))throw new Error('Category ID must be a short lowercase slug.');
  return {
    slug:input.slug,
    name:label(input.name,'category name'),
    group_name:label(input.group_name,'category group'),
    description:typeof input.description==='string' && input.description.trim().length<=600 ? input.description.trim() : (()=>{throw new Error('Invalid category description.');})(),
  };
}
export async function listRuleCategories(db:D1Database,includeInactive=false):Promise<RuleCategory[]>{
  const {results}=await db.prepare(
    'SELECT * FROM purkins_rule_categories WHERE (?=1 OR active=1) ORDER BY group_name COLLATE NOCASE,position,name COLLATE NOCASE LIMIT 500',
  ).bind(includeInactive?1:0).all<RuleCategory>();
  return results??[];
}
export async function getRuleCategory(db:D1Database,slug:string):Promise<RuleCategory|null>{
  return db.prepare('SELECT * FROM purkins_rule_categories WHERE slug=?').bind(slug).first<RuleCategory>();
}
async function hash(value:string):Promise<string>{
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function requireReceipt(requestId:string,actor:string):void{
  if(!REQ_ID.test(requestId))throw new Error('A valid UUID request ID is required.');
  if(!actor || actor.length>254)throw new Error('Invalid editor identity.');
}
export async function createRuleCategory(
  db:D1Database, args:{slug:string;name:string;group_name:string;description:string;actor:string;request_id:string},
):Promise<RuleCategory>{
  const data=validateCategoryFields(args);
  requireReceipt(args.request_id,args.actor);
  const payloadHash=await hash(JSON.stringify(data));
  const old=await db.prepare('SELECT actor,payload_hash,category_slug FROM purkins_rule_category_receipts WHERE request_id=?')
    .bind(args.request_id).first<{actor:string;payload_hash:string;category_slug:string}>();
  if(old) {
    if(old.actor!==args.actor || old.payload_hash!==payloadHash)throw new Error('Request ID reused with different category data.');
    const item=await getRuleCategory(db,old.category_slug);
    if(!item)throw new Error('Saved category cannot be found.');
    return item;
  }
  await db.batch([
    db.prepare(`INSERT INTO purkins_rule_categories
      (slug,name,group_name,description,builtin,active,position,updated_by,last_request_id)
      VALUES(?,?,?,?,0,1,999,?,?) ON CONFLICT DO NOTHING`)
      .bind(data.slug,data.name,data.group_name,data.description,args.actor,args.request_id),
    db.prepare(`INSERT OR IGNORE INTO purkins_rule_category_receipts
      (request_id,actor,payload_hash,category_slug)
      SELECT ?,?,?,slug FROM purkins_rule_categories
      WHERE slug=? AND last_request_id=?`)
      .bind(args.request_id,args.actor,payloadHash,data.slug,args.request_id),
  ]);
  const result=await getRuleCategory(db,data.slug);
  if(!result || result.last_request_id!==args.request_id)throw new Error('Category already exists or conflicts with another category name.');
  return result;
}
export async function getRuleCategoryVersions(
  db:D1Database,slug:string,limit=20,
):Promise<RuleCategoryVersion[]> {
  if(!validSlug(slug))throw new Error('Invalid category ID.');
  const {results}=await db.prepare(`SELECT * FROM purkins_rule_category_versions
    WHERE slug=? ORDER BY revision DESC LIMIT ?`)
    .bind(slug,Math.min(50,Math.max(1,limit))).all<RuleCategoryVersion>();
  return results??[];
}
export async function getRuleCategoryVersion(
  db:D1Database,slug:string,revision:number,
):Promise<RuleCategoryVersion|null> {
  if(!validSlug(slug)||!Number.isInteger(revision)||revision<1)throw new Error('Invalid category revision.');
  return db.prepare('SELECT * FROM purkins_rule_category_versions WHERE slug=? AND revision=?')
    .bind(slug,revision).first<RuleCategoryVersion>();
}
/** Shared by Admin and MCP. Category slugs stay stable; each edit is revision-checked,
 * idempotent and recoverable from an immutable snapshot. */
export async function updateRuleCategory(
  db:D1Database,
  args:{slug:string;name:string;group_name:string;description:string;active:boolean;
    actor:string;request_id:string;expected_revision:number},
):Promise<RuleCategory>{
  const input=validateCategoryFields(args);
  requireReceipt(args.request_id,args.actor);
  if(!Number.isInteger(args.expected_revision)||args.expected_revision<1)
    throw new Error('Expected category revision must be at least 1.');
  const active=args.active?1:0;
  const fingerprint=await hash(JSON.stringify({
    ...input,active,expected_revision:args.expected_revision,
  }));
  const previous=await db.prepare(`SELECT actor,payload_hash,saved_revision
    FROM purkins_rule_category_update_receipts WHERE request_id=?`)
    .bind(args.request_id).first<{actor:string;payload_hash:string;saved_revision:number}>();
  if(previous){
    if(previous.actor!==args.actor||previous.payload_hash!==fingerprint)
      throw new Error('Request ID reused with different changes.');
    const version=await getRuleCategoryVersion(db,args.slug,previous.saved_revision);
    if(!version)throw new Error('Recorded category revision not found.');
    return {...version,updated_at:version.created_at,last_request_id:args.request_id};
  }
  await db.batch([
    db.prepare(`UPDATE purkins_rule_categories
      SET name=?2,group_name=?3,description=?4,active=?5,revision=revision+1,
      updated_by=?6,last_request_id=?7,updated_at=datetime('now')
      WHERE slug=?1 AND revision=?8`)
      .bind(args.slug,input.name,input.group_name,input.description,active,args.actor,
        args.request_id,args.expected_revision),
    db.prepare(`INSERT OR IGNORE INTO purkins_rule_category_update_receipts
      (request_id,actor,payload_hash,category_slug,saved_revision)
      SELECT ?1,?2,?3,slug,revision FROM purkins_rule_categories
      WHERE slug=?4 AND last_request_id=?1 AND revision=?5`)
      .bind(args.request_id,args.actor,fingerprint,args.slug,args.expected_revision+1),
  ]);
  const saved=await getRuleCategory(db,args.slug);
  if(!saved || saved.revision!==args.expected_revision+1 || saved.last_request_id!==args.request_id)
    throw new Error('Category changed since your last read. Reload and retry.');
  return saved;
}

export async function validateRuleTarget(db:D1Database,key:RuleKey):Promise<void>{
  const group=await getRuleCategory(db,key.category_slug);
  if(!group)throw new Error('Rule category does not exist.');
  if(key.scope==='product'||key.scope==='category'){
    const table=key.scope==='product'?'products':'categories';
    const row=await db.prepare(`SELECT id FROM ${table} WHERE public_id=?`).bind(key.target_id).first<{id:number}>();
    if(!row)throw new Error('Selected product or product category does not exist.');
  }
}
export async function getRule(db:D1Database,key:RuleKey):Promise<RuleRow|null>{
  return db.prepare(`SELECT * FROM purkins_rules
    WHERE category_slug=? AND rule_slug=? AND scope=? AND target_id=?`)
    .bind(key.category_slug,key.rule_slug,key.scope,key.target_id).first<RuleRow>();
}
export async function listRules(db:D1Database,params:{category_slug?:string;rule_slug?:string;limit?:number}={}):Promise<RuleRow[]> {
  if(params.category_slug && !validSlug(params.category_slug))throw new Error('Invalid category.');
  if(params.rule_slug && !validSlug(params.rule_slug))throw new Error('Invalid rule ID.');
  const {results}=await db.prepare(`SELECT * FROM purkins_rules
    WHERE (?1='' OR category_slug=?1) AND (?2='' OR rule_slug=?2)
    ORDER BY category_slug,rule_slug,scope,target_id LIMIT ?3`)
    .bind(params.category_slug??'',params.rule_slug??'',Math.min(300,Math.max(1,params.limit??200))).all<RuleRow>();
  return results??[];
}
export async function getRuleVersions(db:D1Database,key:RuleKey,limit=20):Promise<RuleVersion[]>{
  const {results}=await db.prepare(`SELECT * FROM purkins_rule_versions
    WHERE category_slug=? AND rule_slug=? AND scope=? AND target_id=?
    ORDER BY revision DESC LIMIT ?`)
    .bind(key.category_slug,key.rule_slug,key.scope,key.target_id,Math.min(50,Math.max(1,limit)))
    .all<RuleVersion>();
  return results??[];
}
export async function getRuleVersion(db:D1Database,key:RuleKey,revision:number):Promise<RuleVersion|null>{
  return db.prepare(`SELECT * FROM purkins_rule_versions
    WHERE category_slug=? AND rule_slug=? AND scope=? AND target_id=? AND revision=?`)
    .bind(key.category_slug,key.rule_slug,key.scope,key.target_id,revision).first<RuleVersion>();
}
export const ruleConfig = (row:Pick<RuleRow,'rules_json'>|null):RuleConfig =>
  row?validateRuleConfig(JSON.parse(row.rules_json)):{};
export const ruleReferences = (row:Pick<RuleRow,'reference_ids'>|null):string[] =>
  row?normalizeReferenceIds(JSON.parse(row.reference_ids) as string[],100):[];

const PRESENT_REFERENCES = `NOT EXISTS(
  SELECT 1 FROM json_each(?6) refs
  WHERE NOT EXISTS(SELECT 1 FROM media WHERE media.public_id=refs.value)
)`;

/** Snapshot every successful edit and use a guarded revision CAS and durable
 * idempotent receipt. The referenced-media existence check runs inside the write. */
export async function saveRule(db:D1Database,edit:RuleEdit):Promise<RuleRow>{
  const key=normalizeRuleKey(edit.category_slug,edit.rule_slug,edit.scope,edit.target_id);
  await validateRuleTarget(db,key);
  requireReceipt(edit.request_id,edit.actor);
  if(!Number.isInteger(edit.expected_revision) || edit.expected_revision<0)throw new Error('Invalid expected revision.');
  const rules=validateRuleConfig(edit.rules);
  const refs=normalizeReferenceIds(edit.reference_ids);
  const rulesJson=JSON.stringify(rules),refsJson=JSON.stringify(refs);
  const active=edit.active?1:0;
  const digest=await hash(JSON.stringify({key,rulesJson,refsJson,active,revision:edit.expected_revision}));
  const prior=await db.prepare('SELECT actor,payload_hash,saved_revision FROM purkins_rule_write_receipts WHERE request_id=?')
    .bind(edit.request_id).first<{actor:string;payload_hash:string;saved_revision:number}>();
  if(prior){
    if(prior.actor!==edit.actor || prior.payload_hash!==digest)throw new Error('Request ID reused with different changes.');
    const version=await getRuleVersion(db,key,prior.saved_revision);
    if(!version)throw new Error('Saved rule history is unavailable.');
    return {...version,last_request_id:edit.request_id,updated_at:version.created_at};
  }
  const write=edit.expected_revision===0?
    db.prepare(`INSERT INTO purkins_rules
      (category_slug,rule_slug,scope,target_id,rules_json,reference_ids,active,revision,updated_by,last_request_id)
      SELECT ?1,?2,?3,?4,?5,?6,?7,1,?8,?9 WHERE ${PRESENT_REFERENCES}
      ON CONFLICT(category_slug,rule_slug,scope,target_id) DO NOTHING`)
      .bind(key.category_slug,key.rule_slug,key.scope,key.target_id,rulesJson,refsJson,active,edit.actor,edit.request_id)
    :db.prepare(`UPDATE purkins_rules SET rules_json=?5,reference_ids=?6,active=?7,
      revision=revision+1,updated_by=?8,last_request_id=?9,updated_at=datetime('now')
      WHERE category_slug=?1 AND rule_slug=?2 AND scope=?3 AND target_id=?4
        AND revision=?10 AND ${PRESENT_REFERENCES}`)
      .bind(key.category_slug,key.rule_slug,key.scope,key.target_id,rulesJson,refsJson,active,
        edit.actor,edit.request_id,edit.expected_revision);
  const receipt=db.prepare(`INSERT OR IGNORE INTO purkins_rule_write_receipts
    (request_id,actor,payload_hash,category_slug,rule_slug,scope,target_id,saved_revision)
    SELECT ?1,?2,?3,category_slug,rule_slug,scope,target_id,revision
    FROM purkins_rules WHERE category_slug=?4 AND rule_slug=?5 AND scope=?6 AND target_id=?7
    AND last_request_id=?1 AND revision=?8`)
    .bind(edit.request_id,edit.actor,digest,key.category_slug,key.rule_slug,key.scope,key.target_id,edit.expected_revision+1);
  await db.batch([write,receipt]);
  const saved=await getRule(db,key);
  if(!saved || saved.revision!==edit.expected_revision+1 || saved.last_request_id!==edit.request_id) {
    throw new Error('Save refused: rule changed or an approved reference image is missing. Reload and retry.');
  }
  return saved;
}

export async function referencePhotos(db:D1Database,ids:readonly string[],origin:string):Promise<Array<{
  id:string;name:string;image_path:string;image_url:string|null;width:number|null;height:number|null
}>>{
  if(!ids.length)return [];
  const ordered=normalizeReferenceIds(ids,100);
  const result: Array<{id:string;name:string;image_path:string;image_url:string|null;width:number|null;height:number|null}>=[];
  let site:URL|null=null;
  try{const u=new URL(origin);if(u.protocol==='https:')site=u;}catch{}
  for(let offset=0;offset<ordered.length;offset+=80){
    const slice=ordered.slice(offset,offset+80);
    const {results}=await db.prepare(`SELECT public_id,original_name,image_key,width,height
      FROM media WHERE public_id IN (${slice.map(()=>'?').join(',')})`)
      .bind(...slice).all<{public_id:string;original_name:string;image_key:string;width:number|null;height:number|null}>();
    const byId=new Map((results??[]).map(r=>[r.public_id,r]));
    for(const id of slice){
      const row=byId.get(id);if(!row)continue;
      const path=mediaUrl(row.image_key);
      result.push({id,name:row.original_name,image_path:path,
        image_url:site?new URL(path,site).href:null,width:row.width,height:row.height});
    }
  }
  return result;
}

/** A rule can be set globally, changed by a named preset or one/more product
 * categories and finally overridden for an exact product. */
export async function effectiveRule(
  db:D1Database,args:{category_slug:string;rule_slug:string;product_id?:string;category_id?:string;preset?:string;origin?:string},
){
  const category=await getRuleCategory(db,args.category_slug);
  if(!category)throw new Error('Rule category does not exist.');
  if(!validSlug(args.rule_slug))throw new Error('Invalid rule slug.');
  const get=(scope:RuleScope,target_id:string)=>getRule(db,{category_slug:args.category_slug,rule_slug:args.rule_slug,scope,target_id});
  const global=await get('global','');
  let categories:RuleRow[]=[];
  if(args.product_id) {
    const prodId=parsePublicId(args.product_id,'product');
    if(!prodId)throw new Error('Choose a prod_ product ID.');
    const prod=await db.prepare('SELECT id FROM products WHERE public_id=?').bind(prodId).first<{id:number}>();
    if(!prod)throw new Error('Product not found.');
    const {results}=await db.prepare(`SELECT c.public_id
      FROM categories c JOIN product_categories pc ON c.id=pc.category_id
      WHERE pc.product_id=? ORDER BY c.name COLLATE NOCASE,c.id`)
      .bind(prod.id).all<{public_id:string|null}>();
    for(const item of results??[]) {
      if(!item.public_id)continue;
      const row=await get('category',item.public_id);
      if(row?.active)categories.push(row);
    }
  } else if(args.category_id) {
    const id=parsePublicId(args.category_id,'category');
    if(!id)throw new Error('Choose a cat_ category ID.');
    const found=await db.prepare('SELECT id FROM categories WHERE public_id=?').bind(id).first();
    if(!found)throw new Error('Product category not found.');
    const row=await get('category',id);
    if(row?.active)categories.push(row);
  }
  const product=args.product_id?await get('product',parsePublicId(args.product_id,'product')!):null;
  const applicable=[global,...categories,product].filter((r):r is RuleRow=>!!r&&r.active===1);
  const preferred=args.preset || [...applicable].reverse().map(r=>ruleConfig(r).preferred_preset).find(Boolean) || '';
  const preset=preferred?await get('preset',preferred):null;
  const layers=[global,preset,...categories,product].filter((r):r is RuleRow=>!!r&&r.active===1);
  const rules=layers.reduce<RuleConfig>((acc,r)=>{
    const next=ruleConfig(r);
    return {...acc,...next,
      ...(next.instructions?{instructions:[acc.instructions,next.instructions].filter(Boolean).join('\n\n')}:{}),
      ...(next.required_shots?{required_shots:[...new Set([...(acc.required_shots??[]),...next.required_shots])]}:{}),
      ...(next.actions?{actions:[...new Set([...(acc.actions??[]),...next.actions])]}:{}),
      ...(next.fields?{fields:{...acc.fields,...next.fields}}:{}),
    };
  },{});
  return {category_slug:args.category_slug,rule_slug:args.rule_slug,category_name:category.name,
    preferred_preset:preferred||null,active:category.active===1 && layers.length>0,
    rules,sources:layers.map(r=>({scope:r.scope,target_id:r.target_id,revision:r.revision})),
    reference_images:await referencePhotos(db,[...new Set(layers.flatMap(r=>ruleReferences(r)))],args.origin??''),
  };
}

export async function listEffectiveRules(
  db:D1Database,args:{category_slug?:string;product_id?:string;category_id?:string;origin?:string;preset?:string},
){
  if(args.category_slug && !validSlug(args.category_slug))throw new Error('Invalid rule category.');
  const {results}=await db.prepare(`SELECT DISTINCT r.category_slug,r.rule_slug FROM purkins_rules r
    JOIN purkins_rule_categories c ON c.slug=r.category_slug
    WHERE r.active=1 AND c.active=1 AND (?='' OR r.category_slug=?)
    ORDER BY r.category_slug,r.rule_slug LIMIT 100`)
    .bind(args.category_slug??'',args.category_slug??'')
    .all<{category_slug:string;rule_slug:string}>();
  const rules=[];
  for(const r of results??[]){
    const effective=await effectiveRule(db,{...r,product_id:args.product_id,category_id:args.category_id,
      preset:args.preset,origin:args.origin});
    if(effective.active)rules.push(effective);
  }
  return rules;
}
