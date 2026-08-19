import { buildIcosahedron } from './icosahedron.js';
import { subdivide } from './subdivide.js';
import { buildDual } from './dual.js';

// Cell = { id, center, corners, neighbors } — one hex (or, for the original
// 12 icosahedron vertices, pentagon) tile of the planet's surface.
export function generateIcosphereCells(subdivisions) {
  const mesh = subdivide(buildIcosahedron(), subdivisions);
  return buildDual(mesh);
}
