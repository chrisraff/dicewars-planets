import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcosahedron } from '../src/geometry/icosahedron.js';
import { subdivide } from '../src/geometry/subdivide.js';
import { buildDual } from '../src/geometry/dual.js';
import { generateIcosphereCells } from '../src/geometry/icosphere.js';
import { length } from '../src/geometry/vec3.js';

test('the base icosahedron has 12 unit vertices and 20 faces', () => {
  const { vertices, faces } = buildIcosahedron();
  assert.equal(vertices.length, 12);
  assert.equal(faces.length, 20);
  for (const v of vertices) assert.ok(Math.abs(length(v) - 1) < 1e-9);
});

test('subdividing follows V/E/F counts and stays watertight (Euler = 2)', () => {
  const base = buildIcosahedron();
  for (const n of [1, 2, 3]) {
    const { vertices, faces } = subdivide(base, n);
    const expectedFaces = 20 * 4 ** n;
    const expectedVertices = 10 * 4 ** n + 2;
    assert.equal(faces.length, expectedFaces);
    assert.equal(vertices.length, expectedVertices);

    const edges = new Set();
    for (const [a, b, c] of faces) {
      for (const [i, j] of [[a, b], [b, c], [c, a]]) {
        edges.add(i < j ? `${i}_${j}` : `${j}_${i}`);
      }
    }
    assert.equal(vertices.length - edges.size + faces.length, 2);
    for (const v of vertices) assert.ok(Math.abs(length(v) - 1) < 1e-9);
  }
});

test('the dual has exactly 12 pentagons and the rest hexagons, all mutually consistent neighbors', () => {
  const mesh = subdivide(buildIcosahedron(), 2);
  const cells = buildDual(mesh);

  assert.equal(cells.length, mesh.vertices.length);

  const degreeCounts = {};
  for (const cell of cells) {
    degreeCounts[cell.neighbors.length] = (degreeCounts[cell.neighbors.length] ?? 0) + 1;
    assert.equal(cell.corners.length, cell.neighbors.length);
  }
  assert.equal(degreeCounts[5], 12);
  assert.equal(degreeCounts[6], cells.length - 12);

  const byId = new Map(cells.map((c) => [c.id, c]));
  for (const cell of cells) {
    for (const n of cell.neighbors) {
      assert.ok(byId.get(n).neighbors.includes(cell.id), `${n} should list ${cell.id} back`);
    }
  }
});

test('generateIcosphereCells wires the whole pipeline together', () => {
  const cells = generateIcosphereCells(2);
  assert.equal(cells.length, 10 * 4 ** 2 + 2);
});
