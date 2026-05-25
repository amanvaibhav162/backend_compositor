import { BackForgeConfigSchema, validateSemantics } from '../engine/config.js';
import { topologicalSort } from '../engine/orchestrator.js';
import { resetHookSystem, resolveSlot, registerSlot, registerHook } from '../engine/hookSystem.js';
import { flushToDisk, resetVFS, addFile, getVFS } from '../engine/emitter.js';

// ── Module Registry ───────────────────────────────────────────────────────────
// Add new modules here as they are built
import * as coreExpress from '../modules/core-express/index.js';
import * as dbMongodb from '../modules/db-mongodb/index.js';
import * as authJwt from '../modules/auth-jwt/index.js';
import * as authOauth from '../modules/auth-oauth/index.js';

const MODULE_REGISTRY = {
  [coreExpress.id]: coreExpress,
  [dbMongodb.id]: dbMongodb,
  [authJwt.id]: authJwt,
  [authOauth.id]: authOauth,
};

// Map user-facing service types → module IDs
const TYPE_TO_MODULE = {
  express: 'core:express',
  mongodb: 'db:mongodb',
  jwt: 'auth:jwt',
  oauth: 'auth:oauth',
};

/**
 * Run the full 9-step compiler pipeline.
 * @param {Record<string, any>} rawConfig - Parsed YAML object
 * @param {string} outputDir - Destination directory for generated files
 */
export async function runPipeline(rawConfig, outputDir) {
  // ── Step 3: Normalize ──────────────────────────────────────────────────────
  const internalConfig = {
    project: rawConfig.project,
    services: (rawConfig.services ?? []).map((svc) => ({
      ...svc,
      id: svc.id,
      type: svc.type,
    })),
  };

  // ── Step 4: Validate (Schema + Semantic) ───────────────────────────────────
  const parsed = BackForgeConfigSchema.safeParse(internalConfig);
  if (!parsed.success) {
    const messages = parsed.error.errors.map((e) => `  • ${e.path.join('.')}: ${e.message}`);
    throw new Error(`Schema Validation Failed:\n${messages.join('\n')}`);
  }

  const { valid, errors: semanticErrors } = validateSemantics(internalConfig);
  if (!valid) {
    throw new Error(`Semantic Validation Failed:\n${semanticErrors.map((e) => `  • ${e}`).join('\n')}`);
  }

  // ── Step 5: Build IR ───────────────────────────────────────────────────────
  const ir = {
    project: internalConfig.project,
    services: internalConfig.services.map((svc) => {
      const moduleId = TYPE_TO_MODULE[svc.type] ?? svc.type;
      const mod = MODULE_REGISTRY[moduleId];
      if (!mod) throw new Error(`Unknown module type: "${svc.type}". No module registered for it.`);
      return {
        id: svc.id,
        type: svc.type,
        moduleId,
        dependsOn: mod.requires.map((req) =>
          // Resolve module ID back to service ID
          Object.keys(internalConfig.services.reduce((acc, s) => {
            acc[s.id] = TYPE_TO_MODULE[s.type]; return acc;
          }, {})).find((sid) =>
            internalConfig.services.find((s) => s.id === sid && TYPE_TO_MODULE[s.type] === req)
          ) ?? req
        ),
        config: svc,
      };
    }),
  };

  // ── Step 6: DAG (Topological Sort) ────────────────────────────────────────
  const executionOrder = topologicalSort(ir);
  console.log(`\n📋 Execution order: ${executionOrder.join(' → ')}`);

  // ── Step 7 & 8: Strict Multi-Pass Compilation ─────────────────────────────
  resetHookSystem();
  resetVFS();

  // Pass 1: Slot Registration
  for (const serviceId of executionOrder) {
    const mod = MODULE_REGISTRY[ir.services.find(s => s.id === serviceId).moduleId];
    if (mod.slots) {
      for (const slot of Object.values(mod.slots)) {
        registerSlot(slot);
      }
    }
  }

  // Pass 2: Hook Registration
  for (const serviceId of executionOrder) {
    const mod = MODULE_REGISTRY[ir.services.find(s => s.id === serviceId).moduleId];
    if (mod.hooks) {
      for (const hook of mod.hooks) {
        registerHook(hook);
      }
    }
  }

  // Pass 3: Execution & Output Generation
  // Run in exact DAG order
  for (const serviceId of executionOrder) {
    const irSvc = ir.services.find((s) => s.id === serviceId);
    const mod = MODULE_REGISTRY[irSvc.moduleId];
    console.log(`  ⚙️  Executing ${mod.id}...`);
    if (mod.bootstrap) {
      await mod.bootstrap({ ...rawConfig, project: ir.project, options: irSvc.config?.options || {} }, resolveSlot);
    }
  }

  // ── Step 8b: Generate package.json & .env.template ────────────────────────
  // Dynamically collect dependencies and env vars from all active modules
  const collectedDeps = {};
  const collectedEnvVars = [];
  
  for (const serviceId of executionOrder) {
    const irSvc = ir.services.find((s) => s.id === serviceId);
    const mod = MODULE_REGISTRY[irSvc.moduleId];
    
    if (mod.dependencies) {
      Object.assign(collectedDeps, mod.dependencies);
    }
    
    if (mod.envVars) {
      collectedEnvVars.push(mod.envVars);
    }
  }

  const packageJson = {
    name: ir.project.name,
    version: '1.0.0',
    type: 'module',
    scripts: {
      "start": "node src/index.js",
      "dev": "node --watch src/index.js"
    },
    dependencies: collectedDeps,
  };
  addFile('package.json', JSON.stringify(packageJson, null, 2));
  
  const envTemplateContent = `# Generated by BackForge\n\n` + collectedEnvVars.join('\n\n') + '\n';
  addFile('.env.template', envTemplateContent);
  addFile('README.md', `# ${ir.project.name}

Generated by **BackForge** — Deterministic Backend Composition Engine.

## Structure
Professional Express.js boilerplate with:
- \`asyncHandler\` for clean controllers
- \`ApiError\` & \`ApiResponse\` for standardized communication
- JWT Auth (Access/Refresh Tokens)
- Mongoose DB Connection

## Quick Start

\`\`\`bash
cp .env.template .env
npm install
npm run dev
\`\`\`
`);

  // ── Step 9: Return VFS ─────────────────────────────────────────────────────
  return getVFS();
}
