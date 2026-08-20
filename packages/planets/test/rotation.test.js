import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rotationAligning } from '../src/geometry/rotation.js';
import { length, dot, normalize } from '../src/geometry/vec3.js';

function closeVec(a, b, eps = 1e-9) {
  assert.ok(Math.abs(a.x - b.x) < eps, `x: ${a.x} vs ${b.x}`);
  assert.ok(Math.abs(a.y - b.y) < eps, `y: ${a.y} vs ${b.y}`);
  assert.ok(Math.abs(a.z - b.z) < eps, `z: ${a.z} vs ${b.z}`);
}

test('rotates `from` exactly onto `to`', () => {
  const from = normalize({ x: 1, y: 0.4, z: -0.7 });
  const to = { x: 0, y: 1, z: 0 };
  const rotate = rotationAligning(from, to);
  closeVec(rotate(from), to);
});

test('is the identity when already aligned', () => {
  const v = { x: 0, y: 1, z: 0 };
  const rotate = rotationAligning(v, v);
  closeVec(rotate({ x: 3, y: 2, z: 1 }), { x: 3, y: 2, z: 1 });
});

test('handles the antiparallel case', () => {
  const rotate = rotationAligning({ x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 });
  closeVec(rotate({ x: 0, y: 1, z: 0 }), { x: 0, y: -1, z: 0 });
});

test('preserves vector length and angles between vectors', () => {
  const from = normalize({ x: 0.2, y: 0.9, z: -0.3 });
  const to = normalize({ x: -0.5, y: 0.1, z: 0.8 });
  const rotate = rotationAligning(from, to);

  const a = { x: 1.5, y: -2.2, z: 0.7 };
  const b = { x: -0.3, y: 0.9, z: 2.1 };
  const ra = rotate(a);
  const rb = rotate(b);

  assert.ok(Math.abs(length(ra) - length(a)) < 1e-9);
  assert.ok(Math.abs(dot(ra, rb) - dot(a, b)) < 1e-9);
});
