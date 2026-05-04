export interface CodeFragment {
  content: string;
  imports?: string[];
  npmDependencies?: Record<string, string>;
}

export interface SlotDefinition {
  name: string;
  description: string;
}

export interface HookDefinition {
  name: string;
  targetSlot: string;
  priority: number;
  execute: (config: any) => Promise<CodeFragment>;
}

export interface ModuleDefinition {
  id: string;
  provides: string[];
  requires: string[];
  slots: Record<string, SlotDefinition>;
  hooks: HookDefinition[];
}

export interface ServiceConfig {
  id: string;
  type: string;
  [key: string]: any;
}

export interface ProjectConfig {
  name: string;
}

export interface InternalConfig {
  project: ProjectConfig;
  services: ServiceConfig[];
}

// Intermediate Representation (IR)
export interface IRService {
  id: string;
  type: string;
  dependsOn: string[];
  config: Record<string, any>;
}

export interface IR {
  project: ProjectConfig;
  services: IRService[];
}
