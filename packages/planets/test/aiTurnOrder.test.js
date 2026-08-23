import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderAiTurnForCamera, turnDependencies } from '../src/game/aiTurnOrder.js';
import { DEFAULT_FRAMING } from '../src/render/cameraFraming.js';

const spherical = (lonDeg, latDeg = 0) => {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  return { x: Math.cos(lat) * Math.sin(lon), y: Math.sin(lat), z: Math.cos(lat) * Math.cos(lon) };
};
const FAR = { distance: 3.2, halfFov: Math.PI / 8 };

test('a failed attack on a territory must still be shown before a later success there', () => {
  const moves = [
    { from: 'a', to: 'x' }, // fails
    { from: 'b', to: 'y' }, // unrelated
    { from: 'c', to: 'x' }, // succeeds, later, same defender
  ];
  const dependsOn = turnDependencies(moves);
  assert.deepEqual(dependsOn[0], []);
  assert.deepEqual(dependsOn[1], []);
  assert.deepEqual(dependsOn[2], [0], 'move 2 must follow whatever last touched x');
});

test('a newly claimed territory must be shown before it is used to attack from', () => {
  const moves = [
    { from: 'a', to: 'x' }, // claims x
    { from: 'x', to: 'y' }, // attacks from the newly claimed x
  ];
  const dependsOn = turnDependencies(moves);
  assert.deepEqual(dependsOn[1], [0]);
});

test('moves that never share a territory have no dependency at all', () => {
  const moves = [{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }];
  assert.deepEqual(turnDependencies(moves), [[], []]);
});

test('with nothing to prefer, the camera-aware order matches the input order', () => {
  // Every territory sits at the same spot, so nothing ever needs refocusing
  // once the first move is shown — the ready set always resolves to
  // whichever move comes first in the original order.
  const moves = [
    { from: 'a', to: 'w' },
    { from: 'b', to: 'x' },
    { from: 'c', to: 'y' },
    { from: 'd', to: 'z' },
  ];
  const here = spherical(0);
  const positionOf = () => here;
  const initialView = { direction: here, distance: FAR.distance, halfFov: FAR.halfFov };

  const ordered = orderAiTurnForCamera(moves, positionOf, initialView);
  assert.deepEqual(ordered, moves);
});

test('independent moves get reordered so a nearby one shows before a farther one that came first', () => {
  const near = spherical(150);
  const nearer = spherical(160); // close to `near`, far from the start
  const far = spherical(0); // where the camera already is

  // True order: territory 'p' (near) is fought over first, then 'q' (far),
  // then 'r' (nearer, right next to 'p'). Nothing shares a territory, so all
  // three are free to be shown in any order.
  const moves = [
    { from: 'a', to: 'p' }, // near
    { from: 'b', to: 'q' }, // far — already where the camera starts
    { from: 'c', to: 'r' }, // nearer — right by the first move
  ];
  // territoryId -> point; attackers sit right next to whatever they attack
  const positionOf = { a: near, p: near, b: far, q: far, c: nearer, r: nearer };
  const initialView = { direction: far, distance: FAR.distance, halfFov: FAR.halfFov };

  const ordered = orderAiTurnForCamera(moves, (id) => positionOf[id], initialView);

  // 'q' is already framed (the camera starts there) and is picked first,
  // ahead of 'p' even though 'p' came first in the original array. 'r' then
  // follows 'p' because it's already framed once the camera has swung there.
  assert.deepEqual(ordered, [moves[1], moves[0], moves[2]]);
});

test('camera preference reorders around a dependency chain without ever breaking it', () => {
  const start = spherical(20); // near where the camera already is
  const distant = spherical(160); // where the chained pair happens

  // 'x' is claimed by move 0 and then attacked from by move 2 — those two
  // must keep their relative order. Move 1 shares no territory with either
  // and sits right where the camera starts.
  const moves = [
    { from: 'a', to: 'x' }, // claims x, far away
    { from: 'c', to: 'y' }, // unrelated, near the camera
    { from: 'x', to: 'z' }, // attacks from the newly claimed x, far away
  ];
  const positionOf = (id) => ({ a: distant, x: distant, c: start, y: start, z: distant }[id]);
  const initialView = { direction: start, distance: FAR.distance, halfFov: FAR.halfFov };

  const ordered = orderAiTurnForCamera(moves, positionOf, initialView);

  assert.deepEqual(ordered, [moves[1], moves[0], moves[2]],
    'the near, independent move jumps ahead, but the claim still precedes the attack it enables');
});

test('an empty turn orders to an empty turn', () => {
  assert.deepEqual(orderAiTurnForCamera([], () => spherical(0), {
    direction: spherical(0), distance: FAR.distance, halfFov: FAR.halfFov,
  }, DEFAULT_FRAMING), []);
});
