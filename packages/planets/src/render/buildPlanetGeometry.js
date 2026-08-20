// Turns dual-graph cells (center + ordered corners) into a flat-shaded
// triangle mesh: each cell is fan-triangulated from its center out to
// consecutive corners, with its own private copy of every vertex (never
// shared with neighboring cells) so each cell can carry a single flat
// color with no bleeding across cell boundaries.
//
// That private-vertex layout also means every cell owns a contiguous run of
// vertices and of triangles, so the mesh reports both:
//   `faceCellIds[faceIndex]`  — which cell a raycast hit (see pickTerritory.js)
//   `cellVertexRanges`        — which colors to rewrite when an owner changes
export function buildPlanetGeometry(cells, getCellColor) {
  const positions = [];
  const colors = [];
  const indices = [];
  const faceCellIds = [];
  const cellVertexRanges = new Map();

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
      faceCellIds.push(cell.id);
    }
    cellVertexRanges.set(cell.id, { start: base, count: n + 1 });
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
    faceCellIds: new Uint32Array(faceCellIds),
    cellVertexRanges,
  };
}

// Rewrites an existing color buffer in place for the cells whose color may
// have changed — repainting a captured territory costs a handful of writes
// and one `needsUpdate`, rather than rebuilding the whole planet.
//
// `needsUpdate` is write-only on a three.js BufferAttribute (it bumps an
// internal version counter and reads back as `undefined`), so it must be set
// unconditionally — testing it first silently skips the GPU upload and the
// planet keeps showing whatever colors it was first built with.
export function updateCellColors(colorAttribute, cellIds, cellVertexRanges, getCellColor) {
  const array = colorAttribute.array ?? colorAttribute;
  for (const cellId of cellIds) {
    const range = cellVertexRanges.get(cellId);
    if (!range) continue;
    const [r, g, b] = getCellColor(cellId);
    for (let i = 0; i < range.count; i++) {
      const o = (range.start + i) * 3;
      array[o] = r;
      array[o + 1] = g;
      array[o + 2] = b;
    }
  }
  colorAttribute.needsUpdate = true;
}
