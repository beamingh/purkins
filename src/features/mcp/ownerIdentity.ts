/** Owner-only MCP identity allowlist shared by the MCP handler and Admin UI.
 *
 * Must live under src/: Purkins isolates Astro Admin routes into a copied src
 * tree when building the Admin Worker. Importing into ../../../mcp/src from
 * those copied routes resolves outside the bundle and breaks production builds.
 *
 * Call only AFTER verifying the Access JWT signature, issuer, audience and
 * expiry. Email matching alone does not authenticate a request.
 */
export function isApprovedMcpOwner(
  identityEmail: string | null | undefined,
  configuredOwnerEmail: string | null | undefined,
): boolean {
  const allowed = configuredOwnerEmail?.trim().toLowerCase();
  const asserted = identityEmail?.trim().toLowerCase();
  return Boolean(allowed && asserted && allowed === asserted);
}
