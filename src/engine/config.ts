import { z } from 'zod';
import type { BackForgeConfig } from './types.ts';

export const ServiceConfigSchema = z.object({
  id: z.string().min(1, 'Service id cannot be empty'),
  type: z.string().min(1, 'Service type cannot be empty'),
  options: z.record(z.string(), z.any()).optional().default({}),
}).passthrough();

const ProjectConfigSchema = z.object({
  name: z.string().min(1, 'Project name cannot be empty'),
});

export const BackForgeConfigSchema = z.object({
  project: ProjectConfigSchema,
  services: z.array(ServiceConfigSchema).min(1, 'At least one service is required'),
});

export function validateSemantics(config: BackForgeConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
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
