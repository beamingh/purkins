import type { D1Database } from '@cloudflare/workers-types';
import { parsePublicId } from '../ids/publicId';
import { mediaUrl } from '../media/url';

export const DOMAINS = ['photography', 'naming', 'descriptions', 'social'] as const;
export const SCOPES = ['global', 'preset', 'category', 'product'] as const;
export type CreativeDomain = typeof DOMAINS[number];
export type CreativeScope = typeof SCOPES[number];
export type CreativeConfig = {
  title?: string;
  instructions?: string;
  aspect_ratio?: string;
  target_width?: number;
  target_height?: number;
  background?: string;
  composite_allowed?: boolean;
  required_shots?: string[];
  accuracy_notes?: string;
  preferred_preset?: string;
};
export interface CreativeRow {
  domain: CreativeDomain;
  scope: CreativeScope;
  target_id: string;
  rules_json: string;
  reference_ids: string;
  active: number;
  revision: number;
  updated_by: string;
  updated_at: string;
  last_request_id?: string | null;
}
export interface CreativeVersion {
  domain: CreativeDomain;
  scope: CreativeScope;
  target_id: string;
  rules_json: string;
  reference_ids: string;
  active: number;
  revision: number;
  updated_by: string;
  created_at: string;
}
export interface CreativeKey { domain: CreativeDomain; scope: CreativeScope; target_id: string }
export interface CreativeEdit extends CreativeKey {
  rules: CreativeConfig;
  reference_ids: string[];
  active: boolean;
  expected_revision: number;
  request_id: string;
  actor: string;
}
export const DEFAULT_PRESETS = ['studio-product','feature-composite','purkins-kitchen','lifestyle'] as const;

export const isDomain = (v: unknown): v is CreativeDomain =>
  typeof v === 'string' && (DOMAINS as readonly string[]).includes(v);
export const isScope = (v: unknown): v is CreativeScope =>
  typeof v === 'string' && (SCOPES as readonly string[]).includes(v);

export function normalizeCreativeKey(domain: unknown, scope: unknown, target: unknown): CreativeKey {
  if (!isDomain(domain) || !isScope(scope)) throw new Error('Invalid creative standards section.');
  const rawTarget = String(target ?? '').trim();
  const target_id = scope === 'product' ? (parsePublicId(rawTarget,'product') ?? rawTarget)
    : scope === 'category' ? (parsePublicId(rawTarget,'category') ?? rawTarget)
    : rawTarget;
  if (scope === 'global' && target_id !== '') throw new Error('Global standards have no target ID.');
  if (scope === 'preset' && !/^[a-z][a-z0-9-]{0,59}$/.test(target_id)) {
    throw new Error('Preset identifiers must use short lowercase slugs.');
  }
  if (scope === 'product' && !parsePublicId(target_id, 'product')) throw new Error('Choose a prod_ product ID.');
  if (scope === 'category' && !parsePublicId(target_id, 'category')) throw new Error('Choose a cat_ category ID.');
  return {domain,scope,target_id};
}

const MAX_INSTRUCTIONS = 5000;
const MAX_TEXT = 600;
export function validateCreativeConfig(value: unknown): CreativeConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Rules must be an object.');
  const input = value as Record<string, unknown>;
  const allowed = ['title','instructions','aspect_ratio','target_width','target_height','background',
    'composite_allowed','required_shots','accuracy_notes','preferred_preset'];
  if (Object.keys(input).some(k=>!allowed.includes(k))) throw new Error('Unknown creative rules field.');
  const result: CreativeConfig = {};
  for (const field of ['title','instructions','aspect_ratio','background','accuracy_notes','preferred_preset'] as const) {
    const v = input[field];
    if (v == null || v === '') continue;
    if (typeof v !== 'string' || v.length > (field === 'instructions' ? MAX_INSTRUCTIONS : MAX_TEXT)) {
      throw new Error('Invalid or oversized '+field+'.');
    }
    result[field] = v.trim();
  }
  if (result.aspect_ratio && !/^[1-9][0-9]?:[1-9][0-9]?$/.test(result.aspect_ratio)) {
    throw new Error('Aspect ratio must be like 4:5.');
  }
  if (result.preferred_preset && !/^[a-z][a-z0-9-]{0,59}$/.test(result.preferred_preset)) {
    throw new Error('Choose a valid preset slug.');
  }
  for (const field of ['target_width','target_height'] as const) {
    const v = input[field];
    if (v == null || v === '') continue;
    if (!Number.isInteger(v) || (v as number) < 64 || (v as number) > 8000) {
      throw new Error(field+' must be an integer between 64 and 8000.');
    }
    result[field] = v as number;
  }
  if (input.composite_allowed !== undefined) {
    if (typeof input.composite_allowed !== 'boolean') throw new Error('Invalid composite setting.');
    result.composite_allowed = input.composite_allowed;
  }
  if (input.required_shots !== undefined) {
    if (!Array.isArray(input.required_shots) || input.required_shots.length > 20 ||
        !input.required_shots.every(v => typeof v === 'string' && v.length >= 1 && v.length <= 200)) {
      throw new Error('Provide up to 20 short shot descriptions.');
    }
    result.required_shots = [...new Set(input.required_shots.map((s:string)=>s.trim()).filter(Boolean))];
  }
  return result;
}

export function normalizeReferenceIds(input: readonly string[]): string[] {
  if (input.length > 12) throw new Error('A standard supports up to 12 approved reference images.');
  const values=input.map(v=>String(v).trim()).filter(Boolean);
  if (values.some(id=>!parsePublicId(id,'media'))) throw new Error('Reference images require med_ media library IDs.');
  return [...new Set(values.map(id=>parsePublicId(id,'media')!))];
}

export async function validateTarget(db: D1Database, key: CreativeKey): Promise<void> {
  if (key.scope !== 'product' && key.scope !== 'category') return;
  const table = key.scope === 'product' ? 'products' : 'categories';
  const match = await db.prepare(`SELECT id FROM ${table} WHERE public_id = ?`)
    .bind(key.target_id).first<{id:number}>();
  if (!match) throw new Error('The selected product or category does not exist.');
}

export async function getCreativeRule(db: D1Database, key: CreativeKey): Promise<CreativeRow | null> {
  return db.prepare('SELECT * FROM purkins_creative_standards WHERE domain=? AND scope=? AND target_id=?')
    .bind(key.domain,key.scope,key.target_id).first<CreativeRow>();
}
export async function getCreativeVersions(db: D1Database, key: CreativeKey, limit=20): Promise<CreativeVersion[]> {
  const {results} = await db.prepare(
    'SELECT * FROM purkins_creative_versions WHERE domain=? AND scope=? AND target_id=? ORDER BY revision DESC LIMIT ?',
  ).bind(key.domain,key.scope,key.target_id,Math.min(Math.max(limit,1),50)).all<CreativeVersion>();
  return results ?? [];
}
export async function getCreativeVersion(db:D1Database,key:CreativeKey,revision:number): Promise<CreativeVersion|null> {
  return db.prepare('SELECT * FROM purkins_creative_versions WHERE domain=? AND scope=? AND target_id=? AND revision=?')
    .bind(key.domain,key.scope,key.target_id,revision).first<CreativeVersion>();
}
export const ruleConfig = (row: Pick<CreativeRow,'rules_json'> | null): CreativeConfig =>
  row ? validateCreativeConfig(JSON.parse(row.rules_json)) : {};
export const ruleReferences = (row: Pick<CreativeRow,'reference_ids'> | null): string[] =>
  row ? normalizeReferenceIds(JSON.parse(row.reference_ids) as string[]) : [];

async function sha256(input:string):Promise<string>{
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
const REF_CHECK = `NOT EXISTS (
  SELECT 1 FROM json_each(?5) AS refs
  WHERE NOT EXISTS (SELECT 1 FROM media WHERE media.public_id=refs.value)
)`;

/** Compare-and-swap saves, append-only history triggers, and retry receipts.
 * The media-existence check runs inside the same SQL write as the new references.
 * D1 batch executes atomically so a receipt cannot claim an unsuccessful save. */
export async function saveCreativeRule(db:D1Database, edit:CreativeEdit):Promise<CreativeRow>{
  const key=normalizeCreativeKey(edit.domain,edit.scope,edit.target_id);
  await validateTarget(db,key);
  const rules=validateCreativeConfig(edit.rules);
  const references=normalizeReferenceIds(edit.reference_ids);
  const active=edit.active?1:0;
  if (!Number.isInteger(edit.expected_revision) || edit.expected_revision<0) throw new Error('Invalid expected revision.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(edit.request_id)) {
    throw new Error('A fresh UUID request ID is required.');
  }
  if (!edit.actor || edit.actor.length>254) throw new Error('Invalid editor identity.');
  const rulesJson=JSON.stringify(rules), refsJson=JSON.stringify(references);
  const hash=await sha256(JSON.stringify({key,rulesJson,refsJson,active,expected_revision:edit.expected_revision}));
  const receipt=await db.prepare('SELECT actor,payload_hash FROM purkins_creative_write_receipts WHERE request_id=?')
    .bind(edit.request_id).first<{actor:string;payload_hash:string}>();
  if (receipt) {
    if (receipt.payload_hash!==hash || receipt.actor!==edit.actor) throw new Error('Request ID reused with different changes.');
    const previous=await db.prepare('SELECT saved_revision FROM purkins_creative_write_receipts WHERE request_id=?')
      .bind(edit.request_id).first<{saved_revision:number}>();
    const version=previous ? await getCreativeVersion(db,key,previous.saved_revision) : null;
    if (!version) throw new Error('Saved revision could not be located.');
    return {...version,last_request_id:edit.request_id,updated_at:version.created_at};
  }
  const update=edit.expected_revision===0
    ? db.prepare(`INSERT INTO purkins_creative_standards
        (domain,scope,target_id,rules_json,reference_ids,active,revision,updated_by,last_request_id)
        SELECT ?1,?2,?3,?4,?5,?6,1,?7,?8 WHERE ${REF_CHECK}
        ON CONFLICT(domain,scope,target_id) DO NOTHING`)
        .bind(key.domain,key.scope,key.target_id,rulesJson,refsJson,active,edit.actor,edit.request_id)
    : db.prepare(`UPDATE purkins_creative_standards
        SET rules_json=?4,reference_ids=?5,active=?6,revision=revision+1,
            updated_by=?7,last_request_id=?8,updated_at=datetime('now')
        WHERE domain=?1 AND scope=?2 AND target_id=?3 AND revision=?9 AND ${REF_CHECK}`)
        .bind(key.domain,key.scope,key.target_id,rulesJson,refsJson,active,edit.actor,edit.request_id,
          edit.expected_revision);
  const receiptWrite=db.prepare(`INSERT OR IGNORE INTO purkins_creative_write_receipts
      (request_id,actor,payload_hash,domain,scope,target_id,saved_revision)
      SELECT ?1,?2,?3,domain,scope,target_id,revision
      FROM purkins_creative_standards
      WHERE domain=?4 AND scope=?5 AND target_id=?6 AND last_request_id=?1 AND revision=?7`)
    .bind(edit.request_id,edit.actor,hash,key.domain,key.scope,key.target_id,edit.expected_revision+1);
  await db.batch([update,receiptWrite]);
  const saved=await getCreativeRule(db,key);
  if (!saved || saved.last_request_id!==edit.request_id || saved.revision!==edit.expected_revision+1) {
    throw new Error('Save refused: standard changed, or an approved reference image is no longer available. Reload and retry.');
  }
  return saved;
}

export async function referencePhotos(db:D1Database,ids:readonly string[],origin:string):Promise<Array<{
  id:string; name:string; image_path:string; image_url:string|null; width:number|null; height:number|null
}>>{
  if (!ids.length) return [];
  const chosen=normalizeReferenceIds(ids);
  if (!chosen.length) return [];
  const {results}=await db.prepare(`SELECT public_id,original_name,image_key,width,height FROM media WHERE public_id IN (${chosen.map(()=>'?').join(',')})`)
    .bind(...chosen).all<{public_id:string;original_name:string;image_key:string;width:number|null;height:number|null}>();
  const byId=new Map((results??[]).map(r=>[r.public_id,r]));
  let site:URL|null=null;
  try {const u=new URL(origin);if(u.protocol==='https:')site=u;}catch{}
  return chosen.flatMap(id=>{
    const r=byId.get(id);if(!r)return [];
    const image_path=mediaUrl(r.image_key);
    return [{id,name:r.original_name,image_path,image_url:site?new URL(image_path,site).href:null,
      width:r.width,height:r.height}];
  });
}

/** Global defaults -> selected preset -> matching categories -> product override.
 * Product categories are resolved by public ID, never by supplier names. */
export async function effectiveCreativeRule(
  db:D1Database, args:{domain:CreativeDomain;category_id?:string;product_id?:string;preset?:string;origin?:string},
){
  const global=await getCreativeRule(db,{domain:args.domain,scope:'global',target_id:''});
  let categories:CreativeRow[]=[];
  if(args.product_id){
    const pid=parsePublicId(args.product_id,'product');
    if(!pid)throw new Error('Expected a prod_ product ID.');
    const product=await db.prepare('SELECT id FROM products WHERE public_id=?').bind(pid).first<{id:number}>();
    if(!product)throw new Error('Product not found.');
    const {results}=await db.prepare(
      `SELECT c.public_id FROM categories c JOIN product_categories pc ON pc.category_id=c.id
       WHERE pc.product_id=? ORDER BY c.name COLLATE NOCASE,c.id`,
    ).bind(product.id).all<{public_id:string|null}>();
    for(const row of results??[]){
      if(!row.public_id)continue;
      const rule=await getCreativeRule(db,{domain:args.domain,scope:'category',target_id:row.public_id});
      if(rule?.active)categories.push(rule);
    }
  } else if(args.category_id){
    const key=normalizeCreativeKey(args.domain,'category',args.category_id);
    await validateTarget(db,key);
    const rule=await getCreativeRule(db,key);
    if(rule?.active)categories.push(rule);
  }
  const product=args.product_id?await getCreativeRule(db,{
    domain:args.domain,scope:'product',target_id:args.product_id,
  }):null;
  const applicable=[global,...categories,product].filter((r):r is CreativeRow=>!!r&&r.active===1);
  const preferred=args.preset || [...applicable].reverse().map(r=>ruleConfig(r).preferred_preset).find(Boolean) || '';
  const preset=preferred?await getCreativeRule(db,{
    domain:args.domain,scope:'preset',target_id:preferred,
  }):null;
  const layered=[global,preset,...categories,product].filter((r):r is CreativeRow=>!!r&&r.active===1);
  // Structured choices obey last-writer precedence; composition instructions
  // and required shots accumulate so a preset never erases global fidelity rules.
  const rules=layered.reduce<CreativeConfig>((acc,r)=>{
    const next=ruleConfig(r);
    return {
      ...acc,...next,
      ...(next.instructions?{instructions:[acc.instructions,next.instructions].filter(Boolean).join('\n\n')}:{}),
      ...(next.required_shots?{required_shots:[...new Set([...(acc.required_shots??[]),...next.required_shots])]}:{}),
    };
  },{});
  const references=[...new Set(layered.flatMap(r=>ruleReferences(r)))];
  return {domain:args.domain,preferred_preset:preferred||null,rules,
    sources:layered.map(r=>({scope:r.scope,target_id:r.target_id,revision:r.revision,updated_at:r.updated_at})),
    reference_images:await referencePhotos(db,references,args.origin??''),
  };
}
