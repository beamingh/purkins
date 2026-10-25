import { describe, expect, it } from 'vitest';
import { win32 } from 'node:path';
import { resolveBashExecutable } from '../../scripts/bash-executable.mjs';

describe('cross-platform Bash launcher', () => {
  it('uses normal Bash on Linux and macOS', () => {
    for (const platform of ['linux', 'darwin']) {
      expect(resolveBashExecutable({ platform })).toBe('bash');
    }
  });

  it('uses a direct Git-for-Windows executable rather than the PATH bash shim', () => {
    const path = win32.join('C:\\Program Files', 'Git', 'bin', 'bash.exe');
    const selected = resolveBashExecutable({
      platform: 'win32',
      env: { ProgramFiles: 'C:\\Program Files' },
      exists: (file) => file === path,
    });
    expect(selected).toBe(path);
    expect(selected.toLowerCase()).not.toContain('system32');
  });

  it('supports user-local installations and an explicit override', () => {
    const local = win32.join('C:\\Users\\Tester\\AppData\\Local', 'Programs', 'Git', 'bin', 'bash.exe');
    expect(resolveBashExecutable({
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\Users\\Tester\\AppData\\Local' },
      exists: (p) => p === local,
    })).toBe(local);
    expect(resolveBashExecutable({
      platform: 'win32',
      env: { GIT_BASH_EXE: 'D:\\PortableGit\\bin\\bash.exe' },
      exists: (p) => p === 'D:\\PortableGit\\bin\\bash.exe',
    })).toBe('D:\\PortableGit\\bin\\bash.exe');
  });

  it('can resolve nonstandard Git installations from git --exec-path', () => {
    const installed = 'D:\\DevTools\\Git\\bin\\bash.exe';
    expect(resolveBashExecutable({
      platform: 'win32', env: {},
      gitExecPath: 'D:\\DevTools\\Git\\mingw64\\libexec\\git-core',
      exists: (p) => p === installed,
    })).toBe(installed);
  });

  it('never selects the Windows System32 WSL launcher, even as an override', () => {
    expect(() => resolveBashExecutable({
      platform: 'win32',
      env: { GIT_BASH_EXE: 'C:\\Windows\\System32\\bash.exe' },
      exists: () => true,
    })).toThrow('does NOT require WSL');
  });

  it('explains how to install Git Bash instead of asking for WSL', () => {
    expect(() => resolveBashExecutable({
      platform: 'win32', env: {}, exists: () => false,
    })).toThrow('GIT_BASH_EXE');
  });
});
