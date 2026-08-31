export { createGraph, neighbors, areAdjacent, setNeighbors } from './graph.js';
export {
  createInitialState,
  getNode,
  getCurrentPlayerId,
  getPlayerNodeIds,
  isPlayerAlive,
  livingPlayerIds,
  largestConnectedRegionSize,
  incomeFor,
  bodyOf,
  bodiesOf,
  reserveOn,
  withReserveOn,
  reserveFor,
  totalReserve,
  DEFAULT_BODY,
  NEUTRAL_OWNER,
  serializeState,
  reviveState,
  MAX_DICE_PER_NODE,
  MAX_RESERVE,
} from './state.js';
export { seededRng, randomSeed } from './rng.js';
export { attack, endTurn, updateAdjacency } from './actions.js';
export { reduce, isLegalAttack } from './reducer.js';
export { runAiTurn } from './ai/runAiTurn.js';
export { createSimpleStrategy, legalAttacksFor } from './ai/simpleStrategy.js';
export {
  createDefensiveStrategy,
  defensiveMovesFor,
  DEFENSIVE_TUNING,
} from './ai/defensiveStrategy.js';
export {
  createExpertStrategy,
  expertMovesFor,
  EXPERT_WEIGHTS,
  MOON_WEIGHTS,
} from './ai/expertStrategy.js';
export { winProbability } from './ai/battleOdds.js';
export { surrenderedPlayerIds, SURRENDER_TUNING } from './ai/surrender.js';
export { wrapLegacyAi } from './ai/legacyAdapter.js';
