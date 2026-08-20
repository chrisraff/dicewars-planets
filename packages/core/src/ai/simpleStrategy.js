import { neighbors } from '../graph.js';
import { isLegalAttack } from '../reducer.js';
import { getPlayerNodeIds, MAX_DICE_PER_NODE } from '../state.js';

// Every attack this player could legally make right now.
export function legalAttacksFor(state, playerId) {
  const moves = [];
  for (const from of getPlayerNodeIds(state, playerId)) {
    for (const to of neighbors(state.graph, from)) {
      if (isLegalAttack(state, from, to)) moves.push({ from, to });
    }
  }
  return moves;
}

// Rough "how much do I like this attack" score. Dice advantage dominates —
// an even fight is a coin flip the attacker loses on ties, so it's only worth
// taking from a full stack that can't grow any further.
function scoreMove(state, { from, to }) {
  const attacker = state.nodes.get(from);
  const defender = state.nodes.get(to);
  const advantage = attacker.dice - defender.dice;

  if (advantage <= 0 && attacker.dice < MAX_DICE_PER_NODE) return null; // not worth it
  if (advantage < 0) return null; // even a full stack won't throw itself away

  // prefer the safest fight, then the fattest prize
  return advantage * 10 + defender.dice;
}

/**
 * A plain heuristic opponent, in the shape runAiTurn expects:
 * `(state, playerId) -> { from, to } | null`. It keeps taking the most
 * favorable attack available and stops once nothing is worth attacking,
 * re-evaluating from scratch each call since the board just changed.
 *
 * `rng` only breaks ties, so two AIs on a symmetric board don't mirror
 * each other move for move.
 */
export function createSimpleStrategy({ rng = Math.random } = {}) {
  return function simpleStrategy(state, playerId) {
    let best = null;
    let bestScore = -Infinity;

    for (const move of legalAttacksFor(state, playerId)) {
      const score = scoreMove(state, move);
      if (score === null) continue;
      const jittered = score + rng();
      if (jittered > bestScore) {
        bestScore = jittered;
        best = move;
      }
    }
    return best;
  };
}
