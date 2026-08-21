/**
 * A deterministic stand-in for `Math.random`: the same seed gives the same
 * sequence, every time and everywhere.
 *
 * This lives in the rules package rather than in the tests because both
 * sources of chance already arrive through `deps` — a seeded generator is what
 * makes that worth anything. A test pins a game so it fails the same way
 * twice; a save pins a *world*, so a planet can be rebuilt from a single
 * number rather than stored cell by cell.
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

/** A seed to start a fresh world from — the whole 32-bit range, uniformly. */
export function randomSeed(rng = Math.random) {
  return Math.floor(rng() * 4294967296) >>> 0;
}
