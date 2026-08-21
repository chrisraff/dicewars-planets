// Shared fixtures for the rules tests, and for the packages that consume them
// (planets reaches these through the `@dicewars/core/test-support` export, so
// there is one seeded generator in the repo rather than one per test file).
export { seededRng, rollsOf, alwaysRolls } from './rng.js';
export { chainState, chainWorld, boardOf, withReserve } from './worlds.js';
