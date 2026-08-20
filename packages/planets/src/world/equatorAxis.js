import { add, normalize, dot, cross } from '../geometry/vec3.js';

// Evenly-distributed sample directions to test as a candidate "north pole".
function fibonacciSphere(n) {
  const points = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;
    points.push({ x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius });
  }
  return points;
}

function territoryCentroids(territories, cellsById) {
  const centroids = new Map();
  for (const t of territories) {
    const sum = t.cellIds
      .map((id) => cellsById.get(id).center)
      .reduce(add);
    centroids.set(t.id, normalize(sum));
  }
  return centroids;
}

// Largest connected component of the territory graph restricted to
// territories that fall inside the equatorial band for this axis.
function largestBandComponent(inBand, edges) {
  const adjacency = new Map([...inBand].map((id) => [id, []]));
  for (const [a, b] of edges) {
    if (inBand.has(a) && inBand.has(b)) {
      adjacency.get(a).push(b);
      adjacency.get(b).push(a);
    }
  }

  let best = [];
  const seen = new Set();
  for (const start of inBand) {
    if (seen.has(start)) continue;
    const stack = [start];
    const component = [];
    seen.add(start);
    while (stack.length) {
      const cur = stack.pop();
      component.push(cur);
      for (const n of adjacency.get(cur)) {
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    if (component.length > best.length) best = component;
  }
  return best;
}

// 0 = every member sits at roughly the same longitude (a clump, not a
// ring); 1 = evenly spread all the way around the axis — exactly what a
// left-to-right band running around the whole planet needs.
function longitudeSpread(ids, centroids, axis) {
  if (ids.length === 0) return 0;
  const reference = Math.abs(axis.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const east = normalize(cross(axis, reference));
  const north = cross(axis, east);

  let sx = 0;
  let sy = 0;
  for (const id of ids) {
    const c = centroids.get(id);
    const angle = Math.atan2(dot(c, north), dot(c, east));
    sx += Math.cos(angle);
    sy += Math.sin(angle);
  }
  const meanResultantLength = Math.sqrt(sx * sx + sy * sy) / ids.length;
  return 1 - meanResultantLength;
}

// Picks the "north pole" direction that puts the planet's strongest ring of
// mutually-adjacent territories along the equator: sample candidate axes,
// score each by how large and how evenly-wrapped-around the axis its
// equatorial band of territories is, and keep the best one. Deliberately a
// soft heuristic rather than a strict rule, so results still feel random
// rather than perfectly banded.
export function chooseEquatorialAxis(
  { territories, cells, edges },
  { bandHalfAngleDeg = 25, candidateCount = 300 } = {}
) {
  const cellsById = new Map(cells.map((c) => [c.id, c]));
  const centroids = territoryCentroids(territories, cellsById);
  const bandHalfAngle = (bandHalfAngleDeg * Math.PI) / 180;

  let best = null;
  for (const axis of fibonacciSphere(candidateCount)) {
    const inBand = new Set();
    for (const [id, c] of centroids) {
      const latitude = Math.asin(Math.max(-1, Math.min(1, dot(c, axis))));
      if (Math.abs(latitude) <= bandHalfAngle) inBand.add(id);
    }
    if (inBand.size < 3) continue;

    const component = largestBandComponent(inBand, edges);
    if (component.length < 3) continue;

    const spread = longitudeSpread(component, centroids, axis);
    const score = component.length * spread;
    if (!best || score > best.score) best = { axis, score };
  }

  return best ? best.axis : { x: 0, y: 1, z: 0 };
}
