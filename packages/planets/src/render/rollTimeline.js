// Timing for one attack, in seconds. Deliberately data, not code: the AI
// plays the same animation at a higher speed so its turns don't crawl.
//
// `settleFrom` is where in the roll the dice stop tumbling and start showing
// the faces they landed on — which is the moment the outcome becomes
// *readable*, and so the moment a cancel has to have closed. See
// `cancelWindow`.
//
// `bounce` is the second, smaller hop, and it is not decoration: it is the
// cancel window made visible. Pushing `settleFrom` back to give a human time
// to change their mind leaves the dice in the air with nothing to do, and a
// die that hangs is a die that looks broken; a die that lands, bounces and
// then settles is doing something for that time. It is on the player's own
// throw and nowhere else, because a throw nobody can cancel has nothing to
// hide — see AI_TIMING and REPLAY_TIMING, which both settle early.
export const DEFAULT_TIMING = {
  aim: 0.25, // attacker and defender light up, before anything moves
  roll: 1.0, // dice hop, tumble, bounce, and come down on their rolled faces
  read: 0.7, // everything holds still long enough to read the totals
  settleFrom: 0.75,
  // How high the bounce goes, as a fraction of the throw it came off. Its
  // *timing* is not a second number: see `touchdownAt`.
  bounce: { height: 0.7 },
  // How far behind the attacker the defender's dice run. A fight has two
  // halves and they are not equal: the attacker's total is a number, and the
  // defender's is the answer. Landing both at once makes the reader do the
  // subtraction at the same moment they do the reading, and the beat between
  // them is what turns a sum into a result.
  //
  // On the player's own fight only, like the bounce, and for a related
  // reason: this is the fight worth dramatising, and a quarter of a second on
  // every AI attack is a turn that crawls.
  stagger: 0.35,
};

// Where the faces begin to resolve in a throw that does not say. Only a throw
// with a cancel on it needs to hold out, so this is the ordinary value and
// DEFAULT_TIMING is the exception.
const SETTLE_FROM = 0.55;

/**
 * How far short of the faces resolving a cancel closes.
 *
 * Not fussiness about floating point, though it settles that too. `tick` is
 * driven by frames, so the last moment a cancel is offered is the last *frame*
 * before the window shuts — and a frame that runs long on a busy phone would
 * otherwise land the offer after the dice have started coming up. Three
 * frames' worth at 60Hz, spent on the safe side.
 */
const CANCEL_MARGIN = 0.05;

/**
 * When the first landing happens, as a fraction of the roll beat.
 *
 * Derived from the height rather than given, because the two are not free of
 * each other: under gravity a hop's *time* goes as the square root of its
 * height, so a bounce a quarter as high lasts half as long. Picking the two
 * separately is how a bounce ends up looking wrong in a way that is hard to
 * name — and naming it is what this replaces.
 *
 * Solving `t1 + t2 = 1` with `t2 / t1 = sqrt(h)` gives this, and it drops out
 * of the arcs below that the die leaves the ground at exactly `sqrt(h)` of the
 * speed it arrived at — the coefficient of restitution, for free and
 * consistent, rather than as a third number to get wrong.
 */
export function touchdownAt({ height }) {
  return 1 / (1 + Math.sqrt(height));
}

/**
 * The same throw, briefer still, for a replay.
 *
 * A replay is watched rather than played, and its dice have to land inside
 * the cadence the track advances at (`REPLAY_STEP_MS`) or every roll is cut
 * off by the next step — so this is shorter than even the AI's pace. The aim
 * beat is nearly nothing because a replay step has already marked its fight
 * before the dice move; there is no moment of "who is attacking whom" left to
 * cover. What is kept is `read`: the whole point of throwing the dice out
 * across the territory is that the roll can be read off the ground, and dice
 * that re-stack the instant they land cannot be.
 */
export const REPLAY_TIMING = { aim: 0.05, roll: 0.3, read: 0.25, settleFrom: SETTLE_FROM };

export const TUMBLE_TURNS = 3; // whole turns a die makes on the way up and down

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (edge0, edge1, v) => {
  const t = clamp01((v - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/**
 * The whole attack, including the beat the defender's dice run behind by —
 * they are the last thing to come to rest, so they are what "over" means.
 */
export function attackDuration(timing = DEFAULT_TIMING) {
  return timing.aim + timing.roll + timing.read + (timing.stagger ?? 0);
}

/**
 * How long after the attacker's dice the defender's are thrown.
 *
 * It costs nothing in safety and cannot cost any: the attacker's dice are
 * unaffected, so the earliest anything can be read is exactly where it was,
 * and the *outcome* — which needs both halves — arrives strictly later than
 * it used to. `cancelWindow` is measured off the attacker's clock for that
 * reason and does not mention this.
 */
export function staggerOf(timing = DEFAULT_TIMING) {
  return timing.stagger ?? 0;
}

/**
 * How long an attack stays cancelable, in seconds from the moment it was
 * declared.
 *
 * It ends exactly where the faces start resolving, because that is what a
 * cancel must not be able to see. The stake is higher than save-scumming:
 * cancel and re-declare rolls fresh dice, so a window that leaked *anything*
 * about the outcome would turn the cancel into a re-roll button. It leaks
 * nothing only while every die is still tumbling, and `settleFrom` is when
 * that stops being true.
 *
 * Stated as a function of the timing rather than as a constant so it cannot
 * drift from the animation it is measured against — `rollTimeline.test.js`
 * asserts `sampleAttack(cancelWindow(t), t).settle` is still exactly 0.
 */
export function cancelWindow(timing = DEFAULT_TIMING) {
  return Math.max(0, timing.aim + groundedAt(timing) * timing.roll - CANCEL_MARGIN);
}

/**
 * How far through the roll the dice are finally down, as a fraction of it.
 *
 * This is `settleFrom`, and the name is the point: it is one moment wearing
 * three hats, and they have to be the same moment. The flight ends here, the
 * tumble starts braking here — against the ground, which is the only thing
 * that can slow it — and the faces start resolving here, because a die rocks
 * onto its face once it has stopped bouncing and not before.
 *
 * Splitting them is how the animation was wrong twice. Braking used to start
 * mid-flight, with nothing touching the die; the faces used to start resolving
 * while it was still in the air.
 */
export function groundedAt(timing = DEFAULT_TIMING) {
  return timing.settleFrom ?? SETTLE_FROM;
}

/**
 * How far through the roll a die *first* touches down, as a fraction of it —
 * the moment the bounce starts, and the moment its tumble axis changes.
 *
 * `touchdownAt` is where that sits inside the flight; this is where the flight
 * sits inside the roll. Without a bounce the two landings are the same one.
 */
export function firstLandingAt(timing = DEFAULT_TIMING) {
  const grounded = groundedAt(timing);
  return timing.bounce ? touchdownAt(timing.bounce) * grounded : grounded;
}

/**
 * How far through its total tumble a die is, `p` through the roll.
 *
 * **Constant speed, and then a stop — never a stall in between.** A die in the
 * air is not slowing down: nothing is touching it. So it turns at one rate for
 * the whole flight, and comes off that rate only once it is down (`groundedAt`
 * — the same moment the flight ends and the faces start resolving), which is
 * where the ground is available to scrub it off against.
 *
 * What this replaces was `easeOutCubic` across the whole roll, which is down
 * to 12% of its starting rate by the first landing — so the die bounced
 * essentially motionless and then appeared to pick up again as `settle` swung
 * it onto its face. Rotation that slows to nothing mid-flight and then starts
 * again is the single most unnatural thing a thrown die can do, and no amount
 * of tuning the arcs hides it.
 *
 * The rate is `2 / (1 + settleFrom)` rather than 1 because the tail covers
 * only half the ground a constant rate would: spending the whole roll at that
 * rate is what still lands it on a whole number of turns.
 */
function tumbleAt(p, settleFrom) {
  const rate = 2 / (1 + settleFrom);
  if (p <= settleFrom) return rate * p;

  // Slowing linearly to a stop exactly at the end — so the rate is continuous
  // where the two meet, which is the whole point of the piece above.
  const braking = p - settleFrom;
  return rate * (settleFrom + braking - (braking * braking) / (2 * (1 - settleFrom)));
}

// A ballistic hop: up and down again over [0, 1], apex `height` at the middle.
// A parabola rather than a sine arc because that is what falling actually
// looks like — the difference is small in the air and obvious at the landing,
// where a sine comes in soft and a thrown die does not.
const hop = (t, height = 1) => 4 * height * t * (1 - t);

/**
 * How far off the ground a die is, `p` through the roll.
 *
 * **The flight is over at `grounded`, not at the end of the roll**, and the
 * stretch after it is the die on the ground — scrubbing its spin off and
 * rocking onto its face. That is the only place either of those can honestly
 * happen: a die in the air is touching nothing.
 *
 * Inside the flight: one arc without a bounce, two with. Out to the first
 * landing at `touchdownAt`, then a shorter, quicker hop that comes down again
 * exactly as the flight ends. Both ends of both arcs are zero, so the die is
 * on the ground when it should be however they are spliced.
 */
function liftAt(p, bounce, grounded) {
  if (p >= grounded) return 0;

  const flown = p / grounded;
  if (!bounce) return hop(flown);
  const at = touchdownAt(bounce);
  if (flown < at) return hop(flown / at);
  return hop((flown - at) / (1 - at), bounce.height);
}

/**
 * What the dice should be doing `elapsed` seconds into an attack.
 *
 *   phase    which beat of the attack we're in
 *   progress 0..1 through that beat
 *   lift     0..1 of the hop height — zero on the ground at both ends
 *   travel   0..1 of the way from the stack to where the die lands
 *   spin     radians tumbled so far, braking to a stop once it is down
 *   settle   0..1 blend from "tumbling" toward the face that was rolled
 *
 * The roll has two halves and `groundedAt` is the seam: a flight, and then the
 * die on the ground. `lift` is zero after it, `spin` brakes across it, and
 * `settle` runs over exactly it — a die rocks onto its face once it has
 * stopped bouncing and not before, which is also what makes the cancel window
 * end there.
 *
 * At the end of the roll `lift` is 0, `travel` and `settle` are exactly 1 and
 * `spin` is a whole number of turns, so the dice come to rest on their landing
 * spots showing their values with no visible snap.
 */
export function sampleAttack(elapsed, timing = DEFAULT_TIMING) {
  const { aim, roll, read } = timing;

  if (elapsed < aim) {
    return {
      phase: 'aim',
      progress: clamp01(elapsed / aim),
      lift: 0,
      travel: 0,
      spin: 0,
      settle: 0,
    };
  }

  const rolling = elapsed - aim;
  if (rolling < roll) {
    const p = clamp01(rolling / roll);
    return {
      phase: 'roll',
      progress: p,
      lift: liftAt(p, timing.bounce, groundedAt(timing)),
      // Eased at both ends: the dice leave the stack and settle onto the
      // ground rather than starting and stopping dead. One curve across the
      // whole roll, bounce or no bounce — **it must not be split at the
      // touchdown.** Two eased halves meet with zero slope between them, so
      // the die slides, stops dead on the ground and then sets off again,
      // which is the one thing a bounce never does. Sliding on through it is
      // both simpler and what actually happens: a bouncing thing keeps the
      // speed it had.
      travel: smoothstep(0, 1, p),
      spin: TUMBLE_TURNS * 2 * Math.PI * tumbleAt(p, groundedAt(timing)),
      settle: smoothstep(groundedAt(timing), 1, p),
    };
  }

  const settled = { lift: 0, travel: 1, spin: TUMBLE_TURNS * 2 * Math.PI, settle: 1 };
  const reading = rolling - roll;
  if (reading < read) {
    return { phase: 'read', progress: clamp01(reading / read), ...settled };
  }
  return { phase: 'done', progress: 1, ...settled };
}
