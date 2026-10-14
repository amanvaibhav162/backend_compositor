import { z } from 'zod';
import type { BackForgeConfig } from './types.js';
import { validateVersionOverride } from './catalog.js';

export const ServiceConfigSchema = z.object({
  id: z.string().min(1, 'Service id cannot be empty').describe('Unique identifier for this service instance (e.g. "express", "database", "auth")'),
  type: z.string().min(1, 'Service type cannot be empty').describe('Module type to load: "express", "mongodb", "postgres", "jwt", or "oauth"'),
  options: z.object({
    dependencies: z.record(z.string(), z.string()).optional().describe('Custom dependency semver overrides for this service'),
    devDependencies: z.record(z.string(), z.string()).optional().describe('Custom devDependency semver overrides for this service'),
  }).passthrough().optional().default({}).describe('Module-specific configuration options and dependency overrides'),
}).passthrough().describe('Configured backend service definition');

const ProjectConfigSchema = z.object({
  name: z.string().min(1, 'Project name cannot be empty').describe('Name of the backend project and primary package identifier'),
  nix: z.boolean().optional().default(false).describe('Generate hermetic Nix flake and shell for reproducible OS/runtime environments'),
}).describe('Project metadata and global settings');

export const BackForgeConfigSchema = z.object({
  project: ProjectConfigSchema,
  services: z.array(ServiceConfigSchema).min(1, 'At least one service is required').describe('List of backend services to compose'),
}).describe('BackForge declarative backend configuration');

export const SERVICE_TYPE_REQUIREMENTS: Record<string, { requires: string[]; description: string }> = {
  mongodb: { requires: ['express'], description: 'an Express server (type: "express")' },
  postgres: { requires: ['express'], description: 'an Express server (type: "express")' },
  jwt: { requires: ['express'], description: 'an Express server (type: "express") and a database ("mongodb" or "postgres")' },
  oauth: { requires: ['express', 'jwt'], description: 'an Express server, database ("mongodb" or "postgres"), and JWT Auth (type: "jwt")' },
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
  const hasDb = configuredTypes.has('mongodb') || configuredTypes.has('postgres');

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

    if ((service.type === 'jwt' || service.type === 'oauth') && !hasDb) {
      errors.push(
        `Semantic Error: Service "${service.id}" of type "${service.type}" requires a configured database ("mongodb" or "postgres").`
      );
    }

    // Validate user version overrides if supplied in options
    const opts = service.options as Record<string, unknown> | undefined;
    const userDeps = (opts?.dependencies as Record<string, string>) || {};
    const userDevDeps = (opts?.devDependencies as Record<string, string>) || {};

    for (const [pkg, range] of Object.entries({ ...userDeps, ...userDevDeps })) {
      const check = validateVersionOverride(pkg, range);
      if (!check.valid) {
        errors.push(`Service "${service.id}" version override error: ${check.error}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
