import { verifyAccessJwt } from '../auth/access';
import { isApprovedMcpOwner } from './ownerIdentity';
import { normalizeOwnerEmail } from './clientTokens';

type OwnerEnv = {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  PURKINS_MCP_OWNER_EMAIL?: string;
};

/**
 * Management routes require an independently VERIFIED Cloudflare Access JWT
 * for the one configured owner. Existing /admin middleware protection still
 * applies, but a password session alone must never issue MCP credentials.
 *
 * Never trust the unsigned Cf-Access-Jwt-Assertion header or an asserted email
 * without verifying issuer, audience, expiry and the signature.
 */
export async function authorizedMcpOwner(
  accessJwt: string|null,
  env: OwnerEnv,
  verify: typeof verifyAccessJwt = verifyAccessJwt,
): Promise<string|null> {
  const owner=normalizeOwnerEmail(env.PURKINS_MCP_OWNER_EMAIL);
  if(!owner || !accessJwt || !env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) return null;
  try{
    const identity=await verify(accessJwt,{
      teamDomain:env.CF_ACCESS_TEAM_DOMAIN,aud:env.CF_ACCESS_AUD,
    });
    return isApprovedMcpOwner(identity?.email,owner)?owner:null;
  }catch{
    return null;
  }
}
