// Resolve Bash without accidentally invoking Windows' WSL bash.exe shim.
// Local npm commands run from PowerShell; the existing .sh integration suites
// use Git Bash on Windows and the regular bash binary on Unix platforms.
import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

/**
 * Pure resolver, with injectable dependencies for cross-platform unit tests.
 * @param {{platform?:string, env?:NodeJS.ProcessEnv, exists?:(file:string)=>boolean, gitExecPath?:string}} options
 */
export function resolveBashExecutable({
  platform = process.platform,
  env = process.env,
  exists = existsSync,
  gitExecPath,
} = {}) {
  if (platform !== 'win32') return 'bash';

  const candidates = [
    env.GIT_BASH_EXE,
    env.GIT_BASH_PATH,
    env.ProgramFiles && win32.join(env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
    env.ProgramW6432 && win32.join(env.ProgramW6432, 'Git', 'bin', 'bash.exe'),
    env['ProgramFiles(x86)'] && win32.join(env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
    env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
    env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, 'Git', 'bin', 'bash.exe'),
    gitExecPath && win32.resolve(gitExecPath.trim(), '..', '..', '..', 'bin', 'bash.exe'),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = win32.normalize(candidate);
    if (!normalized.toLowerCase().endsWith('\\bash.exe')) continue;
    // C:\Windows\System32\bash.exe is the WSL launcher, NOT Git Bash.
    if (/\\windows\\system32\\bash\.exe$/i.test(normalized)) continue;
    if (exists(normalized)) return normalized;
  }
  throw new Error(
    'Git Bash was not found. This project does NOT require WSL. ' +
    'Install Git for Windows with Git Bash or set GIT_BASH_EXE to the absolute ' +
    'path of Git\\bin\\bash.exe, then rerun the npm command.',
  );
}
