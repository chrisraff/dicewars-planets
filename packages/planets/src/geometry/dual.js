import { centroid, normalize } from './vec3.js';

// The dual of a subdivided icosahedron: one polygon per original vertex,
// corners at the surrounding triangles' centroids. Original icosahedron
// vertices keep degree 5 (pentagons); every vertex introduced by subdivision
// has degree 6 (hexagons) — the classic Goldberg-polyhedron "soccer ball".
export function buildDual({ vertices, faces }) {
  const faceCentroids = faces.map(([a, b, c]) =>
    normalize(centroid([vertices[a], vertices[b], vertices[c]]))
  );

  // Each face touching vertex v contributes one step of the cycle around v:
  // "from" is the previous vertex in winding order, "to" is the next one —
  // chaining to.=>from. links the faces into cyclic order around v, and the
  // chained `to` values are exactly v's mesh neighbors in that same order.
  const touches = vertices.map(() => []);
  faces.forEach((face, faceIndex) => {
    for (let k = 0; k < 3; k++) {
      const v = face[k];
      const from = face[(k + 2) % 3];
      const to = face[(k + 1) % 3];
      touches[v].push({ faceIndex, from, to });
    }
  });

  return vertices.map((position, v) => {
    const entries = touches[v];
    const byFrom = new Map(entries.map((e) => [e.from, e]));

    const order = [];
    let step = entries[0];
    for (let i = 0; i < entries.length; i++) {
      order.push(step);
      step = byFrom.get(step.to);
    }
    if (order.length !== entries.length || step !== entries[0]) {
      throw new Error(`inconsistent mesh winding around vertex ${v}`);
    }

    return {
      id: v,
      center: position,
      corners: order.map((e) => faceCentroids[e.faceIndex]),
      neighbors: order.map((e) => e.to),
    };
  });
}
