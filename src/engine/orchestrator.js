/**
 * @fileoverview DAG Orchestrator - Kahn's Algorithm
 * Takes an InternalConfig and returns a topologically sorted list of service IDs.
 */

/**
 * Build a dependency graph from services.
 * @param {import('./types.js').ServiceConfig[]} services
 * @returns {Map<string, string[]>}
 */
function buildGraph(services) {
  const graph = new Map();
  for (const svc of services) {
    graph.set(svc.id, svc.dependsOn ?? []);
  }
  return graph;
}

/**
 * Topological sort using Kahn's Algorithm.
 * Throws a descriptive error if a cycle is detected.
 * @param {import('./types.js').IR} ir
 * @returns {string[]} Sorted list of service IDs (execution order)
 */
export function topologicalSort(ir) {
  const services = ir.services;
  const graph = buildGraph(services);

  // Compute in-degrees
  const inDegree = new Map();
  for (const id of graph.keys()) inDegree.set(id, 0);

  for (const [, deps] of graph) {
    for (const dep of deps) {
      if (!inDegree.has(dep)) {
        throw new Error(`Dependency Error: Service "${dep}" is referenced but not defined.`);
      }
      inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
    }
  }

  // Queue all nodes with in-degree 0
  const queue = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted = [];
  while (queue.length > 0) {
    // Sort for determinism — same input always = same order
    queue.sort();
    const node = queue.shift();
    sorted.push(node);

    for (const [id, deps] of graph) {
      if (deps.includes(node)) {
        const newDegree = (inDegree.get(id) ?? 0) - 1;
        inDegree.set(id, newDegree);
        if (newDegree === 0) queue.push(id);
      }
    }
  }

  // If not all nodes are sorted, there's a cycle
  if (sorted.length !== services.length) {
    const remaining = [...inDegree.entries()]
      .filter(([, d]) => d > 0)
      .map(([id]) => id);
    throw new Error(
      `Dependency Cycle Detected: Cannot resolve execution order.\n` +
      `Involved services: ${remaining.join(' → ')}\n` +
      `Tip: Check for circular dependencies between these services.`
    );
  }

  return sorted;
}
