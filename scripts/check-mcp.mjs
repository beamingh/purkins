#!/usr/bin/env node
// Platform-independent, local-only MCP typecheck and Cloudflare Worker dry run.
// Does NOT apply migrations, deploy a Worker, or require Bash/WSL.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const templatePath = join(root, 'mcp', 'wrangler.template.jsonc');
// Must reside inside mcp/ so the template's relative paths remain valid.
const configPath = join(root, 'mcp', `.wrangler-check-${randomUUID()}.jsonc`);
const cli = (...parts) => join(root, 'node_modules', ...parts);

function run(label, entrypoint, args) {
  console.log(`MCP check: ${label}`);
  const result = spawnSync(process.execPath, [entrypoint, ...args], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${label} terminated by ${result.signal}`);
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}`);
}

try {
  const template = readFileSync(templatePath, 'utf8');
  const config = template
    .replaceAll('__NAME__', 'minshop-check')
    .replaceAll('__DB_NAME__', 'minshop-check-db')
    .replaceAll('__DB_ID__', '00000000-0000-0000-0000-000000000000');
  writeFileSync(configPath, config, { flag: 'wx' });
  run('TypeScript', cli('typescript', 'bin', 'tsc'), [
    '-p', join(root, 'mcp', 'tsconfig.json'), '--noEmit',
  ]);
  run('Wrangler dry run (no deployment)', cli('wrangler', 'bin', 'wrangler.js'), [
    'deploy', '--config', configPath, '--dry-run',
  ]);
  console.log('MCP check: passed (no deployment performed)');
} catch (error) {
  console.error('MCP check:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  rmSync(configPath, { force: true });
}
