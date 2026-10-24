/**
 * Extra, mandatory owner allowlist after Cloudflare Access JWT signature,
 * issuer, audience and expiry have been checked. A valid Access session is
 * not sufficient by itself to grant the Purkins MCP operator tier.
 *
 * Deliberately fail closed when the secret is unset or empty.
 */
export function isApprovedMcpOwner(identityEmail: string | null | undefined, configuredOwnerEmail: string | null | undefined): boolean {
  const allowed = configuredOwnerEmail?.trim().toLowerCase();
  const asserted = identityEmail?.trim().toLowerCase();
  return Boolean(allowed && asserted && allowed === asserted);
}
