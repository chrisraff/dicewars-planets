// Groups fine hex/pentagon cells into a handful of larger, contiguous
// territories — the actual units the dicewars core plays with. Rather than
// a fixed territory count, each territory grows toward its own randomly
// sampled target size (normally distributed around `targetSize`, floored at
// `minSize`), so no territory grows unboundedly just because its neighbors
// happened to die out — that's what made territories feel "too big" before.
// Several territories grow concurrently (topped back up to `parallelism` as
// each one finishes) so shapes interleave organically instead of tiling in
// greedy sequential blocks.

function pickRandomFrom(set, rng) {
  const index = Math.floor(rng() * set.size);
  let i = 0;
  for (const item of set) {
    if (i === index) return item;
    i++;
  }
  return undefined;
}

// Box-Muller transform: a standard-normal sample from a uniform rng.
function sampleStandardNormal(rng) {
  let u1 = rng();
  while (u1 === 0) u1 = rng(); // avoid log(0)
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function sampleTargetSize(mean, sigma, minSize, rng) {
  const raw = mean + sampleStandardNormal(rng) * sigma;
  return Math.max(minSize, Math.round(raw));
}

// Growth leaves the occasional straggler below `minSize` — a leftover cell
// or two hemmed in by already-finished neighbors. Fold each one into
// whichever neighboring territory it shares the most border with, so the
// floor is an actual guarantee on the output, not just on the growth
// target. Mutates `territories` in place and renumbers ids afterward.
function mergeUndersizedTerritories(territories, minSize, byId) {
  let changed = true;
  while (changed) {
    changed = false;
    const owner = new Map();
    territories.forEach((t, idx) => {
      for (const cellId of t.cellIds) owner.set(cellId, idx);
    });

    for (let idx = 0; idx < territories.length; idx++) {
      if (territories.length === 1) break;
      const territory = territories[idx];
      if (territory.cellIds.length >= minSize) continue;

      const borderCounts = new Map();
      for (const cellId of territory.cellIds) {
        for (const n of byId.get(cellId).neighbors) {
          const neighborIdx = owner.get(n);
          if (neighborIdx === undefined || neighborIdx === idx) continue;
          borderCounts.set(neighborIdx, (borderCounts.get(neighborIdx) || 0) + 1);
        }
      }
      if (borderCounts.size === 0) continue; // no land neighbor to merge into

      let bestIdx = null;
      let bestCount = -1;
      for (const [neighborIdx, count] of borderCounts) {
        if (count > bestCount) {
          bestCount = count;
          bestIdx = neighborIdx;
        }
      }

      territories[bestIdx].cellIds.push(...territory.cellIds);
      territories.splice(idx, 1);
      changed = true;
      break; // indices shifted — restart the scan
    }
  }

  territories.forEach((t, idx) => { t.id = idx; });
}

export function groupIntoTerritories(cells, options = {}) {
  const {
    targetSize = 7,
    sigma = 2,
    minSize = 3,
    rng = Math.random,
    parallelism = 8,
  } = options;

  const byId = new Map(cells.map((c) => [c.id, c]));
  const unclaimed = new Set(cells.map((c) => c.id));
  const territories = [];
  const targets = [];

  function spawnTerritory() {
    if (unclaimed.size === 0) return null;
    const seedId = pickRandomFrom(unclaimed, rng);
    const territoryIndex = territories.length;
    territories.push({ id: territoryIndex, cellIds: [seedId] });
    targets.push(sampleTargetSize(targetSize, sigma, minSize, rng));
    unclaimed.delete(seedId);
    // `cells` may be a land-only subset, so drop neighbors outside it (ocean cells)
    const frontier = byId.get(seedId).neighbors.filter((n) => unclaimed.has(n));
    return { territoryIndex, frontier };
  }

  const active = [];
  while (unclaimed.size > 0 && active.length < parallelism) {
    const spawned = spawnTerritory();
    if (!spawned) break;
    active.push(spawned);
  }

  function retireAndMaybeReplace(index) {
    active.splice(index, 1);
    const spawned = spawnTerritory();
    if (spawned) active.push(spawned);
  }

  while (active.length > 0) {
    for (let a = active.length - 1; a >= 0; a--) {
      const { territoryIndex, frontier } = active[a];
      const territory = territories[territoryIndex];

      if (territory.cellIds.length >= targets[territoryIndex]) {
        retireAndMaybeReplace(a);
        continue;
      }

      let candidate;
      while (frontier.length > 0) {
        const pick = Math.floor(rng() * frontier.length);
        const id = frontier[pick];
        frontier.splice(pick, 1);
        if (unclaimed.has(id)) {
          candidate = id;
          break;
        }
      }

      if (candidate === undefined) {
        retireAndMaybeReplace(a); // this territory has nowhere left to grow
        continue;
      }

      territory.cellIds.push(candidate);
      unclaimed.delete(candidate);
      for (const n of byId.get(candidate).neighbors) {
        if (unclaimed.has(n)) frontier.push(n);
      }
    }
  }

  mergeUndersizedTerritories(territories, minSize, byId);

  const finalOwner = new Map();
  territories.forEach((t) => {
    for (const cellId of t.cellIds) finalOwner.set(cellId, t.id);
  });

  const edges = new Set();
  for (const cell of cells) {
    const a = finalOwner.get(cell.id);
    for (const n of cell.neighbors) {
      if (!finalOwner.has(n)) continue; // neighbor is outside this cell set (ocean)
      const b = finalOwner.get(n);
      if (a !== b) edges.add(a < b ? `${a}_${b}` : `${b}_${a}`);
    }
  }

  return {
    territories,
    edges: [...edges].map((key) => key.split('_').map(Number)),
    cellTerritory: finalOwner,
  };
}
