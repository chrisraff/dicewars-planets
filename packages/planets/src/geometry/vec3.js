// Minimal plain-object vector math — deliberately not three.js's Vector3, so
// world generation stays testable with plain node:test and doesn't drag a
// rendering dependency into logic that has nothing to do with rendering.

export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const length = (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const normalize = (a) => scale(a, 1 / length(a));
export const midpoint = (a, b) => scale(add(a, b), 0.5);
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export const centroid = (points) =>
  scale(points.reduce(add), 1 / points.length);
