import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findDiceMountPoint,
  findAllDiceMountPoints,
  estimateCellSpacing,
} from '../src/world/territoryCenters.js';
import { generateIcosphereCells } from '../src/geometry/icosphere.js';
import { groupIntoTerritories } from '../src/world/continents.js';
import { normalize, dot } from '../src/geometry/vec3.js';
import { seededRng } from '@dicewars/core/test-support';

// A patch of square-grid cells around the north pole, spaced `spacing` apart,
// with grid adjacency filled in so cell spacing can be measured off them.
function gridCells(coords, spacing = 0.05) {
  const key = ([u, v]) => `${u},${v}`;
  const ids = new Map(coords.map((c, i) => [key(c), i]));
  return coords.map(([u, v], i) => ({
    id: i,
    center: normalize({ x: u * spacing, y: v * spacing, z: 1 }),
    neighbors: [[u + 1, v], [u - 1, v], [u, v + 1], [u, v - 1]]
      .map((c) => ids.get(key(c)))
      .filter((id) => id !== undefined),
  }));
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

test('rejects a centroid that sits inside the territory but hard against a border', () => {
  //  A B      the centroid of this C lands inside cell C, yet only 0.6 cells
  //  C .      from the notch — dice there would straddle the seam — so it
  //  E F      should snap back to C's own center, a full cell clear of it.
  const coords = [[0, 2], [1, 2], [0, 1], [0, 0], [1, 0], [1, 1]];
  const cells = gridCells(coords);
  const cellsById = new Map(cells.map((c) => [c.id, c]));
  const notch = cells[5].id;
  const cellIds = cells.map((c) => c.id).filter((id) => id !== notch);

  const point = findDiceMountPoint(cellIds, cellsById);

  const elbow = cells[2].center; // the cell at [0, 1]
  assert.ok(dot(point, elbow) > 1 - 1e-9, 'should snap to the elbow of the C');
});

test('keeps the centroid of a compact territory that clears every border', () => {
  //  . B .    a plus, with the surrounding ring foreign: the centroid lands
  //  D E F    on the hub, a full cell from anything the territory does not
  //  . H .    own, so it is left alone.
  const coords = [
    [1, 2], [0, 1], [1, 1], [2, 1], [1, 0],
    [0, 2], [2, 2], [0, 0], [2, 0], [3, 1], [-1, 1],
  ];
  const cells = gridCells(coords);
  const cellsById = new Map(cells.map((c) => [c.id, c]));
  const cellIds = [0, 1, 2, 3, 4];

  const point = findDiceMountPoint(cellIds, cellsById);

  const centroid = normalize(cellIds.map((id) => cells[id].center).reduce((a, b) => ({
    x: a.x + b.x, y: a.y + b.y, z: a.z + b.z,
  })));
  assert.deepEqual(point, centroid, 'the centroid itself should be used, unsnapped');
  assert.ok(dot(point, cells[2].center) > 1 - 1e-6, 'and it sits on the hub');
});

test('a territory with nowhere clear still lands on its most buried cell', () => {
  // a lone cell ringed by foreign ones: no placement is a full cell from the
  // border, so the best available (its own center) is used rather than none.
  const coords = [[1, 1], [0, 1], [2, 1], [1, 0], [1, 2]];
  const cells = gridCells(coords);
  const cellsById = new Map(cells.map((c) => [c.id, c]));

  const point = findDiceMountPoint([0], cellsById);

  assert.ok(dot(point, cells[0].center) > 1 - 1e-9);
});

test('mount points on a generated planet keep clear of foreign cells', () => {
  const cells = generateIcosphereCells(3);
  const cellsById = new Map(cells.map((c) => [c.id, c]));
  const { territories } = groupIntoTerritories(cells, { rng: seededRng(7) });
  const spacing = estimateCellSpacing(cellsById);

  const points = findAllDiceMountPoints(territories, cellsById);

  for (const t of territories) {
    const point = points.get(t.id);
    const members = new Set(t.cellIds);
    let clearance = Infinity;
    for (const cell of cells) {
      if (members.has(cell.id)) continue;
      clearance = Math.min(clearance, Math.acos(Math.min(1, dot(point, cell.center))));
    }
    const onOwnCell = t.cellIds.some((id) => dot(cellsById.get(id).center, point) > 1 - 1e-9);
    assert.ok(
      clearance >= 0.9 * spacing || onOwnCell,
      `territory ${t.id} (${t.cellIds.length} cells) sits ${(clearance / spacing).toFixed(2)} cells from a foreign cell`
    );
  }
});
