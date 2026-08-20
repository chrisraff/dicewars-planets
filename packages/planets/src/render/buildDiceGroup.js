import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { findAllDiceMountPoints } from '../world/territoryCenters.js';
import { planDiceStacks, stackColumnCount, PIP_FACE_NORMALS } from './diceStacks.js';

const DIE_SIZE = 0.035;
const BEVEL_SEGMENTS = 3;
const COLUMN_GAP = 1.06; // column spacing, in die widths

const LOCAL_UP = new THREE.Vector3(0, 1, 0);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

// The die's own tumble: bring `pipUp`'s face around to point at the sky,
// then spin it a whole number of quarter turns about that face so the pips
// on the sides land square too.
function dieTumble(pipUp, spin) {
  const face = PIP_FACE_NORMALS[pipUp];
  const bringFaceUp = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(face.x, face.y, face.z),
    LOCAL_UP
  );
  const twist = new THREE.Quaternion().setFromAxisAngle(LOCAL_UP, (spin * Math.PI) / 2);
  return twist.multiply(bringFaceUp);
}

// A direction tangent to the sphere at `normal`, used as the axis a
// territory's columns line up along — east-west, so a pair of stacks reads
// side by side however the camera orbits.
function tangentAt(normal) {
  const reference = Math.abs(normal.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : WORLD_UP;
  return new THREE.Vector3().crossVectors(reference, normal).normalize();
}

// Builds each territory's dice at its mount point (see territoryCenters.js),
// standing on the planet's surface: columns of up to four, side by side, with
// every die's up axis following the surface normal there.
export function buildDiceGroup(world, state, pipMaterials, options = {}) {
  const { dieSize = DIE_SIZE, rng = Math.random } = options;
  const cellsById = new Map(world.cells.map((c) => [c.id, c]));
  const mountPoints = findAllDiceMountPoints(world.territories, cellsById);
  const geometry = new RoundedBoxGeometry(dieSize, dieSize, dieSize, BEVEL_SEGMENTS, dieSize * 0.12);

  const group = new THREE.Group();

  for (const territory of world.territories) {
    const node = state.nodes.get(territory.id);
    if (!node) continue;

    const point = mountPoints.get(territory.id);
    const normal = new THREE.Vector3(point.x, point.y, point.z).normalize();
    const tangent = tangentAt(normal);
    const upright = new THREE.Quaternion().setFromUnitVectors(LOCAL_UP, normal);

    const columns = stackColumnCount(node.dice);
    for (const { column, level, pipUp, spin } of planDiceStacks(node.dice, rng)) {
      const mesh = new THREE.Mesh(geometry, pipMaterials);
      const offset = (column - (columns - 1) / 2) * dieSize * COLUMN_GAP;
      mesh.position
        .copy(normal)
        .multiplyScalar(1 + dieSize * (0.5 + level))
        .addScaledVector(tangent, offset);
      mesh.quaternion.multiplyQuaternions(upright, dieTumble(pipUp, spin));
      group.add(mesh);
    }
  }

  return group;
}
