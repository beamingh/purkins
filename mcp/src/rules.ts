import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { D1Database } from '@cloudflare/workers-types';
import {
  RULE_KINDS,RULE_SCOPES,listRuleCategories,getRuleCategory,getRuleCategoryVersions,
  getRuleCategoryVersion,createRuleCategory,updateRuleCategory,
  listRules,normalizeRuleKey,getRule,getRuleVersions,getRuleVersion,ruleConfig,ruleReferences,
  referencePhotos,effectiveRule,listEffectiveRules,saveRule,
} from '../../src/features/rules/standards';

const reply=(data:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(data,null,2)}]});
const slug=z.string().regex(/^[a-z][a-z0-9-]{1,59}$/);
const config=z.object({
  title:z.string().max(200).optional(),
  kind:z.enum(RULE_KINDS).optional(),
  instructions:z.string().max(12000).optional(),
  criteria:z.string().max(5000).optional(),
  actions:z.array(z.string().min(1).max(250)).max(30).optional(),
  tags:z.array(z.string().min(1).max(250)).max(30).optional(),
  fields:z.record(z.string(),z.union([z.string().max(1000),z.number().finite(),z.boolean()])).optional(),
  aspect_ratio:z.string().max(12).optional(),
  target_width:z.number().int().min(64).max(8000).optional(),
  target_height:z.number().int().min(64).max(8000).optional(),
  background:z.string().max(600).optional(),
  composite_allowed:z.boolean().optional(),
  required_shots:z.array(z.string().min(1).max(250)).max(30).optional(),
  accuracy_notes:z.string().max(1200).optional(),
  preferred_preset:slug.optional(),
}).strict();
const ruleKey={category_slug:slug,rule_slug:slug,scope:z.enum(RULE_SCOPES),target_id:z.string().default('')};

function brief(rules:Record<string,unknown>,images:Array<{id:string;image_url:string|null;image_path:string}>):string{
  return [
    'Follow the latest approved Purkins rule:',
    rules.title?'Rule: '+rules.title:'',
    rules.kind?'Type: '+rules.kind:'',
    rules.criteria?'Applies when: '+rules.criteria:'',
    rules.instructions?'Instructions:\n'+rules.instructions:'',
    Array.isArray(rules.actions)?'Steps:\n'+rules.actions.map((x,i)=>`${i+1}. ${x}`).join('\n'):'',
    rules.aspect_ratio?'Aspect ratio: '+rules.aspect_ratio:'',
    rules.target_width && rules.target_height?'Target resolution: '+rules.target_width+' x '+rules.target_height+' px':'',
    rules.background?'Setting: '+rules.background:'',
    rules.accuracy_notes?'Accuracy notes: '+rules.accuracy_notes:'',
    Array.isArray(rules.required_shots)?'Required shots: '+rules.required_shots.join('; '):'',
    images.length?'Approved images:\n'+images.map(p=>p.id+': '+(p.image_url??p.image_path)).join('\n'):'',
    'Only an explicitly enabled, coded business validator can enforce a policy. This stored rule is guidance unless the application implements and verifies it.',
  ].filter(Boolean).join('\n\n');
}

export function registerPurkinsRuleTools(
  server:McpServer,db:D1Database,origin:string,allowWrites:boolean,actor?:string,
):void {
  server.registerTool('list_purkins_rule_categories',{
    description:'List all built-in and custom Purkins rule categories, grouped by business function. Owner-only.',
    inputSchema:{include_inactive:z.boolean().default(false)},
  },async({include_inactive})=>reply({
    categories:await listRuleCategories(db,include_inactive),
  }));

  server.registerTool('get_purkins_rule_category',{
    description:'Read one category including its revision, built-in/custom status, editable name, group, description and active state.',
    inputSchema:{slug},
  },async({slug:categorySlug})=>{
    try{
      const category=await getRuleCategory(db,categorySlug);
      return reply(category?{exists:true,category}:{exists:false,slug:categorySlug});
    }catch(e){return reply({error:e instanceof Error?e.message:'Cannot read category.'});}
  });

  server.registerTool('get_purkins_rule_category_history',{
    description:'Read category revision history so MCP can review and restore past category names, descriptions and status.',
    inputSchema:{slug,limit:z.number().int().min(1).max(50).default(20)},
  },async({slug:categorySlug,limit})=>{
    try{return reply({slug:categorySlug,versions:await getRuleCategoryVersions(db,categorySlug,limit)});}
    catch(e){return reply({error:e instanceof Error?e.message:'Cannot read category history.'});}
  });

  server.registerTool('list_purkins_rules',{
    description:'Read rules stored in the Purkins rule registry, optionally filtered by category and rule slug. Includes scopes, versions, current instructions and approved media IDs.',
    inputSchema:{category_slug:slug.optional(),rule_slug:slug.optional(),limit:z.number().int().min(1).max(200).default(100)},
  },async(input)=>{
    try{
      const rows=await listRules(db,input);
      return reply({rules:rows.map(r=>({...r,rules:ruleConfig(r),reference_ids:ruleReferences(r),
        rules_json:undefined}))});
    }catch(e){return reply({error:e instanceof Error?e.message:'Unable to list rules.'});}
  });

  server.registerTool('get_purkins_rule',{
    description:'Read one exact Purkins rule, revision, editable data and approved reference-image URLs.',
    inputSchema:ruleKey,
  },async(input)=>{
    try{
      const key=normalizeRuleKey(input.category_slug,input.rule_slug,input.scope,input.target_id);
      const r=await getRule(db,key);
      return reply(r?{...key,exists:true,active:r.active===1,revision:r.revision,rules:ruleConfig(r),
        updated_at:r.updated_at,updated_by:r.updated_by,
        references:await referencePhotos(db,ruleReferences(r),origin)}:{...key,exists:false,revision:0});
    }catch(e){return reply({error:e instanceof Error?e.message:'Invalid rule.'});}
  });

  server.registerTool('get_purkins_rule_history',{
    description:'Read earlier immutable revisions of one rule. Use guarded revisioned editing to restore a previous version.',
    inputSchema:{...ruleKey,limit:z.number().int().min(1).max(50).default(20)},
  },async(input)=>{
    try{
      const key=normalizeRuleKey(input.category_slug,input.rule_slug,input.scope,input.target_id);
      return reply({key,versions:(await getRuleVersions(db,key,input.limit)).map(r=>({
        revision:r.revision,active:r.active===1,created_at:r.created_at,
        updated_by:r.updated_by,rules:ruleConfig(r),reference_ids:ruleReferences(r),
      }))});
    }catch(e){return reply({error:e instanceof Error?e.message:'Invalid rule.'});}
  });

  server.registerTool('get_purkins_effective_rule',{
    description:'Resolve one rule through global, preset, product category and product overrides. Returns exact current instructions, provenance, approved image URLs and assistant-ready brief.',
    inputSchema:{category_slug:slug,rule_slug:slug,product_id:z.string().optional(),
      category_id:z.string().optional(),preset:slug.optional()},
  },async(input)=>{
    try{
      const result=await effectiveRule(db,{...input,origin});
      return reply({...result,assistant_brief:brief(result.rules,result.reference_images)});
    }catch(e){return reply({error:e instanceof Error?e.message:'Cannot resolve rule.'});}
  });

  server.registerTool('get_purkins_effective_rules',{
    description:'Retrieve all relevant active business rules, optionally scoped to one rule category or exact product. Helpful before any product, marketing, customer-service or operational task.',
    inputSchema:{category_slug:slug.optional(),product_id:z.string().optional(),
      category_id:z.string().optional(),preset:slug.optional()},
  },async(input)=>{
    try{
      return reply({rules:await listEffectiveRules(db,{...input,origin})});
    }catch(e){return reply({error:e instanceof Error?e.message:'Cannot resolve business rules.'});}
  });

  server.registerTool('update_guarded_purkins_rule',{
    description:'Owner-only rule create/update, with revision guard, actor, idempotency UUID and explicit rule-write kill switch. Never modifies products, prices or orders automatically.',
    inputSchema:{...ruleKey,rules:config,reference_ids:z.array(z.string()).max(12).default([]),
      active:z.boolean().default(true),expected_revision:z.number().int().nonnegative(),request_id:z.string().uuid()},
  },async(input)=>{
    if(!allowWrites||!actor)return reply({error:'Rule editing is disabled for this owner connection.'});
    try{
      const row=await saveRule(db,{...input,actor});
      return reply({saved:true,revision:row.revision,active:row.active===1,
        key:{category_slug:row.category_slug,rule_slug:row.rule_slug,scope:row.scope,target_id:row.target_id},
        product_published:false,
      });
    }catch(e){return reply({error:e instanceof Error?e.message:'Rule save refused.'});}
  });

  server.registerTool('restore_guarded_purkins_rule',{
    description:'Restore a previous rule revision as a NEW revision. Owner-only; requires individual token permission, global+rules write flags, actor, expected current revision and idempotency UUID.',
    inputSchema:{...ruleKey,restore_revision:z.number().int().min(1),
      expected_revision:z.number().int().min(1),request_id:z.string().uuid()},
  },async(input)=>{
    if(!allowWrites||!actor)return reply({error:'Rule editing is disabled for this owner connection.'});
    try{
      const key=normalizeRuleKey(input.category_slug,input.rule_slug,input.scope,input.target_id);
      const old=await getRuleVersion(db,key,input.restore_revision);
      if(!old)return reply({error:'Requested history revision does not exist.'});
      const saved=await saveRule(db,{...key,request_id:input.request_id,actor,
        expected_revision:input.expected_revision,active:old.active===1,
        rules:ruleConfig(old),reference_ids:ruleReferences(old)});
      return reply({restored:true,restored_from:input.restore_revision,new_revision:saved.revision,
        key,product_published:false});
    }catch(e){return reply({error:e instanceof Error?e.message:'Rule restore refused.'});}
  });

  server.registerTool('create_guarded_purkins_rule_category',{
    description:'Owner-only creation of a new rules category, guarded by the dedicated rule-write switch, authenticated actor and idempotency UUID.',
    inputSchema:{slug,name:z.string().min(2).max(100),group_name:z.string().min(2).max(100),
      description:z.string().max(600).default(''),request_id:z.string().uuid()},
  },async(input)=>{
    if(!allowWrites||!actor)return reply({error:'Creating rule categories is disabled for this owner connection.'});
    try{
      const category=await createRuleCategory(db,{...input,actor});
      return reply({created:true,category});
    }catch(e){return reply({error:e instanceof Error?e.message:'Category creation refused.'});}
  });
  server.registerTool('update_guarded_purkins_rule_category',{
    description:'Edit a built-in or custom category name, group, description or active status via MCP, with current revision + UUID idempotency and owner rule-write gate. Stable category slug never changes.',
    inputSchema:{slug,name:z.string().min(2).max(100),
      group_name:z.string().min(2).max(100),description:z.string().max(600).default(''),
      active:z.boolean(),expected_revision:z.number().int().min(1),request_id:z.string().uuid()},
  },async(input)=>{
    if(!allowWrites||!actor)return reply({error:'Category editing is disabled for this owner connection.'});
    try{
      const category=await updateRuleCategory(db,{...input,actor});
      return reply({saved:true,category,changed_rule_data:false});
    }catch(e){return reply({error:e instanceof Error?e.message:'Category edit refused.'});}
  });

  server.registerTool('restore_guarded_purkins_rule_category',{
    description:'Restore a previous category snapshot as a NEW category revision. Owner-only gated edit with current expected revision and request UUID.',
    inputSchema:{slug,restore_revision:z.number().int().min(1),
      expected_revision:z.number().int().min(1),request_id:z.string().uuid()},
  },async(input)=>{
    if(!allowWrites||!actor)return reply({error:'Category editing is disabled for this owner connection.'});
    try{
      const old=await getRuleCategoryVersion(db,input.slug,input.restore_revision);
      if(!old)return reply({error:'Requested category history revision does not exist.'});
      const category=await updateRuleCategory(db,{slug:input.slug,
        name:old.name,group_name:old.group_name,description:old.description,active:old.active===1,
        request_id:input.request_id,expected_revision:input.expected_revision,actor});
      return reply({restored:true,restored_from:input.restore_revision,category});
    }catch(e){return reply({error:e instanceof Error?e.message:'Category restore refused.'});}
  });

}
