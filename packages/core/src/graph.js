// World topology only: which node ids touch which. No coordinates, no shape —
// that's the concern of whatever world generator (planets, classic, ...) builds this.

export function createGraph(nodeIds, edges) {
  const adjacency = new Map(nodeIds.map((id) => [id, new Set()]));
  for (const [a, b] of edges) {
    linkEdge(adjacency, a, b);
  }
  return { adjacency };
}

function linkEdge(adjacency, a, b) {
  if (!adjacency.has(a) || !adjacency.has(b)) {
    throw new Error(`edge references unknown node: ${a} <-> ${b}`);
  }
  adjacency.get(a).add(b);
  adjacency.get(b).add(a);
}

export function neighbors(graph, nodeId) {
  return graph.adjacency.get(nodeId) ?? new Set();
}

export function areAdjacent(graph, a, b) {
  return graph.adjacency.get(a)?.has(b) ?? false;
}

// Replaces the neighbor set for `nodeId` and keeps the reverse edges in sync.
// This is the hook a moving-moon (or any dynamic topology) mode uses between
// rounds: node identity, owner and dice are untouched, only who-touches-whom
// changes.
export function setNeighbors(graph, nodeId, neighborIds) {
  if (!graph.adjacency.has(nodeId)) {
    throw new Error(`unknown node: ${nodeId}`);
  }
  const adjacency = new Map(
    [...graph.adjacency].map(([id, set]) => [id, new Set(set)])
  );
  const next = new Set(neighborIds);

  for (const old of adjacency.get(nodeId)) {
    if (!next.has(old)) adjacency.get(old).delete(nodeId);
  }
  for (const n of next) {
    if (!adjacency.has(n)) throw new Error(`unknown node: ${n}`);
    adjacency.get(n).add(nodeId);
  }
  adjacency.set(nodeId, next);

  return { adjacency };
}
