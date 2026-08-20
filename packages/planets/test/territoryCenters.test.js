import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDiceMountPoint, findAllDiceMountPoints } from '../src/world/territoryCenters.js';
import { generateIcosphereCells } from '../src/geometry/icosphere.js';
import { groupIntoTerritories } from '../src/world/continents.js';
import { normalize, dot } from '../src/geometry/vec3.js';

function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

test('uses the projected centroid when it lands within the territory', () => {
  // a compact "plus" shape: a hub cell plus four symmetric neighbors, all
  // in the territory — the centroid should land back on the hub itself.
  const theta = 0.3;
  const arms = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((phi, i) => ({
    id: i + 1,
    center: {
      x: Math.sin(theta) * Math.cos(phi),
      y: Math.sin(theta) * Math.sin(phi),
      z: Math.cos(theta),
    },
  }));
  const hub = { id: 0, center: { x: 0, y: 0, z: 1 } };
  const cellsById = new Map([hub, ...arms].map((c) => [c.id, c]));
  const cellIds = [...cellsById.keys()];

  const point = findDiceMountPoint(cellIds, cellsById);

  const expectedCentroid = normalize(
    cellIds.map((id) => cellsById.get(id).center).reduce((a, b) => ({
      x: a.x + b.x, y: a.y + b.y, z: a.z + b.z,
    }))
  );
  assert.ok(Math.abs(dot(point, expectedCentroid) - 1) < 1e-9);
});

test('falls back to the nearest territory cell when the centroid lands outside the shape', () => {
  // three cells in a small ring around the north pole, symmetric enough
  // that their centroid, projected onto the sphere, lands exactly on the
  // north pole itself — which belongs to a *different* (excluded) cell,
  // like a crescent territory whose middle is actually someone else's land.
  const theta = 0.3;
  const ring = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3].map((phi, i) => ({
    id: i,
    center: {
      x: Math.sin(theta) * Math.cos(phi),
      y: Math.sin(theta) * Math.sin(phi),
      z: Math.cos(theta),
    },
  }));
  const cellsById = new Map(ring.map((c) => [c.id, c]));
  cellsById.set(99, { id: 99, center: { x: 0, y: 0, z: 1 } }); // excluded hub, sits at the centroid direction

  const cellIds = ring.map((c) => c.id);
  const point = findDiceMountPoint(cellIds, cellsById);

  const isOwnCell = cellIds.some((id) => {
    const c = cellsById.get(id).center;
    return point.x === c.x && point.y === c.y && point.z === c.z;
  });
  assert.ok(isOwnCell, "fallback should snap to one of the territory's own cell centers");
});

test('a single-cell territory mounts on that cell', () => {
  const cellsById = new Map([[5, { id: 5, center: { x: 0, y: 1, z: 0 } }]]);
  const point = findDiceMountPoint([5], cellsById);
  assert.deepEqual(point, { x: 0, y: 1, z: 0 });
});

test('every territory gets a mount point', () => {
  const cells = generateIcosphereCells(2);
  const cellsById = new Map(cells.map((c) => [c.id, c]));
  const { territories } = groupIntoTerritories(cells, { rng: seededRng(11) });

  const points = findAllDiceMountPoints(territories, cellsById);
  assert.equal(points.size, territories.length);
  for (const t of territories) assert.ok(points.has(t.id));
});
