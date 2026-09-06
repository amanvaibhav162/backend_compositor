import { z } from 'zod';
import type { BackForgeConfig } from './types.js';

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

export const SERVICE_TYPE_REQUIREMENTS: Record<string, { requires: string[]; description: string }> = {
  mongodb: { requires: ['express'], description: 'an Express server (type: "express")' },
  jwt: { requires: ['express', 'mongodb'], description: 'an Express server (type: "express") and MongoDB (type: "mongodb")' },
  oauth: { requires: ['express', 'mongodb', 'jwt'], description: 'an Express server, MongoDB, and JWT Auth (type: "jwt")' },
};

export function validateSemantics(
  config: BackForgeConfig,
  typeRequirements: Record<string, { requires: string[]; description: string }> = SERVICE_TYPE_REQUIREMENTS
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const seenIds = new Set<string>();

  for (const service of config.services) {
    if (seenIds.has(service.id)) {
      errors.push(`Duplicate Service ID: "${service.id}" is defined more than once.`);
    }
    seenIds.add(service.id);
  }

  const configuredTypes = new Set(config.services.map((s) => s.type));

  for (const service of config.services) {
    const requirement = typeRequirements[service.type];
    if (requirement) {
      for (const requiredType of requirement.requires) {
        if (!configuredTypes.has(requiredType)) {
          errors.push(
            `Semantic Error: Service "${service.id}" of type "${service.type}" requires ${requirement.description}. Missing type: "${requiredType}".`
          );
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

