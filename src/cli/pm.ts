import { spawn, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

export type PackageManager = 'pnpm' | 'bun' | 'yarn' | 'npm';

export function detectPackageManager(): PackageManager {
  const userAgent = process.env.npm_config_user_agent;
  if (userAgent) {
    if (userAgent.startsWith('pnpm')) return 'pnpm';
    if (userAgent.startsWith('bun')) return 'bun';
    if (userAgent.startsWith('yarn')) return 'yarn';
    if (userAgent.startsWith('npm')) return 'npm';
  }

  // Fallback: check which binaries are installed on the system
  try {
    const resPnpm = spawnSync('pnpm', ['--version'], { stdio: 'ignore' });
    if (resPnpm.status === 0) return 'pnpm';
  } catch {}

  try {
    const resBun = spawnSync('bun', ['--version'], { stdio: 'ignore' });
    if (resBun.status === 0) return 'bun';
  } catch {}

  return 'npm';
}

export function installDependencies(targetDir: string, pm: PackageManager = detectPackageManager()): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(pm, ['install'], {
      cwd: targetDir,
      stdio: 'inherit',
      shell: true,
    });

    child.on('close', (code) => {
      resolve(code === 0);
    });

    child.on('error', () => {
      resolve(false);
    });
  });
}

export function initializeGit(targetDir: string): boolean {
  try {
    const isGitRepo = fs.existsSync(path.join(targetDir, '.git'));
    if (isGitRepo) return true;

    const res = spawnSync('git', ['init'], { cwd: targetDir, stdio: 'ignore' });
    return res.status === 0;
  } catch {
    return false;
  }
}
