// `seededRng` is part of the rules package proper — a save rebuilds a world
// from a seed, so determinism is a shipped promise rather than a test fixture.
// Re-exported here so a test still reaches every generator through one import.
export { seededRng } from '../../src/rng.js';

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
