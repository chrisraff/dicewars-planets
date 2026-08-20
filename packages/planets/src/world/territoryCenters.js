import { add, normalize, dot } from '../geometry/vec3.js';

// How close a mount point is allowed to get to a cell that isn't part of the
// territory, as a multiple of the planet's typical cell spacing. Just under
// one full cell, so a point sitting squarely on a border cell's center still
// counts as clear, while anything nudged toward the seam does not.
const DEFAULT_MIN_CLEARANCE = 0.9;

const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

// Typical great-circle distance between the centers of two adjacent cells,
// measured off the cells' own adjacency when they carry it. Cells built by
// hand (tests) may not, so fall back to the spacing a hexagonal tiling of
// `size` cells would have on the unit sphere: hex area = (sqrt(3)/2)·s².
export function estimateCellSpacing(cellsById) {
  let total = 0;
  let count = 0;
  for (const cell of cellsById.values()) {
    for (const neighborId of cell.neighbors ?? []) {
      const neighbor = cellsById.get(neighborId);
      if (!neighbor) continue;
      total += angleBetween(cell.center, neighbor.center);
      count++;
    }
  }
  if (count > 0) return total / count;
  return Math.sqrt((8 * Math.PI) / (Math.sqrt(3) * cellsById.size));
}

// Where a territory's dice get placed. Normally the geometric centroid of
// its cells, projected straight out onto the sphere — but odd shapes
// (crescents, horseshoes) can push that centroid outside the territory's
// footprint entirely, or leave it technically inside yet hard against a
// border, so the dice would straddle the seam.
//
// So the centroid is only used when it keeps its distance: no cell outside
// the territory may sit within roughly one cell's width of it. Otherwise the
// dice snap to the center of the nearest cell that does keep that distance,
// which is as far from any seam as a cell center can be.
export function findDiceMountPoint(cellIds, cellsById, options = {}) {
  const {
    cellSpacing = estimateCellSpacing(cellsById),
    minClearance = DEFAULT_MIN_CLEARANCE,
  } = options;

  const members = new Set(cellIds);
  const outsiders = [...cellsById.values()].filter((c) => !members.has(c.id));
  const threshold = minClearance * cellSpacing;

  // distance from `point` to the nearest cell the territory doesn't own
  const clearanceAt = (point) => {
    let nearest = Infinity;
    for (const cell of outsiders) {
      const d = angleBetween(point, cell.center);
      if (d < nearest) nearest = d;
    }
    return nearest;
  };

  const centroid = normalize(cellIds.map((id) => cellsById.get(id).center).reduce(add));
  if (clearanceAt(centroid) >= threshold) return centroid;

  // Nearest own cell that is itself clear of the border; if the territory is
  // so thin that none of its cells are, use its most-buried cell instead.
  const candidates = cellIds.map((id) => {
    const cell = cellsById.get(id);
    return {
      center: cell.center,
      clearance: clearanceAt(cell.center),
      distance: angleBetween(cell.center, centroid),
    };
  });

  const clear = candidates.filter((c) => c.clearance >= threshold);
  if (clear.length > 0) return clear.reduce((a, b) => (b.distance < a.distance ? b : a)).center;
  return candidates.reduce((a, b) => (b.clearance > a.clearance ? b : a)).center;
}

export function findAllDiceMountPoints(territories, cellsById, options = {}) {
  const cellSpacing = options.cellSpacing ?? estimateCellSpacing(cellsById);
  const points = new Map();
  for (const t of territories) {
    points.set(t.id, findDiceMountPoint(t.cellIds, cellsById, { ...options, cellSpacing }));
  }
  return points;
}
