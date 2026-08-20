import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateIcosphereCells } from '../src/geometry/icosphere.js';
import { groupIntoTerritories } from '../src/world/continents.js';
import { buildTerritoryBoundaries } from '../src/render/buildTerritoryBoundaries.js';
import { length } from '../src/geometry/vec3.js';

function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function countExpectedBoundaryEdges(cells, cellTerritory) {
  let count = 0;
  for (const cell of cells) {
    const owner = cellTerritory.get(cell.id);
    if (owner === undefined) continue;
    cell.neighbors.forEach((neighborId, i) => {
      if (neighborId <= cell.id) return;
      const neighborOwner = cellTerritory.get(neighborId);
      if (neighborOwner !== undefined && neighborOwner !== owner) count++;
    });
  }
  return count;
}

test('emits exactly one segment per cell-adjacency crossing a territory boundary', () => {
  const cells = generateIcosphereCells(2);
  const { cellTerritory } = groupIntoTerritories(cells, { rng: seededRng(9) });

  const expected = countExpectedBoundaryEdges(cells, cellTerritory);
  const { positions } = buildTerritoryBoundaries(cells, cellTerritory);

  assert.equal(positions.length, expected * 6); // 2 points * 3 coords per segment
});

test('lifts segment endpoints slightly off the unit sphere', () => {
  const cells = generateIcosphereCells(2);
  const { cellTerritory } = groupIntoTerritories(cells, { rng: seededRng(9) });
  const { positions } = buildTerritoryBoundaries(cells, cellTerritory, { liftScale: 1.01 });

  for (let i = 0; i < positions.length; i += 3) {
    const p = { x: positions[i], y: positions[i + 1], z: positions[i + 2] };
    assert.ok(Math.abs(length(p) - 1.01) < 1e-6);
  }
});

test('a single territory covering all cells has no boundaries', () => {
  const cells = generateIcosphereCells(1);
  const cellTerritory = new Map(cells.map((c) => [c.id, 0]));
  const { positions } = buildTerritoryBoundaries(cells, cellTerritory);
  assert.equal(positions.length, 0);
});
