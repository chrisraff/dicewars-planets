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

// Whether anyone still holds ground for this player. Takes the nodes map
// rather than a whole state so it can be asked about the board mid-action,
// before the new state has been assembled.
function stillHoldsGround(nodes, playerId) {
  for (const node of nodes.values()) {
    if (node.owner === playerId) return true;
  }
  return false;
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

// Pure: (state, action) -> { state, events }. `deps` carries the two sources
// of chance in the rules, so a test or a replay can pin either: `deps.rollDie`
// for the dice a battle is fought with, `deps.rng` for where end-of-turn
// reinforcements land.
export function reduce(state, action, deps = {}) {
  switch (action.type) {
    case 'ATTACK': {
      const { from, to } = action;
      if (!isLegalAttack(state, from, to)) {
        throw new Error(`illegal attack: ${from} -> ${to}`);
      }
      const { nodes, result } = resolveAttack(state.nodes, { from, to }, deps);
      const events = [{ type: 'attack', ...result }];

      // Taking a player's last territory knocks them out then and there, in the
      // middle of someone's turn — the only player an attack can ever remove is
      // the one who just lost the defending territory.
      if (result.attackerWins && !stillHoldsGround(nodes, result.defenderOwner)) {
        events.push({
          type: 'eliminated',
          playerId: result.defenderOwner,
          by: result.attackerOwner,
        });
      }

      return { state: { ...state, nodes }, events };
    }

    case 'END_TURN': {
      const playerId = getCurrentPlayerId(state);
      const { state: reinforced, earned, landed } = applyReinforcement(state, playerId, deps);
      const advanced = advanceTurn(reinforced);

      const events = [{ type: 'endTurn', playerId, earned, landed }];
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
