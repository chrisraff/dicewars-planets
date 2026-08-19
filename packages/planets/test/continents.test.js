import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateIcosphereCells } from '../src/geometry/icosphere.js';
import { groupIntoTerritories } from '../src/world/continents.js';

function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

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
  const { territories } = groupIntoTerritories(cells, 12, seededRng(7));

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
  const { edges } = groupIntoTerritories(cells, 10, seededRng(3));

  for (const [a, b] of edges) assert.notEqual(a, b);

  const asSet = new Set(edges.map(([a, b]) => (a < b ? `${a}_${b}` : `${b}_${a}`)));
  assert.equal(asSet.size, edges.length); // no duplicate edges
});

test('rejects asking for more territories than cells', () => {
  const cells = generateIcosphereCells(0); // just the 12 base vertices
  assert.throws(() => groupIntoTerritories(cells, 13, seededRng(1)));
});
