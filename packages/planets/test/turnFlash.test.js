import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  flashDuration,
  flashOpacity,
  prefersReducedMotion,
  REDUCED_TURN_FLASH,
  TURN_FLASH,
} from '../src/render/turnFlash.js';

// Samples the whole burst finely enough to catch a peak between two frames.
function sample(options, step = 1 / 240) {
  const end = flashDuration(options);
  const values = [];
  for (let t = 0; t <= end + step; t += step) values.push(flashOpacity(t, options));
  return values;
}

// How many separate times the veil rises and falls again — the thing a viewer
// actually counts, and the number a photosensitivity guideline is stated in.
function peaks(values) {
  let count = 0;
  let rising = false;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[i - 1]) rising = true;
    if (rising && values[i] < values[i - 1]) {
      count++;
      rising = false;
    }
  }
  return count;
}

test('the veil is clear before the burst and clear again after it', () => {
  assert.equal(flashOpacity(-1), 0);
  assert.equal(flashOpacity(0), 0);
  assert.equal(flashOpacity(flashDuration(TURN_FLASH)), 0);
  assert.equal(flashOpacity(flashDuration(TURN_FLASH) + 5), 0);
});

test('the default burst is two flashes, and reduced motion is one', () => {
  assert.equal(peaks(sample(TURN_FLASH)), 2);
  assert.equal(peaks(sample({ ...TURN_FLASH, ...REDUCED_TURN_FLASH })), 1);
});

// Photosensitivity guidance draws its line at more than three flashes in any
// one second. Asserted against what the sampler counts rather than against
// `flashes`, so a spacing that ran two bursts together — or a future tuning
// that raised the count — has to answer for it here.
test('no second of the burst carries more than three flashes', () => {
  for (const options of [TURN_FLASH, { ...TURN_FLASH, ...REDUCED_TURN_FLASH }]) {
    const step = 1 / 240;
    const values = sample(options, step);
    const perSecond = Math.round(1 / step);
    for (let start = 0; start < values.length; start += perSecond / 4) {
      const window = values.slice(start, start + perSecond);
      assert.ok(peaks(window) <= 3, `${peaks(window)} flashes inside one second`);
    }
  }
});

// `peak` is the number anyone tuning this will read as "how grey it gets", so
// it has to be true however the flashes are spaced. Combining them with `max`
// rather than by adding is what makes it true — overlapping flashes run
// together into a plateau instead of stacking into something brighter than
// either.
test('a spacing tighter than one flash still never goes past peak', () => {
  const tight = { ...TURN_FLASH, spacing: 0.01, flashes: 4 };
  for (const value of sample(tight)) {
    assert.ok(value <= TURN_FLASH.peak + 1e-9, `reached ${value} over peak ${TURN_FLASH.peak}`);
  }
});

test('every flash actually reaches peak, so none is a flicker', () => {
  assert.ok(Math.max(...sample(TURN_FLASH)) >= TURN_FLASH.peak - 1e-6);
});

test('the burst lasts the flashes plus the gaps between them', () => {
  const { spacing, rise, hold, fall } = TURN_FLASH;
  assert.equal(flashDuration(TURN_FLASH), spacing + rise + hold + fall);
  assert.equal(flashDuration({ ...TURN_FLASH, flashes: 1 }), rise + hold + fall);
  assert.equal(flashDuration({ ...TURN_FLASH, flashes: 0 }), 0);
});

// The veil is DOM over the canvas rather than a three.js background, so its
// timing has no business importing three.js — and this file running at all
// under plain `node --test` is the assertion.
test('the timing is importable without a DOM or a renderer', () => {
  assert.equal(typeof flashOpacity, 'function');
  assert.equal(typeof globalThis.document, 'undefined');
});

// The reduced-motion swell is quieter *and* slower, and both halves matter:
// the point is to say the same thing without a strobe, not to say less of it.
test('the reduced-motion burst is dimmer and unhurried, not absent', () => {
  const reduced = { ...TURN_FLASH, ...REDUCED_TURN_FLASH };
  assert.ok(REDUCED_TURN_FLASH.peak < TURN_FLASH.peak);
  assert.ok(REDUCED_TURN_FLASH.rise > TURN_FLASH.rise);
  assert.ok(Math.max(...sample(reduced)) > 0.2, 'still has to be visible');
  assert.ok(flashDuration(reduced) > flashDuration(TURN_FLASH));
});

// Read at play time from a media query, so the answer with no window at all is
// "no such preference" rather than a crash — which is also what makes the
// timing half of this module importable under plain `node --test`.
test('the motion preference answers false rather than throwing without a browser', () => {
  assert.equal(prefersReducedMotion(), false);
});
