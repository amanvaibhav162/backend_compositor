function buildGraph(services) {
  const graph = new Map();
  for (const svc of services) {
    graph.set(svc.id, svc.dependsOn ?? []);
  }
  return graph;
}

export function topologicalSort(ir) {
  const services = ir.services;
  const graph = buildGraph(services);

  const inDegree = new Map();
  for (const id of graph.keys()) inDegree.set(id, graph.get(id).length);

  const dependents = new Map();
  for (const id of graph.keys()) dependents.set(id, []);

  for (const [id, deps] of graph) {
    for (const dep of deps) {
      if (!dependents.has(dep)) {
        throw new Error(`Dependency Error: Service "${dep}" is referenced but not defined.`);
      }
      dependents.get(dep).push(id);
    }
  }

  const queue = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted = [];
  while (queue.length > 0) {
    queue.sort();
    const node = queue.shift();
    sorted.push(node);

    for (const dependent of dependents.get(node)) {
      const newDegree = inDegree.get(dependent) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) queue.push(dependent);
    }
  }

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
