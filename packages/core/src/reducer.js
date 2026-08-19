import { areAdjacent, setNeighbors } from './graph.js';
import { getCurrentPlayerId, livingPlayerIds } from './state.js';
import { resolveAttack, applyReinforcement } from './combat.js';

export function isLegalAttack(state, from, to) {
  if (state.phase !== 'attack') return false;
  const attacker = state.nodes.get(from);
  const defender = state.nodes.get(to);
  if (!attacker || !defender) return false;
  if (attacker.owner !== getCurrentPlayerId(state)) return false;
  if (defender.owner === attacker.owner) return false;
  if (attacker.dice <= 1) return false;
  return areAdjacent(state.graph, from, to);
}

function advanceTurn(state) {
  const living = livingPlayerIds(state);
  if (living.length <= 1) {
    return { ...state, phase: 'gameover', winner: living[0] ?? null };
  }

  let idx = state.currentTurnIndex;
  let next;
  do {
    idx = (idx + 1) % state.turnOrder.length;
    next = state.turnOrder[idx];
  } while (!living.includes(next));

  return { ...state, currentTurnIndex: idx, phase: 'attack' };
}

// Pure: (state, action) -> { state, events }. `deps.rollDie` lets callers
// (tests, replays) inject deterministic dice.
export function reduce(state, action, deps = {}) {
  switch (action.type) {
    case 'ATTACK': {
      const { from, to } = action;
      if (!isLegalAttack(state, from, to)) {
        throw new Error(`illegal attack: ${from} -> ${to}`);
      }
      const { nodes, result } = resolveAttack(state.nodes, { from, to }, deps);
      return {
        state: { ...state, nodes },
        events: [{ type: 'attack', ...result }],
      };
    }

    case 'END_TURN': {
      const playerId = getCurrentPlayerId(state);
      const { state: reinforced, earned } = applyReinforcement(state, playerId);
      const advanced = advanceTurn(reinforced);

      const events = [{ type: 'endTurn', playerId, earned }];
      if (advanced.phase === 'gameover') {
        events.push({ type: 'gameOver', winner: advanced.winner });
      }
      return { state: advanced, events };
    }

    case 'UPDATE_ADJACENCY': {
      let graph = state.graph;
      for (const [nodeId, neighborIds] of action.patch) {
        graph = setNeighbors(graph, nodeId, neighborIds);
      }
      return { state: { ...state, graph }, events: [{ type: 'adjacencyChanged' }] };
    }

    default:
      throw new Error(`unknown action type: ${action.type}`);
  }
}
