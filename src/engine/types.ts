import type { z } from 'zod';
import type { BackForgeConfigSchema, ServiceConfigSchema } from './config.js';

export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;
export type BackForgeConfig = z.infer<typeof BackForgeConfigSchema>;

export interface Slot {
  name: string;
  description: string;
}

export interface HookResult {
  content?: string;
  imports?: string[];
}

export interface Hook {
  name: string;
  targetSlot: string;
  priority: number;
  execute(config: ModuleBootstrapConfig): Promise<HookResult>;
}

export type SlotResolver = (slotName: string, config: ModuleBootstrapConfig) => Promise<HookResult[]>;

export interface ModuleDefinition {
  id: string;
  provides: string[];
  requires: string[];
  dependencies: Record<string, string>;
  envVars: string;
  slots?: Record<string, Slot>;
  hooks?: Hook[];
  bootstrap(config: ModuleBootstrapConfig, resolveSlot?: SlotResolver): Promise<void>;
}

export interface IRService {
  id: string;
  type: string;
  moduleId: string;
  dependsOn: string[];
  config: ServiceConfig;
}

export interface IR {
  project: { name: string };
  services: IRService[];
}

export interface ModuleBootstrapConfig {
  project: { name: string };
  services?: ServiceConfig[];
  options: Record<string, unknown>;
  [key: string]: unknown;
}
