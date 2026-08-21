import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateIcosphereCells } from '../src/geometry/icosphere.js';
import { groupIntoTerritories } from '../src/world/continents.js';
import { seededRng } from '@dicewars/core/test-support';

function isConnected(cellIds, cellsById) {
  const set = new Set(cellIds);
  const seen = new Set([cellIds[0]]);
  const stack = [cellIds[0]];
  while (stack.length) {
    const id = stack.pop();
    for (const n of cellsById.get(id).neighbors) {
      if (set.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
    }
  }
  return seen.size === cellIds.length;
}

test('every cell is claimed by exactly one connected territory', () => {
  const cells = generateIcosphereCells(2);
  const cellsById = new Map(cells.map((c) => [c.id, c]));
  const { territories } = groupIntoTerritories(cells, { rng: seededRng(7) });

  const allCellIds = territories.flatMap((t) => t.cellIds);
  assert.equal(allCellIds.length, cells.length);
  assert.equal(new Set(allCellIds).size, cells.length); // no cell claimed twice

  for (const t of territories) {
    assert.ok(t.cellIds.length > 0);
    assert.ok(isConnected(t.cellIds, cellsById), `territory ${t.id} should be connected`);
  }
});

test('territory adjacency is symmetric and has no self-loops', () => {
  const cells = generateIcosphereCells(2);
  const { edges } = groupIntoTerritories(cells, { rng: seededRng(3) });

  for (const [a, b] of edges) assert.notEqual(a, b);

  const asSet = new Set(edges.map(([a, b]) => (a < b ? `${a}_${b}` : `${b}_${a}`)));
  assert.equal(asSet.size, edges.length); // no duplicate edges
});

test('territory sizes cluster around the target size and respect the floor', () => {
  const cells = generateIcosphereCells(3); // 642 cells, plenty to sample a real distribution
  const { territories } = groupIntoTerritories(cells, {
    targetSize: 7,
    sigma: 2,
    minSize: 3,
    rng: seededRng(42),
  });

  const sizes = territories.map((t) => t.cellIds.length);
  for (const size of sizes) assert.ok(size >= 3, `territory of size ${size} is below the floor`);

  const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  assert.ok(mean > 4 && mean < 10, `mean territory size ${mean} should be roughly around the target of 7`);
});

test('a tighter sigma produces less size variance than a looser one', () => {
  const cells = generateIcosphereCells(3);
  const tight = groupIntoTerritories(cells, { targetSize: 7, sigma: 0.5, minSize: 3, rng: seededRng(1) });
  const loose = groupIntoTerritories(cells, { targetSize: 7, sigma: 4, minSize: 3, rng: seededRng(1) });

  const variance = (territories) => {
    const sizes = territories.map((t) => t.cellIds.length);
    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    return sizes.reduce((sum, s) => sum + (s - mean) ** 2, 0) / sizes.length;
  };

  assert.ok(variance(tight.territories) < variance(loose.territories));
});

test('handles an empty cell set', () => {
  const { territories, edges, cellTerritory } = groupIntoTerritories([], { rng: seededRng(1) });
  assert.deepEqual(territories, []);
  assert.deepEqual(edges, []);
  assert.equal(cellTerritory.size, 0);
});
