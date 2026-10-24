import { describe,it,expect,vi,beforeEach } from 'vitest';
import { authorizedMcpOwner } from './ownerGate';
import { verifyAccessJwt } from '../auth/access';

vi.mock('../auth/access',()=>({verifyAccessJwt:vi.fn()}));
const verify=vi.mocked(verifyAccessJwt);
const config={
  CF_ACCESS_TEAM_DOMAIN:'https://example.cloudflareaccess.com',
  CF_ACCESS_AUD:'an-application-audience',
  PURKINS_MCP_OWNER_EMAIL:'Owner@Example.com',
};
describe('Owner-only MCP Connections gate',()=>{
  beforeEach(()=>verify.mockReset());

  it('rejects absent/forged tokens and incomplete configuration',async()=>{
    expect(await authorizedMcpOwner(null,config)).toBeNull();
    expect(await authorizedMcpOwner('a.jwt.signature',{...config,PURKINS_MCP_OWNER_EMAIL:undefined})).toBeNull();
    expect(await authorizedMcpOwner('a.jwt.signature',{...config,CF_ACCESS_AUD:undefined})).toBeNull();
    expect(verify).not.toHaveBeenCalled();
    verify.mockResolvedValue(null);
    expect(await authorizedMcpOwner('forged',config)).toBeNull();
    expect(verify).toHaveBeenCalledWith('forged',{teamDomain:config.CF_ACCESS_TEAM_DOMAIN,aud:config.CF_ACCESS_AUD});
  });

  it('does not let a valid but different Access user issue credentials',async()=>{
    verify.mockResolvedValue({email:'visitor@example.com'});
    expect(await authorizedMcpOwner('verified-non-owner',config)).toBeNull();
  });

  it('accepts only a matching signature-verified owner email',async()=>{
    verify.mockResolvedValue({email:'OWNER@example.com'});
    expect(await authorizedMcpOwner('valid-owner',config)).toBe('owner@example.com');
  });

  it('fails closed on JWKS/network errors',async()=>{
    verify.mockRejectedValue(new Error('unavailable'));
    expect(await authorizedMcpOwner('identity',config)).toBeNull();
  });
});
