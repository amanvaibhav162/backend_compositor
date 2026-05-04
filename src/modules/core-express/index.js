import { registerSlot, registerHook } from '../../engine/hookSystem.js';
import { addFile } from '../../engine/emitter.js';

/**
 * Module: core:express
 * Provides the base Express HTTP server.
 * Exposes slots that other modules hook into.
 */
export const id = 'core:express';
export const provides = ['core:express'];
export const requires = [];

export const slots = {
  'express:imports': {
    name: 'express:imports',
    description: 'Inject import/require statements at the top of index.js',
  },
  'express:middleware': {
    name: 'express:middleware',
    description: 'Inject middleware (app.use) calls before routes',
  },
  'express:routes': {
    name: 'express:routes',
    description: 'Inject route handlers (app.get, app.post, etc.)',
  },
};

/**
 * Bootstrap this module: register slots, resolve hooks, produce files.
 * @param {Record<string, any>} config
 * @param {import('../../engine/hookSystem.js').resolveSlot} resolveSlot
 */
export async function bootstrap(config, resolveSlot) {
  // 1. Register all slots this module exposes
  for (const slot of Object.values(slots)) {
    registerSlot(slot);
  }

  // 2. After all modules have registered hooks, resolve each slot
  const imports = await resolveSlot('express:imports', config);
  const middleware = await resolveSlot('express:middleware', config);
  const routes = await resolveSlot('express:routes', config);

  // 3. Merge fragments into final index.js
  const importLines = imports.flatMap((f) => f.imports ?? []).join('\n');
  const middlewareLines = middleware.map((f) => f.content).join('\n');
  const routeLines = routes.map((f) => f.content).join('\n');

  const indexContent = `import express from 'express';
${importLines}

const app = express();
app.use(express.json());
${middlewareLines}

// ── Routes ────────────────────────────────────────
${routeLines}

// ── Health check ──────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(\`🚀 Server running on port \${PORT}\`);
});
`;

  addFile('src/index.js', indexContent);
  addFile('src/health.js', `// Health route placeholder\n`);
}
