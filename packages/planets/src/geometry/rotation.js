import { dot, cross, normalize } from './vec3.js';

// Builds a rotation (as a plain `vector -> rotated vector` function) that
// carries unit vector `from` onto unit vector `to`, via Rodrigues' formula.
// Used to re-orient a generated planet without touching its topology at all.
export function rotationAligning(from, to) {
  const f = normalize(from);
  const t = normalize(to);
  const c = dot(f, t);

  if (c > 1 - 1e-9) return (v) => v; // already aligned

  if (c < -1 + 1e-9) {
    // antiparallel: no unique axis, so pick any axis perpendicular to `f`
    const arbitrary = Math.abs(f.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    return rotationAroundAxis(normalize(cross(f, arbitrary)), Math.PI);
  }

  const axis = normalize(cross(f, t));
  const angle = Math.acos(Math.max(-1, Math.min(1, c)));
  return rotationAroundAxis(axis, angle);
}

export function rotationAroundAxis(axis, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const oneMinusCos = 1 - cos;

  return (v) => {
    const kv = cross(axis, v);
    const kDotV = dot(axis, v);
    return {
      x: v.x * cos + kv.x * sin + axis.x * kDotV * oneMinusCos,
      y: v.y * cos + kv.y * sin + axis.y * kDotV * oneMinusCos,
      z: v.z * cos + kv.z * sin + axis.z * kDotV * oneMinusCos,
    };
  };
}
