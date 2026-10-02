import semver from 'semver';
import type { HostInventory } from './hostDetector.js';

export interface DependencyDemand {
  name: string;
  range: string;
  requestedBy: string;
  isDev?: boolean;
}

export interface ResolvedDependency {
  name: string;
  version: string;
  range: string;
  source: 'local-host' | 'registry' | 'host-engine';
  requestedBy: string[];
  isDev: boolean;
}

export interface SolverResult {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  resolvedMap: Record<string, ResolvedDependency>;
  hostMatches: Array<{ name: string; version: string; source: string; isDev: boolean }>;
  registryDownloads: Array<{ name: string; range: string; isDev: boolean }>;
}

export function solveDependencies(
  demands: DependencyDemand[],
  hostInventory: HostInventory
): SolverResult {
  const grouped = new Map<string, DependencyDemand[]>();

  // Add dynamic host-driven devDependencies
  const allDemands: DependencyDemand[] = [...demands];

  // 1. Dynamic @types/node: match host Node.js major engine
  const hostNodeTypes = hostInventory.installedPackages['@types/node'];
  const targetNodeTypesVer = hostNodeTypes
    ? `^${hostNodeTypes.version}`
    : `^${hostInventory.nodeMajor}.0.0`;

  allDemands.push({
    name: '@types/node',
    range: targetNodeTypesVer,
    requestedBy: 'engine:node-runtime',
    isDev: true,
  });

  // 2. Dynamic typescript: adopt host typescript if >= 5.0.0
  const hostTs = hostInventory.installedPackages['typescript'];
  const tsRange = hostTs && semver.satisfies(hostTs.version, '>=5.0.0')
    ? `^${hostTs.version}`
    : '^5.8.2';

  allDemands.push({
    name: 'typescript',
    range: tsRange,
    requestedBy: 'engine:typescript',
    isDev: true,
  });

  // 3. Dynamic tsx: adopt host tsx if >= 4.0.0
  const hostTsx = hostInventory.installedPackages['tsx'];
  const tsxRange = hostTsx && semver.satisfies(hostTsx.version, '>=4.0.0')
    ? `^${hostTsx.version}`
    : '^4.19.3';

  allDemands.push({
    name: 'tsx',
    range: tsxRange,
    requestedBy: 'engine:runner',
    isDev: true,
  });

  // Group demands by package name
  for (const demand of allDemands) {
    const list = grouped.get(demand.name) || [];
    list.push(demand);
    grouped.set(demand.name, list);
  }

  const resolvedDependencies: Record<string, string> = {};
  const resolvedDevDependencies: Record<string, string> = {};
  const resolvedMap: Record<string, ResolvedDependency> = {};
  const hostMatches: Array<{ name: string; version: string; source: string; isDev: boolean }> = [];
  const registryDownloads: Array<{ name: string; range: string; isDev: boolean }> = [];

  for (const [pkgName, pkgDemands] of grouped.entries()) {
    const isDev = pkgDemands.every((d) => d.isDev);
    const requestedBy = Array.from(new Set(pkgDemands.map((d) => d.requestedBy)));

    // 1. Verify pairwise semver intersection
    for (let i = 0; i < pkgDemands.length; i++) {
      for (let j = i + 1; j < pkgDemands.length; j++) {
        const d1 = pkgDemands[i];
        const d2 = pkgDemands[j];
        if (!semver.intersects(d1.range, d2.range)) {
          throw new Error(
            `Dependency Conflict: Package "${pkgName}" has conflicting version requirements:\n` +
            `  • "${d1.requestedBy}" requires: ${d1.range}\n` +
            `  • "${d2.requestedBy}" requires: ${d2.range}\n` +
            `No overlapping semver range exists to satisfy both modules.`
          );
        }
      }
    }

    // 2. Check if the user's host computer already has a satisfying version
    const hostPkg = hostInventory.installedPackages[pkgName];
    let hostSatisfies = false;

    if (hostPkg) {
      hostSatisfies = pkgDemands.every((d) => semver.satisfies(hostPkg.version, d.range));
    }

    let finalRange: string;
    let source: 'local-host' | 'registry' | 'host-engine';

    if (hostPkg && hostSatisfies) {
      // Adopt local version from user's machine
      finalRange = `^${hostPkg.version}`;
      source = 'local-host';
      hostMatches.push({
        name: pkgName,
        version: hostPkg.version,
        source: hostPkg.source,
        isDev,
      });
    } else {
      // Find the most restrictive range (highest lower bound)
      let selectedRange = pkgDemands[0].range;
      let maxMinVer: semver.SemVer | null = semver.minVersion(selectedRange);

      for (const d of pkgDemands) {
        const minVer = semver.minVersion(d.range);
        if (minVer && (!maxMinVer || semver.gt(minVer, maxMinVer))) {
          maxMinVer = minVer;
          selectedRange = d.range;
        }
      }

      finalRange = selectedRange;
      source = pkgName === '@types/node' && !hostPkg ? 'host-engine' : 'registry';

      registryDownloads.push({
        name: pkgName,
        range: finalRange,
        isDev,
      });
    }

    const resolved: ResolvedDependency = {
      name: pkgName,
      version: finalRange,
      range: finalRange,
      source,
      requestedBy,
      isDev,
    };

    resolvedMap[pkgName] = resolved;

    if (isDev) {
      resolvedDevDependencies[pkgName] = finalRange;
    } else {
      resolvedDependencies[pkgName] = finalRange;
    }
  }

  return {
    dependencies: resolvedDependencies,
    devDependencies: resolvedDevDependencies,
    resolvedMap,
    hostMatches,
    registryDownloads,
  };
}
