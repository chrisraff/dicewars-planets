export { createGraph, neighbors, areAdjacent, setNeighbors } from './graph.js';
export {
  createInitialState,
  getNode,
  getCurrentPlayerId,
  getPlayerNodeIds,
  isPlayerAlive,
  livingPlayerIds,
  largestConnectedRegionSize,
  MAX_DICE_PER_NODE,
  MAX_RESERVE,
} from './state.js';
export { attack, endTurn, updateAdjacency } from './actions.js';
export { reduce, isLegalAttack } from './reducer.js';
export { runAiTurn } from './ai/runAiTurn.js';
export { createSimpleStrategy, legalAttacksFor } from './ai/simpleStrategy.js';
export { wrapLegacyAi } from './ai/legacyAdapter.js';
