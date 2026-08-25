import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pipDimpleNormal } from '../src/render/diceTextures.js';

const RADIUS = 12;

// Sample directions around a pip, deliberately including the diagonals, so a
// sign that is only wrong on one axis can't hide behind a symmetric one.
const DIRECTIONS = [
  [1, 0], [0, 1], [-1, 0], [0, -1],
  [0.6, 0.8], [-0.6, 0.8], [0.6, -0.8], [-0.6, -0.8],
];

function at(direction, t) {
  const [ux, uy] = direction;
  return pipDimpleNormal(ux * RADIUS * t, uy * RADIUS * t, RADIUS);
}

test('every normal is a unit vector', () => {
  for (const direction of DIRECTIONS) {
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.99, 1, 1.5]) {
      const n = at(direction, t);
      assert.ok(Math.abs(Math.hypot(n.x, n.y, n.z) - 1) < 1e-9, `${direction} at ${t}`);
    }
  }
});

// The pip is a hollow, not a bead: its walls face back across the pip. Getting
// this backwards still lights, and still looks like a die — from the wrong
// side, with the pips standing proud of the face.
test('the walls of a pip lean back toward its center', () => {
  for (const direction of DIRECTIONS) {
    for (const t of [0.25, 0.5, 0.75]) {
      const n = at(direction, t);
      const outward = n.x * direction[0] + n.y * direction[1];
      assert.ok(outward < 0, `wall at ${direction} ${t} leans outward (${outward})`);
    }
  }
});

// Both ends of the profile are flat, which is what makes a pip a circle that
// fades into the face rather than one ringed by a hard edge of lit pixels.
test('a pip is flat at its bottom and flat again at its rim', () => {
  const bottom = pipDimpleNormal(0, 0, RADIUS);
  assert.deepEqual(bottom, { x: 0, y: 0, z: 1 });

  for (const direction of DIRECTIONS) {
    assert.ok(at(direction, 0.99).z > 0.999, 'the rim should have flattened out');
    assert.deepEqual(at(direction, 1), { x: 0, y: 0, z: 1 });
    assert.deepEqual(at(direction, 2), { x: 0, y: 0, z: 1 });
  }
});

test('the wall is steepest halfway out', () => {
  for (const direction of DIRECTIONS) {
    const steepest = at(direction, 0.5).z;
    for (const t of [0.2, 0.35, 0.65, 0.8]) {
      assert.ok(at(direction, t).z > steepest, `${direction} at ${t} out-tilts the midpoint`);
    }
  }
});
