import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFileSync } from 'node:fs';
import type { D1Database } from '@cloudflare/workers-types';
import {
  issueMcpClientToken, authenticateMcpClientToken, revokeMcpClientToken,
  listMcpClientTokens, listMcpClientTokenEvents, hashClientToken,
} from './clientTokens';

const owner='owner@example.com';
const rid=()=>crypto.randomUUID();

describe('Owner MCP client credentials (real isolated D1)',()=>{
  let mf:Miniflare,db:D1Database;

  beforeAll(async()=>{
    mf=new Miniflare({
      modules:true,script:'export default { fetch(){return new Response("ok");} }',
      compatibilityDate:'2026-07-20',d1Databases:['DB'],
    });
    db=await mf.getD1Database('DB');
    const sql=readFileSync(new URL('../../../migrations/0049_purkins_mcp_connections.sql',import.meta.url),'utf8');
    await db.exec(sql);
  },30000);
  afterAll(async()=>{await mf?.dispose()});

  it('creates one expiring 256-bit credential, never storing the raw secret',async()=>{
    const response=await issueMcpClientToken(db,{
      ownerEmail:owner,name:' ChatGPT stock review ',expiryDays:90,
      requestId:rid(),now:1_800_000_000,
    });
    expect(response.ok).toBe(true);
    if(!response.ok)throw Error(response.message);
    expect(response.token).toMatch(/^pmcp_[A-Za-z0-9_-]{43}$/);
    expect(response.expires_at).toBe(1_800_000_000+90*86400);
    const row=await db.prepare('SELECT name,token_hash,token_prefix,scope,accountable_email FROM purkins_mcp_client_tokens WHERE id=?')
      .bind(response.id).first<{name:string;token_hash:string;token_prefix:string;scope:string;accountable_email:string}>();
    expect(row?.name).toBe('ChatGPT stock review');
    expect(row?.token_hash).toBe(await hashClientToken(response.token));
    expect(row?.token_hash).not.toBe(response.token);
    expect(row?.scope).toBe('read_only');
    expect(row?.accountable_email).toBe(owner);
    expect(row?.token_prefix).toBe(response.token.slice(0,13));
    const listing=await listMcpClientTokens(db);
    expect(JSON.stringify(listing)).not.toContain(response.token);
    expect(JSON.stringify(listing)).not.toContain(row?.token_hash);
    expect((await listMcpClientTokenEvents(db))[0]?.action).toBe('created');
    const auth=await authenticateMcpClientToken(db,'Bearer '+response.token,owner,1_800_000_001);
    expect(auth).toEqual({id:response.id,actor:'owner:client:'+response.id,readOnly:true});
    expect(await authenticateMcpClientToken(db,'Bearer '+response.token,owner,1_800_000_002))
      .toMatchObject({readOnly:true});
    const updated=await db.prepare('SELECT call_count,last_used_at FROM purkins_mcp_client_tokens WHERE id=?')
      .bind(response.id).first<{call_count:number;last_used_at:number}>();
    expect(updated).toMatchObject({call_count:2,last_used_at:1_800_000_002});
  });

  it('fails closed for the wrong owner, malformed headers, or expiry',async()=>{
    const create=await issueMcpClientToken(db,{ownerEmail:owner,name:'Expiry test',expiryDays:30,requestId:rid(),now:1_800_100_000});
    if(!create.ok)throw Error(create.message);
    expect(await authenticateMcpClientToken(db,'Bearer '+create.token,'else@example.com',1_800_100_001)).toBe(null);
    expect(await authenticateMcpClientToken(db,'Bearer '+create.token,undefined,1_800_100_001)).toBe(null);
    expect(await authenticateMcpClientToken(db,'Bearer '+create.token+'extra',owner,1_800_100_001)).toBe(null);
    expect(await authenticateMcpClientToken(db,create.token,owner,1_800_100_001)).toBe(null);
    expect(await authenticateMcpClientToken(db,'Bearer '+create.token,owner,create.expires_at)).toBe(null);
    expect(await authenticateMcpClientToken(db,'Bearer pmcp_'+'A'.repeat(43),owner,1_800_100_001)).toBe(null);
  });

  it('revokes immediately and records only one audit event even on repeated requests',async()=>{
    const r=await issueMcpClientToken(db,{ownerEmail:owner,name:'Revocable test',expiryDays:90,requestId:rid(),now:1_800_200_000});
    if(!r.ok)throw Error(r.message);
    const first=await revokeMcpClientToken(db,{id:r.id,ownerEmail:owner,now:1_800_200_050});
    expect(first.ok).toBe(true);
    expect((await revokeMcpClientToken(db,{id:r.id,ownerEmail:owner,now:1_800_200_050})).ok).toBe(false);
    expect((await revokeMcpClientToken(db,{id:r.id,ownerEmail:'attacker@example.com',now:1_800_200_050})).ok).toBe(false);
    expect(await authenticateMcpClientToken(db,'Bearer '+r.token,owner,1_800_200_051)).toBe(null);
    const events=(await listMcpClientTokenEvents(db)).filter(e=>e.token_id===r.id && e.action==='revoked');
    expect(events).toHaveLength(1);
  });

  it('rejects duplicate issuance request IDs and unsupported durations without extra rows',async()=>{
    const requestId=rid();
    const args={ownerEmail:owner,name:'No double submit',expiryDays:90,requestId,now:1_800_300_000};
    const first=await issueMcpClientToken(db,args);
    expect(first.ok).toBe(true);
    const second=await issueMcpClientToken(db,args);
    expect(second).toMatchObject({ok:false});
    const count=await db.prepare('SELECT count(*) AS count FROM purkins_mcp_client_tokens WHERE request_id=?')
      .bind(requestId).first<{count:number}>();
    expect(count?.count).toBe(1);
    expect((await issueMcpClientToken(db,{...args,requestId:rid(),expiryDays:366})).ok).toBe(false);
    expect((await issueMcpClientToken(db,{...args,requestId:rid(),name:'x'})).ok).toBe(false);
    expect((await issueMcpClientToken(db,{...args,requestId:'not-a-uuid'})).ok).toBe(false);
  });

  it('keeps separate owner credentials distinct',async()=>{
    const a=await issueMcpClientToken(db,{ownerEmail:owner,name:'Device A',expiryDays:30,requestId:rid()});
    const b=await issueMcpClientToken(db,{ownerEmail:owner,name:'Device B',expiryDays:30,requestId:rid()});
    if(!a.ok||!b.ok)throw Error('Fixture issuance failed');
    expect(a.token).not.toBe(b.token);
    expect(a.id).not.toBe(b.id);
  });
});
