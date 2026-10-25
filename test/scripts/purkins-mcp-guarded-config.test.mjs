import {describe,expect,it} from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { configureGuardedMcpWrites,configurePublicationMcpWrite } from '../../scripts/purkins-mcp-guarded-config.mjs';

const fixture=`{
  "vars":{
    "STORE_NAME": "Purkins",
    "PURKINS_MCP_WRITES_ENABLED": "true",
    "PURKINS_MCP_LEGACY_WRITES_ENABLED": "false"
  }
}`;
const flagNames=[
  'PURKINS_MCP_STOCK_WRITES_ENABLED',
  'PURKINS_MCP_CLOTHING_WRITES_ENABLED',
  'PURKINS_MCP_LOCATION_WRITES_ENABLED',
  'PURKINS_MCP_GALLERY_WRITES_ENABLED',
];

describe('permanent Purkins guarded MCP config',()=>{
  it('upgrades an existing old Admin config with the canonical storefront URL and guarded scopes',()=>{
    const config=JSON.parse(configureGuardedMcpWrites(fixture));
    expect(config.vars.STOREFRONT_URL).toBe('https://purkins.ulwimbo.com');
    expect(config.vars.PURKINS_MCP_WRITES_ENABLED).toBe('true');
    expect(config.vars.PURKINS_MCP_LEGACY_WRITES_ENABLED).toBe('false');
    for(const name of flagNames)expect(config.vars[name]).toBe('true');
  });
  it('upgrades a pre-scope Admin config whose global flag is the final vars entry with no comma',()=>{
    const olderAdmin = [
      '{',
      '  "name": "purkins-admin",',
      '  "vars": {',
      '    "STORE_NAME": "Purkins",',
      '    "PURKINS_MCP_WRITES_ENABLED": "true"',
      '  },',
      '  "workers_dev": false',
      '}',
    ].join('\n');
    const upgraded = configureGuardedMcpWrites(olderAdmin);
    const vars = JSON.parse(upgraded).vars;
    expect(vars.STOREFRONT_URL).toBe('https://purkins.ulwimbo.com');
    expect(vars.PURKINS_MCP_WRITES_ENABLED).toBe('true');
    expect(vars.PURKINS_MCP_LEGACY_WRITES_ENABLED).toBe('false');
    for(const name of flagNames)expect(vars[name]).toBe('true');
    expect(configureGuardedMcpWrites(upgraded)).toBe(upgraded);
  });
  it('handles modern generated JSONC and keeps writes opt-in',()=>{
    const src=readFileSync(fileURLToPath(new URL('../../wrangler.admin.template.jsonc',import.meta.url)),'utf8');
    expect(src).toContain('"STOREFRONT_URL": "https://purkins.ulwimbo.com"');
    const prepared=src.replace('"PURKINS_MCP_WRITES_ENABLED": "false"','"PURKINS_MCP_WRITES_ENABLED": "true"');
    const output=configureGuardedMcpWrites(prepared);
    expect(output).toContain('"PURKINS_MCP_STOCK_WRITES_ENABLED": "true"');
    expect(output).toContain('"PURKINS_MCP_CLOTHING_WRITES_ENABLED": "true"');
    expect(output).toContain('"PURKINS_MCP_LOCATION_WRITES_ENABLED": "true"');
    expect(output).toContain('"PURKINS_MCP_GALLERY_WRITES_ENABLED": "true"');
    expect(output).toContain('"PURKINS_MCP_LEGACY_WRITES_ENABLED": "false"');
  });
  it('is idempotent and rejects duplicate, wrong-origin or unsafe legacy settings',()=>{
    const once=configureGuardedMcpWrites(fixture);
    expect(configureGuardedMcpWrites(once)).toBe(once);
    expect(()=>configureGuardedMcpWrites(fixture.replace('"true"','"false"'))).toThrow(/global/);
    expect(()=>configureGuardedMcpWrites(fixture.replace(
      '"PURKINS_MCP_LEGACY_WRITES_ENABLED": "false"',
      '"PURKINS_MCP_LEGACY_WRITES_ENABLED": "true"'))).toThrow(/PURKINS_MCP_LEGACY_WRITES_ENABLED/);
    expect(()=>configureGuardedMcpWrites(fixture.replace(
      '"STORE_NAME": "Purkins",','"STORE_NAME": "Purkins", "STOREFRONT_URL": "https://attacker.test",'))).toThrow(/STOREFRONT_URL/);
    expect(()=>configureGuardedMcpWrites(fixture.replace(
      '"PURKINS_MCP_LEGACY_WRITES_ENABLED": "false"',
      '"PURKINS_MCP_LEGACY_WRITES_ENABLED": "false", "PURKINS_MCP_LEGACY_WRITES_ENABLED": "false"'))).toThrow(/Duplicate/);
  });
  it('never enables publication with normal MCP writes and independently toggles publication',()=>{
    const normal=configureGuardedMcpWrites(fixture);
    expect(normal).not.toContain('"PURKINS_MCP_PUBLICATION_WRITES_ENABLED": "true"');
    const enabled=configurePublicationMcpWrite(normal,true);
    expect(JSON.parse(enabled).vars.PURKINS_MCP_PUBLICATION_WRITES_ENABLED).toBe('true');
    expect(configurePublicationMcpWrite(enabled,true)).toBe(enabled);
    const disabled=configurePublicationMcpWrite(enabled,false);
    expect(JSON.parse(disabled).vars.PURKINS_MCP_PUBLICATION_WRITES_ENABLED).toBe('false');
    expect(()=>configurePublicationMcpWrite(fixture.replace('"true"','"false"'),true))
      .toThrow(/Global MCP writes/);
    const permanent=readFileSync(fileURLToPath(new URL('../../scripts/purkins-permanent.mjs',import.meta.url)),'utf8');
    expect(permanent).toContain("mcp-publication-on");
    expect(permanent).toContain("ENABLE-PURKINS-MCP-PUBLICATION");
  });
  it('has an explicit guarded local activation path, not any remote auto-enable',()=>{
    const s=readFileSync(fileURLToPath(new URL('../../scripts/purkins-permanent.mjs',import.meta.url)),'utf8');
    expect(s).toContain('configureGuardedMcpWrites(nextConfig)');
    expect(s).toContain('requireConfirmation(enabled ?');
    expect(s).toContain("No remote change. Run the separately confirmed build/deploy");
  });
});
