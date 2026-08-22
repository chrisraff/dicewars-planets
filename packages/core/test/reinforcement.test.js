import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduce, endTurn, MAX_DICE_PER_NODE, MAX_RESERVE } from '../src/index.js';
import { chainState, seededRng, withReserve } from './support/index.js';

// Reinforcement is the rule with the most places to hide: it pays on the
// *largest connected region* rather than on territories held, it cannot push a
// territory past eight, and what will not fit is banked and paid out on some
// later turn instead of being thrown away.

const diceOn = (state, ids) => ids.reduce((sum, id) => sum + state.nodes.get(id).dice, 0);
const endP1Turn = (state, seed = 1) => reduce(state, endTurn(), { rng: seededRng(seed) });

test('a player earns one die per territory in their largest connected region', () => {
  // p1 holds a—b—c in one piece; three territories, so three dice
  const { events } = endP1Turn(
    chainState([
      ['a', { owner: 'p1', dice: 1 }],
      ['b', { owner: 'p1', dice: 1 }],
      ['c', { owner: 'p1', dice: 1 }],
      ['d', { owner: 'p2', dice: 1 }],
    ])
  );
  assert.equal(events[0].earned, 3);
});

test('a broken-up empire is paid on its biggest piece, not on everything it holds', () => {
  // p1 holds four territories, but the largest run of them is only two long
  const { events } = endP1Turn(
    chainState([
      ['a', { owner: 'p1', dice: 1 }],
      ['b', { owner: 'p1', dice: 1 }],
      ['c', { owner: 'p2', dice: 1 }],
      ['d', { owner: 'p1', dice: 1 }],
      ['e', { owner: 'p2', dice: 1 }],
      ['f', { owner: 'p1', dice: 1 }],
    ])
  );
  assert.equal(events[0].earned, 2, 'four territories held, but the biggest region is two');
});

test('every earned die lands on the board when there is room for it', () => {
  const state = chainState([
    ['a', { owner: 'p1', dice: 1 }],
    ['b', { owner: 'p1', dice: 1 }],
    ['c', { owner: 'p1', dice: 1 }],
    ['d', { owner: 'p2', dice: 1 }],
  ]);
  const { state: next, events } = endP1Turn(state);

  assert.equal(diceOn(next, ['a', 'b', 'c']), diceOn(state, ['a', 'b', 'c']) + events[0].earned);
  assert.equal(next.players.get('p1').reserve, 0, 'nothing left over to bank');
});

test('reinforcements never land on somebody else’s ground', () => {
  const state = chainState([
    ['a', { owner: 'p1', dice: 1 }],
    ['b', { owner: 'p1', dice: 1 }],
    ['c', { owner: 'p2', dice: 1 }],
    ['d', { owner: 'p2', dice: 1 }],
  ]);
  const { state: next } = endP1Turn(state);

  assert.equal(next.nodes.get('c').dice, 1, 'p2’s territories are untouched');
  assert.equal(next.nodes.get('d').dice, 1);
});

test('no territory is ever pushed past a full stack', () => {
  const state = chainState([
    ['a', { owner: 'p1', dice: 7 }],
    ['b', { owner: 'p1', dice: 8 }],
    ['c', { owner: 'p1', dice: 8 }],
    ['d', { owner: 'p2', dice: 1 }],
  ]);
  const { state: next, events } = endP1Turn(state);

  assert.equal(events[0].earned, 3);
  for (const id of ['a', 'b', 'c']) {
    assert.ok(next.nodes.get(id).dice <= MAX_DICE_PER_NODE, `${id} overflowed`);
  }
  assert.equal(next.nodes.get('a').dice, 8, 'the only territory with room takes the one die');
  assert.equal(next.players.get('p1').reserve, 2, 'the other two had nowhere to go');
});

test('with every territory full, the whole payout is banked rather than lost', () => {
  const state = chainState([
    ['a', { owner: 'p1', dice: 8 }],
    ['b', { owner: 'p1', dice: 8 }],
    ['c', { owner: 'p2', dice: 1 }],
  ]);
  const { state: next, events } = endP1Turn(state);

  assert.equal(events[0].earned, 2);
  assert.equal(diceOn(next, ['a', 'b']), 16, 'the board cannot take any more');
  assert.equal(next.players.get('p1').reserve, 2, 'so all of it banks');
});

test('banked dice pay out on a later turn, once there is room again', () => {
  // three dice banked from earlier turns, and a territory that has since lost
  // ground and can take two of them
  const state = withReserve(
    chainState([
      ['a', { owner: 'p1', dice: 6 }],
      ['b', { owner: 'p1', dice: 8 }],
      ['c', { owner: 'p2', dice: 1 }],
    ]),
    'p1',
    3
  );
  const { state: next, events } = endP1Turn(state);

  assert.equal(events[0].earned, 2, 'this turn’s earnings are reported on their own');
  // 3 banked + 2 earned = 5 to place; only 'a' has room, and only for two
  assert.equal(next.nodes.get('a').dice, 8);
  assert.equal(next.nodes.get('b').dice, 8);
  assert.equal(next.players.get('p1').reserve, 3, 'the rest stays banked for next time');
});

test('the bank does not grow past its cap', () => {
  const state = withReserve(
    chainState([
      ['a', { owner: 'p1', dice: 8 }],
      ['b', { owner: 'p1', dice: 8 }],
      ['c', { owner: 'p2', dice: 1 }],
    ]),
    'p1',
    MAX_RESERVE - 1
  );
  const { state: next } = endP1Turn(state);
  assert.equal(next.players.get('p1').reserve, MAX_RESERVE, 'two earned, but only one fits');

  const { state: after } = endP1Turn(withReserve(state, 'p1', MAX_RESERVE));
  assert.equal(after.players.get('p1').reserve, MAX_RESERVE, 'and it stays there');
});

test('a banked die is worth exactly one die when it finally lands', () => {
  const state = withReserve(
    chainState([
      ['a', { owner: 'p1', dice: 1 }],
      ['b', { owner: 'p1', dice: 1 }],
      ['c', { owner: 'p2', dice: 1 }],
    ]),
    'p1',
    4
  );
  const { state: next } = endP1Turn(state);

  // 4 banked + 2 earned = 6 dice, and 14 spare slots, so all six land
  assert.equal(diceOn(next, ['a', 'b']), 2 + 6);
  assert.equal(next.players.get('p1').reserve, 0);
});

test('dice do not land in the same places every time', () => {
  // The reason this matters: reinforcement used to walk the territories in
  // board order, so the same few always filled up first and the rest of the
  // empire stayed thin for the whole game.
  const board = () =>
    chainState([
      ['a', { owner: 'p1', dice: 1 }],
      ['b', { owner: 'p1', dice: 1 }],
      ['c', { owner: 'p1', dice: 1 }],
      ['d', { owner: 'p1', dice: 1 }],
      ['e', { owner: 'p2', dice: 1 }],
    ]);

  const layouts = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const { state, events } = endP1Turn(board(), seed);
    const shape = ['a', 'b', 'c', 'd'].map((id) => state.nodes.get(id).dice);

    assert.equal(
      shape.reduce((a, b) => a + b) - 4,
      events[0].earned,
      'however they scatter, exactly what was earned goes down'
    );
    layouts.add(shape.join(''));
  }

  assert.ok(layouts.size > 1, `every seed produced the same board: ${[...layouts]}`);
});

test('landed records exactly where each die went, one entry per die', () => {
  const state = chainState([
    ['a', { owner: 'p1', dice: 1 }],
    ['b', { owner: 'p1', dice: 1 }],
    ['c', { owner: 'p1', dice: 1 }],
    ['d', { owner: 'p2', dice: 1 }],
  ]);
  const { state: next, events } = endP1Turn(state);

  assert.equal(events[0].landed.length, events[0].earned, 'one entry per die actually placed');
  for (const id of events[0].landed) assert.equal(next.nodes.get(id).owner, 'p1');

  const gains = {};
  for (const id of events[0].landed) gains[id] = (gains[id] ?? 0) + 1;
  for (const [id, count] of Object.entries(gains)) {
    assert.equal(
      next.nodes.get(id).dice,
      state.nodes.get(id).dice + count,
      `${id} gained exactly what landed on it`
    );
  }
});

test('landed only names territories that actually had room, and stops when the bank does', () => {
  const state = chainState([
    ['a', { owner: 'p1', dice: 7 }],
    ['b', { owner: 'p1', dice: 8 }],
    ['c', { owner: 'p1', dice: 8 }],
    ['d', { owner: 'p2', dice: 1 }],
  ]);
  const { events } = endP1Turn(state);
  assert.deepEqual(events[0].landed, ['a'], 'only the one territory with room, once');
});

test('a player with no territory left earns nothing and banks nothing', () => {
  const state = chainState([
    ['a', { owner: 'p2', dice: 1 }],
    ['b', { owner: 'p2', dice: 1 }],
  ]);
  // p1 has been wiped out, but it is still nominally their turn
  const { state: next, events } = endP1Turn(state);

  assert.equal(events[0].earned, 0);
  assert.equal(next.players.get('p1').reserve, 0);
});
