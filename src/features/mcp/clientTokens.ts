import type { D1Database } from '@cloudflare/workers-types';
import {
  MCP_OWNER_READ_TOOLS, normalizeMcpToolPermissions, parseStoredMcpPermissions,
  hasWritePermissions, type McpToolName,
} from './clientScope';

/**
 * Purkins owner-operated client credentials. Not an OAuth issuer.
 *
 * Raw tokens are shown only on issue. Storage contains one SHA-256 digest of a
 * 256-bit random token. Revocation/expiry is checked on EVERY /mcp request,
 * even for an already initialized MCP Durable Object session.
 *
 * Per-connection immutable tool grants. Default is read-only, but the verified
 * owner can explicitly select individual tools or all permissions. The global
 * write gate and scoped Worker toggles still apply in addition to these grants.
 */
const TOKEN_RE = /^pmcp_[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const VALID_EXPIRY_DAYS = new Set([30, 90, 180, 365]);

export interface McpClientTokenRow {
  id: string;
  name: string;
  token_prefix: string;
  accountable_email: string;
  scope: 'read_only'; // legacy D1 column, retained for compatibility
  tool_permissions_json: string | null;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  last_used_at: number | null;
  call_count: number;
}

export function normalizeOwnerEmail(value: string | undefined | null): string | null {
  if (!value) return null;
  const normalized=value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(normalized) && normalized.length<=254
    ? normalized : null;
}

function newRawToken(): string {
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  let binary='';
  for(const b of bytes)binary+=String.fromCharCode(b);
  return 'pmcp_'+btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

export async function hashClientToken(token: string): Promise<string> {
  const buffer=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  return Array.from(new Uint8Array(buffer),v=>v.toString(16).padStart(2,'0')).join('');
}

export async function listMcpClientTokens(db: D1Database): Promise<McpClientTokenRow[]> {
  const r=await db.prepare(
    'SELECT id,name,token_prefix,accountable_email,scope,created_at,expires_at,'+
    'revoked_at,last_used_at,call_count,tool_permissions_json FROM purkins_mcp_client_tokens '+
    'ORDER BY created_at DESC,id DESC LIMIT 100'
  ).all<McpClientTokenRow>();
  return r.results??[];
}

export async function listMcpClientTokenEvents(db: D1Database): Promise<{
  token_id:string;actor_email:string;action:'created'|'revoked';occurred_at:number;
}[]> {
  const r=await db.prepare(
    'SELECT token_id,actor_email,action,occurred_at FROM purkins_mcp_client_token_events '+
    'ORDER BY occurred_at DESC,id DESC LIMIT 30'
  ).all<{token_id:string;actor_email:string;action:'created'|'revoked';occurred_at:number}>();
  return r.results??[];
}

export type IssueClientTokenResult =
  | {ok:true;token:string;id:string;expires_at:number}
  | {ok:false;message:string};

export async function issueMcpClientToken(
  db: D1Database,
  opts:{name:string;ownerEmail:string;expiryDays:number;requestId:string;toolPermissions?:readonly string[];now?:number},
):Promise<IssueClientTokenResult> {
  const owner=normalizeOwnerEmail(opts.ownerEmail);
  if(!owner) return {ok:false,message:'Verified owner email is required.'};
  const name=opts.name.trim();
  if(name.length<3||name.length>120||/[\u0000-\u001f]/.test(name)){
    return {ok:false,message:'Connection name must contain 3–120 printable characters.'};
  }
  if(!VALID_EXPIRY_DAYS.has(opts.expiryDays)){
    return {ok:false,message:'Choose 30, 90, 180 or 365 days.'};
  }
  if(!UUID_RE.test(opts.requestId)){
    return {ok:false,message:'Missing or invalid request identifier.'};
  }
  // An absent selection is a safe read-only preset (also for older callers).
  const tools = normalizeMcpToolPermissions(opts.toolPermissions ?? MCP_OWNER_READ_TOOLS);
  if (!tools) return {ok:false,message:'Unknown, repeated or excessive MCP permissions.'};
  const now=opts.now??Math.floor(Date.now()/1000);
  const raw=newRawToken();
  const digest=await hashClientToken(raw);
  const id=crypto.randomUUID();
  const expiry=now+opts.expiryDays*86400;
  try{
    await db.batch([
      db.prepare(
        'INSERT INTO purkins_mcp_client_tokens '+
        '(id,name,token_prefix,token_hash,accountable_email,scope,request_id,created_at,expires_at,tool_permissions_json) '+
        "VALUES(?,?,?,?,?,'read_only',?,?,?,?)"
      ).bind(id,name,raw.slice(0,13),digest,owner,opts.requestId.toLowerCase(),now,expiry,JSON.stringify(tools)),
      db.prepare('INSERT INTO purkins_mcp_client_token_events '+
        '(id,token_id,actor_email,action,occurred_at) VALUES(?,?,?,\'created\',?)'
      ).bind(crypto.randomUUID(),id,owner,now),
    ]);
  }catch(error){
    // Never return a different raw token for a replayed POST: if a response was
    // lost, revoke and issue afresh instead of bypassing one-time disclosure.
    if(/UNIQUE|constraint/i.test(String(error))){
      return {ok:false,message:'Creation request already processed or token collision. Refresh the page and use a new request.'};
    }
    throw error;
  }
  return {ok:true,token:raw,id,expires_at:expiry};
}

export async function revokeMcpClientToken(
  db:D1Database,opts:{id:string;ownerEmail:string;now?:number},
):Promise<{ok:boolean;message:string}> {
  const owner=normalizeOwnerEmail(opts.ownerEmail);
  if(!owner || !UUID_RE.test(opts.id))return {ok:false,message:'Invalid token or owner.'};
  const now=opts.now??Math.floor(Date.now()/1000);
  const nonce=crypto.randomUUID();
  const result=await db.batch([
    db.prepare(
      'UPDATE purkins_mcp_client_tokens SET revoked_at=?,revocation_nonce=? '+
      'WHERE id=? AND accountable_email=? AND revoked_at IS NULL RETURNING id'
    ).bind(now,nonce,opts.id,owner),
    // D1 batch is atomic; insert the audit record ONLY if revocation happened.
    db.prepare(
      'INSERT INTO purkins_mcp_client_token_events '+
      '(id,token_id,actor_email,action,occurred_at) '+
      "SELECT ?,id,?,'revoked',? FROM purkins_mcp_client_tokens "+
      'WHERE id=? AND accountable_email=? AND revocation_nonce=?'
    ).bind(nonce,owner,now,opts.id,owner,nonce),
  ]);
  const changed=(result[0]?.results?.length??0)>0;
  return changed?{ok:true,message:'Connection revoked.'}:
    {ok:false,message:'Connection is missing or was already revoked.'};
}

export async function authenticateMcpClientToken(
  db:D1Database,header:string|null,configuredOwnerEmail:string|undefined,
  now=Math.floor(Date.now()/1000),
):Promise<{id:string;actor:string;readOnly:boolean;toolPermissions:McpToolName[]}|null>{
  const owner=normalizeOwnerEmail(configuredOwnerEmail);
  if(!owner||!header?.startsWith('Bearer '))return null;
  const raw=header.slice(7);
  if(!TOKEN_RE.test(raw))return null;
  const digest=await hashClientToken(raw);
  // Every request must see the active credential; an expired or revoked token
  // never authorizes an existing MCP session, regardless of cached props.
  const result=await db.prepare(
    'UPDATE purkins_mcp_client_tokens SET last_used_at=?,call_count=call_count+1 '+
    'WHERE token_hash=? AND accountable_email=? AND scope=\'read_only\' '+
    'AND revoked_at IS NULL AND expires_at>? RETURNING id,tool_permissions_json'
  ).bind(now,digest,owner,now).first<{id:string;tool_permissions_json:string|null}>();
  if(!result)return null;
  const tools=parseStoredMcpPermissions(result.tool_permissions_json);
  if(!tools)return null; // corruption/unknown grants fail closed
  return {
    id:result.id,actor:'owner:client:'+result.id,readOnly:!hasWritePermissions(tools),
    toolPermissions:tools,
  };
}

export const MCP_CLIENT_TOKEN_DAYS = [30,90,180,365] as const;
