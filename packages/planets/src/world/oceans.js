function isConnected(ids, neighborsOf) {
  if (ids.size === 0) return true;
  const start = ids.values().next().value;
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const cur = stack.pop();
    for (const n of neighborsOf(cur)) {
      if (ids.has(n) && !seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen.size === ids.size;
}

// Carves ocean out of the sphere by growing a handful of blobs from random
// seeds, one cell at a time — like `groupIntoTerritories`'s flood fill, but
// removing instead of claiming. Never removes a cell that would split the
// remaining land into disconnected pieces, so whatever grouping runs on the
// leftover land afterward is guaranteed to produce a connected result.
export function carveOceans(cells, oceanFraction, rng = Math.random) {
  const byId = new Map(cells.map((c) => [c.id, c]));
  const land = new Set(cells.map((c) => c.id));
  const neighborsOf = (id) => byId.get(id).neighbors;
  const targetOceanCount = Math.round(cells.length * oceanFraction);

  function tryRemove(id) {
    if (!land.has(id)) return false;
    land.delete(id);
    if (!isConnected(land, neighborsOf)) {
      land.add(id);
      return false;
    }
    return true;
  }

  const pool = cells.map((c) => c.id);
  const seedCount = targetOceanCount > 0 ? Math.min(pool.length, 1 + Math.floor(rng() * 4)) : 0; // 1..4 ocean blobs
  const frontiers = [];
  for (let i = 0; i < seedCount && pool.length > 0; i++) {
    const pick = Math.floor(rng() * pool.length);
    const seed = pool[pick];
    pool.splice(pick, 1);
    if (tryRemove(seed)) frontiers.push(neighborsOf(seed).slice());
  }

  let removed = cells.length - land.size;
  const active = frontiers.map((_, i) => i);

  while (removed < targetOceanCount && active.length > 0) {
    for (let a = active.length - 1; a >= 0; a--) {
      const frontier = frontiers[active[a]];

      let candidate;
      while (frontier.length > 0) {
        const pick = Math.floor(rng() * frontier.length);
        const id = frontier[pick];
        frontier.splice(pick, 1);
        if (land.has(id)) {
          candidate = id;
          break;
        }
      }

      if (candidate === undefined) {
        active.splice(a, 1); // this blob has nowhere safe left to grow
        continue;
      }

      if (tryRemove(candidate)) {
        removed++;
        for (const n of neighborsOf(candidate)) {
          if (land.has(n)) frontier.push(n);
        }
        if (removed >= targetOceanCount) break;
      }
    }
  }

  return {
    landCellIds: land,
    oceanCellIds: new Set(cells.map((c) => c.id).filter((id) => !land.has(id))),
  };
}
