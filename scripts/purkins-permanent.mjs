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
 *
 * Even deploy is initially UNROUTED (workers_dev=false, preview_urls=false).
 * Human review of Cloudflare Access and first-run Admin is required before
 * any public hostname is enabled. MCP has its own deploy gate later.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, constants,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TARGET, parseAccounts, detectCollisions, renderPermanentConfigs,
  assertUuid, assertApiList,
} from './purkins-permanent-core.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const instanceDir = join(root, '.instances');
const stateFile = join(instanceDir, 'purkins-permanent.json');
const original = join(root, 'wrangler.jsonc');
const generated = join(root, 'wrangler.purkins.permanent.jsonc');
const backup = join(instanceDir, 'wrangler.original.backup.jsonc');
const mcpGenerated = join(root, 'mcp', 'wrangler.jsonc');
const expected = {
  create: 'CREATE-PURKINS-FOREVER',
  migrate: 'MIGRATE-PURKINS-FOREVER',
  deploy: 'DEPLOY-UNROUTED-PURKINS',
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
  if (state.worker !== TARGET.worker || state.db !== TARGET.db || !assertUuid(state.dbId)) {
    fail('Saved permanent instance metadata is incomplete or mismatched.');
  }
  if (!existsSync(generated) || !existsSync(mcpGenerated)) {
    fail('Missing permanent Wrangler config. Do not use generic wrangler.jsonc.');
  }
  // Never run a remote migration against an edited/mis-pointed config:
  // the legacy purkins D1 may already contain unrelated data.
  const storefront = readFileSync(generated, 'utf8');
  const operator = readFileSync(mcpGenerated, 'utf8');
  for (const [label, config, expectedParts] of [
    ['storefront', storefront, [
      '"name": "' + TARGET.worker + '"',
      '"database_name": "' + TARGET.db + '"',
      '"database_id": "' + state.dbId + '"',
      '"bucket_name": "' + TARGET.images + '"',
      '"bucket_name": "' + TARGET.files + '"',
      '"PRELAUNCH_NOINDEX": "true"', '"workers_dev": false', '"preview_urls": false',
    ]],
    ['MCP', operator, [
      '"name": "' + TARGET.mcpWorker + '"',
      '"database_name": "' + TARGET.db + '"',
      '"database_id": "' + state.dbId + '"',
      '"PURKINS_MCP_WRITES_ENABLED": "false"',
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
  if (existsSync(stateFile) || existsSync(generated) || existsSync(mcpGenerated)) {
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
  const mcp = readFileSync(join(root, 'mcp', 'wrangler.template.jsonc'), 'utf8');
  const configs = renderPermanentConfigs(src, mcp, id);
  assertSecretsNotInConfig(configs.storefront);
  mkdirSync(instanceDir, { recursive: true });
  // 'wx' refuses accidental overwrites, including stale unrelated state.
  writeFileSync(generated, configs.storefront, { flag: 'wx', mode: 0o600 });
  writeFileSync(mcpGenerated, configs.mcp, { flag: 'wx', mode: 0o600 });
  writeFileSync(stateFile, JSON.stringify({
    worker: TARGET.worker, mcpWorker: TARGET.mcpWorker,
    db: TARGET.db, dbId: id, images: TARGET.images, files: TARGET.files,
    accountId: account.id, accountName: account.name,
    createdAt: new Date().toISOString(), marker: randomUUID(),
  }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log('Permanent resources created; configurations saved locally and gitignored.');
  console.log('NO Worker deployed, NO remote migrations, NO Access or secrets configured.');
}
function buildForPermanent() {
  ensureSafeLocal();
  readState();
  // Astro consumes the canonical wrangler.jsonc during build. Temporarily use
  // the generated permanent config, restoring the tracked config in finally.
  const diff = spawnSync('git', ['diff', '--quiet', '--', 'wrangler.jsonc'], { cwd: root });
  const staged = spawnSync('git', ['diff', '--cached', '--quiet', '--', 'wrangler.jsonc'], { cwd: root });
  if (diff.status !== 0 || staged.status !== 0) {
    fail('wrangler.jsonc has local/staged changes; commit or revert them before building.');
  }
  copyFileSync(original, backup, constants.COPYFILE_EXCL); // never overwrite another pending recovery.
  try {
    copyFileSync(generated, original);
    runLocal('astro', ['build']);
  } finally {
    copyFileSync(backup, original);
    rmSync(backup, { force: true });
  }
  const output = join(root, 'dist', 'server', 'wrangler.json');
  if (!existsSync(output)) fail('Astro output missing dist/server/wrangler.json');
  const cfg = JSON.parse(readFileSync(output, 'utf8'));
  if (cfg.name !== TARGET.worker || cfg.workers_dev !== false || cfg.preview_urls !== false) {
    fail('Generated Worker is not the isolated, unrouted permanent Purkins Worker.');
  }
  if (cfg.d1_databases?.[0]?.database_id !== readState().dbId) fail('Built D1 binding does not match permanent resource.');
  console.log('Permanent Purkins build verified; tracked wrangler.jsonc restored.');
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
  }, null, 2) + '\n', { mode: 0o600 });
}
function deployUnrouted() {
  requireConfirmation('deploy');
  ensureSafeLocal();
  const state = readState();
  if (state.migrationsApplied !== true) fail('Remote Purkins migrations must complete before deploying. Run migrate first.');
  buildForPermanent();
  console.log('Deploying with workers_dev=false and preview_urls=false (unrouted).');
  runLocal('wrangler', ['deploy', '--config', join(root, 'dist', 'server', 'wrangler.json')]);
  console.log('Deployed UNROUTED. Configure secrets and Access before any public URL.');
}

try {
  if (!['plan', 'create', 'build', 'migrate', 'deploy'].includes(command)) {
    fail('Usage: npm run purkins:cloudflare -- [plan|create|build|migrate|deploy] [--confirm=...]');
  }
  if (command === 'plan') await preflight();
  if (command === 'create') await create();
  if (command === 'build') buildForPermanent();
  if (command === 'migrate') remoteMigrate();
  if (command === 'deploy') deployUnrouted();
} catch (error) {
  console.error('Purkins provisioning stopped:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
