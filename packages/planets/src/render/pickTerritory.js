import * as THREE from 'three';

// Pointer position in normalized device coordinates: (-1,-1) bottom-left of
// the canvas to (+1,+1) top-right, which is what a raycaster wants. Kept
// separate from the raycast itself because it's the part that's easy to get
// backwards (the y axis flips) and easy to test.
export function pointerToNdc(clientX, clientY, rect) {
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: -((clientY - rect.top) / rect.height) * 2 + 1,
  };
}

// Casts a ray at the planet and reports which territory was hit, or null for
// a miss (empty space) or for ocean, which belongs to no territory. Only the
// planet mesh is tested, so dice standing in front of a territory never
// swallow a click meant for the land underneath.
export function createTerritoryPicker({ planetMesh, camera, faceCellIds, cellTerritory }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  return function pickTerritoryAt(ndc) {
    pointer.set(ndc.x, ndc.y);
    raycaster.setFromCamera(pointer, camera);

    const [hit] = raycaster.intersectObject(planetMesh, false);
    if (!hit || hit.faceIndex === undefined) return null;

    const cellId = faceCellIds[hit.faceIndex];
    return cellTerritory.get(cellId) ?? null;
  };
}
