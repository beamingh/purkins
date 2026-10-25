import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractMcpUrlToken } from './urlToken';

const BASE='https://admin.purkins.ulwimbo.com/mcp';
const TOKEN='pmcp_'+('B'.repeat(43));
const req=(url:string,method='POST',authorization?:string):Request=>
  new Request(url,{method,headers:authorization?{Authorization:authorization}:undefined});

describe('Purkins URL token for MCP connections',()=>{
  it('accepts a scoped pmcp_ token in a canonical ?token URL',()=>{
    const result=extractMcpUrlToken(req(BASE+'?token='+TOKEN+'&mcp-session-id=abc'));
    expect(result).toEqual({
      kind:'token',bearer:'Bearer '+TOKEN,
      sanitizedUrl:BASE+'?mcp-session-id=abc',
    });
  });

  it('supports the Ulwimbo-style ?mcp_token alias with SSE GET',()=>{
    expect(extractMcpUrlToken(req(BASE+'?mcp_token='+TOKEN,'GET'))).toEqual({
      kind:'token',bearer:'Bearer '+TOKEN,sanitizedUrl:BASE,
    });
  });

  it('cannot authenticate the unscoped legacy worker token through a URL',()=>{
    expect(extractMcpUrlToken(req(BASE+'?token=legacy-secret'))).toEqual({kind:'invalid'});
    expect(extractMcpUrlToken(req(BASE+'?token='))).toEqual({kind:'invalid'});
    expect(extractMcpUrlToken(req(BASE+'?token=pmcp_short'))).toEqual({kind:'invalid'});
  });

  it('rejects duplicates, conflicting names and an extra Authorization header',()=>{
    for(const url of [
      BASE+'?token='+TOKEN+'&token='+TOKEN,
      BASE+'?token='+TOKEN+'&mcp_token='+TOKEN,
      BASE+'?mcp_token='+TOKEN+'&mcp_token='+TOKEN,
    ])expect(extractMcpUrlToken(req(url))).toEqual({kind:'invalid'});
    expect(extractMcpUrlToken(req(BASE+'?token='+TOKEN,'POST','Bearer example')))
      .toEqual({kind:'invalid'});
  });

  it('leaves header-only and ordinary requests unchanged',()=>{
    expect(extractMcpUrlToken(req(BASE))).toEqual({kind:'absent'});
    expect(extractMcpUrlToken(req(BASE+'?sessionId=abc','GET'))).toEqual({kind:'absent'});
    expect(extractMcpUrlToken(req('https://admin.purkins.ulwimbo.com/admin/mcp?token='+TOKEN)))
      .toEqual({kind:'absent'});
  });

  it('wires the Admin entry gate to the backend verifier and strips token before DO transport',()=>{
    const worker=readFileSync(
      fileURLToPath(new URL('../../admin-worker.ts',import.meta.url)),'utf8');
    const handler=readFileSync(
      fileURLToPath(new URL('../../../mcp/src/index.ts',import.meta.url)),'utf8');
    expect(worker).toContain("url.searchParams.has('token')");
    expect(worker).toContain("url.searchParams.has('mcp_token')");
    expect(handler).toContain('extractMcpUrlToken(request)');
    expect(handler).toContain('authenticateMcpClientToken(');
    expect(handler).toContain('new Request(urlCredential.sanitizedUrl,request)');
    expect(handler).toContain("urlCredential.kind==='token'");
  });

  it('the Admin page offers a one-time copyable connection URL but never writes token to permanent links',()=>{
    const admin=readFileSync(
      fileURLToPath(new URL('../../pages/admin/mcp.astro',import.meta.url)),'utf8');
    expect(admin).toContain('mcpEndpoint+\'?token=\'+encodeURIComponent(revealedToken)');
    expect(admin).toContain('id="copy-mcp-url"');
    expect(admin).toContain('oneTimeConnectionUrl');
    expect(admin).toContain("Astro.response.headers.set('Cache-Control','private, no-store')");
  });
});
