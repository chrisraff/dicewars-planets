import { add, angleBetween, cross, normalize } from '../geometry/vec3.js';
import { rotationAroundAxis } from '../geometry/rotation.js';

/**
 * When a fight the player isn't looking at is worth turning the camera for,
 * and what that turn looks like. Pure — no three.js, no camera object — so
 * the decision can be read and tested on its own.
 */
export const DEFAULT_FRAMING = {
  /**
   * The lever. How far in from the edge of the planet a fight has to sit
   * before the camera leaves it alone, measured on screen: 1 is the middle of
   * the disc, 0 is right on the edge of what can be seen (the limb, or the
   * edge of the frame when zoomed in past it).
   *
   * Raise it and the action stays comfortably central at the cost of moving
   * more often; lower it and the planet holds still until a fight is nearly
   * out of sight. 0 only ever moves for a fight that is strictly off screen,
   * which sounds ideal and isn't: dice on the last visible sliver of limb are
   * edge-on and unreadable, and the swing that then follows the *next* attack
   * is a lurch out of nowhere.
   *
   * 0.2 keeps fights inside the middle four fifths of the disc, which on a
   * default planet is everything within about 40° of the point facing the
   * camera. Bear in mind what the sphere itself costs: barely a third of the
   * planet faces the camera at all, so most attacks somewhere on it are out
   * of view whatever this is set to. What the lever really trades is how
   * squashed the dice are allowed to be when the camera does hold still.
   */
  margin: 0.2,

  // How fast the planet turns under a swing, and the bounds on that, so a
  // small correction doesn't crawl and a half-turn doesn't whip past. The
  // ceiling also keeps the camera arriving before the dice land: an AI attack
  // is aim + roll ~= 0.57s of travel before there is anything to read.
  speed: 3.0, // radians per second
  minDuration: 0.25,
  maxDuration: 0.55,
};

/**
 * How far around the planet from the point facing the camera you can still
 * see, in radians. Two things cut that off and the nearer one wins:
 *
 * - the horizon, where the sphere curves away from a camera `distance` from
 *   its center — `acos(1 / distance)`, since the tangent point is where the
 *   surface normal and the line of sight are perpendicular;
 * - the edge of the frame, which up close bites first: at the minimum zoom
 *   the planet is far wider than the screen, so most of the lit half is
 *   nowhere near visible.
 *
 * For the frame: a ray leaving the camera at `halfFov` off axis passes
 * `distance * sin(halfFov)` from the planet's center, so it misses entirely
 * (the whole silhouette fits, horizon governs) once that reaches the radius.
 * Otherwise it strikes the sphere at `t` along the ray, and the angle of that
 * hit from the view center is what the screen edge is showing.
 */
export function visibleAngle(distance, halfFov) {
  if (!(distance > 1)) return 0; // camera at or under the surface: nothing is framed
  const horizon = Math.acos(1 / distance);

  const sin = Math.sin(halfFov);
  const off = distance * sin;
  if (off >= 1) return horizon;

  const cos = Math.cos(halfFov);
  const t = distance * cos - Math.sqrt(1 - off * off);
  return Math.atan2(t * sin, distance - t * cos);
}

// How far out from the middle of the picture a point `angle` around the
// planet lands, before scaling — the perspective projection of the sphere.
const screenRadius = (angle, distance) => Math.sin(angle) / (distance - Math.cos(angle));

/**
 * Where `point` (on the unit sphere) sits in a view looking down
 * `viewDirection`, as a fraction of the way in from the edge of what can be
 * seen: 1 dead center, 0 right on the edge, negative once it's off screen —
 * the same scale `margin` is stated in.
 *
 * Measured on the screen rather than around the planet, because the two are
 * nothing like each other near the limb: a fight 70% of the way to the
 * horizon in angle is already 91% of the way out on the disc. The eye reads
 * the picture, so the lever has to be stated in the picture's terms.
 */
export function framingOf(viewDirection, point, { distance, halfFov }) {
  const edge = visibleAngle(distance, halfFov);
  if (edge <= 0) return 0;

  const angle = angleBetween(normalize(viewDirection), normalize(point));
  // Past the edge the projection folds back on itself — the far side of the
  // planet falls inside the disc again, hidden behind the near side — so out
  // there fall back to the angle, which keeps further away reading as worse
  // all the way round to the antipode.
  if (angle >= edge) return (edge - angle) / edge;

  return 1 - screenRadius(angle, distance) / screenRadius(edge, distance);
}

// Whether the camera should swing over to `point` rather than leaving it
// where it is.
export function needsRefocus(viewDirection, point, view, framing = DEFAULT_FRAMING) {
  return framingOf(viewDirection, point, view) < framing.margin;
}

// Where to aim so a fight is framed as a fight: the direction between the two
// territories, so neither combatant is the one on the edge.
export function fightCenter(from, to) {
  const middle = add(normalize(from), normalize(to));
  return angleBetween(from, to) < Math.PI - 1e-6 ? normalize(middle) : normalize(from);
}

// A swing long enough to read as the planet turning rather than as a cut,
// short enough that the dice haven't landed before the camera arrives.
export function swingDuration(travel, framing = DEFAULT_FRAMING) {
  const { speed, minDuration, maxDuration } = framing;
  return Math.min(maxDuration, Math.max(minDuration, travel / speed));
}

// Eased at both ends: the planet takes up the turn and sets it down again,
// instead of starting and stopping dead.
const easeSwing = (t) => t * t * (3 - 2 * t);

/**
 * The view direction `t` of the way (0..1) from `from` to `to`, along the
 * shortest path — the great circle through both, which is the one arc that
 * doesn't take the long way round the planet.
 *
 * Exactly antipodal, every arc is equally short and equally correct, so any
 * perpendicular axis will do; what matters is that it doesn't come out NaN.
 */
export function swingDirection(from, to, t) {
  const a = normalize(from);
  const b = normalize(to);
  const angle = angleBetween(a, b);
  if (angle < 1e-9) return b;

  const axis =
    angle > Math.PI - 1e-6
      ? normalize(cross(a, Math.abs(a.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }))
      : normalize(cross(a, b));

  return rotationAroundAxis(axis, angle * easeSwing(Math.min(1, Math.max(0, t))))(a);
}
