import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MCP_TOOL_PERMISSIONS,MCP_ALL_TOOLS,MCP_OWNER_READ_TOOLS,
  normalizeMcpToolPermissions,parseStoredMcpPermissions,hasWritePermissions,
} from '../../src/features/mcp/clientScope';
import { filterMcpToolRegistrations } from './tool-filter';

describe('MCP per-connection tool registration',()=>{
  it('catalogs every actual MCP tool exactly once',()=>{
    const sources=[
      './index.ts','./purkins.ts','./purkins-media.ts','./purkins-gallery.ts',
      './locations.ts','./categories.ts','./purkins-publication.ts',
    ];
    const found=new Set<string>();
    for(const path of sources){
      const content=readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8');
      for(const match of content.matchAll(/(?:this\.server|scopedServer|server)\.registerTool\(\s*['"]([^'"]+)/g)) {
        found.add(match[1]!);
      }
    }
    expect(new Set(MCP_ALL_TOOLS).size).toBe(MCP_ALL_TOOLS.length);
    expect([...MCP_ALL_TOOLS].sort()).toEqual([...found].sort());
  });

  it('defaults to the full safe read set, not to a write-capable wildcard',()=>{
    expect(parseStoredMcpPermissions(null)).toEqual(MCP_OWNER_READ_TOOLS);
    expect(hasWritePermissions(MCP_OWNER_READ_TOOLS)).toBe(false);
    expect(MCP_OWNER_READ_TOOLS).toContain('get_purkins_stock');
    expect(MCP_OWNER_READ_TOOLS).not.toContain('approve_purkins_stock');
  });

  it('Full permissions selects every known tool; removing one is exact',()=>{
    expect(normalizeMcpToolPermissions(MCP_ALL_TOOLS)).toEqual(MCP_ALL_TOOLS);
    const withoutPublish=MCP_ALL_TOOLS.filter(x=>x!=='approve_purkins_stock');
    expect(normalizeMcpToolPermissions(withoutPublish)).toEqual(withoutPublish);
    expect(withoutPublish).not.toContain('approve_purkins_stock');
    expect(hasWritePermissions(withoutPublish)).toBe(true);
    expect(MCP_TOOL_PERMISSIONS.filter(t=>t.safety!=='read').length).toBeGreaterThan(0);
  });

  it('unknown, duplicate and corrupt stored grants never authorize new capabilities',()=>{
    expect(normalizeMcpToolPermissions(['invented_operator_action'])).toBeNull();
    expect(normalizeMcpToolPermissions(['list_products','list_products'])).toBeNull();
    expect(parseStoredMcpPermissions('["invented_operator_action"]')).toBeNull();
    expect(parseStoredMcpPermissions('not-json')).toBeNull();
    expect(parseStoredMcpPermissions('{}')).toBeNull();
  });

  it('the MCP handler never bypasses the scoped registerTool proxy',()=>{
    const source=readFileSync(fileURLToPath(new URL('./index.ts',import.meta.url)),'utf8');
    expect(source).toContain('filterMcpToolRegistrations(this.server, this.props?.toolPermissions)');
    expect(source).not.toMatch(/this\.server\.registerTool\s*\(/);
    for (const helper of [
      'registerPurkinsTools','registerGuardedPurkinsStockTools','registerGuardedClothingIntakeTools',
      'registerPurkinsMediaTools','registerGuardedPurkinsGalleryTools',
      'registerLocationTools','registerCategoryTools','registerGuardedPublicationTools',
    ]) {
      expect(source).toContain(helper);
    }
  });

  it('registration proxy hides unselected tools from the MCP registry',()=>{
    const seen:string[]=[];
    const mock={
      registerTool(name:string){seen.push(name);return {name};},
      unrelated(){return 'works';},
    };
    const scoped=filterMcpToolRegistrations(mock,['get_purkins_stock','create_guarded_purkins_draft']);
    scoped.registerTool('get_purkins_stock');
    scoped.registerTool('create_guarded_purkins_draft');
    scoped.registerTool('fulfill_order');
    scoped.registerTool('approve_purkins_stock');
    expect(seen).toEqual(['get_purkins_stock','create_guarded_purkins_draft']);
    expect(scoped.unrelated()).toBe('works');
    expect(filterMcpToolRegistrations(mock,undefined)).toBe(mock);
  });
});
