import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const json = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));

describe('Purkins single root npm install with isolated MCP workspace', () => {
  it('keeps the MCP package as a root npm workspace with one lockfile', () => {
    const pkg = json('package.json');
    const mcp = json('mcp/package.json');
    const lock = json('package-lock.json');
    expect(pkg.workspaces).toContain('mcp');
    expect(lock.packages[''].workspaces).toContain('mcp');
    expect(lock.packages.mcp.name).toBe(mcp.name);
    expect(lock.packages['node_modules/' + mcp.name]).toMatchObject({
      resolved: 'mcp',
      link: true,
    });
    expect(existsSync(join(root, 'mcp', 'package-lock.json'))).toBe(false);
  });

  it('preserves MCP dependencies in the workspace-specific lock tree', () => {
    const mcp = json('mcp/package.json');
    const lock = json('package-lock.json');
    for (const [name, range] of Object.entries(mcp.dependencies)) {
      expect(lock.packages.mcp.dependencies[name]).toBe(range);
      expect(lock.packages['mcp/node_modules/' + name]).toBeTruthy();
    }
    expect(lock.packages['mcp/node_modules/agents'].version).toBe('0.30.0');
    expect(lock.packages['mcp/node_modules/@modelcontextprotocol/sdk'].version).toBe('1.32.1');
  });

  it('does not require a separate MCP npm ci from the worker build script', () => {
    const source = readFileSync(join(root, 'scripts', 'build-purkins-workers.mjs'), 'utf8');
    expect(source).toContain('run npm ci at the repository root');
    expect(source).not.toContain('npm ci --prefix mcp');
  });
});
