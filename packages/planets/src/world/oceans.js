import { dot } from '../geometry/vec3.js';

/**
 * What the ocean carver is aiming at, beyond "remove this many cells".
 *
 * A planet is boring when the water is one cap on one side and the land is
 * the cap opposite: a couple of peninsulas, nothing to sail round, and every
 * player looking at the same continent from a different edge of it. What
 * makes a planet worth looking at is water that *wraps* — a ring of land with
 * ocean over both poles, or the near miss of that, where the land almost
 * closes the loop and one narrow strait keeps the ocean a single body.
 *
 * Both of those are what you get from ocean basins that start far apart, so
 * that is what `seedCandidates` buys. The rest is a guard on the tail:
 * `landClustering` measures the cap that isn't wanted, and a carve that lands
 * above `maxClustering` is thrown away and tried again.
 */
export const OCEAN_TUNING = {
  // Never one basin: a single growing blob is a cap by construction, and it
  // was a quarter of every planet generated. Two makes a ring, three or four
  // a web of straits, and the spread between those is most of the variety.
  minBasins: 2,
  maxBasins: 4,
  // Best-candidate sampling: this many candidate cells are drawn for each
  // basin after the first, and the one furthest from every basin already
  // placed wins. Uniform seeds are the whole problem — at 40% water each
  // basin is angularly enormous, so two seeds an ordinary distance apart
  // merge into one lobe long before either finishes growing.
  //
  // This is where the work happens, and not where it looks like it should.
  // Adding basins does help on its own — four uniform ones score 0.217 median
  // against one's 0.345 — but placing them helps more for less: two spread
  // basins score 0.174. Count buys blobs, placement buys the ones that end up
  // opposite each other. Deliberately best-of-8 rather than an exact
  // antipode, so basins are reliably opposed without every planet arriving on
  // the same axis.
  seedCandidates: 8,
  // The most cap-like a planet may be. Measured rather than chosen: a cap
  // holding 60% of the sphere reads 0.40 and is the worst there is, a ring
  // reads near 0. Planets between 0.20 and 0.28 still wrap most of the way
  // round and are worth keeping for variety, so this sits at the top of that
  // band and catches only the tail the spread seeding misses.
  maxClustering: 0.28,
  // How many carves to spend looking for one under `maxClustering`. Cheap:
  // spread seeding already clears the bar 93% of the time, so this averages
  // 1.07 carves. The best of the attempts is kept whatever it scores — a
  // planet that is a little dull beats one that never arrives.
  attempts: 3,
  // Single cells of water with land all the way round them, punched after
  // the basins are grown. Two independent chances rather than a count, so
  // how *often* a planet has a lake and how many it can have are separate
  // numbers: at 0.25 a little over half of planets have none, most of the
  // rest have one, and about one in sixteen has two. They are meant to be
  // something noticed occasionally rather than a feature of every planet.
  maxLakes: 2,
  lakeChance: 0.25,
};

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

/**
 * How much of one side of the planet the land is: the mean resultant length
 * of the land cells' directions, 0 to 1.
 *
 * Cells are near enough equal area that counting them is weighting them, so
 * this is the length of the average land direction. Land spread evenly round
 * the sphere cancels to nothing; land gathered on one side does not. A
 * perfect cap covering fraction `f` of the sphere reads exactly `1 - f`, so
 * at the 40% ocean the game ships with, 0.40 is as cap-like as a planet can
 * physically get and 0 is a ring.
 *
 * The reason this rather than something shaped more like the question being
 * asked — count the ocean bodies, or look for a band — is that it is one
 * number over the whole planet with no thresholds inside it, and it agrees
 * with the eye across the whole range rather than at the ends. Ring planets
 * and horseshoe planets score alike despite having two ocean bodies and one
 * respectively, which is exactly right: they are the same planet either side
 * of one strait closing.
 */
export function landClustering(landCellIds, cells) {
  if (landCellIds.size === 0) return 0;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const cell of cells) {
    if (!landCellIds.has(cell.id)) continue;
    x += cell.center.x;
    y += cell.center.y;
    z += cell.center.z;
  }
  return Math.sqrt(x * x + y * y + z * z) / landCellIds.size;
}

// Where the ocean basins start. The first is anywhere; each one after it is
// the furthest of `seedCandidates` random draws from the basins already
// placed, measuring "furthest" as the smallest largest dot product — the
// same ordering as angular distance, without the acos.
function pickBasinSeeds(cells, count, rng, seedCandidates) {
  const seeds = [];
  for (let i = 0; i < count; i++) {
    if (seeds.length === 0) {
      seeds.push(cells[Math.floor(rng() * cells.length)]);
      continue;
    }
    let best = null;
    let bestNearest = Infinity;
    for (let k = 0; k < seedCandidates; k++) {
      const candidate = cells[Math.floor(rng() * cells.length)];
      let nearest = -2;
      for (const seed of seeds) {
        const d = dot(seed.center, candidate.center);
        if (d > nearest) nearest = d;
      }
      if (nearest < bestNearest) {
        bestNearest = nearest;
        best = candidate;
      }
    }
    seeds.push(best);
  }
  return seeds;
}

// Grows `seeds` into ocean one cell at a time, round-robin so no basin runs
// away with the budget, and never removing a cell that would split the
// remaining land — so whatever grouping runs on the leftover land afterward
// is guaranteed to produce a connected result.
function growBasins(cells, byId, targetOceanCount, seeds, rng) {
  const land = new Set(cells.map((c) => c.id));
  const neighborsOf = (id) => byId.get(id).neighbors;

  function tryRemove(id) {
    if (!land.has(id)) return false;
    land.delete(id);
    if (!isConnected(land, neighborsOf)) {
      land.add(id);
      return false;
    }
    return true;
  }

  const frontiers = [];
  for (const seed of seeds) {
    if (tryRemove(seed.id)) frontiers.push(neighborsOf(seed.id).slice());
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
        active.splice(a, 1); // this basin has nowhere safe left to grow
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

  return { land, tryRemove };
}

/**
 * Punches up to `count` single-cell lakes into grown land. Mutates `land`.
 *
 * A lake site is a land cell with land on every side, which is what tells a
 * lake apart from a bite out of the coast. It also means lakes can never end
 * up touching: punching one turns its neighbours into coast, and coast is not
 * a site — so two never merge into a pond without anything having to remember
 * where the last one went.
 *
 * Removing such a cell cannot disconnect the land either. Its neighbours ring
 * it — the cells around a cell of a Goldberg polyhedron form a cycle — so any
 * path that went through it can go round it instead. It is still routed
 * through the same `tryRemove` the basins use, because that makes the
 * guarantee unconditional rather than an argument in a comment.
 */
function punchLakes(cells, byId, land, count, rng, tryRemove) {
  const isSite = (id) => land.has(id) && byId.get(id).neighbors.every((n) => land.has(n));
  const sites = cells.filter((c) => isSite(c.id)).map((c) => c.id);

  let punched = 0;
  while (punched < count && sites.length > 0) {
    const pick = Math.floor(rng() * sites.length);
    const id = sites[pick];
    sites.splice(pick, 1);
    if (!isSite(id)) continue; // an earlier lake put this one on a coast
    if (tryRemove(id)) punched++;
  }
  return punched;
}

/**
 * Splits the sphere into land and water.
 *
 * Ocean basins are grown from seeds placed far apart, the result is scored
 * with `landClustering` and re-carved if it came out as one cap, and a lake
 * or two is punched into the land that survives. See `OCEAN_TUNING` for why
 * each of those is there.
 *
 * Lakes come out of the same water budget as the basins, so `oceanFraction`
 * stays what it says it is: the fraction of the planet that is water, however
 * that water happens to be arranged.
 */
export function carveOceans(cells, oceanFraction, rng = Math.random, options = {}) {
  const {
    minBasins = OCEAN_TUNING.minBasins,
    maxBasins = OCEAN_TUNING.maxBasins,
    seedCandidates = OCEAN_TUNING.seedCandidates,
    maxClustering = OCEAN_TUNING.maxClustering,
    attempts = OCEAN_TUNING.attempts,
    maxLakes = OCEAN_TUNING.maxLakes,
    lakeChance = OCEAN_TUNING.lakeChance,
  } = options;

  const byId = new Map(cells.map((c) => [c.id, c]));
  const targetOceanCount = Math.round(cells.length * oceanFraction);
  if (targetOceanCount <= 0) {
    return { landCellIds: new Set(cells.map((c) => c.id)), oceanCellIds: new Set() };
  }

  // Rolled here rather than after the carve because the lakes come out of
  // the same water budget the basins are grown to. A lake is only worth
  // having once there is an ocean to contrast it with, so the basins keep at
  // least one cell of that budget whatever the rolls say.
  let lakeCount = 0;
  for (let i = 0; i < maxLakes; i++) if (rng() < lakeChance) lakeCount++;
  lakeCount = Math.min(lakeCount, targetOceanCount - 1);
  const basinTarget = targetOceanCount - lakeCount;

  let best = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const basinCount = Math.min(
      cells.length,
      minBasins + Math.floor(rng() * (maxBasins - minBasins + 1))
    );
    const seeds = pickBasinSeeds(cells, basinCount, rng, seedCandidates);
    const grown = growBasins(cells, byId, basinTarget, seeds, rng);
    const clustering = landClustering(grown.land, cells);
    if (!best || clustering < best.clustering) best = { ...grown, clustering };
    if (clustering <= maxClustering) break;
  }

  const { land, tryRemove } = best;
  punchLakes(cells, byId, land, lakeCount, rng, tryRemove);

  return {
    landCellIds: land,
    oceanCellIds: new Set(cells.map((c) => c.id).filter((id) => !land.has(id))),
  };
}
