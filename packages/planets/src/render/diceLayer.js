import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { findAllDiceGrounds } from '../world/territoryCenters.js';
import { planDiceStacks, stackColumnCount, PIP_FACE_NORMALS } from './diceStacks.js';

// The die's edge length, in planet radii. Exported because the pole markers
// are sized and stood up in dice — what they have to clear is a dice tower.
export const DIE_SIZE = 0.035;
const BEVEL_SEGMENTS = 3;
const COLUMN_GAP = 1.06; // column spacing, in die widths

const LOCAL_UP = new THREE.Vector3(0, 1, 0);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

// The die's own tumble: bring `pipUp`'s face around to point at the sky,
// then spin it a whole number of quarter turns about that face so the pips
// on the sides land square too.
export function dieTumble(pipUp, spin) {
  const face = PIP_FACE_NORMALS[pipUp];
  const bringFaceUp = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(face.x, face.y, face.z),
    LOCAL_UP
  );
  const twist = new THREE.Quaternion().setFromAxisAngle(LOCAL_UP, (spin * Math.PI) / 2);
  return twist.multiply(bringFaceUp);
}

// Rotation putting a territory's patch of ground under the dice: local +Y is
// the surface normal and local +X runs east, so a pair of columns always
// reads side by side however the camera orbits. Local +Z is then south, not
// north — east/up/south is the ordering that keeps the basis right-handed,
// and a left-handed one is a reflection rather than a rotation.
export function surfaceFrame(normal) {
  const east = new THREE.Vector3().crossVectors(WORLD_UP, normal);
  if (east.lengthSq() < 1e-12) east.set(1, 0, 0); // directly over a pole: any tangent will do
  east.normalize();
  const south = new THREE.Vector3().crossVectors(east, normal).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(east, normal, south)
  );
}

// Where die number `index` rests in its stand's local frame.
export function dicePosition(column, level, columns, dieSize) {
  return new THREE.Vector3(
    (column - (columns - 1) / 2) * dieSize * COLUMN_GAP,
    dieSize * (0.5 + level),
    0
  );
}

/**
 * How far a stack of `diceCount` reaches sideways from its stand: the
 * outermost column's center, plus half a die.
 *
 * The same `COLUMN_GAP` the dice are actually placed with, deliberately —
 * this is what the pole marker asks to find out whether a tower is really in
 * its way, and a second copy of the spacing is exactly how the answer and the
 * dice would drift apart. A die that has stopped tumbling is yawed by a whole
 * number of quarter turns, so its footprint is an axis-aligned square and half
 * an edge is the true reach, not half a diagonal.
 */
export function stackHalfWidth(diceCount, dieSize = DIE_SIZE) {
  const columns = stackColumnCount(diceCount);
  return ((columns - 1) / 2) * dieSize * COLUMN_GAP + dieSize / 2;
}

/**
 * The planet's dice, as one three.js Group with a child "stand" per
 * territory sitting at that territory's mount point (see territoryCenters.js).
 * Each stand carries its own dice in a local frame where +Y points at the
 * sky, which is what makes both stacking and the roll animation simple.
 *
 * `update(state)` re-stacks only the territories whose dice count actually
 * changed, so capturing one territory doesn't send every die on the planet
 * tumbling into a new orientation.
 */
export function createDiceLayer(world, pipMaterials, options = {}) {
  const { dieSize = DIE_SIZE, rng = Math.random } = options;
  const cellsById = new Map(world.cells.map((c) => [c.id, c]));
  const grounds = findAllDiceGrounds(world.territories, cellsById);
  const geometry = new RoundedBoxGeometry(dieSize, dieSize, dieSize, BEVEL_SEGMENTS, dieSize * 0.12);

  const group = new THREE.Group();
  const stands = new Map();

  for (const territory of world.territories) {
    const { center, radius } = grounds.get(territory.id);
    const normal = new THREE.Vector3(center.x, center.y, center.z).normalize();

    const stand = new THREE.Group();
    stand.position.copy(normal);
    stand.quaternion.copy(surfaceFrame(normal));
    group.add(stand);

    // `groundRadius` is how far from the stand a die can land and still be on
    // this territory — the roll animation throws the dice out across it.
    stands.set(territory.id, {
      id: territory.id,
      object: stand,
      normal,
      groundRadius: radius,
      dice: 0,
      meshes: [],
    });
  }

  function rebuild(stand, diceCount) {
    stand.object.clear();
    const columns = stackColumnCount(diceCount);
    stand.dice = diceCount;
    stand.meshes = planDiceStacks(diceCount, rng).map(({ column, level, pipUp, spin }) => {
      const mesh = new THREE.Mesh(geometry, pipMaterials);
      mesh.position.copy(dicePosition(column, level, columns, dieSize));
      mesh.quaternion.copy(dieTumble(pipUp, spin));
      stand.object.add(mesh);
      return mesh;
    });
  }

  return {
    group,
    dieSize,
    geometry,
    standFor: (territoryId) => stands.get(territoryId),
    update(state) {
      for (const stand of stands.values()) {
        const node = state.nodes.get(stand.id);
        const dice = node ? node.dice : 0;
        if (dice !== stand.dice) rebuild(stand, dice);
      }
    },

    // Re-stacks one territory even though its dice count hasn't changed. A
    // stack that survived an attack is still lying on the faces it rolled,
    // so it needs tidying up before its top die reads as a count again.
    reroll(territoryId, state) {
      const stand = stands.get(territoryId);
      if (!stand) return;
      const node = state.nodes.get(territoryId);
      rebuild(stand, node ? node.dice : 0);
    },
    dispose() {
      geometry.dispose();
    },
  };
}
