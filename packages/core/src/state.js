import { createGraph, neighbors } from './graph.js';

export const MAX_DICE_PER_NODE = 8;
export const MAX_RESERVE = 64;

/**
 * Which world a territory sits on, for a mode that has more than one of them
 * (the moon). Territories on different bodies can be made adjacent — that is
 * what a bridge is — but they are separate *economies*: reinforcement is paid
 * on the largest connected region **within each body** and scattered over
 * that body's territories only, so an army can cross a bridge and income
 * never can.
 *
 * A node with no `body` is on the default one. That is the whole of the
 * compatibility story: a single-world game writes no `body` anywhere, every
 * grouping below sees exactly one group, and each of these functions reduces
 * to what it did before this existed — same answers, same rng draws, same
 * saved shape.
 */
export const DEFAULT_BODY = 'planet';

/**
 * Territory that belongs to nobody: dice that have to be fought for before
 * they can be owned, and that do nothing until they are. Deliberately an
 * owner rather than a flag, because that is all it needs to be — it is not in
 * `turnOrder`, so it never takes a turn; `isLegalAttack` already permits
 * attacking anyone who is not you; and it is not in `players`, so it earns no
 * income and is never counted as a rival knocked out.
 */
export const NEUTRAL_OWNER = 'neutral';

export const bodyOf = (node) => node.body ?? DEFAULT_BODY;

// Every body the board has territory on, the default one first and the rest
// in the order they first appear. Stable, because reinforcement walks it and
// the order it walks decides which dice are drawn for what.
export function bodiesOf(state) {
  const bodies = [DEFAULT_BODY];
  for (const node of state.nodes.values()) {
    const body = bodyOf(node);
    if (!bodies.includes(body)) bodies.push(body);
  }
  return bodies;
}

// `assignments`: Map/array of [nodeId, { owner, dice }] — however the world
// generator decided to hand out starting territories.
export function createInitialState({ nodeIds, edges, playerIds, assignments, turnOrder }) {
  const graph = createGraph(nodeIds, edges);
  const assignmentMap = new Map(assignments);

  const nodes = new Map(
    nodeIds.map((id) => {
      const a = assignmentMap.get(id);
      if (!a) throw new Error(`no starting assignment for node: ${id}`);
      const node = { owner: a.owner, dice: a.dice };
      // absent rather than defaulted, so a single-world board carries no
      // trace of a concept it does not use — into the save included
      if (a.body !== undefined) node.body = a.body;
      return [id, node];
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

/**
 * Size of the player's largest connected group of territories — this is the
 * figure classic Dice Wars pays reinforcement dice on at end of turn.
 *
 * `body` narrows it to one world. Since a region is grown only through
 * territories already in `owned`, restricting that set is the whole of it: a
 * walk can no more cross a bridge than it can cross a border. Left out, this
 * measures the board as one, which is what a single-world game wants and what
 * this always did.
 */
export function largestConnectedRegionSize(state, playerId, body = null) {
  const owned = new Set(
    body === null
      ? getPlayerNodeIds(state, playerId)
      : getPlayerNodeIds(state, playerId).filter((id) => bodyOf(state.nodes.get(id)) === body)
  );
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

/**
 * What the player will be paid at the end of their turn: the largest
 * connected region on **each** body, added up.
 *
 * The sum rather than the largest of them, because the two are separate
 * economies rather than rival claims on one — a region of six on the planet
 * and three on the moon earns nine, paid in two places. And separately
 * measured rather than measured across a bridge, so that taking the territory
 * a bridge lands on never merges two empires into one payout for a round.
 *
 * On a single-world board this is `largestConnectedRegionSize` and nothing
 * else, which is why every caller can use it unconditionally.
 */
export function incomeFor(state, playerId) {
  let total = 0;
  for (const body of bodiesOf(state)) {
    total += largestConnectedRegionSize(state, playerId, body);
  }
  return total;
}

/**
 * Banked reinforcement — dice earned with nowhere to land — kept per body,
 * because dice earned on the moon must not spill onto the planet later. The
 * default body keeps the plain `reserve` field it has always had and the
 * others live beside it, so a single-world player entry is untouched, in
 * memory and in a save alike.
 */
export function reserveOn(player, body = DEFAULT_BODY) {
  if (!player) return 0;
  return body === DEFAULT_BODY ? player.reserve ?? 0 : player.reserves?.[body] ?? 0;
}

export function withReserveOn(player, body, amount) {
  if (body === DEFAULT_BODY) return { ...player, reserve: amount };
  return { ...player, reserves: { ...player.reserves, [body]: amount } };
}

/**
 * Everything a player has banked, across every world.
 *
 * The banked-dice badge on a stats tile is one number, so this is the number
 * it wants: a player is owed what they are owed, and which world it is waiting
 * on is a detail the tile has no room for and nothing to do with. On a
 * single-world board it is `player.reserve` and nothing else.
 */
export function totalReserve(player) {
  let total = player?.reserve ?? 0;
  for (const banked of Object.values(player?.reserves ?? {})) total += banked;
  return total;
}

// The same read, from a state — what a HUD showing one body at a time wants.
export const reserveFor = (state, playerId, body = DEFAULT_BODY) =>
  reserveOn(state.players.get(playerId), body);

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
