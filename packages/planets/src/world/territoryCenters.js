import { add, normalize, dot } from '../geometry/vec3.js';

// Where a territory's dice get placed. Normally the geometric centroid of
// its cells, projected straight out onto the sphere (the "normal" of that
// average direction) — but odd shapes (crescents, horseshoes) can push
// that centroid outside the territory's actual footprint, landing it on
// another territory or the ocean instead. So it's only used when it lands
// firmly within the territory (its nearest cell, out of every cell on the
// planet, is actually a member); otherwise the nearest of the territory's
// own cells to that centroid is used instead.
export function findDiceMountPoint(cellIds, cellsById) {
  const centroid = normalize(cellIds.map((id) => cellsById.get(id).center).reduce(add));

  let nearestOverallId = null;
  let nearestOverallDot = -Infinity;
  for (const cell of cellsById.values()) {
    const d = dot(cell.center, centroid);
    if (d > nearestOverallDot) {
      nearestOverallDot = d;
      nearestOverallId = cell.id;
    }
  }

  if (new Set(cellIds).has(nearestOverallId)) return centroid;

  let bestId = cellIds[0];
  let bestDot = -Infinity;
  for (const id of cellIds) {
    const d = dot(cellsById.get(id).center, centroid);
    if (d > bestDot) {
      bestDot = d;
      bestId = id;
    }
  }
  return cellsById.get(bestId).center;
}

export function findAllDiceMountPoints(territories, cellsById) {
  const points = new Map();
  for (const t of territories) points.set(t.id, findDiceMountPoint(t.cellIds, cellsById));
  return points;
}
