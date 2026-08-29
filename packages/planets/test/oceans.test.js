import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateIcosphereCells } from '../src/geometry/icosphere.js';
import { carveOceans, landClustering, OCEAN_TUNING } from '../src/world/oceans.js';
import { seededRng } from '@dicewars/core/test-support';

function isConnected(ids, cellsById) {
  const set = new Set(ids);
  const start = ids.values().next().value;
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const id = stack.pop();
    for (const n of cellsById.get(id).neighbors) {
      if (set.has(n) && !seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen.size === set.size;
}

// Sizes of the connected bodies of water, largest first.
function waterBodies(oceanCellIds, cellsById) {
  const seen = new Set();
  const sizes = [];
  for (const id of oceanCellIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const stack = [id];
    let size = 0;
    while (stack.length) {
      const cur = stack.pop();
      size++;
      for (const n of cellsById.get(cur).neighbors) {
        if (oceanCellIds.has(n) && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}

// The planets a player actually gets: whole-range seeds, because an LCG's
// first draw barely moves across small ones and every planet built from
// seeds 1..200 would start from nearly the same number.
function playableSeeds(count, from = 20260828) {
  const picker = seededRng(from);
  return Array.from({ length: count }, () => Math.floor(picker() * 4294967296) >>> 0);
}

test('land and ocean partition every cell exactly once', () => {
  const cells = generateIcosphereCells(2);
  const { landCellIds, oceanCellIds } = carveOceans(cells, 0.4, seededRng(11));

  assert.equal(landCellIds.size + oceanCellIds.size, cells.length);
  for (const id of landCellIds) assert.ok(!oceanCellIds.has(id));
});

test('carves out a meaningful amount of ocean', () => {
  const cells = generateIcosphereCells(2);
  const { oceanCellIds } = carveOceans(cells, 0.4, seededRng(5));
  assert.ok(oceanCellIds.size > cells.length * 0.1);
});

test('never disconnects the remaining land', () => {
  const cells = generateIcosphereCells(3);
  const cellsById = new Map(cells.map((c) => [c.id, c]));
  const { landCellIds } = carveOceans(cells, 0.5, seededRng(99), { lakeChance: 1 });

  assert.ok(isConnected(landCellIds, cellsById));
});

test('zero ocean fraction leaves all cells as land', () => {
  const cells = generateIcosphereCells(1);
  const { landCellIds, oceanCellIds } = carveOceans(cells, 0, seededRng(1));
  assert.equal(landCellIds.size, cells.length);
  assert.equal(oceanCellIds.size, 0);
});

// `landClustering` is the whole basis for calling a planet boring, so what is
// worth pinning is that it agrees with the geometry it claims to measure —
// not that it returns whatever it happens to return today. A cap covering
// fraction `f` of the sphere has a mean direction of length exactly `1 - f`,
// which is a number the implementation is never told.
test('landClustering scores a cap at 1 minus its share of the sphere', () => {
  const points = [];
  const n = 4000;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    points.push({ id: i, center: { x: Math.cos(goldenAngle * i) * r, y, z: Math.sin(goldenAngle * i) * r } });
  }

  for (const fraction of [0.25, 0.5, 0.6, 0.75]) {
    // Evenly spaced by area, so the first `fraction` of them is exactly a cap.
    const cap = new Set(points.slice(0, Math.round(n * fraction)).map((p) => p.id));
    assert.ok(
      Math.abs(landClustering(cap, points) - (1 - fraction)) < 0.01,
      `cap of ${fraction} scored ${landClustering(cap, points)}, expected ${1 - fraction}`
    );
  }

  const whole = new Set(points.map((p) => p.id));
  assert.ok(landClustering(whole, points) < 0.01);
});

// The distinction the measure exists to draw: a band of land round the
// planet's middle covers the same area as a cap and is the good case, so a
// measure that only counted land would call them the same planet.
test('landClustering tells a band of land from a cap of the same size', () => {
  const points = [];
  const n = 4000;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    points.push({ id: i, center: { x: Math.cos(goldenAngle * i) * r, y, z: Math.sin(goldenAngle * i) * r } });
  }

  const cap = new Set(points.slice(0, Math.round(n * 0.6)).map((p) => p.id));
  const band = new Set(points.filter((p) => Math.abs(p.center.y) <= 0.6).map((p) => p.id));

  assert.ok(Math.abs(band.size / n - 0.6) < 0.02, 'band should cover the same 60% as the cap');
  assert.ok(landClustering(band, points) < 0.02);
  assert.ok(landClustering(cap, points) > 0.35);
});

// The bug this generator had: ocean seeds were placed uniformly at random, so
// at 40% water — where every basin is angularly enormous — two seeds an
// ordinary distance apart merged into one lobe long before either finished
// growing, and the planet came out as a cap of land facing a cap of ocean.
//
// Where the fix is, and it is not where it looks: adding basins does help, so
// the tempting change is to raise the count and stop. It buys less than
// placing them, which is the thing worth holding still — two basins put apart
// beat four dropped at random, on the same planets.
test('spreading the ocean seeds beats adding more of them', () => {
  const cells = generateIcosphereCells(2);
  const seeds = playableSeeds(40);

  const clusteringWith = (options) => {
    const scores = seeds.map((seed) => {
      const { landCellIds } = carveOceans(cells, 0.4, seededRng(seed), options);
      return landClustering(landCellIds, cells);
    });
    return scores.sort((a, b) => a - b)[Math.floor(scores.length / 2)];
  };

  const uniform = (n) => clusteringWith({ minBasins: n, maxBasins: n, seedCandidates: 1, attempts: 1 });
  const spreadTwo = clusteringWith({ minBasins: 2, maxBasins: 2, attempts: 1 });

  // One basin from a uniform seed is what shipped a quarter of the time, and
  // is a cap by construction — there is only one blob for the water to be.
  assert.ok(uniform(1) > OCEAN_TUNING.maxClustering, `one uniform basin was ${uniform(1)}`);
  assert.ok(uniform(2) > OCEAN_TUNING.maxClustering, `two uniform basins were ${uniform(2)}`);
  assert.ok(
    spreadTwo < uniform(4),
    `two spread basins should beat four uniform ones: ${spreadTwo} vs ${uniform(4)}`
  );
});

test('no planet a player can be dealt is a cap of land facing a cap of ocean', () => {
  const cells = generateIcosphereCells(3);
  for (const seed of playableSeeds(30)) {
    const { landCellIds } = carveOceans(cells, 0.4, seededRng(seed));
    const clustering = landClustering(landCellIds, cells);
    assert.ok(
      clustering <= OCEAN_TUNING.maxClustering,
      `seed ${seed} scored ${clustering.toFixed(3)}, over ${OCEAN_TUNING.maxClustering}`
    );
  }
});

// A lake has to read as a lake rather than as a pond or a bay, so the claim
// is about the shape of every body of water on the planet: the basins, and
// then single cells. Nothing in between, and nothing joined on to a coast.
test('lakes are single cells of water, never joined to each other', () => {
  const cells = generateIcosphereCells(3);
  const cellsById = new Map(cells.map((c) => [c.id, c]));
  let lakesSeen = 0;

  for (const seed of playableSeeds(25, 4242)) {
    const { landCellIds, oceanCellIds } = carveOceans(cells, 0.4, seededRng(seed), { lakeChance: 1 });
    assert.ok(isConnected(landCellIds, cellsById), `seed ${seed} split the land`);

    for (const size of waterBodies(oceanCellIds, cellsById)) {
      assert.ok(size === 1 || size > 20, `seed ${seed} has a body of water ${size} cells across`);
      if (size === 1) lakesSeen++;
    }
  }

  assert.ok(lakesSeen > 0, 'asking for lakes should produce some');
});

test('a lake is surrounded by land on every side', () => {
  const cells = generateIcosphereCells(3);
  const cellsById = new Map(cells.map((c) => [c.id, c]));
  const { landCellIds, oceanCellIds } = carveOceans(cells, 0.4, seededRng(20260828), { lakeChance: 1 });

  const singles = [...oceanCellIds].filter(
    (id) => !cellsById.get(id).neighbors.some((n) => oceanCellIds.has(n))
  );
  assert.ok(singles.length > 0);
  for (const id of singles) {
    for (const n of cellsById.get(id).neighbors) assert.ok(landCellIds.has(n));
  }
});

test('basins alone never leave a stray cell of water inland', () => {
  const cells = generateIcosphereCells(3);
  const cellsById = new Map(cells.map((c) => [c.id, c]));
  for (const seed of playableSeeds(20, 77)) {
    const { oceanCellIds } = carveOceans(cells, 0.4, seededRng(seed), { maxLakes: 0 });
    for (const size of waterBodies(oceanCellIds, cellsById)) {
      assert.ok(size > 1, `seed ${seed} produced a one-cell body of water with no lake asked for`);
    }
  }
});

// Lakes are spent out of the same budget the basins are grown to, so
// `oceanFraction` keeps meaning "how much of the planet is water" however
// that water ends up arranged — the alternative quietly hands a planet with
// two lakes two fewer cells of land than one without.
test('lakes come out of the water budget rather than on top of it', () => {
  const cells = generateIcosphereCells(3);
  const expected = Math.round(cells.length * 0.4);

  for (const seed of playableSeeds(10, 5150)) {
    const none = carveOceans(cells, 0.4, seededRng(seed), { maxLakes: 0 });
    const some = carveOceans(cells, 0.4, seededRng(seed), { lakeChance: 1 });
    assert.equal(none.oceanCellIds.size, expected);
    assert.equal(some.oceanCellIds.size, expected);
  }
});
