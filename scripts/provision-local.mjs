#!/usr/bin/env node
/**
 * Provision Minshop locally on Windows, Linux, or macOS using Node.js.
 * Does not require Bash, WSL, or OpenSSL; never modifies remote D1 or R2.
 *
 * npm run provision:local -- --seed
 * npm run provision:local -- --no-build
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = new Set(process.argv.slice(2));
const accepted = new Set(['--seed', '--no-build']);
for (const arg of args) {
  if (!accepted.has(arg)) {
    console.error(`Unknown argument: ${arg}. Use --seed and/or --no-build.`);
    process.exit(1);
  }
}

const seed = args.has('--seed');
const skipBuild = args.has('--no-build');
const configPath = join(root, 'dist', 'server', 'wrangler.json');
const varsPath = join(root, '.dev.vars');

function ensureLocalSecret(name) {
  const contents = existsSync(varsPath) ? readFileSync(varsPath, 'utf8') : '';
  const exists = contents.split(/\r?\n/).some((line) => line.startsWith(`${name}=`));
  if (exists) return;

  const newline = contents.length > 0 && !contents.endsWith('\n') ? '\n' : '';
  appendFileSync(varsPath, `${newline}${name}=${randomBytes(32).toString('base64')}\n`, { mode: 0o600 });
  console.log(`  • generated ${name} → .dev.vars`);
}

function runLocalTool(relativeCli, args, extraEnv = {}) {
  const cli = join(root, ...relativeCli);
  if (!existsSync(cli)) throw new Error(`Missing ${relativeCli.join('/')}. Run npm ci first.`);
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${relativeCli.at(-1)} failed (exit ${result.status ?? 'unknown'}).`);
  }
}

try {
  console.log('▸ Ensuring local secrets in .dev.vars…');
  ensureLocalSecret('SECRETS_KEK');
  ensureLocalSecret('AUTH_SECRET');

  if (!skipBuild || !existsSync(configPath)) {
    console.log('▸ [1/2] Building (astro build)…');
    runLocalTool(['node_modules', 'astro', 'astro.js'], ['build']);
  } else {
    console.log('▸ [1/2] Skipping build (--no-build).');
  }
  if (!existsSync(configPath)) throw new Error(`Missing ${configPath} after build.`);

  console.log('▸ [2/2] Applying migrations to LOCAL D1…');
  runLocalTool(['node_modules', 'wrangler', 'bin', 'wrangler.js'], ['d1', 'migrations', 'apply', 'DB', '--local'], { CI: '1' });
  if (seed) {
    if (existsSync(join(root, 'seed.sql'))) {
      console.log('▸ Seeding LOCAL D1 with example data…');
      runLocalTool(['node_modules', 'wrangler', 'bin', 'wrangler.js'], ['d1', 'execute', 'DB', '--local', '--file=./seed.sql'], { CI: '1' });
    } else {
      console.log('  (--seed requested but seed.sql is missing — skipped)');
    }
  }

  console.log('\n✓ Local Minshop store ready (no remote resources changed).');
  console.log('  Start: npm run preview');
  console.log('  Store: http://localhost:8787/');
  console.log('  Admin: http://localhost:8787/admin/setup\n');
} catch (error) {
  console.error(`✗ Local provisioning failed: ${error.message}`);
  process.exitCode = 1;
}
