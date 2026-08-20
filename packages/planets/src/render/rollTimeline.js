// Timing for one attack, in seconds. Deliberately data, not code: the AI
// plays the same animation at a higher speed so its turns don't crawl.
export const DEFAULT_TIMING = {
  aim: 0.25, // attacker and defender light up, before anything moves
  roll: 1.0, // dice hop, tumble, and come down on their rolled faces
  read: 0.7, // everything holds still long enough to read the totals
};

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
 *   spin     radians tumbled so far, easing to a stop
 *   settle   0..1 blend from "tumbling" toward the face that was rolled
 *
 * At the end of the roll `lift` is back to 0, `spin` is a whole number of
 * turns and `settle` is exactly 1, so the dice land square on their values
 * with no visible snap.
 */
export function sampleAttack(elapsed, timing = DEFAULT_TIMING) {
  const { aim, roll, read } = timing;

  if (elapsed < aim) {
    return { phase: 'aim', progress: clamp01(elapsed / aim), lift: 0, spin: 0, settle: 0 };
  }

  const rolling = elapsed - aim;
  if (rolling < roll) {
    const p = clamp01(rolling / roll);
    return {
      phase: 'roll',
      progress: p,
      lift: Math.sin(Math.PI * p),
      spin: TUMBLE_TURNS * 2 * Math.PI * easeOutCubic(p),
      settle: smoothstep(0.55, 1, p),
    };
  }

  const settled = { lift: 0, spin: TUMBLE_TURNS * 2 * Math.PI, settle: 1 };
  const reading = rolling - roll;
  if (reading < read) {
    return { phase: 'read', progress: clamp01(reading / read), ...settled };
  }
  return { phase: 'done', progress: 1, ...settled };
}
