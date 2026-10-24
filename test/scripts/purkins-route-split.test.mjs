import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeBelongsToWorker, prepareWorkerSource } from '../../scripts/purkins-route-split.mjs';

describe('Purkins route-level Worker isolation', () => {
  it('passes Windows-safe filesystem strings, not URL objects, to Astro srcDir/outDir', () => {
    const config = readFileSync(new URL('../../astro.config.mjs', import.meta.url), 'utf8');
    expect(config).toContain('fileURLToPath(new URL(`./.instances/split-build/');
    expect(config).toContain('fileURLToPath(new URL(`./dist/');
    expect(config).toContain('srcDir: splitSrc');
    expect(config).toContain('outDir: splitOutput');
    // The theme stamp must also use a filesystem path after srcDir/outDir
    // are changed from URL objects to strings.
    expect(config).toContain("join(stampDir, 'theme.json')");
  });

  it('keeps MCP-only bindings optional for the shared public Worker environment', () => {
    const declaration = readFileSync(new URL('../../src/env.d.ts', import.meta.url), 'utf8');
    const optionalMcpBindings = ['MCP_TOKEN?', 'STOREFRONT_URL?', 'STORE_MCP?'];
    for (const binding of optionalMcpBindings) {
      expect(declaration).toContain(binding);
    }
    expect(declaration).not.toContain('MCP_TOKEN: string;');
    expect(declaration).not.toContain('STORE_MCP: DurableObjectNamespace;');
  });

  it('never bundles private management endpoints into the public Worker', () => {
    for (const path of [
      'admin', 'admin/stock-intake.astro', 'admin/locations.astro',
      'api/admin', 'api/admin/products/[id].ts', 'api/admin/locations.ts',
    ]) {
      expect(routeBelongsToWorker('public', path)).toBe(false);
      expect(routeBelongsToWorker('admin', path)).toBe(true);
    }
  });

  it('keeps storefront, order and payment endpoints out of Admin+MCP', () => {
    for (const path of [
      'products/index.astro', 'api/products/[slug].ts',
      'api/cart.ts', 'api/checkout.ts', 'api/webhook.ts',
      'api/webhook/[provider].ts', 'order/[token]/status.ts',
      'robots.txt.ts', 'sitemap.xml.ts', 'index.astro',
    ]) {
      expect(routeBelongsToWorker('public', path)).toBe(true);
      expect(routeBelongsToWorker('admin', path)).toBe(false);
    }
    for (const path of ['404.astro', 'images/[...key].ts', 'api/health.ts']) {
      expect(routeBelongsToWorker('admin', path)).toBe(true);
    }
  });

  it('actually removes forbidden files from the generated Astro srcDir', () => {
    const temp = mkdtempSync(join(tmpdir(), 'purkins-workers-'));
    const mockFiles = [
      'pages/index.astro',
      'pages/admin/index.astro',
      'pages/admin/stock-intake.astro',
      'pages/api/admin/products.ts',
      'pages/api/checkout.ts',
      'pages/api/webhook.ts',
      'pages/images/[...key].ts',
      'pages/api/health.ts',
      'features/purkins/db.ts',
    ];
    try {
      writeFileSync(join(temp, 'seed-demo.sql'), '-- sample seed for test only');
      for (const file of mockFiles) {
        const full = join(temp, 'src', file);
        mkdirSync(full.slice(0, full.lastIndexOf(requireSeparator())), { recursive: true });
        writeFileSync(full, '// mock');
      }
      const publicRoot = prepareWorkerSource(temp, 'public');
      const adminRoot = prepareWorkerSource(temp, 'admin');
      expect(existsSync(join(publicRoot, 'pages', 'admin'))).toBe(false);
      expect(existsSync(join(publicRoot, 'pages', 'api', 'admin'))).toBe(false);
      expect(existsSync(join(publicRoot, 'pages', 'api', 'checkout.ts'))).toBe(true);
      expect(existsSync(join(adminRoot, 'pages', 'api', 'checkout.ts'))).toBe(false);
      expect(existsSync(join(adminRoot, 'pages', 'api', 'webhook.ts'))).toBe(false);
      expect(existsSync(join(adminRoot, 'pages', 'admin', 'stock-intake.astro'))).toBe(true);
      expect(existsSync(join(adminRoot, 'pages', 'api', 'admin', 'products.ts'))).toBe(true);
      expect(existsSync(join(adminRoot, 'pages', 'images', '[...key].ts'))).toBe(true);
      expect(existsSync(join(adminRoot, 'features', 'purkins', 'db.ts'))).toBe(true);
      expect(existsSync(join(temp, '.instances', 'split-build', 'admin', 'seed-demo.sql'))).toBe(true);
      expect(existsSync(join(temp, '.instances', 'split-build', 'public', 'seed-demo.sql'))).toBe(true);
      expect(readFileSync(join(publicRoot, 'features', 'runtime', 'worker-target.ts'), 'utf8'))
        .toBe('export const HAS_LOCAL_ADMIN_ROUTES = false;\n');
      expect(readFileSync(join(adminRoot, 'features', 'runtime', 'worker-target.ts'), 'utf8'))
        .toBe('export const HAS_LOCAL_ADMIN_ROUTES = true;\n');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('keeps first-run redirect only when Admin routes exist on the same Worker', () => {
    const middleware = readFileSync(new URL('../../src/middleware.ts', import.meta.url), 'utf8');
    const monolithic = readFileSync(new URL('../../src/features/runtime/worker-target.ts', import.meta.url), 'utf8');
    expect(middleware).toContain('HAS_LOCAL_ADMIN_ROUTES &&');
    expect(middleware).toContain("return context.redirect('/admin/setup', 302)");
    expect(monolithic).toContain('HAS_LOCAL_ADMIN_ROUTES = true');
  });

  it('public Worker rejects Admin and MCP even if a build accidentally included the routes', () => {
    const publicWorker = readFileSync(new URL('../../src/worker.ts', import.meta.url), 'utf8');
    const adminWorker = readFileSync(new URL('../../src/admin-worker.ts', import.meta.url), 'utf8');
    expect(publicWorker).toContain("path.startsWith('/api/admin/')");
    expect(publicWorker).toContain("path.startsWith('/mcp/')");
    expect(adminWorker).toContain("pathname.startsWith('/api/admin/')");
    expect(adminWorker).toContain("pathname.startsWith('/mcp/')");
    expect(adminWorker).toContain("if (!request.headers.get('Authorization'))");
  });
});
function requireSeparator() {
  return process.platform === 'win32' ? '\\' : '/';
}
