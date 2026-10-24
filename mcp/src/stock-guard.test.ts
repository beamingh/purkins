import { describe, expect, it } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGuardedPurkinsStockTools } from './purkins';

function toolNames(allowed: boolean, actor?: string) {
  const seen: string[] = [];
  const server = { registerTool(name: string) { seen.push(name); } } as unknown as McpServer;
  registerGuardedPurkinsStockTools(server, {} as never, allowed, actor);
  return seen;
}
describe('MCP guarded stock tool authorization', () => {
  it('does not register stock mutations when the scope is off', () => {
    expect(toolNames(false, 'owner:bearer')).toEqual([]);
  });
  it('does not register stock mutations without a verified owner actor', () => {
    expect(toolNames(true)).toEqual([]);
    expect(toolNames(true, '')).toEqual([]);
  });
  it('registers private draft and counted-stock tools for explicitly authorized owners only', () => {
    expect(toolNames(true, 'owner:access:owner@example.com')).toEqual([
      'create_guarded_purkins_draft', 'adjust_guarded_purkins_stock',
    ]);
  });
});
