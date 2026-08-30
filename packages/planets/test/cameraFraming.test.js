import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FRAMING,
  clusterAim,
  fightCenter,
  framingDistance,
  framingOf,
  narrowHalfFov,
  needsRefocus,
  swingDirection,
  swingDuration,
  swingTravel,
  visibleAngle,
  zoomAlong,
  zoomDuration,
} from '../src/render/cameraFraming.js';
import { angleBetween, cross, dot, length, normalize } from '../src/geometry/vec3.js';

// The default camera: 45° vertical field of view, 3.2 out from the middle of
// a unit planet. `minDistance` is 1.5, which is the interesting other end.
const HALF_FOV = Math.PI / 8; // half of 45°, i.e. a square viewport
const FAR = { distance: 3.2, halfFov: HALF_FOV };
const CLOSE = { distance: 1.5, halfFov: HALF_FOV };

const spherical = (lonDeg, latDeg = 0) => {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  return { x: Math.cos(lat) * Math.sin(lon), y: Math.sin(lat), z: Math.cos(lat) * Math.cos(lon) };
};
const FACING = spherical(0); // straight at the camera

/**
 * Independently: is a point on the planet actually visible from a camera
 * `distance` out, with a half-angle `halfFov` frustum? Nothing the module
 * does is reused here — this is a plain ray/lens check, so it can disagree.
 */
function reallyVisible({ distance, halfFov }, point) {
  const camera = { x: 0, y: 0, z: distance };
  const toPoint = { x: point.x - camera.x, y: point.y - camera.y, z: point.z - camera.z };
  const facesCamera = dot(point, toPoint) < 0; // the front of the sphere, not the back
  const offAxis = angleBetween(normalize(toPoint), { x: 0, y: 0, z: -1 });
  return facesCamera && offAxis <= halfFov;
}

test('what you can see is capped by the horizon when the planet fits the frame', () => {
  // 3.2 out, the whole planet is comfortably inside a 45° view, so the only
  // thing hiding ground is the sphere curving away: acos(1/d).
  assert.ok(Math.abs(visibleAngle(FAR.distance, FAR.halfFov) - Math.acos(1 / 3.2)) < 1e-9);
});

test('and by the frame instead once you zoom in past the planet', () => {
  // Up close the silhouette is wider than the screen, so most of the lit half
  // is off frame long before it reaches the horizon.
  assert.ok(visibleAngle(CLOSE.distance, CLOSE.halfFov) < Math.acos(1 / CLOSE.distance) - 0.2);
  assert.ok(visibleAngle(CLOSE.distance, CLOSE.halfFov) < visibleAngle(FAR.distance, FAR.halfFov),
    'zooming in shows less of the planet, not more');
});

test('the edge of the cap is the last point actually on screen, at either zoom', () => {
  // The claim `visibleAngle` makes but does not itself check: a point just
  // inside it renders, and a point just outside it does not.
  for (const view of [FAR, CLOSE]) {
    const edge = (visibleAngle(view.distance, view.halfFov) * 180) / Math.PI;
    assert.ok(reallyVisible(view, spherical(edge - 0.5)), `${edge}° - 0.5 should be visible`);
    assert.ok(!reallyVisible(view, spherical(edge + 0.5)), `${edge}° + 0.5 should not be`);
  }
});

test('framing reads 1 dead center, 0 at the edge and negative off screen', () => {
  const edge = visibleAngle(FAR.distance, FAR.halfFov);
  assert.equal(framingOf(FACING, FACING, FAR), 1);
  assert.ok(Math.abs(framingOf(FACING, spherical((edge * 180) / Math.PI), FAR)) < 1e-9);
  assert.ok(framingOf(FACING, spherical(180), FAR) < 0, 'the far side of the planet');
});

test('framing keeps getting worse all the way round to the far side', () => {
  // The projection folds back past the limb — the antipode lands dead center
  // on screen, behind everything — so reading it off the picture alone would
  // rank the one place you can see least as the best framed spot there is.
  let previous = Infinity;
  for (let deg = 0; deg <= 180; deg += 2) {
    const framing = framingOf(FACING, spherical(deg), FAR);
    assert.ok(framing < previous, `${deg}° should be worse framed than ${deg - 2}°`);
    previous = framing;
  }
});

test('framing is measured on the screen, not around the planet', () => {
  // Half way to the limb in angle is already most of the way out on the disc:
  // the sphere crams its last few degrees into the outside of the picture,
  // and a margin stated in angle would quietly tolerate dice seen edge-on.
  const edge = visibleAngle(FAR.distance, FAR.halfFov);
  const halfway = framingOf(FACING, spherical((edge * 90) / Math.PI), FAR);
  assert.ok(halfway < 0.3,
    `half way to the limb reads ${halfway.toFixed(2)}, not the 0.5 an angle would give it`);
});

test('the margin is the only thing deciding whether the camera moves', () => {
  // 20° out on the default view — a little under half way out on screen.
  const nearside = spherical(20);
  const framing = framingOf(FACING, nearside, FAR);
  assert.ok(!needsRefocus(FACING, nearside, FAR, { ...DEFAULT_FRAMING, margin: framing - 0.01 }));
  assert.ok(needsRefocus(FACING, nearside, FAR, { ...DEFAULT_FRAMING, margin: framing + 0.01 }));
});

test('a fight in front of the camera is left alone; one round the back is not', () => {
  assert.ok(!needsRefocus(FACING, FACING, FAR));
  assert.ok(needsRefocus(FACING, spherical(180), FAR));
  assert.ok(needsRefocus(FACING, spherical(65), FAR), 'and one out on the limb, seen edge-on');
});

test('the same fight can need a move zoomed in and not zoomed out', () => {
  const point = spherical(20);
  assert.ok(!needsRefocus(FACING, point, FAR));
  assert.ok(needsRefocus(FACING, point, CLOSE), 'zoomed in, 20° away is off the side of the screen');
});

test('a fight is framed between its two territories', () => {
  const center = fightCenter(spherical(-20), spherical(20));
  assert.ok(Math.abs(length(center) - 1) < 1e-12, 'stays on the sphere');
  assert.ok(angleBetween(center, spherical(0)) < 1e-9);
});

test('the swing takes the short way round, however far it has to go', () => {
  const from = spherical(0);
  const to = spherical(170); // the long way round is 190°, and would look absurd
  const path = Array.from({ length: 21 }, (_, i) => swingDirection(from, to, i / 20));

  let travelled = 0;
  for (let i = 1; i < path.length; i++) travelled += angleBetween(path[i - 1], path[i]);
  assert.ok(Math.abs(travelled - angleBetween(from, to)) < 1e-6, 'no detour, no overshoot');

  const plane = normalize(cross(from, to));
  for (const step of path) assert.ok(Math.abs(dot(step, plane)) < 1e-9, 'stays on one great circle');
});

test('the swing holds latitude steady instead of bulging toward a pole', () => {
  // Two fights at the same high latitude, most of the way round in
  // longitude. The great circle between them is the mathematically shortest
  // path, but it bulges up toward the pole to get there — the "jumps poles"
  // swing this exists to avoid, even though neither fight is anywhere near
  // one. Moving lon/lat independently should hold 70° steady throughout.
  const from = spherical(0, 70);
  const to = spherical(170, 70);
  const path = Array.from({ length: 21 }, (_, i) => swingDirection(from, to, i / 20));

  for (const step of path) {
    const lat = (Math.asin(Math.max(-1, Math.min(1, step.y))) * 180) / Math.PI;
    assert.ok(Math.abs(lat - 70) < 1e-6, `stayed at 70° latitude, not ${lat.toFixed(3)}°`);
  }
});

test('swingTravel matches the direct distance on the equator, where the two paths agree', () => {
  const from = spherical(0);
  const to = spherical(170);
  assert.ok(Math.abs(swingTravel(from, to) - angleBetween(from, to)) < 1e-9);
});

test('off the equator, holding latitude costs more distance than the great circle it replaces', () => {
  // The same pair the "bulging toward a pole" test above uses: holding 70°
  // steady is a longer way round than the great circle that cuts across
  // toward the pole to get there, so pacing the swing by the direct distance
  // would move it faster than it is actually travelling.
  const from = spherical(0, 70);
  const to = spherical(170, 70);
  assert.ok(
    swingTravel(from, to) > angleBetween(from, to) * 1.2,
    'the lon/lat path is meaningfully longer than "as the crow flies"'
  );
});

test('the swing starts where the camera is and ends looking at the target', () => {
  const from = spherical(0);
  const to = spherical(120, 30);
  assert.ok(angleBetween(swingDirection(from, to, 0), from) < 1e-9);
  assert.ok(angleBetween(swingDirection(from, to, 1), to) < 1e-9);
});

test('the swing eases in and out rather than starting and stopping dead', () => {
  const from = spherical(0);
  const to = spherical(90);
  const at = (t) => angleBetween(from, swingDirection(from, to, t));

  assert.ok(at(0.1) < 0.1 * at(1), 'still gathering pace');
  assert.ok(at(0.9) > 0.9 * at(1), 'already settling');
  for (let t = 0.05; t <= 1; t += 0.05) assert.ok(at(t) > at(t - 0.05), 'and never backs up');
});

test('a fight on the exact opposite side still turns somewhere', () => {
  // No unique shortest arc — every direction is equally right, and the one
  // thing that must not happen is the camera pointing at NaN.
  const from = spherical(0);
  const path = [0, 0.5, 1].map((t) => swingDirection(from, spherical(180), t));
  for (const step of path) assert.ok(Math.abs(length(step) - 1) < 1e-9, `${JSON.stringify(step)}`);
  assert.ok(angleBetween(path[2], spherical(180)) < 1e-6);
});

test('a swing is paced by distance, and bounded at both ends', () => {
  assert.equal(swingDuration(0.01), DEFAULT_FRAMING.minDuration, 'a nudge is not slower than a turn');
  assert.equal(swingDuration(Math.PI), DEFAULT_FRAMING.maxDuration, 'a half turn is not a whip pan');
  assert.ok(swingDuration(1.2) > swingDuration(0.9), 'in between, further takes longer');
});

test('the camera always arrives before the dice it is turning for land', () => {
  // An AI attack aims for 0.12s and rolls for 0.45s (AI_TIMING); anything the
  // camera is still doing after that is a swing the player watches instead of
  // the battle it exists to show.
  assert.ok(swingDuration(Math.PI) <= 0.12 + 0.45);
});

test('clusterAim leaves a comfortably framed run alone, same as needsRefocus', () => {
  assert.equal(clusterAim([], FACING, FAR), null);
  assert.equal(clusterAim([spherical(10)], FACING, FAR), null);
});

// The press mid-AI-turn: the player wants the fight, and "it is nearly framed
// already" is not an answer to a button they pressed. Forcing drops that rule
// and nothing else — the aim is the one the swing would have chosen.
test('a forced clusterAim aims at a run the swing would have left alone', () => {
  const run = [spherical(10), spherical(16)];
  assert.equal(clusterAim(run, FACING, FAR), null);

  const aim = clusterAim(run, FACING, FAR, DEFAULT_FRAMING, { force: true });
  assert.ok(aim !== null);
  assert.ok(framingOf(aim, run[0], FAR) >= DEFAULT_FRAMING.margin);
  assert.ok(framingOf(aim, run[1], FAR) >= DEFAULT_FRAMING.margin);
});

// Forcing is about a camera that could have stayed put, not about inventing a
// fight — an AI turn with nothing in flight has nowhere for a press to go.
test('a forced clusterAim with no fights still has nothing to look at', () => {
  assert.equal(clusterAim([], FACING, FAR, DEFAULT_FRAMING, { force: true }), null);
});

test('clusterAim swings to a lone fight round the back, same as fightCenter would for one point', () => {
  const target = spherical(150);
  const aim = clusterAim([target], FACING, FAR);
  assert.ok(angleBetween(aim, target) < 1e-9);
});

test('two nearby upcoming fights are pulled into one aim that frames them both', () => {
  const first = spherical(150);
  const second = spherical(160);
  const aim = clusterAim([first, second], FACING, FAR);

  assert.ok(aim !== null);
  assert.ok(framingOf(aim, first, FAR) >= DEFAULT_FRAMING.margin, 'the first fight is still well framed');
  assert.ok(framingOf(aim, second, FAR) >= DEFAULT_FRAMING.margin, 'so is the second');
});

test('a fight too far away to share a frame is left for its own swing later', () => {
  const first = spherical(150);
  const second = spherical(160); // close enough to join
  const distant = spherical(150 + 150); // nowhere near either

  const aim = clusterAim([first, second, distant], FACING, FAR);

  assert.ok(framingOf(aim, first, FAR) >= DEFAULT_FRAMING.margin);
  assert.ok(framingOf(aim, second, FAR) >= DEFAULT_FRAMING.margin);
  assert.ok(
    framingOf(aim, distant, FAR) < DEFAULT_FRAMING.margin,
    'the distant fight was not absorbed into this swing'
  );
});

// --- fitting the whole planet on the screen ---------------------------------

// Two real viewports, both at the app's 45° vertical field of view.
const PHONE = 390 / 844; // portrait, where the horizontal fov is the tight one
const DESKTOP = 1440 / 900;

// The apparent radius of the planet's silhouette, as a fraction of the frame's
// half-width — 1 exactly filling it, above 1 overrunning it. Written from the
// projection rather than from `framingDistance`, so it is an independent check
// rather than the same algebra twice.
const discFill = (distance, halfFov) =>
  Math.tan(Math.asin(1 / distance)) / Math.tan(halfFov);

test('a portrait phone is framed by its width, a landscape desktop by its height', () => {
  const vertical = Math.PI / 8;
  assert.ok(narrowHalfFov(45, PHONE) < vertical, 'upright, the sides are what run out first');
  assert.equal(narrowHalfFov(45, DESKTOP), vertical, 'wide, the vertical fov is already the tighter');
});

test('the planet is framed with exactly the shave hanging off each edge', () => {
  for (const aspect of [PHONE, DESKTOP, 1]) {
    const halfFov = narrowHalfFov(45, aspect);
    const fill = discFill(framingDistance(halfFov, 0.075), halfFov);
    assert.ok(Math.abs(fill - 1 / 0.925) < 1e-9, `aspect ${aspect}: 92.5% of the disc is in frame`);
  }
});

test('no shave means the whole silhouette, edge to edge', () => {
  const halfFov = narrowHalfFov(45, PHONE);
  assert.ok(Math.abs(discFill(framingDistance(halfFov, 0), halfFov) - 1) < 1e-9);
});

test('shaving a corner off lets the camera come closer', () => {
  // the point of the shave: two slivers of limb bought back as apparent size
  const halfFov = narrowHalfFov(45, PHONE);
  assert.ok(framingDistance(halfFov, 0.075) < framingDistance(halfFov, 0));
});

test('a phone has to sit much further back than a desktop for the same view', () => {
  const phone = framingDistance(narrowHalfFov(45, PHONE), DEFAULT_FRAMING.shave);
  const desktop = framingDistance(narrowHalfFov(45, DESKTOP), DEFAULT_FRAMING.shave);

  assert.ok(phone > desktop * 1.5, 'which is why a phone opens wrong without this at all');
  assert.ok(desktop < 3.2, 'and why a desktop, already past that, is left exactly as it was');
  assert.ok(phone < 8, 'and it still has to be a distance the controls will allow');
});

test('the planet never ends up behind the camera or inside it', () => {
  for (let aspect = 0.3; aspect <= 3; aspect += 0.1) {
    const distance = framingDistance(narrowHalfFov(45, aspect), DEFAULT_FRAMING.shave);
    assert.ok(distance > 1, `aspect ${aspect.toFixed(1)}: outside the surface`);
    assert.ok(Number.isFinite(distance), `aspect ${aspect.toFixed(1)}: a real distance`);
  }
});

// --- pacing the pull-back ---------------------------------------------------

test('a pull-back is paced by how far it goes, within bounds', () => {
  const { minZoomDuration, maxZoomDuration, zoomSpeed } = DEFAULT_FRAMING;
  assert.equal(zoomDuration(3, 3.01), minZoomDuration, 'a nudge does not crawl');
  assert.equal(zoomDuration(1.5, 8), maxZoomDuration, 'the whole range does not drag');
  assert.equal(zoomDuration(2, 2 + zoomSpeed * 0.5), 0.5, 'and in between, its own speed');
});

test('it is over before the AI has anything to show', () => {
  // 0.25s of think pause plus ~0.57s of aim and roll before the first dice
  // land — the pull-back has to have stopped by then or the planet is still
  // moving under a battle being read
  assert.ok(DEFAULT_FRAMING.maxZoomDuration < 0.25 + 0.57);
});

test('a pull-back starts and ends where it says, and eases in between', () => {
  assert.equal(zoomAlong(1.5, 4.9, 0), 1.5);
  assert.equal(zoomAlong(1.5, 4.9, 1), 4.9);
  assert.equal(zoomAlong(1.5, 4.9, 0.5), (1.5 + 4.9) / 2, 'symmetric about the middle');
  assert.ok(zoomAlong(1.5, 4.9, 0.1) - 1.5 < (4.9 - 1.5) * 0.1, 'eased in, not linear');
  assert.equal(zoomAlong(1.5, 4.9, 2), 4.9, 'and it cannot overshoot');
});
