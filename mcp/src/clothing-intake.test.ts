import { describe, expect, it } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGuardedClothingIntakeTools } from './purkins';

function names(allowed: boolean, actor?: string) {
  const items: string[]=[];
  const server={registerTool(name: string) {items.push(name);}} as unknown as McpServer;
  registerGuardedClothingIntakeTools(server,{} as never,allowed,actor);
  return items;
}
describe('Private clothing intake MCP tool registration', () => {
  it('does not allow buyer or read-only sessions to mutate stock', () => {
    expect(names(false,'owner:bearer')).toEqual([]);
    expect(names(false)).toEqual([]);
  });
  it('requires verified owner context in addition to the clothing write scope', () => {
    expect(names(true)).toEqual([]);
    expect(names(true,'')).toEqual([]);
  });
  it('registers one bounded, draft-only bulk intake tool when both conditions hold', () => {
    expect(names(true,'owner:access:owner@example.com')).toEqual([
      'bulk_create_guarded_clothing_drafts',
    ]);
  });
});
