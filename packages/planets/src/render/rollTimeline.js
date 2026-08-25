// Timing for one attack, in seconds. Deliberately data, not code: the AI
// plays the same animation at a higher speed so its turns don't crawl.
export const DEFAULT_TIMING = {
  aim: 0.25, // attacker and defender light up, before anything moves
  roll: 1.0, // dice hop, tumble, and come down on their rolled faces
  read: 0.7, // everything holds still long enough to read the totals
};

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
export const REPLAY_TIMING = { aim: 0.05, roll: 0.3, read: 0.25 };

export const TUMBLE_TURNS = 3; // whole turns a die makes on the way up and down

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const easeOutCubic = (p) => 1 - (1 - p) ** 3;
const smoothstep = (edge0, edge1, v) => {
  const t = clamp01((v - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export function attackDuration(timing = DEFAULT_TIMING) {
  return timing.aim + timing.roll + timing.read;
}

/**
 * What the dice should be doing `elapsed` seconds into an attack.
 *
 *   phase    which beat of the attack we're in
 *   progress 0..1 through that beat
 *   lift     0..1 of the hop height — zero on the ground at both ends
 *   travel   0..1 of the way from the stack to where the die lands
 *   spin     radians tumbled so far, easing to a stop
 *   settle   0..1 blend from "tumbling" toward the face that was rolled
 *
 * At the end of the roll `lift` is back to 0, `travel` and `settle` are
 * exactly 1 and `spin` is a whole number of turns, so the dice come down on
 * their landing spots showing their values with no visible snap.
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
      lift: Math.sin(Math.PI * p),
      // eased at both ends: the dice leave the stack and settle onto the
      // ground rather than starting and stopping dead
      travel: smoothstep(0, 1, p),
      spin: TUMBLE_TURNS * 2 * Math.PI * easeOutCubic(p),
      settle: smoothstep(0.55, 1, p),
    };
  }

  const settled = { lift: 0, travel: 1, spin: TUMBLE_TURNS * 2 * Math.PI, settle: 1 };
  const reading = rolling - roll;
  if (reading < read) {
    return { phase: 'read', progress: clamp01(reading / read), ...settled };
  }
  return { phase: 'done', progress: 1, ...settled };
}
