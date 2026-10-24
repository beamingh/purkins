import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authorizedMcpOwner } from './ownerGate';
import type { verifyAccessJwt } from '../auth/access';

const config = {
  CF_ACCESS_TEAM_DOMAIN: 'https://example.cloudflareaccess.com',
  CF_ACCESS_AUD: 'an-application-audience',
  PURKINS_MCP_OWNER_EMAIL: 'Owner@Example.com',
};
// Explicit dependency injection avoids module-level mock leakage between tests.
const verify = vi.fn<typeof verifyAccessJwt>();
describe('Owner-only MCP Connections gate', () => {
  beforeEach(() => verify.mockReset());

  it('rejects absent/forged tokens and incomplete configuration', async () => {
    expect(await authorizedMcpOwner(null, config, verify)).toBeNull();
    expect(await authorizedMcpOwner('a.jwt.signature', {...config, PURKINS_MCP_OWNER_EMAIL: undefined}, verify)).toBeNull();
    expect(await authorizedMcpOwner('a.jwt.signature', {...config, CF_ACCESS_AUD: undefined}, verify)).toBeNull();
    expect(verify).not.toHaveBeenCalled();
    verify.mockResolvedValue(null);
    expect(await authorizedMcpOwner('forged', config, verify)).toBeNull();
    expect(verify).toHaveBeenCalledWith('forged', {
      teamDomain: config.CF_ACCESS_TEAM_DOMAIN, aud: config.CF_ACCESS_AUD,
    });
  });

  it('does not let a valid but different Access user issue credentials', async () => {
    verify.mockResolvedValue({ email: 'visitor@example.com' });
    expect(await authorizedMcpOwner('verified-non-owner', config, verify)).toBeNull();
  });

  it('accepts only a matching signature-verified owner email', async () => {
    verify.mockResolvedValue({ email: 'OWNER@example.com' });
    expect(await authorizedMcpOwner('valid-owner', config, verify)).toBe('owner@example.com');
  });

  it('fails closed when Cloudflare JWKS retrieval rejects', async () => {
    // A direct async verifier avoids creating a globally tracked rejected
    // vi.fn() result, which can be reported as an unhandled rejection in the
    // full Miniflare + Vitest pool despite the application catching it.
    const unreachableJwks: typeof verifyAccessJwt = async () => {
      throw new Error('JWKS temporarily unavailable');
    };
    const result = await authorizedMcpOwner('identity', config, unreachableJwks);
    expect(result).toBeNull();
  });

  it('fails closed when verification throws synchronously', async () => {
    const brokenVerifier: typeof verifyAccessJwt = () => {
      throw new Error('unexpected verifier failure');
    };
    const result = await authorizedMcpOwner('identity', config, brokenVerifier);
    expect(result).toBeNull();
  });
});
