import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POLE_MARKER, axisFalloff, blockingAngle } from '../src/render/poleMarkers.js';
import { DIE_SIZE, stackHalfWidth } from '../src/render/diceLayer.js';
import { MAX_DICE_PER_STACK } from '../src/render/diceStacks.js';

// `align` is the cosine of the angle between the pole's axis and where you
// are looking from, which is what the shader has to hand — so a test stated
// in degrees has to say so.
const atDegrees = (degrees, tuning) =>
  axisFalloff(Math.cos((degrees * Math.PI) / 180), tuning);

const tuning = (over = {}) => ({ sideOn: 0.16, axisPower: 1, ...over });

// cos(90°) is 6e-17 rather than 0, so edge-on is only ever edge-on to within
// a rounding error — and a fractional axisPower amplifies that (6e-17 to the
// 0.4 is 3e-7). The tolerance is set below what a screen can even show: a
// channel is 1/255, so anything under 1e-6 of a brightness is not a
// difference, it is arithmetic.
const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: got ${actual}, wanted ${expected}`);

test('the two knobs do separate jobs: one sets the floor, the other the ramp', () => {
  // the whole reason both exist, and the thing that is hard to tell apart by
  // eye — turning axisPower must never change how it looks edge-on
  for (const axisPower of [0.4, 1, 2.5, 6]) {
    close(
      atDegrees(90, tuning({ axisPower })),
      0.16,
      `axisPower ${axisPower} must leave edge-on at sideOn`
    );
    close(atDegrees(0, tuning({ axisPower })), 1, 'and head-on always at full');
  }
});

test('sideOn is the only knob that moves edge-on', () => {
  close(atDegrees(90, tuning({ sideOn: 0 })), 0, 'nothing left at all');
  close(atDegrees(90, tuning({ sideOn: 0.5 })), 0.5, 'or half of it');
});

test('above 1 holds it near the floor until you are nearly over the pole', () => {
  const middle = 45;
  assert.ok(
    atDegrees(middle, tuning({ axisPower: 4 })) < atDegrees(middle, tuning({ axisPower: 1 })),
    'a higher power is dimmer everywhere between the ends'
  );
  assert.ok(
    atDegrees(middle, tuning({ axisPower: 0.4 })) > atDegrees(middle, tuning({ axisPower: 1 })),
    'and a lower one is brighter'
  );
});

test('even at 1 it is not linear in the angle, because align is a cosine', () => {
  // this is the part that makes tuning by eye confusing: at 1 the marker
  // barely dims over a wide cap above the pole and then falls away fast
  const linear = tuning({ axisPower: 1 });
  assert.ok(atDegrees(30, linear) > 0.85, '30° off the pole is still nearly full strength');
  assert.ok(atDegrees(75, linear) < 0.4, 'while 75° is most of the way down to the floor');
});

test('it never leaves the range the two ends set', () => {
  for (let degrees = 0; degrees <= 180; degrees += 5) {
    const kept = atDegrees(degrees, tuning());
    assert.ok(kept >= 0.16 - 1e-6 && kept <= 1 + 1e-6, `${degrees}° stayed in range`);
  }
});

test('the far side of the planet reads the same as the near side', () => {
  // `abs` in the shader: a pole pointing away is as head-on as one pointing
  // at you, and the planet is what hides the far one, not the falloff
  close(atDegrees(0, tuning()), atDegrees(180, tuning()), 'both ends read alike');
});

// --- when a dice tower is actually in the marker's way ----------------------

test('how tall a tower is has nothing to do with whether it blocks', () => {
  // the cone is widest at its base, so a stack that overlaps there overlaps
  // whatever its height — and one that clears it stays clear further up,
  // where the cone is narrower still. Only the column count moves the answer.
  assert.equal(blockingAngle(1), blockingAngle(MAX_DICE_PER_STACK), 'one column, any height');
  assert.equal(
    blockingAngle(MAX_DICE_PER_STACK + 1),
    blockingAngle(MAX_DICE_PER_STACK * 2),
    'two columns, any height'
  );
});

test('a second column reaches further, so it blocks from further out', () => {
  assert.ok(
    blockingAngle(MAX_DICE_PER_STACK + 1) > blockingAngle(MAX_DICE_PER_STACK),
    'the die that starts a new column is the one that widens the footprint'
  );
});

test('the reach is the cone plus the stack, and nothing else', () => {
  // stated against diceLayer's own measurement rather than re-derived, which
  // is the point: the spacing lives in one place
  for (const dice of [1, 4, 5, 8]) {
    assert.equal(
      blockingAngle(dice),
      DIE_SIZE * POLE_MARKER.radiusInDice + stackHalfWidth(dice),
      `${dice} dice`
    );
  }
});

test('a slimmer base is in the way less often', () => {
  // the whole reason the base is under a die wide: every lift is a marker
  // standing off the ground, and the footprint is what decides how often
  const slim = blockingAngle(8, { radiusInDice: 0.8 });
  const fat = blockingAngle(8, { radiusInDice: 1.6 });
  assert.ok(slim < fat);
  assert.ok(POLE_MARKER.radiusInDice < 1, 'and the default really is under a die wide');
});

test('the marker is sized in dice throughout, because what it clears is dice', () => {
  for (const key of ['heightInDice', 'radiusInDice', 'sinkInDice']) {
    assert.ok(POLE_MARKER[key] > 0, `${key} is a real size`);
  }
});
