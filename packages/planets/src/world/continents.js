// Groups fine hex/pentagon cells into a handful of larger, contiguous
// territories — the actual units the dicewars core plays with — the same
// way classic dicewars groups grid cells into areas: grow outward from
// random seeds, one cell at a time, until every cell belongs to a region.
function pickSeeds(cells, count, rng) {
  const pool = cells.map((c) => c.id);
  const seeds = [];
  for (let i = 0; i < count; i++) {
    const pick = Math.floor(rng() * pool.length);
    seeds.push(pool[pick]);
    pool.splice(pick, 1);
  }
  return seeds;
}

export function groupIntoTerritories(cells, territoryCount, rng = Math.random) {
  if (territoryCount > cells.length) {
    throw new Error(`cannot form ${territoryCount} territories from ${cells.length} cells`);
  }

  const byId = new Map(cells.map((c) => [c.id, c]));
  const owner = new Map(); // cellId -> territoryIndex
  const frontiers = pickSeeds(cells, territoryCount, rng).map((seedId, territoryIndex) => {
    owner.set(seedId, territoryIndex);
    return byId.get(seedId).neighbors.slice(); // frontier holds candidates, not the (already-owned) seed itself
  });

  let claimed = territoryCount;
  const active = frontiers.map((_, i) => i);

  while (claimed < cells.length && active.length > 0) {
    for (let a = active.length - 1; a >= 0; a--) {
      const territoryIndex = active[a];
      const frontier = frontiers[territoryIndex];

      // pop random unclaimed cells off this territory's frontier until one works
      let cellId;
      while (frontier.length > 0) {
        const pick = Math.floor(rng() * frontier.length);
        const candidate = frontier[pick];
        frontier.splice(pick, 1);
        if (!owner.has(candidate)) { cellId = candidate; break; }
      }

      if (cellId === undefined) {
        active.splice(a, 1); // this territory has nowhere left to grow
        continue;
      }

      owner.set(cellId, territoryIndex);
      claimed++;
      for (const n of byId.get(cellId).neighbors) {
        if (!owner.has(n)) frontier.push(n);
      }
    }
  }

  if (claimed < cells.length) {
    throw new Error('world generation left unclaimed cells (disconnected cell graph?)');
  }

  const territories = Array.from({ length: territoryCount }, (_, id) => ({ id, cellIds: [] }));
  for (const [cellId, territoryIndex] of owner) territories[territoryIndex].cellIds.push(cellId);

  const edges = new Set();
  for (const cell of cells) {
    for (const n of cell.neighbors) {
      const a = owner.get(cell.id);
      const b = owner.get(n);
      if (a !== b) edges.add(a < b ? `${a}_${b}` : `${b}_${a}`);
    }
  }

  return {
    territories,
    edges: [...edges].map((key) => key.split('_').map(Number)),
    cellTerritory: owner,
  };
}
