import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildDiceGroup } from '../src/render/buildDiceGroup.js';
import { PIP_FACE_NORMALS, MAX_DICE_PER_STACK } from '../src/render/diceStacks.js';

function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// One territory of a single cell at the north pole, surrounded by nothing, so
// the mount point is that cell and the surface normal is straight up.
function poleWorld() {
  return {
    cells: [{ id: 0, center: { x: 0, y: 1, z: 0 }, neighbors: [] }],
    territories: [{ id: 't', cellIds: [0] }],
  };
}

function stateWith(dice) {
  return { nodes: new Map([['t', { owner: 'p1', dice }]]) };
}

const materials = Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial());

// Which numbered face of this die ends up pointing along `normal`.
function pipFacing(mesh, normal) {
  for (const [pips, face] of Object.entries(PIP_FACE_NORMALS)) {
    const world = new THREE.Vector3(face.x, face.y, face.z).applyQuaternion(mesh.quaternion);
    if (world.dot(normal) > 1 - 1e-6) return Number(pips);
  }
  return null;
}

test('one mesh per die', () => {
  for (let dice = 1; dice <= 8; dice++) {
    const group = buildDiceGroup(poleWorld(), stateWith(dice), materials, { rng: seededRng(dice) });
    assert.equal(group.children.length, dice);
  }
});

test('the top die of each stack shows that stack’s height', () => {
  const up = new THREE.Vector3(0, 1, 0);
  for (let dice = 1; dice <= 8; dice++) {
    const group = buildDiceGroup(poleWorld(), stateWith(dice), materials, { rng: seededRng(dice) });

    // group dice by column (their offset off the surface normal), then read
    // the pip count on the up face of whichever one is highest in each
    const columns = new Map();
    for (const mesh of group.children) {
      const key = Math.round(mesh.position.x * 1e6) + ':' + Math.round(mesh.position.z * 1e6);
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

test('every die is axis-aligned to the surface: some face points straight up', () => {
  const up = new THREE.Vector3(0, 1, 0);
  const group = buildDiceGroup(poleWorld(), stateWith(8), materials, { rng: seededRng(42) });
  for (const mesh of group.children) {
    assert.ok(pipFacing(mesh, up) !== null);
  }
});

test('dice stack outward from the surface without overlapping', () => {
  const group = buildDiceGroup(poleWorld(), stateWith(4), materials, { rng: seededRng(8) });
  const heights = group.children.map((m) => m.position.y).sort((a, b) => a - b);
  assert.ok(heights[0] > 1, 'the bottom die rests on the surface, not inside it');
  for (let i = 1; i < heights.length; i++) {
    assert.ok(heights[i] > heights[i - 1], 'each die sits above the one below it');
  }
});

test('a second column appears beside the first, not through it', () => {
  const group = buildDiceGroup(poleWorld(), stateWith(8), materials, { rng: seededRng(2) });

  // at the pole the surface normal is +y, so the columns are offset in the xz-plane
  const offsets = [...new Set(group.children.map((m) => Math.round(m.position.z * 1e6) / 1e6))];
  assert.equal(offsets.length, 2, 'eight dice should sit in two side-by-side columns');
  assert.ok(Math.abs(offsets[0] + offsets[1]) < 1e-9, 'straddling the mount point evenly');
  assert.ok(Math.abs(offsets[0] - offsets[1]) > 0.035, 'far enough apart not to intersect');
  for (const mesh of group.children) assert.ok(Math.abs(mesh.position.x) < 1e-9);
});
