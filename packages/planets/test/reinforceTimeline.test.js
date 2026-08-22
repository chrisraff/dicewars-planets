import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dieStart,
  reinforceDuration,
  DEFAULT_REINFORCE_TIMING,
  MAX_REINFORCE_DURATION,
} from '../src/render/reinforceTimeline.js';

const T = DEFAULT_REINFORCE_TIMING;

test('nothing to pay out takes no time', () => {
  assert.equal(reinforceDuration(0), 0);
});

test('one die is just its own fall', () => {
  assert.equal(reinforceDuration(1), T.fall);
  assert.equal(dieStart(0, 1), 0);
});

test('dice start staggered, each sooner than the one before it lands', () => {
  const starts = [0, 1, 2, 3].map((i) => dieStart(i, 4));
  for (let i = 1; i < starts.length; i++) {
    assert.ok(starts[i] > starts[i - 1], 'each die starts later than the one before');
    assert.ok(starts[i] - starts[i - 1] < T.fall, 'and before the previous one has landed');
  }
});

test('duration always covers the last die’s own start plus its fall', () => {
  for (const count of [1, 2, 5, 20]) {
    assert.equal(reinforceDuration(count), dieStart(count - 1, count) + T.fall);
  }
});

test('a big payout is capped rather than taking forever', () => {
  const big = reinforceDuration(200);
  assert.ok(big <= MAX_REINFORCE_DURATION + 1e-9, `expected ${big} <= ${MAX_REINFORCE_DURATION}`);
  assert.ok(big > reinforceDuration(2), 'more dice still take a little longer, just not linearly');
});
