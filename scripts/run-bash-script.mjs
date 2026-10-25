#!/usr/bin/env node
// Cross-platform npm entrypoint for checked-in Bash scripts.
// Windows MUST invoke Git for Windows directly: plain "bash" may launch WSL.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBashExecutable } from './bash-executable.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [scriptArg, ...args] = process.argv.slice(2);
if (!scriptArg || !scriptArg.endsWith('.sh')) {
  console.error('Usage: node scripts/run-bash-script.mjs <repo-script.sh> [args...]');
  process.exit(2);
}

const absoluteScript = resolve(root, scriptArg);
const pathFromRoot = relative(root, absoluteScript);
if (pathFromRoot === '..' || pathFromRoot.startsWith('..' + sep) ||
    isAbsolute(pathFromRoot) || !existsSync(absoluteScript)) {
  console.error('Bash runner: script must be an existing .sh file inside the repository.');
  process.exit(2);
}

let gitExecPath;
if (process.platform === 'win32') {
  // Git for Windows knows its installation root even when installed outside
  // Program Files. This lookup invokes git.exe, never bash.exe or wsl.exe.
  const git = spawnSync('git', ['--exec-path'], {
    shell: false, encoding: 'utf8', windowsHide: true,
  });
  if (!git.error && git.status === 0) gitExecPath = git.stdout.trim();
}

try {
  const bash = resolveBashExecutable({ gitExecPath });
  const script = pathFromRoot.replaceAll('\\', '/');
  console.log(`Shell test: ${script} (using ${bash})`);
  const result = spawnSync(bash, [script, ...args], {
    cwd: root, shell: false, stdio: 'inherit',
    env: process.env, windowsHide: false,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Bash test interrupted by ${result.signal}`);
  if (result.status !== 0) {
    console.error(`Shell test failed: ${script} (exit ${result.status})`);
    process.exitCode = result.status || 1;
  }
} catch (error) {
  console.error('Shell test:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
