import { createGraph, neighbors } from './graph.js';

export const MAX_DICE_PER_NODE = 8;
export const MAX_RESERVE = 64;

// `assignments`: Map/array of [nodeId, { owner, dice }] — however the world
// generator decided to hand out starting territories.
export function createInitialState({ nodeIds, edges, playerIds, assignments, turnOrder }) {
  const graph = createGraph(nodeIds, edges);
  const assignmentMap = new Map(assignments);

  const nodes = new Map(
    nodeIds.map((id) => {
      const a = assignmentMap.get(id);
      if (!a) throw new Error(`no starting assignment for node: ${id}`);
      return [id, { owner: a.owner, dice: a.dice }];
    })
  );

  const players = new Map(
    playerIds.map((id) => [id, { id, reserve: 0 }])
  );

  return {
    graph,
    nodes,
    players,
    turnOrder: turnOrder ?? [...playerIds],
    currentTurnIndex: 0,
    phase: 'attack',
    winner: null,
  };
}

export function getNode(state, nodeId) {
  const node = state.nodes.get(nodeId);
  if (!node) throw new Error(`unknown node: ${nodeId}`);
  return node;
}

export function getCurrentPlayerId(state) {
  return state.turnOrder[state.currentTurnIndex];
}

export function getPlayerNodeIds(state, playerId) {
  const ids = [];
  for (const [id, node] of state.nodes) {
    if (node.owner === playerId) ids.push(id);
  }
  return ids;
}

export function isPlayerAlive(state, playerId) {
  for (const node of state.nodes.values()) {
    if (node.owner === playerId) return true;
  }
  return false;
}

export function livingPlayerIds(state) {
  return state.turnOrder.filter((id) => isPlayerAlive(state, id));
}

// Size of the player's largest connected group of territories — this is the
// figure classic Dice Wars pays reinforcement dice on at end of turn.
export function largestConnectedRegionSize(state, playerId) {
  const owned = new Set(getPlayerNodeIds(state, playerId));
  const seen = new Set();
  let best = 0;

  for (const start of owned) {
    if (seen.has(start)) continue;
    let size = 0;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const id = stack.pop();
      size++;
      for (const n of neighbors(state.graph, id)) {
        if (owned.has(n) && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    if (size > best) best = size;
  }
  return best;
}
