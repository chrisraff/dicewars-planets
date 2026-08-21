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

// --- saving and restoring ----------------------------------------------------

/**
 * A state as plain JSON-able data: Maps become entry arrays and the graph
 * becomes a list of edges.
 *
 * The edges are read back out of the graph rather than taken from whatever
 * world description built it, because those two can differ — `setNeighbors`
 * exists precisely so a world can rewire itself mid-game, and a save has to
 * record the board as it stands, not as it was dealt.
 *
 * Node and player entries are copied whole rather than field by field, so a
 * field added to either is carried through a save without this function
 * needing to hear about it.
 */
export function serializeState(state) {
  const seen = new Set();
  const edges = [];
  for (const [id, adjacent] of state.graph.adjacency) {
    seen.add(id);
    for (const other of adjacent) {
      if (!seen.has(other)) edges.push([id, other]); // each edge once, either way round
    }
  }

  return {
    nodes: [...state.nodes].map(([id, node]) => [id, { ...node }]),
    edges,
    players: [...state.players].map(([id, player]) => [id, { ...player }]),
    turnOrder: [...state.turnOrder],
    currentTurnIndex: state.currentTurnIndex,
    phase: state.phase,
    winner: state.winner,
  };
}

/**
 * The inverse of `serializeState` — a state the reducer can carry on from.
 *
 * Node order is preserved, not just node identity: reinforcement scatters
 * across a player's territories, and the order they are visited in is part of
 * where the dice land.
 */
export function reviveState(snapshot) {
  const nodeIds = snapshot.nodes.map(([id]) => id);

  return {
    graph: createGraph(nodeIds, snapshot.edges),
    nodes: new Map(snapshot.nodes.map(([id, node]) => [id, { ...node }])),
    players: new Map(snapshot.players.map(([id, player]) => [id, { ...player }])),
    turnOrder: [...snapshot.turnOrder],
    currentTurnIndex: snapshot.currentTurnIndex,
    phase: snapshot.phase,
    winner: snapshot.winner ?? null,
  };
}
