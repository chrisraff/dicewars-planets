import { scale } from '../geometry/vec3.js';

// Each dual-cell polygon edge between corners[i] and corners[(i+1)%n] is
// exactly the border shared with neighbors[i] (see dual.js) — so walking
// every cell's edges and keeping the ones where the two sides' territories
// differ traces every territory boundary on the planet. Segments are
// nudged radially outward by `liftScale` so the line doesn't z-fight with
// the filled cell mesh sitting at the same surface.
export function buildTerritoryBoundaries(cells, cellTerritory, { liftScale = 1.002 } = {}) {
  const positions = [];

  for (const cell of cells) {
    const owner = cellTerritory.get(cell.id);
    if (owner === undefined) continue; // ocean cell — no territory of its own

    const n = cell.corners.length;
    for (let i = 0; i < n; i++) {
      const neighborId = cell.neighbors[i];
      if (neighborId <= cell.id) continue; // each cell pair only visited once

      const neighborOwner = cellTerritory.get(neighborId);
      if (neighborOwner === undefined || neighborOwner === owner) continue;

      const a = scale(cell.corners[i], liftScale);
      const b = scale(cell.corners[(i + 1) % n], liftScale);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }

  return { positions: new Float32Array(positions) };
}
