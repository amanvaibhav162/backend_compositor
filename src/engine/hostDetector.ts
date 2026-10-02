import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface HostPackageInfo {
  version: string;
  source: 'global' | 'local' | 'nix';
}

export interface HostInventory {
  nodeVersion: string;
  nodeMajor: number;
  platform: NodeJS.Platform;
  arch: string;
  packageManager: 'pnpm' | 'bun' | 'yarn' | 'npm';
  hasNix: boolean;
  nixVersion?: string;
  installedPackages: Record<string, HostPackageInfo>;
}

let cachedInventory: HostInventory | null = null;

export function detectPackageManager(): 'pnpm' | 'bun' | 'yarn' | 'npm' {
  const userAgent = process.env.npm_config_user_agent;
  if (userAgent) {
    if (userAgent.startsWith('pnpm')) return 'pnpm';
    if (userAgent.startsWith('bun')) return 'bun';
    if (userAgent.startsWith('yarn')) return 'yarn';
    if (userAgent.startsWith('npm')) return 'npm';
  }

  try {
    const resPnpm = spawnSync('pnpm', ['--version'], { stdio: 'ignore', timeout: 1000 });
    if (resPnpm.status === 0) return 'pnpm';
  } catch {}

  try {
    const resBun = spawnSync('bun', ['--version'], { stdio: 'ignore', timeout: 1000 });
    if (resBun.status === 0) return 'bun';
  } catch {}

  try {
    const resYarn = spawnSync('yarn', ['--version'], { stdio: 'ignore', timeout: 1000 });
    if (resYarn.status === 0) return 'yarn';
  } catch {}

  return 'npm';
}

export function detectNix(): { hasNix: boolean; nixVersion?: string } {
  try {
    const res = spawnSync('nix', ['--version'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
    });
    if (res.status === 0 && res.stdout) {
      const match = res.stdout.trim().match(/nix\s+\(?([a-zA-Z0-9\._\-]+)\)?/i);
      return { hasNix: true, nixVersion: match ? match[1] : res.stdout.trim() };
    }
  } catch {}

  try {
    const resShell = spawnSync('nix-shell', ['--version'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
    });
    if (resShell.status === 0 && resShell.stdout) {
      return { hasNix: true, nixVersion: resShell.stdout.trim() };
    }
  } catch {}

  return { hasNix: false };
}

export function detectInstalledPackages(scanDirs: string[] = []): Record<string, HostPackageInfo> {
  const packages: Record<string, HostPackageInfo> = {};

  // 1. Scan global NPM packages via `npm list -g --depth=0 --json`
  try {
    const res = spawnSync('npm', ['list', '-g', '--depth=0', '--json'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    });

    if (res.status === 0 && res.stdout) {
      const parsed = JSON.parse(res.stdout);
      if (parsed.dependencies && typeof parsed.dependencies === 'object') {
        for (const [name, info] of Object.entries(parsed.dependencies)) {
          if (info && typeof info === 'object' && 'version' in (info as Record<string, unknown>)) {
            const ver = String((info as Record<string, unknown>).version);
            if (ver && !ver.startsWith('file:') && !ver.startsWith('link:')) {
              packages[name] = { version: ver, source: 'global' };
            }
          }
        }
      }
    }
  } catch {
    // Graceful fallback if npm is unavailable or times out
  }

  // 2. Scan local directories (e.g. current working directory or target directory)
  for (const dir of scanDirs) {
    if (!dir || !fs.existsSync(dir)) continue;

    const pkgJsonPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
        const allDeps = { ...(raw.dependencies || {}), ...(raw.devDependencies || {}) };
        for (const [name, range] of Object.entries(allDeps)) {
          if (typeof range === 'string') {
            const cleanVer = range.replace(/^[\^~>=<]+/, '');
            packages[name] = { version: cleanVer, source: 'local' };
          }
        }
      } catch {}
    }
  }

  return packages;
}

export function detectHostInventory(scanDirs: string[] = [], forceRefresh = false): HostInventory {
  if (cachedInventory && !forceRefresh) {
    return cachedInventory;
  }

  const rawNode = process.version;
  const cleanNode = rawNode.replace(/^v/, '');
  const nodeMajor = parseInt(cleanNode.split('.')[0] || '20', 10);

  const pm = detectPackageManager();
  const nixInfo = detectNix();
  const installedPackages = detectInstalledPackages([process.cwd(), ...scanDirs]);

  cachedInventory = {
    nodeVersion: cleanNode,
    nodeMajor,
    platform: process.platform,
    arch: process.arch,
    packageManager: pm,
    hasNix: nixInfo.hasNix,
    nixVersion: nixInfo.nixVersion,
    installedPackages,
  };

  return cachedInventory;
}
