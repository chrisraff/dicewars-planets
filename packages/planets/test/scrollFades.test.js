import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrollFades } from '../src/render/scrollFades.js';

// Shared by the dice strip in the battle readout and the player stats row —
// the same problem in both, so deliberately the same answer.

// A strip 200px wide holding 500px of contents: 300px of scrolling to do.
const strip = (scrollLeft) => ({ scrollLeft, scrollWidth: 500, clientWidth: 200 });

test('a strip with nothing to scroll fades on neither side', () => {
  assert.deepEqual(
    scrollFades({ scrollLeft: 0, scrollWidth: 200, clientWidth: 200 }),
    { left: false, right: false }
  );
});

test('unscrolled, it fades only on the right, where the rest of it is', () => {
  assert.deepEqual(scrollFades(strip(0)), { left: false, right: true });
});

test('part way along, it fades on both sides', () => {
  assert.deepEqual(scrollFades(strip(150)), { left: true, right: true });
});

test('scrolled to the end, it fades only on the left', () => {
  assert.deepEqual(scrollFades(strip(300)), { left: true, right: false });
});

test('a strip already at the end does not claim there is more to the right', () => {
  // scrollLeft is fractional on a zoomed or high-DPI display, so the end is
  // never reached exactly and a strict comparison would fade forever
  assert.equal(scrollFades(strip(299.6)).right, false);
  assert.equal(scrollFades({ ...strip(0.4) }).left, false, 'and likewise at the start');
});

test('the fades follow the scroll all the way across', () => {
  const seen = [0, 100, 200, 300].map((at) => scrollFades(strip(at)));
  assert.deepEqual(seen.map((f) => `${f.left ? 'L' : '-'}${f.right ? 'R' : '-'}`), [
    '-R', 'LR', 'LR', 'L-',
  ]);
});
