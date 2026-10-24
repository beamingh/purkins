import { describe,expect,it } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGuardedPurkinsGalleryTools } from './purkins-gallery';

function registered(writes:boolean, actor?:string):string[] {
  const out:string[]=[];
  const server={registerTool(name:string){out.push(name);}} as unknown as McpServer;
  registerGuardedPurkinsGalleryTools(server,{} as never,writes,actor);
  return out;
}
describe('Private Purkins MCP gallery tool scopes',()=>{
  it('always offers owner-only read-only review within the operator tier',()=>{
    expect(registered(false)).toEqual(['review_purkins_draft']);
    expect(registered(false,'owner:bearer')).toEqual(['review_purkins_draft']);
  });
  it('does not expose gallery mutations without verified operator actor',()=>{
    expect(registered(true)).toEqual(['review_purkins_draft']);
    expect(registered(true,'')).toEqual(['review_purkins_draft']);
  });
  it('exposes only the guarded photo tools to an owner with the explicit gallery flag',()=>{
    expect(registered(true,'owner:access:owner@example.com')).toEqual([
      'review_purkins_draft',
      'attach_guarded_purkins_photo',
      'set_guarded_purkins_photo_alt',
      'make_guarded_purkins_photo_primary',
    ]);
  });
});
