import crypto from 'crypto';
import { BackForgeConfigSchema, validateSemantics } from './config.js';
import { topologicalSort } from './orchestrator.js';
import { resetHookSystem, resolveSlot, registerSlot, registerHook } from './hookSystem.js';
import { resetVFS, addFile, getVFS } from './emitter.js';
import type { ModuleDefinition, IR, IRService, ServiceConfig, ModuleBootstrapConfig } from './types.js';
import { detectHostInventory, type HostInventory } from './hostDetector.js';
import { solveDependencies, type DependencyDemand, type SolverResult } from './solver.js';
import { generateLockfile } from './derivation.js';
import { generateFlakeNix, generateShellNix } from './nixEmitter.js';

import * as coreExpress from '../modules/core-express/index.js';
import * as dbMongodb from '../modules/db-mongodb/index.js';
import * as dbPostgres from '../modules/db-postgres/index.js';
import * as authJwt from '../modules/auth-jwt/index.js';
import * as authOauth from '../modules/auth-oauth/index.js';

const MODULE_REGISTRY: Record<string, ModuleDefinition> = {
  [coreExpress.id]: coreExpress,
  [dbMongodb.id]: dbMongodb,
  [dbPostgres.id]: dbPostgres,
  [authJwt.id]: authJwt,
  [authOauth.id]: authOauth,
};

const TYPE_TO_MODULE: Record<string, string> = {
  express: 'core:express',
  mongodb: 'db:mongodb',
  postgres: 'db:postgres',
  jwt: 'auth:jwt',
  oauth: 'auth:oauth',
};

export interface PipelineOptions {
  nix?: boolean;
}

export interface PipelineResult {
  vfs: Map<string, string>;
  derivationId: string;
  hostInventory: HostInventory;
  hostMatches: Array<{ name: string; version: string; source: string; isDev: boolean }>;
  registryDownloads: Array<{ name: string; range: string; isDev: boolean }>;
  lockfileContent: string;
}

export function buildIR(rawConfig: Record<string, unknown>): { ir: IR; executionOrder: string[] } {
  const internalConfig = {
    project: rawConfig.project as { name: string; nix?: boolean },
    services: ((rawConfig.services as ServiceConfig[]) ?? []).map((svc) => ({
      ...svc,
      id: svc.id,
      type: svc.type,
    })),
  };

  const parsed = BackForgeConfigSchema.safeParse(internalConfig);
  if (!parsed.success) {
    const messages = parsed.error.issues.map((e) => `  • ${e.path.join('.')}: ${e.message}`);
    throw new Error(`Schema Validation Failed:\n${messages.join('\n')}`);
  }

  const { valid, errors: semanticErrors } = validateSemantics(parsed.data);
  if (!valid) {
    throw new Error(`Semantic Validation Failed:\n${semanticErrors.map((e) => `  • ${e}`).join('\n')}`);
  }

  const ir: IR = {
    project: parsed.data.project,
    services: parsed.data.services.map((svc): IRService => {
      const moduleId = TYPE_TO_MODULE[svc.type] ?? svc.type;
      const mod = MODULE_REGISTRY[moduleId];
      if (!mod) throw new Error(`Unknown module type: "${svc.type}". No module registered for it.`);
      return {
        id: svc.id,
        type: svc.type,
        moduleId,
        dependsOn: mod.requires.map((req) => {
          const matchingSvc = internalConfig.services.find((s) => {
            const sModuleId = TYPE_TO_MODULE[s.type] ?? s.type;
            const sMod = MODULE_REGISTRY[sModuleId];
            return sMod?.provides?.includes(req) || sModuleId === req;
          });
          if (!matchingSvc) {
            throw new Error(`Dependency Error: Service "${svc.id}" (${svc.type}) requires "${req}", but no configured service provides it.`);
          }
          return matchingSvc.id;
        }),
        config: svc,
      };
    }),
  };

  const executionOrder = topologicalSort(ir);
  return { ir, executionOrder };
}

export async function runPipeline(
  rawConfig: Record<string, unknown>,
  outputDir: string,
  options?: PipelineOptions
): Promise<PipelineResult> {
  const { ir, executionOrder } = buildIR(rawConfig);
  console.log(`\n📋 Execution order: ${executionOrder.join(' → ')}`);

  resetHookSystem();
  resetVFS();

  // Register slots
  for (const serviceId of executionOrder) {
    const mod = MODULE_REGISTRY[ir.services.find((s) => s.id === serviceId)!.moduleId];
    if (mod.slots) {
      for (const slot of Object.values(mod.slots)) {
        registerSlot(slot);
      }
    }
  }

  // Register hooks
  for (const serviceId of executionOrder) {
    const mod = MODULE_REGISTRY[ir.services.find((s) => s.id === serviceId)!.moduleId];
    if (mod.hooks) {
      for (const hook of mod.hooks) {
        registerHook(hook);
      }
    }
  }

  // Execute bootstrap on all modules
  for (const serviceId of executionOrder) {
    const irSvc = ir.services.find((s) => s.id === serviceId)!;
    const mod = MODULE_REGISTRY[irSvc.moduleId];
    console.log(`  ⚙️  Executing ${mod.id}...`);
    if (mod.bootstrap) {
      const bootstrapConfig: ModuleBootstrapConfig = {
        ...rawConfig,
        project: ir.project,
        services: ir.services.map((s) => s.config),
        options: (irSvc.config?.options as Record<string, unknown>) || {},
      };
      await mod.bootstrap(bootstrapConfig, resolveSlot);
    }
  }

  // Collect demands from modules
  const demands: DependencyDemand[] = [];
  const collectedEnvVars: string[] = [];

  for (const serviceId of executionOrder) {
    const irSvc = ir.services.find((s) => s.id === serviceId)!;
    const mod = MODULE_REGISTRY[irSvc.moduleId];

    const userOpts = irSvc.config?.options as Record<string, unknown> | undefined;
    const userDeps = ((userOpts?.dependencies as Record<string, string>) || {}) as Record<string, string>;
    const userDevDeps = ((userOpts?.devDependencies as Record<string, string>) || {}) as Record<string, string>;

    if (mod.dependencies) {
      for (const [name, defaultRange] of Object.entries(mod.dependencies)) {
        const range: string = userDeps[name] || defaultRange;
        const requestedBy = userDeps[name] ? `user-override:${irSvc.id}` : mod.id;
        demands.push({
          name,
          range,
          requestedBy,
          isDev: false,
        });
      }
    }

    // Additional user-specified production dependencies
    for (const [name, range] of Object.entries(userDeps)) {
      if (!mod.dependencies || !(name in mod.dependencies)) {
        demands.push({
          name,
          range,
          requestedBy: `user-custom:${irSvc.id}`,
          isDev: false,
        });
      }
    }

    if (mod.devDependencies) {
      for (const [name, defaultRange] of Object.entries(mod.devDependencies)) {
        const range: string = userDevDeps[name] || defaultRange;
        const requestedBy = userDevDeps[name] ? `user-override:${irSvc.id}` : mod.id;
        demands.push({
          name,
          range,
          requestedBy,
          isDev: true,
        });
      }
    }

    // Additional user-specified devDependencies
    for (const [name, range] of Object.entries(userDevDeps)) {
      if (!mod.devDependencies || !(name in mod.devDependencies)) {
        demands.push({
          name,
          range,
          requestedBy: `user-custom:${irSvc.id}`,
          isDev: true,
        });
      }
    }

    if (mod.envVars) {
      collectedEnvVars.push(mod.envVars);
    }
  }

  // Detect host environment and installed packages on user's computer
  const hostInventory = detectHostInventory([outputDir]);

  // Pure Semver Intersection Constraint Solver
  const solverResult = solveDependencies(demands, hostInventory);

  // Content-Addressable Derivation and backforge.lock
  const { lockfile, derivationId, content: lockfileContent } = generateLockfile({
    projectName: ir.project.name,
    modules: ir.services.map((s) => ({
      id: s.id,
      type: s.type,
      options: s.config.options as Record<string, unknown>,
    })),
    hostInventory,
    resolvedMap: solverResult.resolvedMap,
  });
  addFile('backforge.lock', lockfileContent);

  // Nix Flake & Shell generation (if requested via option, project config, or host environment)
  const shouldEmitNix = options?.nix ?? ir.project.nix ?? hostInventory.hasNix;
  if (shouldEmitNix) {
    const hasMongo = ir.services.some((s) => s.type === 'mongodb');
    const hasPostgres = ir.services.some((s) => s.type === 'postgres');
    const flakeContent = generateFlakeNix({
      projectName: ir.project.name,
      hostInventory,
      hasMongo,
      hasPostgres,
    });
    addFile('flake.nix', flakeContent);

    const shellContent = generateShellNix({
      projectName: ir.project.name,
      hostInventory,
      hasMongo,
      hasPostgres,
    });
    addFile('shell.nix', shellContent);
  }

  // TypeScript Compiler Config
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      lib: ['ES2022'],
      outDir: './dist',
      rootDir: './src',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
    },
    include: ['src/**/*'],
  };
  addFile('tsconfig.json', JSON.stringify(tsconfig, null, 2) + '\n');

  // Resolved package.json scripts
  const hasPostgres = ir.services.some((s) => s.type === 'postgres');
  const scripts: Record<string, string> = {
    build: 'tsc',
    start: 'node dist/index.js',
    dev: 'tsx watch src/index.ts',
    typecheck: 'tsc --noEmit',
  };

  if (hasPostgres) {
    scripts['db:generate'] = 'drizzle-kit generate';
    scripts['db:migrate'] = 'drizzle-kit migrate';
    scripts['db:studio'] = 'drizzle-kit studio';
  }

  const packageJson = {
    name: ir.project.name,
    version: '1.0.0',
    type: 'module',
    scripts,
    dependencies: solverResult.dependencies,
    devDependencies: solverResult.devDependencies,
  };
  addFile('package.json', JSON.stringify(packageJson, null, 2) + '\n');

  // Environment variables templates
  const envTemplateContent =
    `# Generated by BackForge (.env.template)\n\n` + collectedEnvVars.join('\n\n') + '\n';
  addFile('.env.template', envTemplateContent);

  const envContent =
    `# Local Environment Configuration (Generated by BackForge)\n\n` +
    collectedEnvVars
      .join('\n\n')
      .replace(/replace_this_with_[a-z_]+/g, () => crypto.randomBytes(32).toString('hex')) +
    '\n';
  addFile('.env', envContent);

  // README with Nix derivation verification
  const nixSection = shouldEmitNix
    ? `\n## Nix Hermetic Development Shell\n\n\`\`\`bash\n# Enter reproducible Nix devshell\nnix develop\n# Or with traditional nix-shell\nnix-shell\n\`\`\`\n`
    : '';

  const dbCommandsSection = hasPostgres
    ? `\n### Database & Migrations (Drizzle ORM)\n\n\`\`\`bash\n# Generate migration files from schema\n${hostInventory.packageManager === 'npm' ? 'npm run' : hostInventory.packageManager} db:generate\n\n# Apply migrations to PostgreSQL\n${hostInventory.packageManager === 'npm' ? 'npm run' : hostInventory.packageManager} db:migrate\n\n# Open Drizzle Studio visual editor\n${hostInventory.packageManager === 'npm' ? 'npm run' : hostInventory.packageManager} db:studio\n\`\`\`\n`
    : '';

  addFile(
    'README.md',
    `# ${ir.project.name}

Generated by **BackForge** — Deterministic Backend Composition Engine.

## Stack
- **Derivation ID:** \`${derivationId}\`
- **Runtime:** Node.js (v${hostInventory.nodeVersion}, ES2022 / NodeNext ESM)
- **Language:** Strict TypeScript (100% type-checked)
- **Framework:** Express.js with Helmet security headers & rate limiting
${hasPostgres ? '- **Database:** PostgreSQL with Drizzle ORM\n' : ir.services.some((s) => s.type === 'mongodb') ? '- **Database:** MongoDB with Mongoose\n' : ''}- **Utilities:** \`asyncHandler\`, \`ApiError\`, \`ApiResponse\`
- **Lockfile:** \`backforge.lock\` (Content-Addressable Verification)
${nixSection}
## Quick Start

\`\`\`bash
# 1. Install dependencies
${hostInventory.packageManager} install

# 2. Start development server (with hot reload via tsx)
${hostInventory.packageManager === 'npm' ? 'npm run' : hostInventory.packageManager} dev

# 3. Type-check the project
${hostInventory.packageManager === 'npm' ? 'npm run' : hostInventory.packageManager} typecheck

# 4. Build for production
${hostInventory.packageManager === 'npm' ? 'npm run' : hostInventory.packageManager} build
${hostInventory.packageManager === 'npm' ? 'npm run' : hostInventory.packageManager} start
\`\`\`
${dbCommandsSection}`
  );

  return {
    vfs: getVFS(),
    derivationId,
    hostInventory,
    hostMatches: solverResult.hostMatches,
    registryDownloads: solverResult.registryDownloads,
    lockfileContent,
  };
}
