#!/usr/bin/env node
/**
 * Build two genuine Astro route bundles from one Purkins repository:
 *   dist/public  (no /admin, /api/admin, /mcp)
 *   dist/admin   (no public checkout/webhooks/product catalog)
 *
 * Reads permanent instance configurations only with --permanent; otherwise
 * renders unrouteable LOCAL probe configs. NO remote Cloudflare mutations.
 * Restores root wrangler.jsonc even on build failure.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync, readFileSync, writeFileSync, copyFileSync,
  mkdirSync, rmSync, constants,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeThemeArtifacts } from './theme-css.mjs';
import { prepareWorkerSource } from './purkins-route-split.mjs';
import { renderPermanentConfigs, TARGET, assertUuid } from './purkins-permanent-core.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--permanent')) {
  throw new Error('Only supported argument: --permanent');
}
const permanent = args.includes('--permanent');
const original = join(root, 'wrangler.jsonc');
const backup = join(root, '.instances', 'split-build', 'wrangler.original.jsonc');
const astro = join(root, 'node_modules', 'astro', 'bin', 'astro.mjs');
if (!existsSync(astro)) throw new Error('Run npm ci first.');
if (!existsSync(join(root, 'mcp', 'node_modules', 'agents'))) {
  throw new Error('Admin+MCP build requires npm ci --prefix mcp.');
}
if (existsSync(backup)) {
  throw new Error('Unrecovered Wrangler backup exists: .instances/split-build/wrangler.original.jsonc');
}

const workingTree = [
  ['diff', '--quiet', '--', 'wrangler.jsonc'],
  ['diff', '--cached', '--quiet', '--', 'wrangler.jsonc'],
];
for (const args of workingTree) {
  const status = spawnSync('git', args, { cwd: root });
  if (status.status !== 0) {
    throw new Error('wrangler.jsonc has local/staged changes; refuse to swap the tracked config.');
  }
}

let configs;
if (permanent) {
  const stateFile = join(root, '.instances', 'purkins-permanent.json');
  if (!existsSync(stateFile)) throw new Error('Permanent instance has not been provisioned.');
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  if (!assertUuid(state.dbId) || state.worker !== TARGET.worker ||
      state.adminWorker !== TARGET.adminWorker) {
    throw new Error('Unexpected permanent instance identity.');
  }
  configs = {
    storefront: readFileSync(join(root, 'wrangler.purkins.permanent.jsonc'), 'utf8'),
    admin: readFileSync(join(root, 'wrangler.admin.permanent.jsonc'), 'utf8'),
  };
  if (!configs.storefront.includes(state.dbId) || !configs.admin.includes(state.dbId)) {
    throw new Error('Permanent D1 bindings do not match the saved instance.');
  }
} else {
  configs = renderPermanentConfigs(
    readFileSync(join(root, 'wrangler.template.jsonc'), 'utf8'),
    readFileSync(join(root, 'wrangler.admin.template.jsonc'), 'utf8'),
    '00000000-0000-4000-8000-000000000000',
  );
}
for (const [target, content] of [
  ['public', configs.storefront], ['admin', configs.admin],
]) {
  const name = target === 'public' ? TARGET.worker : TARGET.adminWorker;
  for (const expected of [
    '"name": "' + name + '"',
    '"PRELAUNCH_NOINDEX": "true"',
    '"workers_dev": false',
    '"preview_urls": false',
  ]) {
    if (!content.includes(expected)) throw new Error(target + ' config missing ' + expected);
  }
}
mkdirSync(join(root, '.instances', 'split-build'), { recursive: true });
writeThemeArtifacts();
for (const target of ['public', 'admin']) {
  prepareWorkerSource(root, target);
  // The Astro route-resolved hook regenerates this only after a successful
  // source/manifest check. Never accept a stale file from an earlier build.
  rmSync(join(root, '.instances', 'split-build', target, 'routes.json'), { force: true });
}

copyFileSync(original, backup, constants.COPYFILE_EXCL);
try {
  for (const [target, content] of [
    ['public', configs.storefront], ['admin', configs.admin],
  ]) {
    // Astro's adapter reads the root wrangler.jsonc during compilation.
    writeFileSync(original, content);
    console.log('Building Purkins ' + target + ' Worker...');
    const result = spawnSync(process.execPath, [astro, 'build'], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, PURKINS_WORKER_TARGET: target, CI: '1' },
    });
    if (result.error || result.status !== 0) {
      throw new Error('Purkins ' + target + ' Worker build failed.');
    }
    const routes = join(root, '.instances', 'split-build', target, 'routes.json');
    if (!existsSync(routes)) throw new Error('Missing verified Astro route list for ' + target);
    const output = join(root, 'dist', target, 'server', 'wrangler.json');
    if (!existsSync(output)) throw new Error('Missing compiled ' + target + ' Worker config.');
    const built = JSON.parse(readFileSync(output, 'utf8'));
    if (built.name !== (target === 'public' ? TARGET.worker : TARGET.adminWorker) ||
        built.workers_dev !== false || built.preview_urls !== false) {
      throw new Error(target + ' generated unsafe Wrangler config.');
    }
  }
} finally {
  copyFileSync(backup, original);
  rmSync(backup, { force: true });
}
console.log('Both isolated Purkins Workers built. No Cloudflare resources changed.');
