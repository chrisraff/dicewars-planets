// Turns dual-graph cells (center + ordered corners) into a flat-shaded
// triangle mesh: each cell is fan-triangulated from its center out to
// consecutive corners, with its own private copy of every vertex (never
// shared with neighboring cells) so each cell can carry a single flat
// color with no bleeding across cell boundaries.
export function buildPlanetGeometry(cells, getCellColor) {
  const positions = [];
  const colors = [];
  const indices = [];

  for (const cell of cells) {
    const [r, g, b] = getCellColor(cell.id);
    const base = positions.length / 3;

    positions.push(cell.center.x, cell.center.y, cell.center.z);
    colors.push(r, g, b);

    cell.corners.forEach((corner) => {
      positions.push(corner.x, corner.y, corner.z);
      colors.push(r, g, b);
    });

    const n = cell.corners.length;
    for (let i = 0; i < n; i++) {
      indices.push(base, base + 1 + ((i + 1) % n), base + 1 + i);
    }
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
  };
}
