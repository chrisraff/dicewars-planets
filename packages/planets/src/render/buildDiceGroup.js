import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { findAllDiceMountPoints } from '../world/territoryCenters.js';

const DIE_SIZE = 0.035;
const BEVEL_SEGMENTS = 3;

function orientationAt(normal) {
  const up = new THREE.Vector3(0, 1, 0);
  return new THREE.Quaternion().setFromUnitVectors(up, normal);
}

// Builds one small stack of dice per territory — one die per die it owns,
// stacked face to face — standing on that territory's dice mount point
// (see territoryCenters.js), oriented so each die's local up axis matches
// the sphere's surface normal there.
export function buildDiceGroup(world, state, pipMaterials, { dieSize = DIE_SIZE } = {}) {
  const cellsById = new Map(world.cells.map((c) => [c.id, c]));
  const mountPoints = findAllDiceMountPoints(world.territories, cellsById);
  const geometry = new RoundedBoxGeometry(dieSize, dieSize, dieSize, BEVEL_SEGMENTS, dieSize * 0.12);

  const group = new THREE.Group();

  for (const territory of world.territories) {
    const node = state.nodes.get(territory.id);
    if (!node) continue;

    const point = mountPoints.get(territory.id);
    const normal = new THREE.Vector3(point.x, point.y, point.z).normalize();
    const orientation = orientationAt(normal);

    for (let i = 0; i < node.dice; i++) {
      const mesh = new THREE.Mesh(geometry, pipMaterials);
      const radius = 1 + dieSize * (0.5 + i);
      mesh.position.copy(normal).multiplyScalar(radius);
      mesh.quaternion.copy(orientation);
      group.add(mesh);
    }
  }

  return group;
}
