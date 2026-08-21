import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pipPositions, PIP_LAYOUTS } from '../src/render/pips.js';

test('each face has as many pips as it is worth', () => {
  for (let value = 1; value <= 6; value++) {
    assert.equal(pipPositions(value).length, value, `face ${value}`);
  }
});

test('every pip sits on the face, not off the edge of it', () => {
  for (let value = 1; value <= 6; value++) {
    for (const [x, y] of pipPositions(value)) {
      assert.ok(x > 0.1 && x < 0.9, `face ${value}: x ${x} is too close to the edge`);
      assert.ok(y > 0.1 && y < 0.9, `face ${value}: y ${y} is too close to the edge`);
    }
  }
});

test('no face has two pips in the same place', () => {
  for (let value = 1; value <= 6; value++) {
    const seen = new Set(pipPositions(value).map(([x, y]) => `${x},${y}`));
    assert.equal(seen.size, value, `face ${value} has pips on top of each other`);
  }
});

// The visual check that matters: a die face reads right however you turn it,
// which is true exactly when its pips are symmetric about the center.
test('every face is symmetric about its center, as a real die is', () => {
  for (let value = 1; value <= 6; value++) {
    const pips = pipPositions(value);
    const mirrored = new Set(pips.map(([x, y]) => `${(1 - x).toFixed(3)},${(1 - y).toFixed(3)}`));
    const original = new Set(pips.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`));
    assert.deepEqual([...mirrored].sort(), [...original].sort(), `face ${value} is lopsided`);
  }
});

test('odd faces have a pip dead center, even faces do not', () => {
  const hasCenter = (value) => pipPositions(value).some(([x, y]) => x === 0.5 && y === 0.5);
  for (const value of [1, 3, 5]) assert.ok(hasCenter(value), `face ${value} needs a center pip`);
  for (const value of [2, 4, 6]) assert.ok(!hasCenter(value), `face ${value} must not have one`);
});

test('six is two columns of three, not a ring', () => {
  const columns = new Set(pipPositions(6).map(([x]) => x));
  assert.equal(columns.size, 2, 'both columns of three share an x');
});

test('the table covers every face a die has, and no more', () => {
  // both the 3D texture and the flat SVG dice read this one table; that they
  // read *this* one rather than a copy is checked by scripts/lint-conventions.js
  assert.deepEqual(Object.keys(PIP_LAYOUTS).sort(), ['1', '2', '3', '4', '5', '6']);
});

test('an impossible face has no pips rather than blowing up', () => {
  assert.deepEqual(pipPositions(0), []);
  assert.deepEqual(pipPositions(7), []);
  assert.deepEqual(pipPositions(undefined), []);
});
