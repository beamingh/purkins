import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { D1Database } from '@cloudflare/workers-types';
import {
  DOMAINS, SCOPES, getCreativeRule, getCreativeVersions,
  ruleConfig, ruleReferences, referencePhotos, effectiveCreativeRule,
  saveCreativeRule, normalizeCreativeKey, type CreativeDomain, type CreativeScope,
} from '../../src/features/creative/standards';

const reply=(data:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(data,null,2)}]});
const domain=z.enum(DOMAINS);
const scope=z.enum(SCOPES);
const document=z.object({
  title:z.string().max(600).optional(),
  instructions:z.string().max(5000).optional(),
  aspect_ratio:z.string().max(12).optional(),
  target_width:z.number().int().min(64).max(8000).optional(),
  target_height:z.number().int().min(64).max(8000).optional(),
  background:z.string().max(600).optional(),
  composite_allowed:z.boolean().optional(),
  required_shots:z.array(z.string().min(1).max(200)).max(20).optional(),
  accuracy_notes:z.string().max(600).optional(),
  preferred_preset:z.string().max(60).optional(),
}).strict();

function brief(rules:Record<string,unknown>,photos:Array<{id:string;image_url:string|null;image_path:string}>):string {
  const sections=[
    'Purkins approved creative brief (follow the currently active standards):',
    rules.instructions ? String(rules.instructions):'',
    rules.accuracy_notes ? 'Product fidelity: '+rules.accuracy_notes:'',
    rules.aspect_ratio ? 'Aspect ratio: '+rules.aspect_ratio:'',
    rules.target_width && rules.target_height ? 'Target resolution: '+rules.target_width+' x '+rules.target_height+' px':'',
    rules.background ? 'Setting/background: '+rules.background:'',
    typeof rules.composite_allowed==='boolean'?'Feature composites: '+(rules.composite_allowed?'permitted':'not permitted'):'',
    Array.isArray(rules.required_shots)?'Required shots: '+rules.required_shots.join('; '):'',
    photos.length?'Approved reference images:\n'+photos.map(p=>p.id+': '+(p.image_url??p.image_path)).join('\n'):'',
    'Do not invent labels, included accessories, features, packaging claims or product specifications.',
    'Generated images require owner review and attachment to a private draft before publication.',
  ];
  return sections.filter(Boolean).join('\n');
}

export function registerCreativeStandardsTools(
  server:McpServer,db:D1Database,origin:string,allowWrites:boolean,actor?:string,
):void {
  server.registerTool('list_purkins_creative_presets',{
    description:'Owner-only live creative presets including instructions and approved media references; use these rather than remembered image rules.',
    inputSchema:{domain:domain.default('photography')},
  },async ({domain:section})=>{
    const {results}=await db.prepare(
      "SELECT * FROM purkins_creative_standards WHERE domain=? AND scope='preset' ORDER BY target_id LIMIT 100",
    ).bind(section).all<{target_id:string;active:number;revision:number;rules_json:string;reference_ids:string}>();
    return reply({domain:section,presets:await Promise.all((results??[]).map(async p=>({
      slug:p.target_id,active:!!p.active,revision:p.revision,rules:ruleConfig(p),
      reference_images:await referencePhotos(db,ruleReferences(p),origin),
    })))});
  });

  server.registerTool('get_purkins_creative_standards',{
    description:'Resolve live Purkins rules: global → preset → category → product. Returns exact active instructions, revision sources, approved reference URLs and a ready image-generation brief. Operator only.',
    inputSchema:{
      domain:domain.default('photography'),
      category_id:z.string().optional(),
      product_id:z.string().optional(),
      preset:z.string().optional(),
    },
  },async (input)=>{
    try{
      const resolved=await effectiveCreativeRule(db,{
        domain:input.domain,category_id:input.category_id,product_id:input.product_id,
        preset:input.preset,origin,
      });
      return reply({...resolved,generation_brief:brief(resolved.rules as Record<string,unknown>,resolved.reference_images)});
    }catch(e){return reply({error:e instanceof Error?e.message:'Could not resolve standards.'});}
  });

  server.registerTool('get_purkins_creative_rule',{
    description:'Fetch the editable definition, current revision and approved reference images of one global, preset, category or product standard.',
    inputSchema:{domain,scope,target_id:z.string().default('')},
  },async(input)=>{
    try{
      const key=normalizeCreativeKey(input.domain,input.scope,input.target_id);
      const row=await getCreativeRule(db,key);
      return reply(row?{...key,revision:row.revision,active:!!row.active,
        updated_at:row.updated_at,updated_by:row.updated_by,rules:ruleConfig(row),
        reference_images:await referencePhotos(db,ruleReferences(row),origin)}:{...key,revision:0,exists:false});
    }catch(e){return reply({error:e instanceof Error?e.message:'Invalid standard.'});}
  });

  server.registerTool('get_purkins_creative_history',{
    description:'Read recent immutable revisions of one creative standard. Prior rules can be restored by submitting a new guarded revision.',
    inputSchema:{domain,scope,target_id:z.string().default(''),limit:z.number().int().min(1).max(30).default(10)},
  },async(input)=>{
    try{
      const key=normalizeCreativeKey(input.domain,input.scope,input.target_id);
      const rows=await getCreativeVersions(db,key,input.limit);
      return reply({key,versions:rows.map(r=>({
        revision:r.revision,active:!!r.active,changed_at:r.created_at,changed_by:r.updated_by,
        rules:ruleConfig(r),reference_ids:ruleReferences(r),
      }))});
    }catch(e){return reply({error:e instanceof Error?e.message:'Invalid standard.'});}
  });

  server.registerTool('update_guarded_purkins_creative_standard',{
    description:'Owner-only revision-checked creative rule edit. An explicit creative write gate, per-token write grant, actor and idempotent request UUID are required. Never publishes products or media.',
    inputSchema:{
      domain,scope,target_id:z.string().default(''),
      rules:document,reference_ids:z.array(z.string()).max(12).default([]),
      active:z.boolean().default(true),
      expected_revision:z.number().int().nonnegative(),
      request_id:z.string().uuid(),
    },
  },async(input)=>{
    if(!allowWrites||!actor)return reply({error:'Creative standards MCP editing is disabled for this owner connection.'});
    try{
      const saved=await saveCreativeRule(db,{
        domain:input.domain as CreativeDomain,scope:input.scope as CreativeScope,
        target_id:input.target_id,rules:input.rules,reference_ids:input.reference_ids,
        active:input.active,expected_revision:input.expected_revision,
        request_id:input.request_id,actor,
      });
      return reply({saved:true,published:false,revision:saved.revision,
        key:{domain:saved.domain,scope:saved.scope,target_id:saved.target_id},
        reference_images:await referencePhotos(db,ruleReferences(saved),origin)});
    }catch(e){return reply({error:e instanceof Error?e.message:'Creative standards edit refused.'});}
  });
}
