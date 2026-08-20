import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseEquatorialAxis } from '../src/world/equatorAxis.js';
import { dot } from '../src/geometry/vec3.js';

// A synthetic planet with an obvious ring: 8 territories evenly spaced
// around the z-axis (an octagon in the xy-plane) chained into a cycle, plus
// two isolated "polar" territories not connected to anything. The axis that
// best explains this as an equatorial ring should be close to the z-axis.
function ringWorld() {
  const ringCount = 8;
  const cells = [];
  const territories = [];
  const edges = [];

  for (let i = 0; i < ringCount; i++) {
    const theta = (i / ringCount) * Math.PI * 2;
    const center = { x: Math.cos(theta), y: Math.sin(theta), z: 0 };
    cells.push({ id: i, center, corners: [], neighbors: [] });
    territories.push({ id: i, cellIds: [i] });
    edges.push([i, (i + 1) % ringCount]);
  }

  cells.push({ id: 100, center: { x: 0, y: 0, z: 1 }, corners: [], neighbors: [] });
  cells.push({ id: 101, center: { x: 0, y: 0, z: -1 }, corners: [], neighbors: [] });
  territories.push({ id: 100, cellIds: [100] });
  territories.push({ id: 101, cellIds: [101] });

  return { cells, territories, edges };
}

test('finds the ring axis for an obviously ringed planet', () => {
  const world = ringWorld();
  const axis = chooseEquatorialAxis(world);
  assert.ok(Math.abs(dot(axis, { x: 0, y: 0, z: 1 })) > 0.9, `axis ${JSON.stringify(axis)} should align with z`);
});
