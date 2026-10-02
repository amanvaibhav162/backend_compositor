import crypto from 'crypto';
import type { HostInventory } from './hostDetector.js';
import type { ResolvedDependency } from './solver.js';

export interface ModuleClosureInfo {
  id: string;
  type: string;
  options?: Record<string, unknown>;
}

export interface DerivationClosure {
  projectName: string;
  modules: ModuleClosureInfo[];
  host: {
    nodeVersion: string;
    platform: string;
    arch: string;
    packageManager: string;
    hasNix: boolean;
  };
  dependencies: Record<string, {
    version: string;
    source: string;
    requestedBy: string[];
  }>;
  devDependencies: Record<string, {
    version: string;
    source: string;
    requestedBy: string[];
  }>;
}

export interface BackForgeLockfile {
  $schema: string;
  lockfileVersion: number;
  derivationId: string;
  generatedAt: string;
  projectName: string;
  host: DerivationClosure['host'];
  modules: ModuleClosureInfo[];
  dependencies: DerivationClosure['dependencies'];
  devDependencies: DerivationClosure['devDependencies'];
}

function canonicalStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalStringify).join(',') + ']';
  }

  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map((key) => {
    return JSON.stringify(key) + ':' + canonicalStringify((obj as Record<string, unknown>)[key]);
  });
  return '{' + entries.join(',') + '}';
}

export function computeDerivationId(closure: DerivationClosure): string {
  const canonicalJson = canonicalStringify(closure);
  const hash = crypto.createHash('sha256').update(canonicalJson).digest('hex');
  return `sha256:${hash}`;
}

export function buildDerivationClosure(params: {
  projectName: string;
  modules: ModuleClosureInfo[];
  hostInventory: HostInventory;
  resolvedMap: Record<string, ResolvedDependency>;
}): DerivationClosure {
  const deps: DerivationClosure['dependencies'] = {};
  const devDeps: DerivationClosure['devDependencies'] = {};

  for (const [name, res] of Object.entries(params.resolvedMap)) {
    const item = {
      version: res.version,
      source: res.source,
      requestedBy: [...res.requestedBy].sort(),
    };

    if (res.isDev) {
      devDeps[name] = item;
    } else {
      deps[name] = item;
    }
  }

  return {
    projectName: params.projectName,
    modules: params.modules.map((m) => ({
      id: m.id,
      type: m.type,
      options: m.options || {},
    })),
    host: {
      nodeVersion: params.hostInventory.nodeVersion,
      platform: params.hostInventory.platform,
      arch: params.hostInventory.arch,
      packageManager: params.hostInventory.packageManager,
      hasNix: params.hostInventory.hasNix,
    },
    dependencies: deps,
    devDependencies: devDeps,
  };
}

export function generateLockfile(params: {
  projectName: string;
  modules: ModuleClosureInfo[];
  hostInventory: HostInventory;
  resolvedMap: Record<string, ResolvedDependency>;
}): { lockfile: BackForgeLockfile; derivationId: string; content: string } {
  const closure = buildDerivationClosure(params);
  const derivationId = computeDerivationId(closure);

  const lockfile: BackForgeLockfile = {
    $schema: 'https://backforge.dev/schemas/lockfile-v1.json',
    lockfileVersion: 1,
    derivationId,
    generatedAt: new Date().toISOString(),
    projectName: closure.projectName,
    host: closure.host,
    modules: closure.modules,
    dependencies: closure.dependencies,
    devDependencies: closure.devDependencies,
  };

  const content = JSON.stringify(lockfile, null, 2) + '\n';
  return { lockfile, derivationId, content };
}

export function verifyLockfileMatch(
  existingContent: string,
  params: {
    projectName: string;
    modules: ModuleClosureInfo[];
    hostInventory: HostInventory;
    resolvedMap: Record<string, ResolvedDependency>;
  }
): boolean {
  try {
    const parsed = JSON.parse(existingContent) as BackForgeLockfile;
    const closure = buildDerivationClosure(params);
    const newDerivationId = computeDerivationId(closure);
    return parsed.derivationId === newDerivationId;
  } catch {
    return false;
  }
}
