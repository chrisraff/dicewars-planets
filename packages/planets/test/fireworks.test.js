import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededRng } from '@dicewars/core/test-support';
import { FIREWORKS, fireworksShow } from '../src/render/fireworks.js';

// A show is a couple of hundred dots, so every claim below is about all of
// them at once. Seeded, because a property that only holds for the draws one
// run happened to make is not a property.
const show = (options = {}, seed = 7) => fireworksShow(options, seededRng(seed));
const everyBurst = (fn, options) => {
  for (let seed = 1; seed <= 40; seed++) {
    for (const burst of show(options, seed).bursts) fn(burst, seed);
  }
};

const TAU = Math.PI * 2;
const distanceFromMiddle = ({ x, y }) => Math.hypot(x - 50, y - 50) / 50;

// The one claim the card actually depends on. The banner's card sits in the
// middle and is the thing the player is there to read; a firework behind it is
// a firework making the sentence harder to read, so bursts are placed in a
// ring rather than placed anywhere and hoped about.
test('nothing goes off over the card in the middle of the banner', () => {
  everyBurst((burst) => {
    assert.ok(
      distanceFromMiddle(burst) >= FIREWORKS.clear - 1e-9,
      `a burst landed ${distanceFromMiddle(burst).toFixed(2)} out, inside the clear zone`
    );
  });
});

test('and nothing goes off outside the banner either', () => {
  everyBurst((burst) => {
    assert.ok(burst.x >= 0 && burst.x <= 100, `x of ${burst.x}`);
    assert.ok(burst.y >= 0 && burst.y <= 100, `y of ${burst.y}`);
  });
});

// `duration` has to be the honest length of the show rather than roughly when
// it tails off, because it is also the timer that empties the layer — a spark
// still animating when that fires is one that vanishes mid-flight.
test('every spark is out before the run is over', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const plan = show({}, seed);
    for (const burst of plan.bursts) {
      for (const spark of burst.sparks) {
        assert.ok(
          burst.at + spark.duration <= plan.duration + 1e-9,
          `a spark ran to ${(burst.at + spark.duration).toFixed(2)}s of ${plan.duration}s`
        );
      }
    }
  }
});

test('the bursts run in order, and the first is early enough to be a greeting', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { bursts } = show({}, seed);
    for (let i = 1; i < bursts.length; i++) {
      assert.ok(bursts[i].at >= bursts[i - 1].at, 'a burst overtook the one before it');
    }
    assert.ok(bursts[0].at < 0.4, `the show opened ${bursts[0].at.toFixed(2)}s after the banner`);
  }
});

// The reason sparks are laid on spokes rather than given uniformly random
// angles: random angles clump, and a clumped burst reads as a spill rather
// than as an explosion. `angleJitter` under 1 keeps every spark inside its own
// spoke, so the circle is always covered.
test('a burst covers the whole circle rather than clumping to one side', () => {
  const gap = TAU / FIREWORKS.sparks;
  everyBurst((burst) => {
    const angles = burst.sparks.map((s) => ((s.angle % TAU) + TAU) % TAU).sort((a, b) => a - b);
    for (let i = 0; i < angles.length; i++) {
      const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + TAU;
      assert.ok(next - angles[i] < gap * 2, 'a burst left a gap two spokes wide');
    }
  });
});

// Two of the same color running reads as one firework that stuttered rather
// than as two, and with eight colors in the palette it comes up often.
test('no two bursts in a row are the same color', () => {
  everyBurstPair((a, b) => assert.notDeepEqual(a.color, b.color));
});

function everyBurstPair(fn) {
  for (let seed = 1; seed <= 40; seed++) {
    const { bursts } = show({}, seed);
    for (let i = 1; i < bursts.length; i++) fn(bursts[i - 1], bursts[i]);
  }
}

// Jitter is meant to be jitter. A reach that came out negative would be a
// spark flying backwards through its own burst, and a duration of zero would
// be one that never appears at all.
test('no spark is given a backwards flight or no time to make it', () => {
  everyBurst((burst) => {
    for (const spark of burst.sparks) {
      assert.ok(spark.reach >= 0, `reach of ${spark.reach}`);
      assert.ok(spark.duration > 0, `duration of ${spark.duration}`);
    }
  });
}, { reachJitter: 2, riseJitter: 2 }); // far past anything shipped, on purpose

// It takes its randomness as an argument like everything else here that has
// any, which is what lets a preview show the same show twice.
test('the same seed deals the same show', () => {
  assert.deepEqual(show({}, 12), show({}, 12));
  assert.notDeepEqual(show({}, 12), show({}, 13));
});

// A single burst is the degenerate case for the spacing arithmetic — `slot`
// divides by `bursts - 1` — and a show can be configured down to one.
test('a show of one burst still fits its run', () => {
  const plan = show({ bursts: 1 });
  assert.equal(plan.bursts.length, 1);
  assert.ok(plan.bursts[0].at >= 0);
  assert.ok(plan.bursts[0].at + plan.bursts[0].sparks[0].duration <= plan.duration + 1e-9);
});
