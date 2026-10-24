import { describe, expect, it } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerLocationTools } from './locations';

function registered(allowWrites: boolean, actor?: string): string[] {
  const names: string[] = [];
  const server = { registerTool(name: string) { names.push(name); } } as unknown as McpServer;
  registerLocationTools(server, {} as never, allowWrites, actor);
  return names;
}

describe('Purkins MCP location write gates', () => {
  it('registers read tools only while write scope is off', () => {
    expect(registered(false, 'owner:bearer')).toEqual([
      'list_purkins_locations', 'get_purkins_location',
    ]);
  });
  it('requires an authenticated actor even when the write scope is enabled', () => {
    expect(registered(true)).toEqual([
      'list_purkins_locations', 'get_purkins_location',
    ]);
    expect(registered(true, '')).toHaveLength(2);
  });
  it('registers guarded mutators only for an authenticated owner scope', () => {
    expect(registered(true, 'owner:bearer')).toEqual([
      'list_purkins_locations', 'get_purkins_location',
      'create_purkins_location', 'move_purkins_location',
    ]);
  });
});
