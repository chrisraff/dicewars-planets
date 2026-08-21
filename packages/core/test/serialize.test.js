import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reduce,
  attack,
  endTurn,
  setNeighbors,
  neighbors,
  serializeState,
  reviveState,
  seededRng,
} from '../src/index.js';
import { chainState, boardOf, withReserve, alwaysRolls } from './support/index.js';

const board = () =>
  chainState([
    ['a', { owner: 'p1', dice: 4 }],
    ['b', { owner: 'p2', dice: 1 }],
    ['c', { owner: 'p1', dice: 2 }],
    ['d', { owner: 'p2', dice: 8 }],
  ]);

// what actually crosses the wire: a save is JSON in a browser's storage, so a
// round trip that only works on live objects is no round trip at all
const throughJson = (state) => reviveState(JSON.parse(JSON.stringify(serializeState(state))));

test('a state survives a trip through JSON unchanged', () => {
  const state = withReserve(board(), 'p1', 5);
  assert.deepEqual(throughJson(state), state);
});

test('a revived state carries on being played rather than merely inspected', () => {
  const before = board();
  const { state: revived } = reduce(throughJson(before), attack('a', 'b'), {
    rollDie: alwaysRolls(6),
  });

  assert.deepEqual(boardOf(revived), { a: 'p1:1', b: 'p1:3', c: 'p1:2', d: 'p2:8' });
});

test('rewired adjacency is saved as it stands, not as the board was dealt', () => {
  // the moon mode this exists for: a save has to record who touches whom now,
  // which is not what any world description would rebuild
  const bridged = board();
  bridged.graph = setNeighbors(bridged.graph, 'a', ['b', 'd']);

  const revived = throughJson(bridged);
  assert.deepEqual([...neighbors(revived.graph, 'a')].sort(), ['b', 'd']);
  assert.ok(neighbors(revived.graph, 'd').has('a'), 'and the far end of the bridge too');
});

test('a territory nobody borders comes back still on the board', () => {
  const island = chainState([['a', { owner: 'p1', dice: 3 }]]);
  const revived = throughJson(island);

  assert.deepEqual([...revived.nodes.keys()], ['a']);
  assert.equal(neighbors(revived.graph, 'a').size, 0);
});

test('resuming from a save plays out exactly as not having saved would', () => {
  // reinforcement scatters over a player's territories, so which node is
  // reached first is part of the outcome — a round trip has to keep the order
  // and not merely the set of territories
  const played = (state) => reduce(state, endTurn(), { rng: seededRng(3) }).state;
  const state = board();

  assert.deepEqual(boardOf(played(throughJson(state))), boardOf(played(state)));

  // and that order is the one the state itself is in, not the graph's or the
  // alphabet's, so it stays right for a board dealt in any order at all
  assert.deepEqual(
    serializeState(state).nodes.map(([id]) => id),
    [...state.nodes.keys()]
  );
});

test('a finished game keeps its winner', () => {
  const won = { ...board(), phase: 'gameover', winner: 'p2' };
  const revived = throughJson(won);

  assert.equal(revived.phase, 'gameover');
  assert.equal(revived.winner, 'p2');
});

test('banked dice are part of the save, not something to be recomputed', () => {
  // nothing on the board says how many dice a player has waiting, so a save
  // that dropped them would quietly rob whoever had the most
  const revived = throughJson(withReserve(board(), 'p2', 11));
  assert.equal(revived.players.get('p2').reserve, 11);
});
