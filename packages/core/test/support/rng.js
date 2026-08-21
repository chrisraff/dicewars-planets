/**
 * A deterministic stand-in for `Math.random`, so a test that involves chance
 * fails the same way twice and a seed can be quoted in a bug report.
 *
 * Numerical Recipes' LCG constants, kept inside 32 bits by `Math.imul`: a
 * plain `s * 1664525` leaves the safe integer range on the first step, after
 * which the low bits are float rounding rather than the sequence.
 */
export function seededRng(seed = 1) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * A `rollDie` that hands out exactly these faces, in order. Once they run out
 * every further die comes up `whenSpent` — a test that pins the rolls it cares
 * about should not have to count the ones it does not.
 */
export function rollsOf(faces, whenSpent = 1) {
  const queue = [...faces];
  return () => (queue.length > 0 ? queue.shift() : whenSpent);
}

/** A `rollDie` where every die comes up the same, for a foregone conclusion. */
export const alwaysRolls = (face) => () => face;
