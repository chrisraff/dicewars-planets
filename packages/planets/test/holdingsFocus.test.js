import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FRAMING,
  framingOf,
  framingDistance,
  holdingsAim,
  holdingsFocus,
  narrowHalfFov,
} from '../src/render/cameraFraming.js';
import { normalize } from '../src/geometry/vec3.js';

// A desktop-ish view: the planet framed as `framePlanet` would leave it.
const HALF_FOV = narrowHalfFov(45, 16 / 9);
const WIDE = framingDistance(HALF_FOV, DEFAULT_FRAMING.shave);
const VIEW = { distance: WIDE, halfFov: HALF_FOV };

// A direction `degrees` around the equator from the point facing +z.
const at = (degrees) => {
  const a = (degrees * Math.PI) / 180;
  return { x: Math.sin(a), y: 0, z: Math.cos(a) };
};

// A little clump around `degrees`, spread just enough to still share a view.
const clumpAt = (degrees, count) =>
  Array.from({ length: count }, (_, i) => at(degrees + (i - (count - 1) / 2) * 6));

const framedFrom = (aim, points, view = VIEW) =>
  points.filter((p) => framingOf(aim, p, view) >= DEFAULT_FRAMING.margin).length;

test('the camera stays put while any of your own ground is on screen', () => {
  const points = [at(0), at(150)];
  assert.equal(holdingsFocus(points, at(0), VIEW, WIDE), null);
});

test('holding nothing is not a reason to move the camera', () => {
  assert.equal(holdingsFocus([], at(0), VIEW, WIDE), null);
});

// The rule above is right for a handover and wrong for a press. Somebody who
// asked to be taken back to their ground has already seen whatever sliver of
// it is on screen and said it was not the view they wanted; answering "you can
// see some of it" is refusing the one thing the button promises.
test('a forced focus moves even when some of your ground is already framed', () => {
  const points = [at(0), at(150)];
  const focus = holdingsFocus(points, at(0), VIEW, WIDE, DEFAULT_FRAMING, { force: true });

  assert.notEqual(focus, null);
  // and it is the same aim the handover would have picked — forcing drops the
  // "don't bother" rule and nothing else about how the aim is chosen
  const aim = holdingsAim(points, VIEW, DEFAULT_FRAMING);
  assert.deepEqual(focus.aim, aim.aim);
});

// Forcing is about a camera that could have stayed put, not about conjuring an
// aim out of nothing: a player with no ground left has nothing to be shown.
test('forcing still finds nothing to look at when you hold nothing', () => {
  assert.equal(holdingsFocus([], at(0), VIEW, WIDE, DEFAULT_FRAMING, { force: true }), null);
});

// The whole point of the aim: a clump on the far side and a straggler
// somewhere else, and the camera has to pick the clump. Seeding from the
// points alone would tie — every seed frames itself — so this is really a test
// that the score is "how many end up on screen" rather than "did I aim at one".
test('it turns to wherever the most of your territories are, not the nearest one', () => {
  const clump = clumpAt(170, 5);
  const points = [at(60), ...clump];

  const focus = holdingsFocus(points, at(0), VIEW, WIDE);
  assert.ok(focus, 'nothing was in view, so it should have moved');
  assert.ok(
    framedFrom(focus.aim, points) >= 5,
    `only framed ${framedFrom(focus.aim, points)} of the clump of 5`
  );
  // and specifically not the straggler on its own
  assert.ok(framingOf(focus.aim, at(60), VIEW) < DEFAULT_FRAMING.margin);
});

// A seed sitting on the rim of a clump frames fewer of it than the middle
// does, so the aim has to be allowed to slide. This is what `AIM_SETTLE` buys,
// and without it the answer is whichever end of the clump happened to be tried.
test('the aim settles into the middle of a clump rather than one end of it', () => {
  const clump = clumpAt(180, 7);
  const best = holdingsAim(clump, VIEW);

  assert.equal(best.framed, clump.length);
  // the middle of the clump is at 180°; the aim should be close to it
  const middle = normalize(at(180));
  const off = Math.acos(Math.min(1, Math.abs(
    best.aim.x * middle.x + best.aim.y * middle.y + best.aim.z * middle.z
  ))) * 180 / Math.PI;
  assert.ok(off < 10, `aim landed ${off.toFixed(1)}° off the middle of the clump`);
});

// Drawing back is offered, not assumed. Zoomed right in, `visibleAngle` is
// small enough that turning alone cannot show a spread-out empire, so pulling
// out shows strictly more and is taken.
test('it draws back when turning alone cannot show as much', () => {
  const points = [at(150), at(180), at(210)];
  const close = { distance: 1.6, halfFov: HALF_FOV };

  const focus = holdingsFocus(points, at(0), close, WIDE);
  assert.ok(focus);
  assert.ok(focus.distance > close.distance, 'should have pulled back');
  assert.ok(
    framedFrom(focus.aim, points, { distance: focus.distance, halfFov: HALF_FOV })
      > framedFrom(focus.aim, points, close),
    'pulling back should have been worth it'
  );
});

test('it never hauls the player inwards, however spread out they are', () => {
  const points = [at(90), at(180), at(270)];
  const farOut = { distance: 6, halfFov: HALF_FOV };

  const focus = holdingsFocus(points, at(0), farOut, WIDE);
  if (focus) assert.equal(focus.distance, farOut.distance);
});

test('a clump that already fits is shown without drawing back', () => {
  const clump = clumpAt(180, 4);
  const view = { distance: 3.2, halfFov: HALF_FOV };

  const focus = holdingsFocus(clump, at(0), view, WIDE);
  assert.ok(focus);
  assert.equal(focus.distance, view.distance, 'turning alone was enough');
});

// Territories scattered singly all over the planet is the opening board, and
// the case the "largest connected region" version of this would have handled
// worst — there is no region to speak of, so it would have aimed at an
// essentially arbitrary one. Counting what lands on screen degrades into
// "whichever quarter of the planet holds most of you", which is the right
// answer at every stage of a game.
test('a scattered opening board still aims at the thickest part of it', () => {
  const scattered = [at(0), at(20), at(35), at(120), at(200), at(300)];
  const best = holdingsAim(scattered, VIEW);

  const everyAim = scattered.map((p) => framedFrom(normalize(p), scattered));
  assert.ok(
    best.framed >= Math.max(...everyAim),
    `settled aim framed ${best.framed}, a raw territory framed ${Math.max(...everyAim)}`
  );
  assert.ok(best.framed >= 3, 'the three inside 35° of each other should share a view');
});
