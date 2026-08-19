import { reduce } from '../reducer.js';
import { getCurrentPlayerId } from '../state.js';
import { attack, endTurn } from '../actions.js';

const MAX_ATTACKS_PER_TURN = 10_000; // guards against a runaway/misbehaving strategy

// Native AI interface: strategy(state, playerId) -> { from, to } | null.
// Returning null/undefined ends the turn — this mirrors the classic
// "call repeatedly, return falsy to stop" protocol on purpose, since it's
// exactly what packages/core/src/ai/legacyAdapter.js has to bridge to.
export function runAiTurn(state, strategy, deps = {}) {
  const playerId = getCurrentPlayerId(state);
  const events = [];
  let current = state;

  for (let i = 0; i < MAX_ATTACKS_PER_TURN; i++) {
    const move = strategy(current, playerId);
    if (!move) break;

    const step = reduce(current, attack(move.from, move.to), deps);
    current = step.state;
    events.push(...step.events);
  }

  const step = reduce(current, endTurn(), deps);
  events.push(...step.events);
  return { state: step.state, events };
}
