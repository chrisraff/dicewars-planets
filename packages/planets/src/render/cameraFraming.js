import { add, angleBetween, normalize } from '../geometry/vec3.js';

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

// A point's position in the same two axes an orbiting camera's own controls
// move on — `lon` swings it round the pole axis (the +Y OrbitControls turns
// the planet on), `lat` tilts it between the poles. Matches three.js' own
// `Spherical` (`theta`/`phi`), just named for what a camera swing actually
// does with each one.
function lonLatOf(point) {
  return { lon: Math.atan2(point.x, point.z), lat: Math.asin(Math.max(-1, Math.min(1, point.y))) };
}

function pointAt(lon, lat) {
  const cosLat = Math.cos(lat);
  return { x: cosLat * Math.sin(lon), y: Math.sin(lat), z: cosLat * Math.cos(lon) };
}

// The shorter way from `a` to `b` around a circle — 350° short of a full turn
// back to 10° is a 20° step, not a 340° one the long way round.
const shortestTurn = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

// `rawT` (0..1), not eased — `swingDirection` eases the pace, `swingTravel`
// below samples the shape, and both walk the same underlying curve.
function pointAlong(a, b, rawT) {
  const start = lonLatOf(a);
  const end = lonLatOf(b);
  return pointAt(
    start.lon + shortestTurn(start.lon, end.lon) * rawT,
    start.lat + (end.lat - start.lat) * rawT
  );
}

/**
 * The view direction `t` of the way (0..1) from `from` to `to`, moving in
 * longitude and latitude — the two axes the orbit controls themselves turn
 * on — rather than along the great circle between them.
 *
 * The great circle is the mathematically shortest path, but it is not the
 * one a hand on the controls would ever produce: two fights at the same high
 * latitude but far apart in longitude sit on a great circle that bulges up
 * toward whichever pole is nearer, so the "shortest" swing between them
 * drags that pole across the middle of the screen — a lurch that reads as a
 * glitch, not a turn. Moving lon and lat independently instead holds
 * latitude roughly steady and lets longitude carry the turn, which is what
 * dragging the controls to get from one to the other would actually look
 * like.
 */
export function swingDirection(from, to, t) {
  const a = normalize(from);
  const b = normalize(to);
  if (angleBetween(a, b) < 1e-9) return b;

  return pointAlong(a, b, easeSwing(Math.min(1, Math.max(0, t))));
}

// How many segments `swingTravel` samples the path in — cheap, and only ever
// run once per swing, not per frame.
const TRAVEL_SAMPLES = 16;

/**
 * How far a swing from `from` to `to` actually moves the camera, walking the
 * same lon/lat path `swingDirection` animates rather than the straight-line
 * distance between the endpoints. The two only agree on the equator — away
 * from it the lon/lat path can be the longer route (see `swingDirection`),
 * and pacing a swing that dips or bulges by the distance "as the crow flies"
 * moves it too fast for how far it is actually travelling.
 *
 * Sampled rather than integrated: this path has no closed-form length, and a
 * swing is triggered at most a few times a second — nowhere near a spot that
 * needs to be fast.
 */
export function swingTravel(from, to) {
  const a = normalize(from);
  const b = normalize(to);
  if (angleBetween(a, b) < 1e-9) return 0;

  let travel = 0;
  let previous = a;
  for (let i = 1; i <= TRAVEL_SAMPLES; i++) {
    const next = pointAlong(a, b, i / TRAVEL_SAMPLES);
    travel += angleBetween(previous, next);
    previous = next;
  }
  return travel;
}
