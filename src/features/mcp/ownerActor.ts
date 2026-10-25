/**
 * Validate the *shape* of an MCP owner actor derived by the authenticated
 * server transport. This is NOT authentication: never accept an actor from an
 * MCP tool argument or unverified request header.
 *
 * The transport authenticates legacy bearer tokens, signed Cloudflare Access
 * JWTs, or owner-issued pmcp_ credentials against D1 on every request.
 * The owner-issued credential's generated UUID is the audit actor suffix.
 */
export function requireVerifiedOwnerActorShape(actor: string): string {
  const valid = Boolean(actor && actor.length <= 254 && (
    actor === 'owner:bearer' ||
    /^owner:access:[^\s@]+@[^\s@]+$/.test(actor) ||
    /^owner:client:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actor)
  ));
  if (!valid) throw new Error('Verified owner identity is required.');
  return actor;
}
