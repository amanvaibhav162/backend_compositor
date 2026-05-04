/**
 * @fileoverview BackForge Type Definitions (JSDoc)
 * Defines the core data shapes for the entire compiler pipeline.
 */

/**
 * @typedef {Object} CodeFragment
 * @property {string} content - The raw code string to inject
 * @property {string[]} [imports] - Import statements needed by this fragment
 * @property {Record<string, string>} [npmDependencies] - npm packages required
 */

/**
 * @typedef {Object} SlotDefinition
 * @property {string} name - Unique slot identifier (e.g. "express:middleware")
 * @property {string} description - Human-readable description
 */

/**
 * @typedef {Object} HookDefinition
 * @property {string} name - Hook identifier
 * @property {string} targetSlot - Which slot this hook attaches to
 * @property {number} priority - Lower = runs first (e.g. 10 runs before 20)
 * @property {function(Record<string, any>): Promise<CodeFragment>} execute - Returns a code fragment
 */

/**
 * @typedef {Object} ModuleDefinition
 * @property {string} id - Unique module ID (e.g. "auth:jwt")
 * @property {string[]} provides - What capabilities this module provides
 * @property {string[]} requires - Module IDs this module depends on
 * @property {Record<string, SlotDefinition>} slots - Injection points this module exposes
 * @property {HookDefinition[]} hooks - Hooks this module injects into other slots
 */

/**
 * @typedef {Object} ProjectConfig
 * @property {string} name - Project name
 */

/**
 * @typedef {Object} ServiceConfig
 * @property {string} id - Service ID (e.g. "database")
 * @property {string} type - Service type (e.g. "mongodb", "jwt")
 */

/**
 * @typedef {Object} InternalConfig
 * @property {ProjectConfig} project
 * @property {ServiceConfig[]} services
 */

/**
 * @typedef {Object} IRService
 * @property {string} id
 * @property {string} type
 * @property {string[]} dependsOn
 * @property {Record<string, any>} config
 */

/**
 * @typedef {Object} IR
 * @property {ProjectConfig} project
 * @property {IRService[]} services
 */

// Export a dummy object so this file is treated as an ES module
export {};
