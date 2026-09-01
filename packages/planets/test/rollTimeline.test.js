import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cancelWindow,
  staggerOf,
  firstLandingAt,
  groundedAt,
  touchdownAt,
  sampleAttack,
  attackDuration,
  DEFAULT_TIMING,
  REPLAY_TIMING,
  TUMBLE_TURNS,
} from '../src/render/rollTimeline.js';
import { AI_TIMING } from '../src/game/createGame.js';
import { REPLAY_STEP_MS } from '../src/render/hud.js';

const T = DEFAULT_TIMING;

test('the beats run aim, roll, read, done, in that order', () => {
  const phases = [0, T.aim / 2, T.aim + 0.01, T.aim + T.roll + 0.01, attackDuration() + 0.01].map(
    (t) => sampleAttack(t).phase
  );
  assert.deepEqual(phases, ['aim', 'aim', 'roll', 'read', 'done']);
});

test('duration is the beats back to back, plus the beat the defender runs behind', () => {
  assert.equal(attackDuration(), T.aim + T.roll + T.read + T.stagger);
  assert.equal(attackDuration({ aim: 1, roll: 2, read: 3 }), 6, 'no stagger, nothing added');
  assert.equal(attackDuration({ aim: 1, roll: 2, read: 3, stagger: 0.5 }), 6.5);
});

// --- the two halves of a fight, one after the other ------------------------

// A fight has two halves and they are not equal: the attacker's total is a
// number and the defender's is the answer. The beat between them is what turns
// a sum into a result — landing both at once makes the reader do the reading
// and the subtraction in the same moment.
test('the defender’s dice have not moved while the attacker’s are being thrown', () => {
  const stagger = staggerOf(T);
  assert.ok(stagger > 0, 'the player’s own fight is the one worth dramatising');

  // What the defender's dice are doing is the attacker's clock, run back.
  const defender = (t) => sampleAttack(t - stagger, T);
  assert.equal(defender(0).lift, 0);
  assert.equal(defender(stagger / 2).travel, 0, 'still stacked while the attacker is in the air');
  assert.equal(defender(T.aim).spin, 0);
  assert.ok(sampleAttack(T.aim + T.roll * 0.3, T).lift > 0, 'which the attacker’s plainly are not');
});

test('the attacker comes to rest a whole beat before the defender does', () => {
  const stagger = staggerOf(T);
  const settles = T.aim + T.roll;

  assert.equal(sampleAttack(settles, T).settle, 1, 'the attacker is read first');
  assert.ok(sampleAttack(settles - stagger, T).settle < 1, 'and the defender is a beat behind');
  assert.ok(
    Math.abs(attackDuration(T) - stagger - (settles + T.read)) < 1e-9,
    'which is what makes the whole throw a beat longer'
  );
});

// The stagger cannot cost anything in safety, and the shape of that argument
// matters more than the number: the attacker's dice are untouched, so the
// earliest anything can be read is exactly where it was — and the *outcome*,
// which needs both halves, now arrives strictly later than it used to.
test('running the defender late does not move the cancel window', () => {
  const withoutStagger = { ...T, stagger: 0 };
  assert.equal(cancelWindow(T), cancelWindow(withoutStagger));
  assert.equal(sampleAttack(cancelWindow(T), T).settle, 0);
});

test('nothing moves before the dice are thrown', () => {
  const { lift, spin, settle } = sampleAttack(0);
  assert.deepEqual([lift, spin, settle], [0, 0, 0]);
});

// The player's own throw bounces: out, down, a shorter hop, down again. It is
// the cancel window made visible — the dice have to still be moving for as
// long as the outcome is being withheld, and a die that simply hangs in the
// air for that time looks broken rather than undecided.
test('the player’s dice land, bounce once, and land again', () => {
  const at = (p) => sampleAttack(T.aim + T.roll * p).lift;
  const first = firstLandingAt(T);
  const grounded = groundedAt(T);
  const { height } = T.bounce;

  assert.equal(at(0), 0, 'on the ground when the throw starts');
  assert.ok(at(first / 2) > 0.99, 'the top of the first hop');
  assert.ok(at(first) < 1e-9, 'and down again part way through the roll');

  const second = at(first + (grounded - first) / 2);
  assert.ok(second > 0.99 * height, 'the top of the bounce');
  assert.ok(second < at(first / 2), 'which is shorter than the throw it came off');
  assert.equal(at(grounded), 0, 'and the flight ends on the ground');
});

// The half of the roll that used to not exist. Everything that can only
// honestly happen against something solid happens here — the tumble braking,
// the faces resolving — and nothing that needs air happens after it.
test('the flight ends before the roll does, and the die is down for the rest of it', () => {
  const grounded = groundedAt(T);
  assert.ok(grounded < 1, 'there is a stretch of roll left after the dice are down');

  for (const p of [grounded, grounded + 0.05, 0.9, 1]) {
    assert.equal(sampleAttack(T.aim + T.roll * p).lift, 0, `airborne again at ${p}`);
  }
  assert.ok(sampleAttack(T.aim + T.roll * (grounded - 0.05)).lift > 0, 'and still flying before it');

  // The three things that share that moment, which is the whole reason it is
  // one number and not three.
  assert.equal(sampleAttack(T.aim + T.roll * grounded).settle, 0, 'the faces start resolving here');
  assert.equal(cancelWindow(T), T.aim + grounded * T.roll - 0.05, 'and the cancel closes here');
});

// A throw nobody can cancel has nothing to withhold, so it settles early and
// does not bounce — the two go together, and neither is a free choice.
test('the AI’s throw and a replay’s neither bounce nor hold out', () => {
  for (const timing of [AI_TIMING, REPLAY_TIMING]) {
    assert.equal(timing.bounce, undefined);
    assert.ok(timing.settleFrom < T.settleFrom, 'the faces come up sooner');
    // One arc, highest exactly halfway through its *flight* — which a bounce
    // never is, and which is not halfway through the roll for anybody now.
    const flight = groundedAt(timing);
    assert.ok(sampleAttack(timing.aim + (timing.roll * flight) / 2, timing).lift > 0.999);
    assert.equal(firstLandingAt(timing), flight, 'its only landing is the landing');
  }
});

// The other half of the complaint the bounce was reported with, and the worse
// half: rotation that slows to nothing mid-flight and then appears to pick up
// again is the single most unnatural thing a thrown die can do. Nothing is
// touching a die in the air, so nothing is slowing it down — it turns at one
// rate for the whole flight and comes off that rate only at the end, against
// the ground, over the same stretch the faces are settling on.
test('the tumble holds one rate through the air and only slows at the end', () => {
  const steps = 60;
  const rateAt = (i) => {
    const p = i / steps;
    return sampleAttack(T.aim + T.roll * (p + 1 / steps) * 0.9999).spin
      - sampleAttack(T.aim + T.roll * p).spin;
  };

  const flying = Math.round(T.settleFrom * steps);
  const cruise = rateAt(0);

  for (let i = 0; i < flying; i++) {
    assert.ok(Math.abs(rateAt(i) - cruise) < cruise * 0.01, `rate changed at ${i / steps}`);
  }

  let previous = cruise;
  for (let i = flying; i < steps - 1; i++) {
    const rate = rateAt(i);
    assert.ok(rate <= previous + 1e-9, `sped back up at ${i / steps}`);
    previous = rate;
  }
  assert.ok(previous < cruise * 0.35, 'and it is nearly stopped by the time it is read');
});

test('the tumble never runs backwards, and still lands on a whole number of turns', () => {
  let previous = -1;
  for (let i = 0; i <= 40; i++) {
    const { spin } = sampleAttack(T.aim + (T.roll * i) / 40);
    assert.ok(spin >= previous, 'dice never spin backwards');
    previous = spin;
  }
  assert.equal(sampleAttack(T.aim + T.roll).spin / (2 * Math.PI), TUMBLE_TURNS);
});

test('the roll ends on a whole number of turns, square on the rolled face', () => {
  const end = sampleAttack(T.aim + T.roll);
  assert.equal(end.settle, 1, 'fully blended onto the rolled value');
  assert.equal(end.spin / (2 * Math.PI), TUMBLE_TURNS, 'a whole number of turns, so no visible snap');
  assert.equal(end.lift, 0);
});

test('the rolled faces stay put while the totals are being read', () => {
  const reading = sampleAttack(T.aim + T.roll + T.read / 2);
  const done = sampleAttack(attackDuration() + 5);
  assert.equal(reading.settle, 1);
  assert.deepEqual([done.lift, done.settle], [0, 1]);
  assert.equal(done.phase, 'done');
});

test('a faster timing runs the same shape in less time', () => {
  const quick = { aim: 0.05, roll: 0.2, read: 0.1 };
  assert.equal(sampleAttack(0.06, quick).phase, 'roll');
  assert.equal(sampleAttack(0.3, quick).phase, 'read');
  assert.equal(sampleAttack(0.25, quick).settle, sampleAttack(T.aim + T.roll, T).settle);
});


// --- the replay's own pace ------------------------------------------------

test('a replay throw lands before the track moves on without it', () => {
  // The replay advances itself every REPLAY_STEP_MS while playing, and a
  // throw that has not finished by then is cut off mid-air by the next step.
  // This is the whole constraint REPLAY_TIMING is sized against, and nothing
  // in either constant enforces it on the other.
  assert.ok(
    attackDuration(REPLAY_TIMING) * 1000 < REPLAY_STEP_MS,
    `a replay roll takes ${attackDuration(REPLAY_TIMING)}s but a step is ${REPLAY_STEP_MS}ms`
  );
});

test('a replay throw is brisker than the AI’s, which is brisker than a player’s', () => {
  // watched rather than played, and played faster than it is watched
  assert.ok(attackDuration(REPLAY_TIMING) < attackDuration(AI_TIMING));
  assert.ok(attackDuration(AI_TIMING) < attackDuration(DEFAULT_TIMING));
});

test('a replay throw still holds the dice still long enough to be read', () => {
  // the reason the dice are thrown across the territory at all is that the
  // roll can be read off the ground — a throw that re-stacks the instant it
  // lands would be motion for its own sake
  assert.ok(REPLAY_TIMING.read > 0.2);
  assert.equal(sampleAttack(attackDuration(REPLAY_TIMING) - 0.01, REPLAY_TIMING).phase, 'read');
});


// --- how long a cancel stays open -----------------------------------------

// The one that matters. Cancel and re-declare rolls fresh dice, so a window
// that leaked anything at all about the outcome would be a re-roll button
// rather than an undo. Nothing leaks while every die is still tumbling, and
// `settle` is exactly what stops being true first.
test('the cancel window closes before a single face has begun to resolve', () => {
  for (const timing of [DEFAULT_TIMING, AI_TIMING, REPLAY_TIMING]) {
    const beat = sampleAttack(cancelWindow(timing), timing);
    assert.equal(beat.settle, 0, 'not merely small — nothing has resolved at all');
    assert.equal(beat.phase, 'roll', 'the dice are in the air, which is why it is safe');
  }
});

test('and it is a window a person can actually react in', () => {
  // The whole point of pushing `settleFrom` back and bouncing the dice. The
  // aim beat alone is a quarter of a second, which is not time to see a bar
  // appear, decide, and hit it.
  assert.ok(cancelWindow(DEFAULT_TIMING) > 0.8, 'a beat, not a flinch');
  assert.ok(cancelWindow(DEFAULT_TIMING) > DEFAULT_TIMING.aim * 3);
});

test('a cancel closes well before the throw does', () => {
  // Otherwise the readout would still be offering an X over dice that have
  // already been read, which is the one thing this must never do.
  assert.ok(cancelWindow(DEFAULT_TIMING) < attackDuration(DEFAULT_TIMING) - DEFAULT_TIMING.read);
});


// The defect this shape was reported with, and the reason `travel` is one
// curve across the whole roll rather than one per hop: two eased halves meet
// with zero slope between them, so the die slid, stopped dead on the ground at
// the touchdown, and then set off again. Nothing that bounces does that — it
// keeps the speed it had.
test('a die never stops moving forward part way through its throw', () => {
  const steps = 200;
  let previous = 0;

  for (let i = 1; i <= steps; i++) {
    const p = i / steps;
    const { travel } = sampleAttack(T.aim + T.roll * p * 0.999);
    const moved = travel - previous;
    previous = travel;
    assert.ok(moved > 0, `stalled at ${p.toFixed(3)} of the roll`);
  }
});

test('and it is still travelling when it first lands, which is what a bounce is', () => {
  const touchdown = touchdownAt(T.bounce);
  const just = (p) => sampleAttack(T.aim + T.roll * p).travel;

  const arriving = just(touchdown) - just(touchdown - 0.02);
  const leaving = just(touchdown + 0.02) - just(touchdown);
  assert.ok(leaving > arriving * 0.5, 'it carries most of its speed through the landing');
  assert.ok(just(touchdown) < 0.85, 'and still has ground to cover when it gets there');
});

// The timing of the bounce is not a free number — under gravity a hop's time
// goes as the square root of its height. Stated here because the pair is easy
// to pick apart by hand and hard to name when it looks wrong.
test('the bounce takes as long as its height says it should', () => {
  for (const height of [0.1, 0.3, 0.6]) {
    const at = touchdownAt({ height });
    assert.ok(
      Math.abs((1 - at) / at - Math.sqrt(height)) < 1e-12,
      `a bounce ${height} as high should last sqrt(${height}) as long`
    );
  }
});
