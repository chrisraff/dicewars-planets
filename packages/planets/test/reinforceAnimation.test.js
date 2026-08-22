import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createDiceLayer } from '../src/render/diceLayer.js';
import { createReinforceAnimation } from '../src/render/reinforceAnimation.js';
import { reinforceDuration, dieStart } from '../src/render/reinforceTimeline.js';
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
  const animation = createReinforceAnimation({ landed, dice: layer, materials });
  return { layer, animation };
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
  const identity = drop.quaternion.clone();

  for (const t of [0, reinforceDuration(1) / 2, reinforceDuration(1)]) {
    animation.apply(t);
    assert.ok(drop.quaternion.angleTo(identity) < 1e-9, 'orientation never changes, unlike a rolled die');
  }
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
