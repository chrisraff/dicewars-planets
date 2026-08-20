import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateIcosphereCells } from '../src/geometry/icosphere.js';
import { carveOceans } from '../src/world/oceans.js';

function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

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
  const { landCellIds } = carveOceans(cells, 0.5, seededRng(99));

  assert.ok(isConnected(landCellIds, cellsById));
});

test('zero ocean fraction leaves all cells as land', () => {
  const cells = generateIcosphereCells(1);
  const { landCellIds, oceanCellIds } = carveOceans(cells, 0, seededRng(1));
  assert.equal(landCellIds.size, cells.length);
  assert.equal(oceanCellIds.size, 0);
});
