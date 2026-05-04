/**
 * @fileoverview Slot/Hook System
 * Handles registration of slots and hooks, then merges fragments deterministically.
 */

// ─── In-memory registries ─────────────────────────────────────────────────────

/** @type {Map<string, import('./types.js').SlotDefinition>} */
const slotRegistry = new Map();

/** @type {import('./types.js').HookDefinition[]} */
const hookRegistry = [];

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Register a slot so hooks can target it.
 * @param {import('./types.js').SlotDefinition} slot
 */
export function registerSlot(slot) {
  if (slotRegistry.has(slot.name)) {
    console.warn(`⚠️  Slot "${slot.name}" is already registered. Skipping duplicate.`);
    return;
  }
  slotRegistry.set(slot.name, slot);
}

/**
 * Register a hook to be injected into a slot.
 * @param {import('./types.js').HookDefinition} hook
 */
export function registerHook(hook) {
  if (!slotRegistry.has(hook.targetSlot)) {
    throw new Error(
      `Hook Safety Error: Hook "${hook.name}" targets slot "${hook.targetSlot}" which does not exist.\n` +
      `Tip: Ensure the module that exposes "${hook.targetSlot}" is loaded before this hook.`
    );
  }
  hookRegistry.push(hook);
}

// ─── Resolution ───────────────────────────────────────────────────────────────

/**
 * Resolve all hooks for a given slot, sorted by priority (deterministic).
 * @param {string} slotName
 * @param {Record<string, any>} config
 * @returns {Promise<import('./types.js').CodeFragment[]>}
 */
export async function resolveSlot(slotName, config) {
  const hooks = hookRegistry
    .filter((h) => h.targetSlot === slotName)
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      // Alphabetical fallback for 100% determinism
      return a.name.localeCompare(b.name);
    });

  const fragments = [];
  for (const hook of hooks) {
    try {
      const fragment = await hook.execute(config);
      fragments.push(fragment);
    } catch (err) {
      throw new Error(`Hook Execution Error in "${hook.name}": ${err.message}`);
    }
  }
  return fragments;
}

/**
 * Reset registries (useful for testing).
 */
export function resetHookSystem() {
  slotRegistry.clear();
  hookRegistry.length = 0;
}

export { slotRegistry, hookRegistry };
