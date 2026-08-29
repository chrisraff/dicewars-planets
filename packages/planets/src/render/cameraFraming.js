import { add, angleBetween, centroid, normalize } from '../geometry/vec3.js';

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

  /**
   * How much of the planet is allowed to fall outside the frame when the
   * camera pulls back to take the whole thing in — a fraction of its radius,
   * off each edge of the narrower screen dimension.
   *
   * Deliberately not zero. Framing the silhouette exactly means pulling back
   * until it touches the edges, which on a phone leaves the planet noticeably
   * smaller for little benefit.
   */
  shave: 0.075,

  // The pull-back's own pacing, same shape as a swing's. Slower, because a
  // swing is chasing something about to happen while this is only settling —
  // but the ceiling still clears the 0.25s AI pause plus its first aim, so
  // the planet has stopped moving before there are dice to read.
  zoomSpeed: 4.0, // planet radii per second
  minZoomDuration: 0.3,
  maxZoomDuration: 0.7,
};

/**
 * The narrower half-angle of a perspective frustum, in radians — so "in
 * frame" means in frame in *both* directions. On a phone held upright that is
 * the horizontal one, and it is less than half the vertical: this is the
 * whole reason a planet comfortably framed on a desktop spills off both sides
 * of a portrait screen.
 */
export function narrowHalfFov(fovDegrees, aspect) {
  const vertical = ((fovDegrees * Math.PI) / 180) / 2;
  return Math.min(vertical, Math.atan(Math.tan(vertical) * aspect));
}

/**
 * How far from the planet's center the camera has to sit for the whole planet
 * to be in frame, bar `shave` of its radius off each edge.
 *
 * The silhouette of a unit sphere seen from `distance` is a circle of angular
 * radius `asin(1 / distance)` — the tangent cone, where the line of sight
 * grazes the surface. A perspective projection puts screen offsets in
 * proportion to `tan` of the angle, so the disc and the frame can be compared
 * directly in those terms: the frame's half-width is `tan(halfFov)`, the
 * disc's radius is `tan(asin(1 / distance))`, and letting the disc overrun by
 * `shave` means the frame covers `1 - shave` of it.
 *
 * Solving that for the distance is what this is. Note it grows without bound
 * as `halfFov` narrows, which is why the caller still clamps it to whatever
 * the controls will actually allow.
 */
export function framingDistance(halfFov, shave = DEFAULT_FRAMING.shave) {
  const covered = 1 - Math.min(0.95, Math.max(0, shave));
  const apparent = Math.atan(Math.tan(halfFov) / covered);
  return 1 / Math.sin(apparent);
}

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

/**
 * Where to aim to show as many of the *upcoming* `points` at once as will
 * comfortably fit, instead of swinging to just the next one and then
 * swinging again moments later for its neighbor. `points` is in the order
 * they're about to be shown, starting with the one that's about to trigger
 * a swing.
 *
 * Returns `null` exactly when `lookAt`/`needsRefocus` would: `points[0]` is
 * already framed, so there is nothing to do. Otherwise it grows an accepted
 * set one point at a time — generalizing `fightCenter`'s "average, then
 * normalize" from two points to however many keep fitting — and stops the
 * moment a candidate would push some already-accepted point out past the
 * margin. A point three moves out that's nowhere near this cluster should
 * never widen the aim just because it happens to be next in line; stopping
 * at the first rejection (rather than skipping over it) is what keeps that
 * from happening.
 */
export function clusterAim(points, viewDirection, view, framing = DEFAULT_FRAMING) {
  if (points.length === 0) return null;
  if (!needsRefocus(viewDirection, points[0], view, framing)) return null;

  let accepted = [points[0]];
  let aim = normalize(points[0]);

  for (let i = 1; i < points.length; i++) {
    const candidate = [...accepted, points[i]];
    const candidateAim = normalize(centroid(candidate));
    const allFramed = candidate.every(
      (p) => framingOf(candidateAim, p, view) >= framing.margin
    );
    if (!allFramed) break;
    accepted = candidate;
    aim = candidateAim;
  }

  return aim;
}

/**
 * How many of `points` are comfortably framed from `aim`, and how well — the
 * score `holdingsAim` maximizes, in that order.
 */
function coverage(points, aim, view, framing) {
  let framed = 0;
  let quality = 0;
  for (const point of points) {
    const seen = framingOf(aim, point, view);
    if (seen >= framing.margin) {
      framed++;
      quality += seen;
    }
  }
  return { framed, quality };
}

// How many times an aim is allowed to slide towards the middle of whatever it
// can see before it is scored. Two is enough to walk a seed sitting on the rim
// of a clump into the middle of it; more buys nothing measurable and this runs
// once per turn over every territory.
const AIM_SETTLE = 2;

const isFinitePoint = (p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

/**
 * Where to aim to see as many of `points` as possible at once.
 *
 * Deliberately "the most of them", not "the biggest connected region". What a
 * camera can show is decided by angle, and connectedness is a fact about the
 * territory graph — two territories can share a border and still want
 * different framings, while two with no border between them may sit in the
 * same glance. Counting what actually lands on screen is the question being
 * asked, so it is also the thing scored.
 *
 * Every point is tried as a seed, and each seed is slid a couple of times
 * towards the middle of whatever it can see — a mean shift, which walks a seed
 * on the edge of a clump into the centre of that clump. Every aim along the
 * way is scored, so a seed that drifts somewhere worse cannot lose the good
 * position it started from. Seeding from the points themselves rather than
 * sampling the sphere evenly is what keeps this affordable: the best aim is
 * always near a point, since an aim near nothing sees nothing.
 *
 * The tie-break is total framing rather than another count, so among aims that
 * show the same territories the one that shows them nearest the middle wins.
 */
export function holdingsAim(points, view, framing = DEFAULT_FRAMING) {
  let best = null;
  const consider = (aim) => {
    const score = coverage(points, aim, view, framing);
    if (
      !best
      || score.framed > best.framed
      || (score.framed === best.framed && score.quality > best.quality)
    ) {
      best = { aim, ...score };
    }
  };

  for (const seed of points) {
    let aim = normalize(seed);
    if (!isFinitePoint(aim)) continue;
    consider(aim);

    for (let i = 0; i < AIM_SETTLE; i++) {
      const seen = points.filter((p) => framingOf(aim, p, view) >= framing.margin);
      if (seen.length === 0) break;
      // Points spread over more than a hemisphere can cancel out entirely, and
      // a centroid of nothing is not a direction — keep the aim that got here.
      const next = normalize(centroid(seen.map(normalize)));
      if (!isFinitePoint(next)) break;
      aim = next;
      consider(aim);
    }
  }

  return best;
}

/**
 * Where to put the camera so the player can see their own ground again, or
 * null to leave it where it is.
 *
 * Null whenever *any* of `points` is already comfortably framed. Seeing some
 * of your own ground is enough to know where you are, and a camera that moved
 * anyway would be taking away a view from somebody who already has one — the
 * same bargain `framePlanet` makes about distance, applied to direction.
 *
 * `wideDistance` is how far back the whole planet fits (`framingDistance`).
 * Drawing back is offered rather than assumed: it is taken only when it
 * strictly shows more territories than turning alone would, and never when it
 * would mean coming in, so a player already further out than the whole planet
 * needs keeps the distance they chose.
 */
export function holdingsFocus(
  points,
  viewDirection,
  view,
  wideDistance,
  framing = DEFAULT_FRAMING
) {
  if (points.length === 0) return null;
  if (points.some((p) => framingOf(viewDirection, p, view) >= framing.margin)) return null;

  const near = holdingsAim(points, view, framing);
  if (near === null) return null;
  if (!(wideDistance > view.distance)) return { aim: near.aim, distance: view.distance };

  const wide = holdingsAim(points, { distance: wideDistance, halfFov: view.halfFov }, framing);
  return wide && wide.framed > near.framed
    ? { aim: wide.aim, distance: wideDistance }
    : { aim: near.aim, distance: view.distance };
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

// A pull-back long enough to read as the camera drawing back rather than as a
// cut, paced by how far it actually has to travel so a small correction does
// not take as long as crossing half the zoom range.
export function zoomDuration(from, to, framing = DEFAULT_FRAMING) {
  const { zoomSpeed, minZoomDuration, maxZoomDuration } = framing;
  const travel = Math.abs(to - from);
  return Math.min(maxZoomDuration, Math.max(minZoomDuration, travel / zoomSpeed));
}

// The distance `t` of the way (0..1) from `from` to `to`, eased on the same
// curve a swing is, so a pull-back that happens alongside one moves with it
// rather than against it.
export function zoomAlong(from, to, t) {
  return from + (to - from) * easeSwing(Math.min(1, Math.max(0, t)));
}

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
