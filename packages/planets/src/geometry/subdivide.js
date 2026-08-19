import { midpoint, normalize } from './vec3.js';

function subdivideOnce({ vertices, faces }) {
  const nextVertices = vertices.slice();
  const midpointCache = new Map(); // "i_j" (i<j) -> new vertex index

  function edgeMidpoint(i, j) {
    const key = i < j ? `${i}_${j}` : `${j}_${i}`;
    let index = midpointCache.get(key);
    if (index === undefined) {
      index = nextVertices.length;
      nextVertices.push(normalize(midpoint(vertices[i], vertices[j])));
      midpointCache.set(key, index);
    }
    return index;
  }

  const nextFaces = [];
  for (const [a, b, c] of faces) {
    const ab = edgeMidpoint(a, b);
    const bc = edgeMidpoint(b, c);
    const ca = edgeMidpoint(c, a);
    // four children, winding preserved so the whole mesh stays consistently oriented
    nextFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
  }

  return { vertices: nextVertices, faces: nextFaces };
}

// Triforce-subdivides every triangle `times` times, sharing edge-midpoint
// vertices between neighboring triangles so the mesh stays watertight.
export function subdivide(mesh, times) {
  let current = mesh;
  for (let i = 0; i < times; i++) current = subdivideOnce(current);
  return current;
}
