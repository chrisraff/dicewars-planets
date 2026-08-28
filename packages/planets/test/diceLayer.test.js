import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createDiceLayer, dieTumble, surfaceFrame } from '../src/render/diceLayer.js';
import { PIP_FACE_NORMALS, MAX_DICE_PER_STACK } from '../src/render/diceStacks.js';
import { seededRng } from '@dicewars/core/test-support';

// Two single-cell territories on opposite sides of the planet, so mount
// points and surface normals are exactly known.
function twoCellWorld() {
  return {
    cells: [
      { id: 0, center: { x: 0, y: 0, z: 1 }, neighbors: [] },
      { id: 1, center: { x: 0, y: 0, z: -1 }, neighbors: [] },
    ],
    territories: [
      { id: 'front', cellIds: [0] },
      { id: 'back', cellIds: [1] },
    ],
  };
}

const stateWith = (front, back) => ({
  nodes: new Map([
    ['front', { owner: 'p1', dice: front }],
    ['back', { owner: 'p2', dice: back }],
  ]),
});

const materials = Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial());
const layerFor = (seed = 1) => createDiceLayer(twoCellWorld(), materials, { rng: seededRng(seed) });

// Which numbered face of this die points along `direction`, in world space.
function pipFacing(mesh, direction) {
  const worldQuaternion = mesh.getWorldQuaternion(new THREE.Quaternion());
  for (const [pips, face] of Object.entries(PIP_FACE_NORMALS)) {
    const facing = new THREE.Vector3(face.x, face.y, face.z).applyQuaternion(worldQuaternion);
    if (facing.dot(direction) > 1 - 1e-6) return Number(pips);
  }
  return null;
}

test('one mesh per die, on the right territory', () => {
  const layer = layerFor();
  for (let dice = 1; dice <= 8; dice++) {
    layer.update(stateWith(dice, 1));
    assert.equal(layer.standFor('front').meshes.length, dice);
    assert.equal(layer.standFor('back').meshes.length, 1);
  }
});

test('the top die of each stack shows that stack’s height', () => {
  const layer = layerFor(3);
  for (let dice = 1; dice <= 8; dice++) {
    layer.update(stateWith(dice, 1));
    layer.group.updateMatrixWorld(true);

    const stand = layer.standFor('front');
    const up = stand.normal;

    const columns = new Map();
    for (const mesh of stand.meshes) {
      const key = Math.round(mesh.position.x * 1e6);
      const current = columns.get(key);
      if (!current || mesh.position.y > current.position.y) columns.set(key, mesh);
    }
    assert.equal(columns.size, Math.ceil(dice / MAX_DICE_PER_STACK));

    let shown = 0;
    for (const top of columns.values()) {
      const pips = pipFacing(top, up);
      assert.ok(pips !== null, `no face squarely up on the top die of a ${dice}-die stack`);
      shown += pips;
    }
    assert.equal(shown, dice, `${dice} dice should read as ${dice} on the stack tops`);
  }
});

test('dice stack away from the planet without overlapping', () => {
  const layer = layerFor(4);
  layer.update(stateWith(4, 1));
  const heights = layer.standFor('front').meshes.map((m) => m.position.y).sort((a, b) => a - b);

  assert.ok(heights[0] > 0, 'the bottom die rests on the surface, not inside it');
  for (let i = 1; i < heights.length; i++) assert.ok(heights[i] > heights[i - 1]);
});

test('a fifth die starts a second column beside the first', () => {
  const layer = layerFor(5);
  layer.update(stateWith(8, 1));
  const offsets = [...new Set(layer.standFor('front').meshes.map((m) => m.position.x))];

  assert.equal(offsets.length, 2);
  assert.ok(Math.abs(offsets[0] + offsets[1]) < 1e-9, 'straddling the mount point evenly');
  assert.ok(Math.abs(offsets[0] - offsets[1]) >= layer.dieSize, 'far enough apart not to intersect');
});

test('every stand sits on the surface with its dice pointing outward', () => {
  const layer = layerFor(6);
  layer.update(stateWith(2, 3));
  layer.group.updateMatrixWorld(true);

  for (const id of ['front', 'back']) {
    const stand = layer.standFor(id);
    assert.ok(Math.abs(stand.object.position.length() - 1) < 1e-9, 'stands sit on the sphere');
    for (const mesh of stand.meshes) {
      const world = mesh.getWorldPosition(new THREE.Vector3());
      assert.ok(world.length() > 1, 'dice stand above the surface, not inside the planet');
      assert.ok(pipFacing(mesh, stand.normal) !== null, 'dice rest square on a face');
    }
  }
});

test('updating only re-tumbles the territories whose dice actually changed', () => {
  const layer = layerFor(7);
  layer.update(stateWith(3, 3));
  const untouched = layer.standFor('back').meshes.slice();
  const before = untouched.map((m) => m.quaternion.clone());

  layer.update(stateWith(5, 3));

  assert.equal(layer.standFor('front').meshes.length, 5);
  assert.deepEqual(layer.standFor('back').meshes, untouched, 'the other stack was left alone');
  layer.standFor('back').meshes.forEach((m, i) => {
    // angleTo goes through acos, so it bottoms out around 1e-8 even for a
    // quaternion compared against a clone of itself
    assert.ok(m.quaternion.angleTo(before[i]) < 1e-6, 'and did not re-roll');
  });
});

test('a territory reduced to nothing loses its dice', () => {
  const layer = layerFor(8);
  layer.update(stateWith(4, 2));
  layer.update({ nodes: new Map([['front', { owner: 'p1', dice: 4 }]]) });

  assert.equal(layer.standFor('back').meshes.length, 0);
  assert.equal(layer.standFor('back').object.children.length, 0);
});

test('dieTumble puts the requested face up, whichever face it is', () => {
  const up = new THREE.Vector3(0, 1, 0);
  for (let pips = 1; pips <= 6; pips++) {
    for (let spin = 0; spin < 4; spin++) {
      const mesh = new THREE.Object3D();
      mesh.quaternion.copy(dieTumble(pips, spin));
      const face = PIP_FACE_NORMALS[pips];
      const facing = new THREE.Vector3(face.x, face.y, face.z).applyQuaternion(mesh.quaternion);
      assert.ok(facing.dot(up) > 1 - 1e-9, `face ${pips} spin ${spin}`);
    }
  }
});

test('the surface frame points local +Y outward and local +X east', () => {
  for (const n of [[0, 0, 1], [1, 0, 0], [0.3, 0.5, -0.8], [0, 1, 0]]) {
    const normal = new THREE.Vector3(...n).normalize();
    const frame = surfaceFrame(normal);

    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(frame);
    assert.ok(up.dot(normal) > 1 - 1e-9, 'local up follows the surface normal');

    const east = new THREE.Vector3(1, 0, 0).applyQuaternion(frame);
    assert.ok(Math.abs(east.dot(normal)) < 1e-9, 'local east stays tangent to the surface');
    assert.ok(Math.abs(east.y) < 1e-9, 'and level, not tilted toward a pole');

    // a reflection would pass the two checks above and still turn the pips
    // inside out, so make sure this is an honest rotation
    const south = new THREE.Vector3(0, 0, 1).applyQuaternion(frame);
    assert.ok(
      south.distanceTo(new THREE.Vector3().crossVectors(east, normal)) < 1e-9,
      'the frame is right-handed'
    );
  }
});

test('reroll stands a surviving stack back up on its counting face', () => {
  const layer = layerFor(11);
  layer.update(stateWith(3, 3));
  const stand = layer.standFor('back');

  // a stack that fought and survived is left lying on the faces it rolled
  stand.meshes.forEach((m, i) => m.quaternion.copy(dieTumble(1 + i, 0)));

  layer.reroll('back', stateWith(3, 3));
  layer.group.updateMatrixWorld(true);

  assert.equal(stand.meshes.length, 3, 'still three dice');
  const top = stand.meshes.reduce((a, b) => (b.position.y > a.position.y ? b : a));
  assert.equal(pipFacing(top, stand.normal), 3, 'and reading as three again');
});

// --- painted by owner --------------------------------------------------

const paintedWorld = () => ({
  p1: Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial()),
  p2: Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial()),
});

test('dice are painted by whoever owns the territory', () => {
  const paints = paintedWorld();
  const layer = createDiceLayer(twoCellWorld(), materials, {
    rng: seededRng(1),
    materialsFor: (owner) => paints[owner],
  });
  layer.update(stateWith(3, 2));

  assert.equal(layer.standFor('front').meshes[0].material, paints.p1);
  assert.equal(layer.standFor('back').meshes[0].material, paints.p2);
});

// A change of hands is a repaint, not a restack. The tumble is what says how
// many dice a territory holds — turning it over because it changed owner
// would throw away the one thing the stack is there to tell you, on the very
// move the player most wants to read it.
test('a territory changing hands repaints its dice without re-tumbling them', () => {
  const paints = paintedWorld();
  const layer = createDiceLayer(twoCellWorld(), materials, {
    rng: seededRng(1),
    materialsFor: (owner) => paints[owner],
  });
  layer.update(stateWith(3, 2));

  const before = layer.standFor('front').meshes.slice();
  const orientations = before.map((mesh) => mesh.quaternion.clone());

  layer.update({
    nodes: new Map([
      ['front', { owner: 'p2', dice: 3 }],
      ['back', { owner: 'p2', dice: 2 }],
    ]),
  });

  const after = layer.standFor('front').meshes;
  assert.deepEqual(after, before, 'the same meshes, not new ones');
  after.forEach((mesh, i) => {
    assert.ok(mesh.quaternion.equals(orientations[i]), 'standing exactly as it was');
    assert.equal(mesh.material, paints.p2, 'in its new owner’s colour');
  });
});

// The default has to be untouched: pass no painter and every die on the
// planet is the one bone set, which is what every existing caller relies on.
test('with no painter, every die shares the one set of materials', () => {
  const layer = layerFor();
  layer.update(stateWith(3, 2));
  assert.equal(layer.standFor('front').meshes[0].material, materials);
  assert.equal(layer.standFor('back').meshes[0].material, materials);
  assert.equal(layer.materialsAt('front'), materials);
});
