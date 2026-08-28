import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createDiceLayer } from '../src/render/diceLayer.js';
import { createReinforceAnimation } from '../src/render/reinforceAnimation.js';
import { reinforceDuration, dieStart } from '../src/render/reinforceTimeline.js';
import { PIP_FACE_NORMALS } from '../src/render/diceStacks.js';
import { seededRng } from '@dicewars/core/test-support';

const world = {
  cells: [
    { id: 0, center: { x: 0, y: 0, z: 1 }, neighbors: [] },
    { id: 1, center: { x: 1, y: 0, z: 0 }, neighbors: [] },
  ],
  territories: [
    { id: 'a', cellIds: [0] },
    { id: 'b', cellIds: [1] },
  ],
};

const materials = Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial());

function setup(counts, landed, seed = 1) {
  const layer = createDiceLayer(world, materials, { rng: seededRng(seed) });
  layer.update({
    nodes: new Map(Object.entries(counts).map(([id, dice]) => [id, { owner: 'p1', dice }])),
  });
  const animation = createReinforceAnimation({ landed, dice: layer });
  const settle = (counts2) => layer.update({
    nodes: new Map(Object.entries(counts2).map(([id, dice]) => [id, { owner: 'p1', dice }])),
  });
  return { layer, animation, settle };
}

// The animation adds its temporary dice straight into the stand, alongside
// whatever `dice.update` already stacked there — anything beyond that
// permanent set is one of the falling dice.
function fallingMeshes(stand) {
  return stand.object.children.filter((child) => !stand.meshes.includes(child));
}

test('a die is hidden until its own start time, then appears', () => {
  const { layer, animation } = setup({ a: 1, b: 1 }, ['a', 'a']);
  const stand = layer.standFor('a');

  animation.apply(0);
  const [first, second] = fallingMeshes(stand);
  assert.equal(first.visible, true, 'the first die starts immediately');
  assert.equal(second.visible, false, 'the second is still waiting its turn');

  animation.apply(dieStart(1, 2) + 0.001);
  assert.equal(second.visible, true, 'and appears once its own start time arrives');
});

test('a die falls from above down onto its landing slot, and stays there once it lands', () => {
  const { layer, animation } = setup({ a: 0, b: 0 }, ['a']);
  const stand = layer.standFor('a');

  animation.apply(0);
  const [drop] = fallingMeshes(stand);
  const startY = drop.position.y;
  assert.ok(startY > layer.dieSize / 2, 'starts above the ground it is about to land on');

  animation.apply(reinforceDuration(1));
  assert.ok(Math.abs(drop.position.y - layer.dieSize / 2) < 1e-9, 'lands exactly one die above the surface');
  assert.ok(drop.position.y < startY, 'lower than where the fall began');

  animation.apply(reinforceDuration(1) + 5);
  assert.ok(
    Math.abs(drop.position.y - layer.dieSize / 2) < 1e-9,
    'and does not keep moving once it has landed'
  );
});

test('several dice landing on the same territory stack up rather than piling on one spot', () => {
  const { layer, animation } = setup({ a: 0, b: 0 }, ['a', 'a', 'a']);
  const stand = layer.standFor('a');
  animation.apply(reinforceDuration(3));

  const heights = fallingMeshes(stand)
    .map((m) => m.position.y)
    .sort((x, y) => x - y);
  assert.equal(new Set(heights.map((h) => h.toFixed(9))).size, 3, 'three distinct heights');
  for (let i = 1; i < heights.length; i++) {
    assert.ok(heights[i] > heights[i - 1], 'each die rests higher than the one below it');
  }
});

test('a die landing on a territory that already has dice lands above the existing stack', () => {
  const { layer, animation } = setup({ a: 3, b: 0 }, ['a']);
  const stand = layer.standFor('a');
  animation.apply(reinforceDuration(1));

  const [drop] = fallingMeshes(stand);
  assert.ok(drop.position.y > layer.dieSize * 3, 'well above a bare single die');
});

test('a die slides into place without tumbling', () => {
  const { layer, animation } = setup({ a: 0, b: 0 }, ['a']);
  const stand = layer.standFor('a');
  const [drop] = fallingMeshes(stand);
  // compared component by component rather than with angleTo, which is
  // 2*acos(|dot|) and turns the last bit of a unit quaternion into ~3e-8 of
  // angle. Nothing here should be rewriting the rotation at all, so exact is
  // the right standard.
  const landing = drop.quaternion.clone();

  for (const t of [0, reinforceDuration(1) / 2, reinforceDuration(1)]) {
    animation.apply(t);
    assert.deepEqual(
      drop.quaternion.toArray(),
      landing.toArray(),
      'orientation never changes, unlike a rolled die'
    );
  }
});

// --- which way up a dropped die lands ---------------------------------------

// Which numbered face a die is actually showing: the pip face whose own
// normal, once the die is turned, points away from the planet.
function faceUp(mesh) {
  const up = new THREE.Vector3(0, 1, 0);
  for (const [value, normal] of Object.entries(PIP_FACE_NORMALS)) {
    const turned = new THREE.Vector3(normal.x, normal.y, normal.z).applyQuaternion(mesh.quaternion);
    if (turned.dot(up) > 0.999) return Number(value);
  }
  return null;
}

const attitudes = (meshes) => meshes.map((mesh) => mesh.quaternion.toArray());

test('a die lands already standing the way the rebuild will leave it', () => {
  // it used to land at the identity rotation — a 2, every time — and then
  // visibly turn the moment `dice.update` replaced it with the real stack
  const { layer, animation, settle } = setup({ a: 2, b: 0 }, ['a']);
  const stand = layer.standFor('a');

  animation.apply(reinforceDuration(1));
  const landed = attitudes(fallingMeshes(stand));

  settle({ a: 3, b: 0 }); // what the game does the instant the payout is over
  assert.deepEqual(attitudes([stand.meshes[2]]), landed, 'no snap when the real die arrives');
});

test('every die of a multi-die payout agrees with its rebuilt counterpart', () => {
  const { layer, animation, settle } = setup({ a: 1, b: 0 }, ['a', 'a', 'a', 'a', 'a']);
  const stand = layer.standFor('a');

  animation.apply(reinforceDuration(5));
  const landed = attitudes(fallingMeshes(stand));

  settle({ a: 6, b: 0 });
  assert.deepEqual(attitudes(stand.meshes.slice(1)), landed, 'including across a new column');
});

test('the die left on top still shows how many its column holds', () => {
  // the drop takes the whole layout from the rebuild, so this is really a
  // check that the layout it took is the one for the *finished* pile
  const { layer, animation } = setup({ a: 2, b: 0 }, ['a']);
  const stand = layer.standFor('a');

  animation.apply(reinforceDuration(1));
  assert.equal(faceUp(fallingMeshes(stand)[0]), 3, 'three dice in the column, so a three on top');
});

test('a payout that starts a second column tops that one at one', () => {
  const { layer, animation } = setup({ a: 3, b: 0 }, ['a', 'a']);
  const stand = layer.standFor('a');

  animation.apply(reinforceDuration(2));
  const [fourth, fifth] = fallingMeshes(stand);
  assert.equal(faceUp(fourth), 4, 'fills the first column');
  assert.equal(faceUp(fifth), 1, 'and the next die is alone on a fresh one');
});

test('a reroll re-tumbles rather than honouring a plan left over from a payout', () => {
  // reroll exists to stand dice back up after a battle has left them lying on
  // the faces they rolled, so it is the one caller that must never reuse a
  // reserved layout
  const { layer } = setup({ a: 4, b: 0 }, ['a']);
  const stand = layer.standFor('a');
  const before = attitudes(stand.meshes);

  layer.reroll('a', { nodes: new Map([['a', { owner: 'p1', dice: 4 }]]) });
  assert.notDeepEqual(attitudes(stand.meshes), before, 'the stack was actually re-thrown');
});

test('apply reports how many dice have started falling, one more with each die', () => {
  const { animation } = setup({ a: 0, b: 0 }, ['a', 'a', 'a', 'a']);

  assert.equal(animation.apply(-1), 0, 'nothing has started before the payout begins');
  assert.equal(animation.apply(0), 1, 'the first die starts immediately');

  for (let index = 1; index < 4; index++) {
    assert.equal(animation.apply(dieStart(index, 4) - 1e-6), index, `just before die ${index}`);
    assert.equal(animation.apply(dieStart(index, 4)), index + 1, `the moment die ${index} starts`);
  }
  assert.equal(animation.apply(reinforceDuration(4)), 4, 'every die has started by the end');
});

test('dice destined for different territories fall onto their own ground', () => {
  const { layer, animation } = setup({ a: 0, b: 0 }, ['a', 'b']);
  animation.apply(reinforceDuration(2));

  const [onA] = fallingMeshes(layer.standFor('a'));
  const [onB] = fallingMeshes(layer.standFor('b'));
  assert.equal(onA.parent, layer.standFor('a').object);
  assert.equal(onB.parent, layer.standFor('b').object);
});
