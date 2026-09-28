import crypto from 'crypto';
import { BackForgeConfigSchema, validateSemantics } from './config.js';
import { topologicalSort } from './orchestrator.js';
import { resetHookSystem, resolveSlot, registerSlot, registerHook } from './hookSystem.js';
import { resetVFS, addFile, getVFS } from './emitter.js';
import type { ModuleDefinition, IR, IRService, ServiceConfig, ModuleBootstrapConfig } from './types.js';

import * as coreExpress from '../modules/core-express/index.js';
import * as dbMongodb from '../modules/db-mongodb/index.js';
import * as authJwt from '../modules/auth-jwt/index.js';
import * as authOauth from '../modules/auth-oauth/index.js';

const MODULE_REGISTRY: Record<string, ModuleDefinition> = {
  [coreExpress.id]: coreExpress,
  [dbMongodb.id]: dbMongodb,
  [authJwt.id]: authJwt,
  [authOauth.id]: authOauth,
};

const TYPE_TO_MODULE: Record<string, string> = {
  express: 'core:express',
  mongodb: 'db:mongodb',
  jwt: 'auth:jwt',
  oauth: 'auth:oauth',
};

export function buildIR(rawConfig: Record<string, unknown>): { ir: IR; executionOrder: string[] } {
  const internalConfig = {
    project: rawConfig.project as { name: string },
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

  const { valid, errors: semanticErrors } = validateSemantics(internalConfig);
  if (!valid) {
    throw new Error(`Semantic Validation Failed:\n${semanticErrors.map((e) => `  • ${e}`).join('\n')}`);
  }

  const ir: IR = {
    project: internalConfig.project,
    services: internalConfig.services.map((svc): IRService => {
      const moduleId = TYPE_TO_MODULE[svc.type] ?? svc.type;
      const mod = MODULE_REGISTRY[moduleId];
      if (!mod) throw new Error(`Unknown module type: "${svc.type}". No module registered for it.`);
      return {
        id: svc.id,
        type: svc.type,
        moduleId,
        dependsOn: mod.requires.map((req) => {
          const matchingSvc = internalConfig.services.find(
            (s) => (TYPE_TO_MODULE[s.type] ?? s.type) === req
          );
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

export async function runPipeline(rawConfig: Record<string, unknown>, outputDir: string): Promise<Map<string, string>> {
  const { ir, executionOrder } = buildIR(rawConfig);
  console.log(`\n📋 Execution order: ${executionOrder.join(' → ')}`);

  resetHookSystem();
  resetVFS();

  for (const serviceId of executionOrder) {
    const mod = MODULE_REGISTRY[ir.services.find(s => s.id === serviceId)!.moduleId];
    if (mod.slots) {
      for (const slot of Object.values(mod.slots)) {
        registerSlot(slot);
      }
    }
  }

  for (const serviceId of executionOrder) {
    const mod = MODULE_REGISTRY[ir.services.find(s => s.id === serviceId)!.moduleId];
    if (mod.hooks) {
      for (const hook of mod.hooks) {
        registerHook(hook);
      }
    }
  }

  for (const serviceId of executionOrder) {
    const irSvc = ir.services.find((s) => s.id === serviceId)!;
    const mod = MODULE_REGISTRY[irSvc.moduleId];
    console.log(`  ⚙️  Executing ${mod.id}...`);
    if (mod.bootstrap) {
      const bootstrapConfig: ModuleBootstrapConfig = {
        ...rawConfig,
        project: ir.project,
        options: (irSvc.config?.options as Record<string, unknown>) || {},
      };
      await mod.bootstrap(bootstrapConfig, resolveSlot);
    }
  }

  const collectedDeps: Record<string, string> = {};
  const collectedDevDeps: Record<string, string> = {
    'typescript': '^5.8.2',
    'tsx': '^4.19.3',
    '@types/node': '^22.13.9',
  };
  const collectedEnvVars: string[] = [];

  for (const serviceId of executionOrder) {
    const irSvc = ir.services.find((s) => s.id === serviceId)!;
    const mod = MODULE_REGISTRY[irSvc.moduleId];

    if (mod.dependencies) {
      Object.assign(collectedDeps, mod.dependencies);
    }

    if (mod.devDependencies) {
      Object.assign(collectedDevDeps, mod.devDependencies);
    }

    if (mod.envVars) {
      collectedEnvVars.push(mod.envVars);
    }
  }

  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      lib: ["ES2022"],
      outDir: "./dist",
      rootDir: "./src",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true
    },
    include: ["src/**/*"]
  };
  addFile('tsconfig.json', JSON.stringify(tsconfig, null, 2) + '\n');

  const packageJson = {
    name: ir.project.name,
    version: '1.0.0',
    type: 'module',
    scripts: {
      "build": "tsc",
      "start": "node dist/index.js",
      "dev": "tsx watch src/index.ts",
      "typecheck": "tsc --noEmit"
    },
    dependencies: collectedDeps,
    devDependencies: collectedDevDeps,
  };
  addFile('package.json', JSON.stringify(packageJson, null, 2) + '\n');

  const envTemplateContent = `# Generated by BackForge (.env.template)\n\n` + collectedEnvVars.join('\n\n') + '\n';
  addFile('.env.template', envTemplateContent);

  const envContent = `# Local Environment Configuration (Generated by BackForge)\n\n` +
    collectedEnvVars
      .join('\n\n')
      .replace(/replace_this_with_[a-z_]+/g, () => crypto.randomBytes(32).toString('hex')) +
    '\n';
  addFile('.env', envContent);
  addFile('README.md', `# ${ir.project.name}

Generated by **BackForge** — Deterministic Backend Composition Engine.

## Stack
- **Runtime:** Node.js (ES2022 / NodeNext ESM)
- **Language:** Strict TypeScript (100% type-checked)
- **Framework:** Express.js with Helmet security headers & rate limiting
- **Utilities:** \`asyncHandler\`, \`ApiError\`, \`ApiResponse\`

## Quick Start

\`\`\`bash
# 1. Install dependencies
npm install

# 2. Start development server (with hot reload via tsx)
npm run dev

# 3. Type-check the project
npm run typecheck

# 4. Build for production
npm run build
npm start
\`\`\`
`);

  return getVFS();
}
