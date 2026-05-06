import { z } from 'zod';

// ─── Schema Definitions ──────────────────────────────────────────────────────

const ServiceConfigSchema = z.object({
  id: z.string().min(1, 'Service id cannot be empty'),
  type: z.string().min(1, 'Service type cannot be empty'),
  options: z.record(z.any()).optional().default({}),
}).passthrough(); // allow extra keys per service

const ProjectConfigSchema = z.object({
  name: z.string().min(1, 'Project name cannot be empty'),
});

export const BackForgeConfigSchema = z.object({
  project: ProjectConfigSchema,
  services: z.array(ServiceConfigSchema).min(1, 'At least one service is required'),
});

// ─── Semantic Validation ──────────────────────────────────────────────────────

/**
 * Validates semantic rules (e.g. auth requires database).
 * @param {import('./types.js').InternalConfig} config
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSemantics(config) {
  const errors = [];
  const ids = new Set(config.services.map((s) => s.id));

  for (const service of config.services) {
    if (service.id === 'auth' && !ids.has('database')) {
      errors.push('Semantic Error: "auth" service requires a "database" service to be defined.');
    }
    if (service.id === 'payments' && !ids.has('auth')) {
      errors.push('Semantic Error: "payments" service requires an "auth" service to be defined.');
    }
  }

  return { valid: errors.length === 0, errors };
}
