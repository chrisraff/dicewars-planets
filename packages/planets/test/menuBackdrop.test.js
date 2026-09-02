import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKDROP,
  aimSpin,
  backdropView,
  faceScore,
  onScreen,
  radiusReaching,
} from '../src/render/menuBackdrop.js';

// The two windows the framing has two different answers for, and neither is
// anything like square — the aspect is exactly where placement goes wrong.
const DESKTOP = { width: 1600, height: 900, fov: 45 };
const PHONE = { width: 390, height: 844, fov: 45 };

/**
 * Where a point on the planet lands, worked out from the projection rather
 * than from the module: camera at `(0, 0, distance)` looking down -Z, screen
 * offsets in proportion to `tan`, and then the view offset applied by hand.
 *
 * The point of doing it again here is that `onScreen` only ever answers yes or
 * no, so a placement out by a factor would still pass a test written in its
 * own terms.
 */
function projected(point, view) {
  const depth = view.distance - point.z;
  const halfHeight = Math.tan(view.halfFov) * depth;
  const x = ((point.x / halfHeight) * (view.height / 2)) + view.width / 2 - view.offset.x;
  const y = view.height / 2 - (point.y / halfHeight) * (view.height / 2) - view.offset.y;
  return { x, y };
}

/** A point on the silhouette, `around` radians round it from straight up. */
function limb(view, around) {
  const grazing = Math.asin(1 / view.distance);
  const out = Math.cos(grazing);
  return {
    x: out * Math.sin(around),
    y: out * Math.cos(around),
    z: Math.sin(grazing),
  };
}

/** A point on the unit sphere, in degrees. `lon` 0 faces the camera. */
const spherical = (lon, lat) => ({
  x: Math.cos((lat * Math.PI) / 180) * Math.sin((lon * Math.PI) / 180),
  y: Math.sin((lat * Math.PI) / 180),
  z: Math.cos((lat * Math.PI) / 180) * Math.cos((lon * Math.PI) / 180),
});

/** A point turned about Y, the way `group.rotation.y` turns the planet. */
function turn(point, spin) {
  const cos = Math.cos(spin);
  const sin = Math.sin(spin);
  return { x: point.x * cos + point.z * sin, y: point.y, z: point.z * cos - point.x * sin };
}

// --- where it sits ---------------------------------------------------------

test('landscape: the planet rises out of the bottom right, a quarter of the way down', () => {
  const view = backdropView(DESKTOP);

  const middle = projected({ x: 0, y: 0, z: 0 }, view);
  assert.ok(Math.abs(middle.x - DESKTOP.width) < 1e-6, 'its middle is off the right edge');
  assert.ok(middle.y > DESKTOP.height, 'and below the bottom of the window');

  const top = projected(limb(view, 0), view);
  assert.ok(
    Math.abs(top.y - BACKDROP.wide.top * DESKTOP.height) < 0.5,
    `the top of the planet draws at ${top.y.toFixed(1)}px, a quarter down is 225`
  );

  // Stated again as a bound, because the line above is measured against the
  // very constant it is checking and so says nothing about what that constant
  // is. This is the shape of the thing: the planet is *down* the window rather
  // than hanging off the top of it, and not so far down it is a sliver
  // cresting the bottom edge.
  const down = top.y / DESKTOP.height;
  assert.ok(down > 0.15 && down < 0.35, `the top of the planet sits ${(down * 100).toFixed(0)}% down`);
});

test('landscape: it reaches halfway across the page, at the bottom of the frame', () => {
  const view = backdropView(DESKTOP);

  // The widest the planet gets in shot is where its edge crosses the bottom
  // edge of the window, since its own middle is below that.
  const around = Math.acos((view.center.y - DESKTOP.height) / view.radius);
  const crossing = projected(limb(view, -around), view);

  assert.ok(Math.abs(crossing.y - DESKTOP.height) < 1, 'that point really is on the bottom edge');
  assert.ok(
    Math.abs(crossing.x - BACKDROP.wide.reach * DESKTOP.width) < 1,
    `it comes ${((crossing.x / DESKTOP.width) * 100).toFixed(1)}% across, asked for 50%`
  );

  // and the same bound, for the same reason as above: it is half the page, not
  // a corner it can be cropped into
  const across = crossing.x / DESKTOP.width;
  assert.ok(across > 0.4 && across < 0.6, `it reaches ${(across * 100).toFixed(0)}% across`);
});

test('the reach is solved for rather than picked, so it holds at any aspect', () => {
  // A radius chosen to look right on one window is a different fraction of the
  // next one; these are two windows a real person has.
  for (const window of [DESKTOP, { width: 1280, height: 800, fov: 45 }]) {
    const view = backdropView(window);
    const around = Math.acos((view.center.y - window.height) / view.radius);
    const crossing = projected(limb(view, -around), view);
    assert.ok(
      Math.abs(crossing.x / window.width - BACKDROP.wide.reach) < 0.01,
      `${window.width}x${window.height} reaches ${(crossing.x / window.width).toFixed(3)}`
    );
  }
});

test('portrait: the planet crests under the top of the screen rather than over it', () => {
  const view = backdropView(PHONE);
  const top = projected(limb(view, 0), view);

  assert.ok(top.y > 0, 'the top of the globe is in frame — a disc overrunning it is a wall');
  assert.ok(Math.abs(top.y - BACKDROP.tall.top * PHONE.height) < 0.5);

  // And high enough to be in the band above the panel, which is the only clear
  // sky a phone has: on the shortest one there is, nothing is left over to
  // centre the panel in and it starts about 70px down.
  const short = backdropView({ width: 390, height: 667, fov: 45 });
  assert.ok(projected(limb(short, 0), short).y < 70, 'and clear of the panel on a short phone');
});

test('portrait: the planet runs past the left edge, so it fills the screen behind the panel', () => {
  const view = backdropView(PHONE);
  // Its middle is in frame here, so this is the widest it gets — unlike
  // landscape, where the widest point in shot is where it crosses the bottom.
  assert.ok(view.center.y < PHONE.height, 'the middle of the disc is on the screen');
  const leftmost = projected(limb(view, -Math.PI / 2), view);

  assert.ok(leftmost.x < 0, 'it overruns the left edge rather than stopping short of it');
  assert.ok(
    Math.abs(leftmost.x / PHONE.width - BACKDROP.tall.reach) < 0.01,
    `it runs ${((-leftmost.x / PHONE.width) * 100).toFixed(1)}% past, asked for 15%`
  );

  // and past the bottom, which is the other half of filling the screen
  assert.ok(view.center.y + view.radius > PHONE.height);
});

test('a window too wide to honour gets a smaller planet, still anchored where it says', () => {
  // An ultrawide asks the camera inside `nearest`. The planet then stops
  // growing — but the top of it must still land where the anchor puts it, or a
  // clamped window gets one that is both smaller and sitting lower.
  const ultrawide = { width: 3440, height: 1080, fov: 45 };
  const view = backdropView(ultrawide);

  assert.equal(view.distance, BACKDROP.nearest, 'the clamp bit');
  const top = projected(limb(view, 0), view);
  assert.ok(Math.abs(top.y - BACKDROP.wide.top * ultrawide.height) < 0.5, 'and the top held');
});

test('the radius is taken at the widest point in frame, not at the widest of the disc', () => {
  // Portrait: the middle of the disc is on the screen, so the reach is simply
  // how far left of the right edge it has to come — and a negative reach, one
  // that overruns, only means anything in this case.
  assert.equal(radiusReaching({ top: 0.08, reach: -0.15 }, 390, 844), 1.15 * 390);

  // Landscape: the middle is below the window, so the planet is never seen at
  // its widest and has to be *larger* than the distance it is asked to cover.
  const wide = radiusReaching({ top: 0.25, reach: 0.5 }, 1600, 900);
  assert.ok(wide > 0.5 * 1600, 'bigger than the reach it is covering');

  // stated as a circle rather than as a fraction, so it can be checked as one
  const center = { x: 1600, y: 0.25 * 900 + wide };
  const crossing = { x: 0.5 * 1600, y: 900 };
  const away = Math.hypot(crossing.x - center.x, crossing.y - center.y);
  assert.ok(Math.abs(away - wide) < 1e-6, 'the bottom-edge crossing is on the circle');
});

// --- what is in frame ------------------------------------------------------

test('the near side of the planet is the cap inside the horizon, not the facing half', () => {
  const view = backdropView(DESKTOP);
  // Both of these project into the window; only the horizon test refuses the
  // one that is round the back.
  const grazing = Math.asin(1 / view.distance);
  assert.equal(onScreen(spherical(-25, 35), view), true);
  assert.equal(
    onScreen({ x: -Math.cos(grazing * 0.99), y: 0.4, z: Math.sin(grazing * 0.99) }, view),
    false,
    'over the horizon, and so behind the planet'
  );
});

test('the ground facing the camera is below the window, not in the middle of it', () => {
  // Worth stating, because it is the thing that stops being true when the
  // anchor moves: the planet is framed off its own corner, so the point
  // pointed straight at the lens is off the bottom of the screen.
  const view = backdropView(DESKTOP);
  assert.equal(onScreen(spherical(0, 0), view), false);
  assert.ok(projected(spherical(0, 0), view).y > DESKTOP.height);
});

// --- which way round it starts ---------------------------------------------

test('a face is scored for how much is on it and for how many players are', () => {
  // The one that matters: a wall of one empire loses to a smaller mixed face,
  // because a planet nobody is contesting is not what this is advertising.
  assert.ok(faceScore(Array(20).fill('p1')) < faceScore('aabbccdd'.split('')));
  // but not at any price — plenty of land still beats a sprinkling of colours
  assert.ok(faceScore('aaaaaaaaaabbbbbbbbbb'.split('')) > faceScore('abcde'.split('')));
  assert.equal(faceScore([]), 0, 'a face of nothing but ocean scores nothing');
});

const clumpAt = (lon, count, owners) =>
  Array.from({ length: count }, (_, i) => ({
    normal: spherical(lon + (i - count / 2) * 3, 35 + (i % 3) * 4),
    owner: owners[i % owners.length],
  }));

test('the opening spin is the one that shows the most, not merely one that shows some', () => {
  const view = backdropView(DESKTOP);
  const planet = clumpAt(155, 12, ['p1', 'p2', 'p3']); // starts round the back
  const seenAt = (spin) => planet.filter((t) => onScreen(turn(t.normal, spin), view)).length;

  assert.equal(seenAt(0), 0, 'none of it is in frame to begin with');

  const spin = aimSpin(planet, view);
  assert.ok(seenAt(spin) > 0, 'the aim found it');
  for (let step = 0; step < 96; step++) {
    const other = (step / 96) * Math.PI * 2;
    assert.ok(seenAt(spin) >= seenAt(other), `a turn of ${other.toFixed(2)} shows more`);
  }
});

test('the aim prefers a contested face to a bigger one held by one player', () => {
  const view = backdropView(DESKTOP);
  // Two clumps half a turn apart: a large single-owner one, and a smaller one
  // split between four. The mixed one is the picture worth opening on.
  const planet = [...clumpAt(-25, 16, ['p1']), ...clumpAt(155, 10, ['p1', 'p2', 'p3', 'p4'])];

  const spin = aimSpin(planet, view);
  const owners = new Set(
    planet.filter((t) => onScreen(turn(t.normal, spin), view)).map((t) => t.owner)
  );

  assert.ok(owners.size > 1, `it picked the contested face, seeing ${[...owners].join(', ')}`);
});
