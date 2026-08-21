import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduce, isLegalAttack, attack, endTurn } from '../src/index.js';
import { chainState, rollsOf, seededRng } from './support/index.js';

// p1 holds the ends of the chain, p2 the middle and the far end: a—b—c—d.
const board = () =>
  chainState([
    ['a', { owner: 'p1', dice: 3 }],
    ['b', { owner: 'p2', dice: 1 }],
    ['c', { owner: 'p1', dice: 2 }],
    ['d', { owner: 'p2', dice: 5 }],
  ]);

const overwhelming = () => rollsOf([6, 6, 6, 1]); // 3 attacking dice against 1
const hopeless = () => rollsOf([1, 1, 1, 6]);

test('a winning attack transfers ownership and moves dice in', () => {
  const { state: next, events } = reduce(board(), attack('a', 'b'), { rollDie: overwhelming() });

  assert.equal(next.nodes.get('b').owner, 'p1');
  assert.equal(next.nodes.get('b').dice, 2); // attacker's dice minus the one left behind
  assert.equal(next.nodes.get('a').dice, 1);
  assert.equal(events[0].attackerWins, true);
});

test('a losing attack strips the attacker down to one die and leaves the defender alone', () => {
  const { state: next } = reduce(board(), attack('a', 'b'), { rollDie: hopeless() });

  assert.equal(next.nodes.get('a').dice, 1);
  assert.equal(next.nodes.get('b').owner, 'p2');
  assert.equal(next.nodes.get('b').dice, 1);
});

test('illegal attacks are rejected', () => {
  const state = board();
  assert.equal(isLegalAttack(state, 'a', 'c'), false); // not adjacent
  assert.equal(isLegalAttack(state, 'b', 'd'), false); // not the current player's turn
  assert.throws(() => reduce(state, attack('a', 'c'), {}));
});

test('ending a turn pays reinforcement dice onto the board and advances to the next player', () => {
  const state = board();
  const { state: next, events } = reduce(state, endTurn(), { rng: seededRng(1) });

  assert.equal(events[0].type, 'endTurn');
  assert.equal(events[0].earned, 1, 'p1’s largest connected group is a single territory');

  // which territory the die lands on is chance; that it landed, and landed on
  // p1's own ground, is the rule
  const held = (s) => s.nodes.get('a').dice + s.nodes.get('c').dice;
  assert.equal(held(next), held(state) + 1, 'the earned die went onto the board');
  assert.equal(next.players.get('p1').reserve, 0, 'so nothing needed banking');
  assert.equal(next.currentTurnIndex, 1);
});

test('the game ends once only one player still holds territory', () => {
  const state = board();
  const eliminated = {
    ...state,
    nodes: new Map(state.nodes)
      .set('b', { owner: 'p1', dice: 1 })
      .set('d', { owner: 'p1', dice: 1 }),
  };
  const { state: next, events } = reduce(eliminated, endTurn(), {});

  assert.equal(next.phase, 'gameover');
  assert.equal(next.winner, 'p1');
  assert.ok(events.some((e) => e.type === 'gameOver'));
});

test('taking a player’s last territory reports them as eliminated', () => {
  const state = board();
  // p2 holds only 'b' — 'd' has been taken already
  const cornered = { ...state, nodes: new Map(state.nodes).set('d', { owner: 'p1', dice: 1 }) };
  const { events } = reduce(cornered, attack('a', 'b'), { rollDie: overwhelming() });

  const knockout = events.find((e) => e.type === 'eliminated');
  assert.ok(knockout, 'losing the last territory should be reported');
  assert.equal(knockout.playerId, 'p2');
  assert.equal(knockout.by, 'p1', 'and say who did it');
  assert.equal(events[0].type, 'attack', 'the attack itself still comes first');
});

test('a player who still holds ground elsewhere is not reported eliminated', () => {
  const { events } = reduce(board(), attack('a', 'b'), { rollDie: overwhelming() });
  assert.equal(events.some((e) => e.type === 'eliminated'), false);
});

test('a failed attack never eliminates anyone', () => {
  const state = board();
  const cornered = { ...state, nodes: new Map(state.nodes).set('d', { owner: 'p1', dice: 1 }) };
  const { events } = reduce(cornered, attack('a', 'b'), { rollDie: hopeless() });

  assert.equal(events.some((e) => e.type === 'eliminated'), false);
});
