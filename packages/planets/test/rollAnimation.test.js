import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createDiceLayer } from '../src/render/diceLayer.js';
import { createRollAnimation } from '../src/render/rollAnimation.js';
import { attackDuration, DEFAULT_TIMING } from '../src/render/rollTimeline.js';
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

function setup(attackerDice, defenderDice, event, seed = 1) {
  const layer = createDiceLayer(world, materials, { rng: seededRng(seed) });
  layer.update({
    nodes: new Map([
      ['a', { owner: 'p1', dice: attackerDice }],
      ['b', { owner: 'p2', dice: defenderDice }],
    ]),
  });
  const animation = createRollAnimation({
    attackerStand: layer.standFor('a'),
    defenderStand: layer.standFor('b'),
    event,
    dieSize: layer.dieSize,
    rng: seededRng(seed + 100),
  });
  return { layer, animation };
}

// Which numbered face points along the stand's surface normal.
function pipUp(mesh, stand) {
  const world = mesh.getWorldQuaternion(new THREE.Quaternion());
  for (const [pips, face] of Object.entries(PIP_FACE_NORMALS)) {
    const facing = new THREE.Vector3(face.x, face.y, face.z).applyQuaternion(world);
    if (facing.dot(stand.normal) > 1 - 1e-6) return Number(pips);
  }
  return null;
}

test('when the tumble stops, every die is showing the face that was rolled', () => {
  const event = { attackRolls: [3, 1, 6], defendRolls: [5, 2] };
  const { layer, animation } = setup(3, 2, event);

  animation.apply(attackDuration());
  layer.group.updateMatrixWorld(true);

  const attacker = layer.standFor('a');
  const defender = layer.standFor('b');
  assert.deepEqual(attacker.meshes.map((m) => pipUp(m, attacker)), event.attackRolls);
  assert.deepEqual(defender.meshes.map((m) => pipUp(m, defender)), event.defendRolls);
});

test('the dice still read correctly once the animation is over', () => {
  const event = { attackRolls: [2, 2, 4, 6], defendRolls: [1] };
  const { layer, animation } = setup(4, 1, event, 9);

  const beat = animation.apply(attackDuration() + 10);
  layer.group.updateMatrixWorld(true);

  assert.equal(beat.phase, 'done');
  const attacker = layer.standFor('a');
  assert.deepEqual(attacker.meshes.map((m) => pipUp(m, attacker)), event.attackRolls);
});

test('dice leave the stack while rolling and come down flat on the ground', () => {
  const event = { attackRolls: [4, 4], defendRolls: [3] };
  const { layer, animation } = setup(2, 1, event, 3);
  const attacker = layer.standFor('a');
  const resting = attacker.meshes.map((m) => m.position.clone());

  animation.apply(DEFAULT_TIMING.aim + DEFAULT_TIMING.roll / 2);
  attacker.meshes.forEach((m, i) => {
    assert.ok(m.position.y > resting[i].y, 'mid-roll the dice are in the air');
  });

  animation.apply(attackDuration());
  for (const mesh of attacker.meshes) {
    assert.ok(
      Math.abs(mesh.position.y - layer.dieSize / 2) < 1e-9,
      'every die comes to rest lying on the ground, not stacked or hovering'
    );
  }
  assert.ok(
    attacker.meshes.some((m, i) => m.position.distanceTo(resting[i]) > layer.dieSize),
    'and they have been thrown clear of where they were stacked'
  );
});

test('the dice a stack throws land apart, and on their own territory', () => {
  // Eight against eight is the most dice a single attack ever puts on the
  // ground. Both territories here are wide open, so there is room for all of
  // them; how the layout gives way when there isn't is diceScatter's own test.
  const event = { attackRolls: [1, 2, 3, 4, 5, 6, 1, 2], defendRolls: [6, 5, 4, 3, 2, 1, 6, 5] };
  const { layer, animation } = setup(8, 8, event, 12);
  animation.apply(attackDuration());

  for (const id of ['a', 'b']) {
    const stand = layer.standFor(id);
    const landed = stand.meshes.map((m) => m.position);
    const half = layer.dieSize / 2;

    for (const spot of landed) {
      const corner = Math.hypot(Math.abs(spot.x) + half, Math.abs(spot.z) + half);
      assert.ok(corner <= stand.groundRadius, `a die overhangs ${id}: ${corner}`);
    }
    for (let i = 0; i < landed.length; i++) {
      for (let j = i + 1; j < landed.length; j++) {
        const apart = Math.max(
          Math.abs(landed[i].x - landed[j].x),
          Math.abs(landed[i].z - landed[j].z)
        );
        assert.ok(apart >= layer.dieSize - 1e-12, `dice ${i} and ${j} on ${id} are inside each other`);
      }
    }
  }
});

test('nothing has moved before the dice are thrown', () => {
  const event = { attackRolls: [1, 1], defendRolls: [1] };
  const { layer, animation } = setup(2, 1, event, 4);
  const attacker = layer.standFor('a');
  const before = attacker.meshes.map((m) => m.quaternion.clone());

  animation.apply(0);
  attacker.meshes.forEach((m, i) => {
    assert.ok(m.quaternion.angleTo(before[i]) < 1e-6);
  });
});

test('cancelling puts every die back exactly where it was', () => {
  const event = { attackRolls: [6, 6], defendRolls: [6] };
  const { layer, animation } = setup(2, 1, event, 5);
  const stands = ['a', 'b'].map((id) => layer.standFor(id));
  const before = stands.flatMap((s) =>
    s.meshes.map((m) => ({ mesh: m, p: m.position.clone(), q: m.quaternion.clone() }))
  );

  animation.apply(DEFAULT_TIMING.aim + DEFAULT_TIMING.roll * 0.4);
  animation.cancel();

  for (const { mesh, p, q } of before) {
    assert.ok(mesh.position.distanceTo(p) < 1e-9);
    assert.ok(mesh.quaternion.angleTo(q) < 1e-6);
  }
});

test('dice tumble independently rather than in lockstep', () => {
  const event = { attackRolls: [2, 2, 2, 2], defendRolls: [2] };
  const { layer, animation } = setup(4, 1, event, 6);

  animation.apply(DEFAULT_TIMING.aim + DEFAULT_TIMING.roll * 0.3);
  const attacker = layer.standFor('a');
  const orientations = attacker.meshes.map((m) => m.quaternion.clone());

  let differing = 0;
  for (let i = 1; i < orientations.length; i++) {
    if (orientations[i].angleTo(orientations[0]) > 0.05) differing++;
  }
  assert.ok(differing >= 2, 'dice mid-roll should not all be at the same angle');
});
