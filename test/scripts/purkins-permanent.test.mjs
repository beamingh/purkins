import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  TARGET, parseAccounts, assertApiList, detectCollisions,
  renderPermanentConfigs, latestMigrationFilename, isMigrationReady,
} from '../../scripts/purkins-permanent-core.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const template = (name) => readFileSync(join(root, name), 'utf8');
const apiPage = (result) => ({ success: true, result });

describe('Permanent Purkins provisioning safety', () => {
  it('uses new permanent resource names, not unverified legacy purkins resources', () => {
    expect(TARGET).toMatchObject({
      worker: 'purkins-storefront',
      db: 'purkins-storefront-db',
      images: 'purkins-storefront-images',
      files: 'purkins-storefront-files',
      adminWorker: 'purkins-admin',
    });
    expect(Object.values(TARGET)).not.toContain('purkins');
    expect(Object.values(TARGET)).not.toContain('purkins-media');
  });

  it('rejects duplicate Worker, D1 or R2 names before creation', () => {
    expect(detectCollisions({
      dbs: [{ name: 'purkins' }],
      buckets: [{ name: 'purkins-media' }],
      workers: [{ name: 'seezambia' }],
    })).toEqual([]);
    expect(detectCollisions({
      dbs: [{ name: 'PURKINS-STOREFRONT-DB' }],
      buckets: [{ name: 'purkins-storefront-files' }],
      workers: [{ name: 'purkins-admin' }],
    })).toEqual([
      'D1: purkins-storefront-db', 'R2: purkins-storefront-files',
      'Worker: purkins-admin',
    ]);
  });

  it('fails closed on unavailable or paginated account/Cloudflare inventories', () => {
    expect(parseAccounts(apiPage([{ id: 'a', name: 'Main account' }]))).toHaveLength(1);
    expect(() => parseAccounts({ result: [] , result_info: { total_count: 2 }})).toThrow(/paginated/);
    expect(() => assertApiList({ result: {} }, 'workers')).toThrow(/invalid/);
    expect(() => assertApiList({ result: { buckets: [], cursor: 'next-page' } }, 'r2')).toThrow(/more pages/);
    expect(assertApiList(apiPage([{ name: 'purkins' }]), 'd1')).toHaveLength(1);
  });

  it('normalizes the actual Cloudflare Workers scripts response and detects a collision', () => {
    // The live Cloudflare GET /workers/scripts API exposes IDs rather than
    // "name", unlike D1 and R2. The preflight must not mistake this for a
    // missing/empty Worker inventory.
    const scripts = assertApiList(apiPage([
      { id: 'seezambia', routes: [] },
      { id: 'purkins-storefront', routes: [] },
    ]), 'workers');
    expect(scripts).toEqual([
      { name: 'seezambia' },
      { name: 'purkins-storefront' },
    ]);
    expect(detectCollisions({ dbs: [], buckets: [], workers: scripts }))
      .toEqual(['Worker: purkins-storefront']);
    expect(() => assertApiList(apiPage([{ routes: [] }]), 'workers'))
      .toThrow(/name missing/);
  });

  it('renders a permanent *unrouted* noindex storefront and separate read-only MCP worker', () => {
    const dbId = '00000000-1234-4000-8000-123456789abc';
    const output = renderPermanentConfigs(
      template('wrangler.template.jsonc'),
      template('wrangler.admin.template.jsonc'),
      dbId,
    );
    expect(output.storefront).toContain('"workers_dev": false');
    expect(output.storefront).toContain('"preview_urls": false');
    expect(output.storefront).toContain('"PRELAUNCH_NOINDEX": "true"');
    expect(output.storefront).toContain('"database_name": "purkins-storefront-db"');
    expect(output.storefront).toContain('"database_id": "' + dbId + '"');
    expect(output.storefront).toContain('"bucket_name": "purkins-storefront-files"');
    expect(output.admin).toContain('"name": "purkins-admin"');
    expect(output.admin).toContain('"PURKINS_MCP_WRITES_ENABLED": "false"');
    expect(output.admin).toContain('"workers_dev": false');
    expect(output.admin).not.toMatch(/__[A-Z_]+__/);
  });

  it('rejects malformed IDs or templates that would expose or index stock', () => {
    const s = template('wrangler.template.jsonc');
    const m = template('wrangler.admin.template.jsonc');
    expect(() => renderPermanentConfigs(s, m, 'garbage')).toThrow(/UUID/);
    expect(() => renderPermanentConfigs(s.replace('"PRELAUNCH_NOINDEX": "true"', '"PRELAUNCH_NOINDEX": "false"'), m, '00000000-1234-4000-8000-123456789abc'))
      .toThrow(/noindex/);
  });

  it('blocks deploy after a new migration is added until the permanent DB is migrated again', () => {
    const latest = latestMigrationFilename([
      '0043_purkins_location_tree.sql', '0045_purkins_mcp_write_guard.sql',
      'notes.md', 'unrelated.txt',
    ]);
    expect(latest).toBe('0045_purkins_mcp_write_guard.sql');
    expect(isMigrationReady({ migrationsApplied: true }, latest)).toBe(false);
    expect(isMigrationReady({ migrationsApplied: true, migratedThrough: '0044_purkins_manual_sales.sql' }, latest)).toBe(false);
    expect(isMigrationReady({ migrationsApplied: false, migratedThrough: latest }, latest)).toBe(false);
    expect(isMigrationReady({ migrationsApplied: true, migratedThrough: latest }, latest)).toBe(true);
    expect(() => latestMigrationFilename(['readme.md'])).toThrow(/No Purkins SQL migration/);
  });

  it('never provisions/migrates/deploys unless an exact confirmation is supplied', () => {
    for (const operation of ['create', 'migrate', 'deploy']) {
      const processResult = spawnSync(process.execPath, [
        join(root, 'scripts', 'purkins-permanent.mjs'), operation,
      ], { cwd: root, encoding: 'utf8' });
      expect(processResult.status).toBe(1);
      expect(processResult.stderr).toContain('--confirm=');
    }
  });
});
