import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateIcosphereCells } from '../src/geometry/icosphere.js';
import { buildPlanetGeometry } from '../src/render/buildPlanetGeometry.js';

test('produces one private vertex fan per cell, each triangle facing outward', () => {
  const cells = generateIcosphereCells(1);
  const { positions, colors, indices } = buildPlanetGeometry(cells, () => [1, 0, 0]);

  const expectedVertexCount = cells.reduce((sum, c) => sum + 1 + c.corners.length, 0);
  const expectedTriangleCount = cells.reduce((sum, c) => sum + c.corners.length, 0);

  assert.equal(positions.length, expectedVertexCount * 3);
  assert.equal(colors.length, expectedVertexCount * 3);
  assert.equal(indices.length, expectedTriangleCount * 3);

  for (let i = 0; i < indices.length; i += 3) {
    const p = [indices[i], indices[i + 1], indices[i + 2]].map((idx) => ({
      x: positions[idx * 3],
      y: positions[idx * 3 + 1],
      z: positions[idx * 3 + 2],
    }));

    const e1 = { x: p[1].x - p[0].x, y: p[1].y - p[0].y, z: p[1].z - p[0].z };
    const e2 = { x: p[2].x - p[0].x, y: p[2].y - p[0].y, z: p[2].z - p[0].z };
    const normal = {
      x: e1.y * e2.z - e1.z * e2.y,
      y: e1.z * e2.x - e1.x * e2.z,
      z: e1.x * e2.y - e1.y * e2.x,
    };
    // a properly outward-wound triangle's normal points away from the
    // sphere's center, i.e. the same general direction as its own vertices
    const dot = normal.x * p[0].x + normal.y * p[0].y + normal.z * p[0].z;
    assert.ok(dot > 0, 'triangle should be wound with an outward-facing normal');
  }
});

test('every vertex within a cell shares that cell\'s color', () => {
  const cells = generateIcosphereCells(0);
  const colorFor = (id) => [id / 10, 0, 1 - id / 10];
  const { colors } = buildPlanetGeometry(cells, colorFor);

  let offset = 0;
  for (const cell of cells) {
    const [r, g, b] = colorFor(cell.id);
    const vertexCount = 1 + cell.corners.length;
    for (let i = 0; i < vertexCount; i++) {
      assert.equal(colors[(offset + i) * 3], Math.fround(r));
      assert.equal(colors[(offset + i) * 3 + 1], Math.fround(g));
      assert.equal(colors[(offset + i) * 3 + 2], Math.fround(b));
    }
    offset += vertexCount;
  }
});
