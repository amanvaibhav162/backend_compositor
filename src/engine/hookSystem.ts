import type { Slot, Hook, HookResult, ModuleBootstrapConfig } from './types.js';

const slotRegistry: Map<string, Slot> = new Map();

const hookRegistry: Hook[] = [];

export function registerSlot(slot: Slot): void {
  if (slotRegistry.has(slot.name)) {
    console.warn(`⚠️  Slot "${slot.name}" is already registered. Skipping duplicate.`);
    return;
  }
  slotRegistry.set(slot.name, slot);
}

export function registerHook(hook: Hook): void {
  if (!slotRegistry.has(hook.targetSlot)) {
    throw new Error(
      `Hook Safety Error: Hook "${hook.name}" targets slot "${hook.targetSlot}" which does not exist.\n` +
      `Tip: Ensure the module that exposes "${hook.targetSlot}" is loaded before this hook.`
    );
  }
  if (hookRegistry.some(h => h.name === hook.name)) {
    return;
  }
  hookRegistry.push(hook);
}

export async function resolveSlot(slotName: string, config: ModuleBootstrapConfig): Promise<HookResult[]> {
  const hooks = hookRegistry
    .filter((h) => h.targetSlot === slotName)
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.name.localeCompare(b.name);
    });

  const fragments: HookResult[] = [];
  for (const hook of hooks) {
    try {
      const fragment = await hook.execute(config);
      fragments.push(fragment);
    } catch (err) {
      throw new Error(`Hook Execution Error in "${hook.name}": ${(err as Error).message}`);
    }
  }
  return fragments;
}

export function resetHookSystem(): void {
  slotRegistry.clear();
  hookRegistry.length = 0;
}

export { slotRegistry, hookRegistry };
