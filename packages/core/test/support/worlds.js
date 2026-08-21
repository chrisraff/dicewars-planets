import { createInitialState } from '../../src/index.js';

/**
 * A row of territories, each one touching only the next: a—b—c—d.
 *
 * Almost every rules test wants a board small enough to reason about by eye
 * and shaped so that adjacency is obvious, which is exactly what a chain is.
 * `assignments` is core's own `[nodeId, { owner, dice }]` form, so a test
 * reads as the board it is describing.
 */
export function chainState(assignments, { playerIds = ['p1', 'p2'], turnOrder } = {}) {
  const nodeIds = assignments.map(([id]) => id);
  return createInitialState({
    nodeIds,
    edges: nodeIds.slice(1).map((id, i) => [nodeIds[i], id]),
    playerIds,
    assignments,
    turnOrder,
  });
}

/** The same chain as a plain world description, for consumers of core. */
export function chainWorld(assignments, { playerIds = ['p1', 'p2'] } = {}) {
  const nodeIds = assignments.map(([id]) => id);
  return {
    nodeIds,
    edges: nodeIds.slice(1).map((id, i) => [nodeIds[i], id]),
    playerIds,
    assignments,
  };
}

/** Every node's owner and dice, as a plain object — handy for one assertion. */
export const boardOf = (state) =>
  Object.fromEntries([...state.nodes].map(([id, n]) => [id, `${n.owner}:${n.dice}`]));

/**
 * The same state with a player's bank preset. Reinforcement is the one rule
 * whose interesting cases only arise on a *later* turn — dice that had nowhere
 * to land last time — and nothing in the public API sets a bank directly.
 */
export const withReserve = (state, playerId, reserve) => ({
  ...state,
  players: new Map(state.players).set(playerId, { ...state.players.get(playerId), reserve }),
});
