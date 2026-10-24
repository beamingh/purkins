#!/usr/bin/env node
/**
 * One durable Purkins installation, prelaunch -> production.
 *
 * PLAN IS THE DEFAULT. No mutation without both a named command and a
 * matching confirmation string. Requires Node >=22, installed Wrangler,
 * existing Wrangler authentication and a single authorized account (or
 * explicit CLOUDFLARE_ACCOUNT_ID). Never reads/writes legacy purkins resources.
 *
 *   npm run purkins:cloudflare                       # read-only preflight
 *   npm run purkins:cloudflare -- create --confirm=CREATE-PURKINS-FOREVER
 *   npm run purkins:cloudflare -- build              # local build only
 *   npm run purkins:cloudflare -- migrate --confirm=MIGRATE-PURKINS-FOREVER
 *   npm run purkins:cloudflare -- deploy --confirm=DEPLOY-UNROUTED-PURKINS
 *   npm run purkins:cloudflare -- mcp-writes-on --confirm=ENABLE-PURKINS-MCP-WRITES
 *   npm run purkins:cloudflare -- mcp-writes-off --confirm=DISABLE-PURKINS-MCP-WRITES
 *
 * New installations initially have no public route (workers_dev=false,
 * preview_urls=false). Existing Purkins Workers may already have active
 * custom domains assigned through Cloudflare. Deploy updates the Worker code
 * served on those domains; this script neither configures nor removes them.
 * MCP authentication and write scopes have their own release gates.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TARGET, parseAccounts, detectCollisions, renderPermanentConfigs,
  assertUuid, assertApiList, latestMigrationFilename, isMigrationReady,
} from './purkins-permanent-core.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const instanceDir = join(root, '.instances');
const stateFile = join(instanceDir, 'purkins-permanent.json');
const generated = join(root, 'wrangler.purkins.permanent.jsonc');
const backup = join(instanceDir, 'wrangler.original.backup.jsonc');
const adminGenerated = join(root, 'wrangler.admin.permanent.jsonc');
const latestMigration = () => latestMigrationFilename(readdirSync(join(root, 'migrations')));
const expected = {
  create: 'CREATE-PURKINS-FOREVER',
  migrate: 'MIGRATE-PURKINS-FOREVER',
  deploy: 'DEPLOY-UNROUTED-PURKINS',
  'mcp-writes-on': 'ENABLE-PURKINS-MCP-WRITES',
  'mcp-writes-off': 'DISABLE-PURKINS-MCP-WRITES',
};
const command = process.argv[2] || 'plan';
const confirm = process.argv.slice(3).find((arg) => arg.startsWith('--confirm='))?.slice(10) ?? '';

function fail(message) {
  throw new Error(message);
}
function runLocal(bin, args, opts = {}) {
  const binary = join(root, 'node_modules', bin, 'bin',
    bin === 'astro' ? 'astro.mjs' : 'wrangler.js');
  if (!existsSync(binary)) fail('Dependencies missing: run npm ci first.');
  const result = spawnSync(process.execPath, [binary, ...args], {
    cwd: root, encoding: 'utf8', stdio: opts.stdio ?? 'inherit',
    env: { ...process.env, CI: '1' }, input: opts.input,
  });
  if (result.error || result.status !== 0) fail(
    bin + ' ' + args[0] + ' failed; see Wrangler output above.',
  );
  return result.stdout ?? '';
}
function requireConfirmation(action) {
  if (confirm !== expected[action]) {
    fail('This action changes PERMANENT remote infrastructure. Rerun with --confirm=' + expected[action]);
  }
}
function ensureSafeLocal() {
  if (existsSync(backup)) fail(
    'Unrestored Wrangler backup exists. Inspect .instances/wrangler.original.backup.jsonc before continuing.',
  );
}
function readState() {
  if (!existsSync(stateFile)) fail('No provisioned permanent instance. Run plan, then create first.');
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  if (state.worker !== TARGET.worker || state.adminWorker !== TARGET.adminWorker || state.db !== TARGET.db || !assertUuid(state.dbId)) {
    fail('Saved permanent instance metadata is incomplete or mismatched.');
  }
  if (!existsSync(generated) || !existsSync(adminGenerated)) {
    fail('Missing permanent Wrangler config. Do not use generic wrangler.jsonc.');
  }
  // Never run a remote migration against an edited/mis-pointed config:
  // the legacy purkins D1 may already contain unrelated data.
  const storefront = readFileSync(generated, 'utf8');
  const operator = readFileSync(adminGenerated, 'utf8');
  for (const [label, config, expectedParts] of [
    ['storefront', storefront, [
      '"name": "' + TARGET.worker + '"',
      '"database_name": "' + TARGET.db + '"',
      '"database_id": "' + state.dbId + '"',
      '"bucket_name": "' + TARGET.images + '"',
      '"bucket_name": "' + TARGET.files + '"',
      '"PRELAUNCH_NOINDEX": "true"', '"workers_dev": false', '"preview_urls": false',
    ]],
    ['Admin+MCP', operator, [
      '"name": "' + TARGET.adminWorker + '"',
      '"database_name": "' + TARGET.db + '"',
      '"database_id": "' + state.dbId + '"',
      '"PURKINS_MCP_WRITES_ENABLED": "' + (state.mcpWritesEnabled === true ? 'true' : 'false') + '"',
      '"PRELAUNCH_NOINDEX": "true"',
      '"bucket_name": "' + TARGET.images + '"',
      '"bucket_name": "' + TARGET.files + '"',
      '"workers_dev": false', '"preview_urls": false',
    ]],
  ]) {
    if (expectedParts.some((part) => !config.includes(part))) {
      fail('Permanent ' + label + ' config does not match created resources or has unsafe public settings.');
    }
  }
  return state;
}
function assertSecretsNotInConfig(text) {
  if (!text.includes('"PRELAUNCH_NOINDEX": "true"') ||
      !text.includes('"workers_dev": false') ||
      !text.includes('"preview_urls": false')) {
    fail('Permanent config must be unindexed and inaccessible on default Worker URLs.');
  }
}

function authToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  // Wrangler can return an OAuth session token without the user copying one.
  // Treat this as a secret: capture only in memory and never echo stdout.
  const value = runLocal('wrangler', ['auth', 'token', '--json'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let data;
  try { data = JSON.parse(value); } catch { fail('Wrangler auth token did not return JSON. Log in with npx wrangler login.'); }
  if (!['oauth', 'api_token'].includes(data.type) || typeof data.token !== 'string' || !data.token) {
    fail('Wrangler authentication is not a supported bearer-token session.');
  }
  return data.token;
}
function makeClient(token) {
  return async function api(method, path, body) {
    const res = await fetch('https://api.cloudflare.com/client/v4' + path, {
      method,
      headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.success !== true) {
      const reason = data?.errors?.map((e) => e.message).join('; ') || 'API request failed';
      fail('Cloudflare ' + method + ' ' + path.split('?')[0] + ' failed (' + res.status + '): ' + reason);
    }
    return data;
  };
}
async function preflight() {
  const api = makeClient(authToken());
  const accounts = parseAccounts(await api('GET', '/accounts?per_page=100'));
  const requested = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
  const account = requested
    ? accounts.find((a) => a.id === requested)
    : accounts.length === 1 ? accounts[0] : null;
  if (!account) fail('Choose one authorized Cloudflare account using CLOUDFLARE_ACCOUNT_ID. No changes made.');
  const aid = encodeURIComponent(account.id);
  const [dbPage, bucketPage, workerPage] = await Promise.all([
    api('GET', '/accounts/' + aid + '/d1/database?per_page=1000&page=1'),
    api('GET', '/accounts/' + aid + '/r2/buckets?per_page=1000'),
    api('GET', '/accounts/' + aid + '/workers/scripts'),
  ]);
  const dbs = assertApiList(dbPage, 'd1');
  const buckets = assertApiList(bucketPage, 'r2');
  const workers = assertApiList(workerPage, 'workers');
  const collisions = detectCollisions({ dbs, buckets, workers });
  console.log('Cloudflare account:', account.name);
  console.log('Permanent target names:', JSON.stringify(TARGET, null, 2));
  console.log(collisions.length
    ? 'COLLISIONS: ' + collisions.join(', ') + ' — will not claim existing resources.'
    : 'All permanent target names currently unoccupied.');
  return { api, account, collisions };
}
async function create() {
  requireConfirmation('create');
  ensureSafeLocal();
  if (existsSync(stateFile) || existsSync(generated) || existsSync(adminGenerated)) {
    fail('Provisioning metadata/config already exists. Never run first-time creation twice.');
  }
  const { api, account, collisions } = await preflight();
  if (collisions.length) fail('Collision detected. No resources created.');
  const path = '/accounts/' + encodeURIComponent(account.id);
  console.log('Creating permanent Purkins D1 and two R2 buckets. Partial failures need manual reconciliation.');
  // Do not delete any resource on failure: the identity/history may now matter.
  const createdDb = await api('POST', path + '/d1/database', { name: TARGET.db });
  const id = createdDb.result?.uuid;
  if (!assertUuid(id)) fail('D1 created, but database UUID was missing. STOP; inspect Cloudflare and reconcile manually.');
  await api('POST', path + '/r2/buckets', { name: TARGET.images });
  await api('POST', path + '/r2/buckets', { name: TARGET.files });

  const src = readFileSync(join(root, 'wrangler.template.jsonc'), 'utf8');
  const admin = readFileSync(join(root, 'wrangler.admin.template.jsonc'), 'utf8');
  const configs = renderPermanentConfigs(src, admin, id);
  assertSecretsNotInConfig(configs.storefront);
  mkdirSync(instanceDir, { recursive: true });
  // 'wx' refuses accidental overwrites, including stale unrelated state.
  writeFileSync(generated, configs.storefront, { flag: 'wx', mode: 0o600 });
  writeFileSync(adminGenerated, configs.admin, { flag: 'wx', mode: 0o600 });
  writeFileSync(stateFile, JSON.stringify({
    worker: TARGET.worker, adminWorker: TARGET.adminWorker,
    db: TARGET.db, dbId: id, images: TARGET.images, files: TARGET.files,
    accountId: account.id, accountName: account.name,
    createdAt: new Date().toISOString(), marker: randomUUID(),
  }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log('Permanent resources created; configurations saved locally and gitignored.');
  console.log('NO Workers deployed, NO remote migrations, NO Access or secrets configured.');
}
function buildForPermanent() {
  ensureSafeLocal();
  const state = readState();
  // Builds *both* route-filtered Astro bundles, swapping/restoring the tracked
  // config safely. Never deploy the old monolithic `dist/server/wrangler.json`.
  const runner = join(root, 'scripts', 'build-purkins-workers.mjs');
  const result = spawnSync(process.execPath, [runner, '--permanent'], {
    cwd: root, stdio: 'inherit', env: process.env,
  });
  if (result.error || result.status !== 0) {
    fail('The two-Worker build failed; no remote change was made.');
  }
  for (const [label, name] of [['public', TARGET.worker], ['admin', TARGET.adminWorker]]) {
    const output = join(root, 'dist', label, 'server', 'wrangler.json');
    if (!existsSync(output)) fail('Missing ' + label + ' compiled Worker configuration.');
    const cfg = JSON.parse(readFileSync(output, 'utf8'));
    if (cfg.name !== name || cfg.workers_dev !== false ||
        cfg.preview_urls !== false || cfg.d1_databases?.[0]?.database_id !== state.dbId) {
      fail('Unsafe generated ' + label + ' Worker binding or route settings.');
    }
  }
  console.log('Public and Admin+MCP bundles verified against the single permanent D1.');
}
/**
 * A separate, explicit LOCAL approval to include operator write tools in the
 * NEXT Admin Worker build/deploy. Does not change Cloudflare until deploy is
 * separately confirmed. Can be reversed without editing any tracked config.
 * MCP_TOKEN (or verified Access OAuth) is still required per request.
 */
function setMcpWrites(enabled) {
  requireConfirmation(enabled ? 'mcp-writes-on' : 'mcp-writes-off');
  ensureSafeLocal();
  const state = readState();
  if (enabled && !isMigrationReady(state, latestMigration())) {
    fail('Permanent D1 migration record is out of date. Apply the current migration set first.');
  }
  const current = readFileSync(adminGenerated, 'utf8');
  const previous = state.mcpWritesEnabled === true ? 'true' : 'false';
  const from = '"PURKINS_MCP_WRITES_ENABLED": "' + previous + '"';
  const to = '"PURKINS_MCP_WRITES_ENABLED": "' + (enabled ? 'true' : 'false') + '"';
  if (!current.includes(from)) fail('Permanent Admin write switch was not found in expected state.');
  const nextConfig = current.replace(from, to);
  writeFileSync(adminGenerated, nextConfig, { mode: 0o600 });
  try {
    writeFileSync(stateFile, JSON.stringify({
      ...state, mcpWritesEnabled: enabled,
      mcpWriteSwitchUpdatedAt: new Date().toISOString(),
    }, null, 2) + '\n', { mode: 0o600 });
  } catch (error) {
    writeFileSync(adminGenerated, current, { mode: 0o600 });
    throw error;
  }
  console.log('Local Admin MCP writes:', enabled ? 'ON' : 'OFF');
  console.log('No remote change. Run the separately confirmed build/deploy to apply it.');
}

function remoteMigrate() {
  requireConfirmation('migrate');
  ensureSafeLocal();
  readState();
  console.log('Applying migrations to PERMANENT Purkins D1, not any other database.');
  runLocal('wrangler', ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', generated]);
  const state = readState();
  writeFileSync(stateFile, JSON.stringify({
    ...state, migrationsApplied: true, migratedAt: new Date().toISOString(),
    migratedThrough: latestMigration(),
  }, null, 2) + '\n', { mode: 0o600 });
}
function deployPermanentWorkers() {
  requireConfirmation('deploy');
  ensureSafeLocal();
  const state = readState();
  if (!isMigrationReady(state, latestMigration())) {
    fail('Remote Purkins migration record does not cover the latest SQL migration. Run migrate first.');
  }
  buildForPermanent();
  console.log('Updating BOTH permanent Workers (workers.dev and preview URLs remain disabled).');
  for (const target of ['public', 'admin']) {
    runLocal('wrangler', ['deploy', '--config', join(root, 'dist', target, 'server', 'wrangler.json')]);
  }
  console.log('Both Workers deployed. Existing Cloudflare-managed custom domains remain live; this script did not add or remove routes.');
}

try {
  if (!['plan', 'create', 'build', 'migrate', 'deploy', 'mcp-writes-on', 'mcp-writes-off'].includes(command)) {
    fail('Usage: npm run purkins:cloudflare -- [plan|create|build|migrate|deploy|mcp-writes-on|mcp-writes-off] [--confirm=...]');
  }
  if (command === 'plan') await preflight();
  if (command === 'create') await create();
  if (command === 'build') buildForPermanent();
  if (command === 'migrate') remoteMigrate();
  if (command === 'deploy') deployPermanentWorkers();
  if (command === 'mcp-writes-on') setMcpWrites(true);
  if (command === 'mcp-writes-off') setMcpWrites(false);
} catch (error) {
  console.error('Purkins provisioning stopped:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
