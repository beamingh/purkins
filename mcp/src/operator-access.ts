/**
 * Compatibility re-export for older MCP imports. The canonical allowlist
 * lives within src so Astro's isolated Admin build can resolve it locally.
 */
export { isApprovedMcpOwner } from '../../src/features/mcp/ownerIdentity';
