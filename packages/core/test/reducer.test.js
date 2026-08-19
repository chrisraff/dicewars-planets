import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState,
  reduce,
  isLegalAttack,
  attack,
  endTurn,
} from '../src/index.js';

function makeState() {
  return createInitialState({
    nodeIds: ['a', 'b', 'c', 'd'],
    edges: [['a', 'b'], ['b', 'c'], ['c', 'd']],
    playerIds: ['p1', 'p2'],
    assignments: [
      ['a', { owner: 'p1', dice: 3 }],
      ['b', { owner: 'p2', dice: 1 }],
      ['c', { owner: 'p1', dice: 2 }],
      ['d', { owner: 'p2', dice: 5 }],
    ],
  });
}

test('a winning attack transfers ownership and moves dice in', () => {
  const state = makeState();
  const rolls = [6, 6, 6, 1]; // attacker: 3 dice, defender: 1 die
  const rollDie = () => rolls.shift();
  const { state: next, events } = reduce(state, attack('a', 'b'), { rollDie });

  assert.equal(next.nodes.get('b').owner, 'p1');
  assert.equal(next.nodes.get('b').dice, 2); // attacker's dice minus the one left behind
  assert.equal(next.nodes.get('a').dice, 1);
  assert.equal(events[0].attackerWins, true);
});

test('a losing attack strips the attacker down to one die and leaves the defender alone', () => {
  const state = makeState();
  const rolls = [1, 1, 1, 6];
  const rollDie = () => rolls.shift();
  const { state: next } = reduce(state, attack('a', 'b'), { rollDie });

  assert.equal(next.nodes.get('a').dice, 1);
  assert.equal(next.nodes.get('b').owner, 'p2');
  assert.equal(next.nodes.get('b').dice, 1);
});

test('illegal attacks are rejected', () => {
  const state = makeState();
  assert.equal(isLegalAttack(state, 'a', 'c'), false); // not adjacent
  assert.equal(isLegalAttack(state, 'b', 'd'), false); // not the current player's turn
  assert.throws(() => reduce(state, attack('a', 'c'), {}));
});

test('ending a turn pays reinforcement dice onto the board and advances to the next player', () => {
  const state = makeState();
  const { state: next, events } = reduce(state, endTurn(), {});

  assert.equal(events[0].type, 'endTurn');
  assert.equal(events[0].earned, 1); // p1's largest connected group is a single territory
  assert.equal(next.nodes.get('a').dice, 4); // the earned die landed on an owned territory
  assert.equal(next.players.get('p1').reserve, 0);
  assert.equal(next.currentTurnIndex, 1);
});

test('the game ends once only one player still holds territory', () => {
  const state = makeState();
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
