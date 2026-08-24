import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefensiveStrategy,
  defensiveMovesFor,
  isLegalAttack,
  runAiTurn,
  getCurrentPlayerId,
} from '../src/index.js';
import { chainState, graphState, withReserve, seededRng } from './support/index.js';

const choose = createDefensiveStrategy();

// p1 owns a chain long enough to count as "something to defend" — the border
// rule only applies above `minRegionToHoldBorder`, so a test that isn't about
// that rule wants a board small enough for it to be switched off, and one
// that is about it wants this.
const homeland = (dice) => [
  ['h1', { owner: 'p1', dice: 1 }],
  ['h2', { owner: 'p1', dice: 1 }],
  ['h3', { owner: 'p1', dice: 1 }],
  ['h4', { owner: 'p1', dice: 1 }],
  ['post', { owner: 'p1', dice }],
];
const homelandEdges = [['h1', 'h2'], ['h2', 'h3'], ['h3', 'h4'], ['h4', 'post']];

test('only offers attacks the reducer would accept', () => {
  const state = chainState([
    ['a', { owner: 'p1', dice: 3 }],
    ['b', { owner: 'p2', dice: 1 }],
    ['c', { owner: 'p1', dice: 1 }],
    ['d', { owner: 'p2', dice: 2 }],
  ]);

  const moves = defensiveMovesFor(state, 'p1');
  for (const { from, to } of moves) assert.ok(isLegalAttack(state, from, to));
  assert.deepEqual(moves, [{ from: 'a', to: 'b' }], 'c holds a single die, so it cannot attack');
});

test('declines an even fight, since the attacker loses ties', () => {
  const state = chainState([
    ['a', { owner: 'p1', dice: 3 }],
    ['b', { owner: 'p2', dice: 3 }],
  ]);
  assert.equal(choose(state, 'p1'), null);
});

test('a full stack takes an even fight, having nowhere left to grow', () => {
  const state = chainState([
    ['a', { owner: 'p1', dice: 8 }],
    ['b', { owner: 'p2', dice: 8 }],
  ]);
  assert.deepEqual(choose(state, 'p1'), { from: 'a', to: 'b' });
});

// --- what makes it defensive: it wants to keep what it takes ----------------

test('refuses a fight it would win and then immediately lose back', () => {
  // 'a' beats 'x' comfortably and would garrison it with three dice, with a
  // five-die stack sitting right next to it — ground taken on loan
  const board = (guard) => graphState(
    [
      ['a', { owner: 'p1', dice: 4 }],
      ['x', { owner: 'p2', dice: 2 }],
      ['guard', { owner: 'p2', dice: guard }],
    ],
    [['a', 'x'], ['x', 'guard']]
  );

  assert.equal(choose(board(5), 'p1'), null, 'a stronger neighbour waves it off');
  assert.deepEqual(
    choose(board(4), 'p1'),
    { from: 'a', to: 'x' },
    'and one it can match does not — the bar is the attacker, not its garrison, '
      + 'which is the leniency that keeps this AI playing at all'
  );
});

test('a counter-attack can come from any rival, not just the prize’s own colour', () => {
  // the fix worth having: 'guard' belongs to p3, so it is no ally of p2's, but
  // it is still the thing that takes 'x' straight back
  const state = graphState(
    [
      ['a', { owner: 'p1', dice: 4 }],
      ['x', { owner: 'p2', dice: 2 }],
      ['guard', { owner: 'p3', dice: 6 }],
    ],
    [['a', 'x'], ['x', 'guard']],
    { playerIds: ['p1', 'p2', 'p3'] }
  );
  assert.equal(choose(state, 'p1'), null);
});

test('a strong rival elsewhere on the board is no reason to hold back', () => {
  // the counter-attack test is about what touches the prize, nothing wider
  const state = graphState(
    [
      ['a', { owner: 'p1', dice: 4 }],
      ['x', { owner: 'p2', dice: 2 }],
      ['far', { owner: 'p2', dice: 8 }],
    ],
    [['a', 'x'], ['far', 'a']]
  );
  assert.deepEqual(choose(state, 'p1'), { from: 'a', to: 'x' });
});

// --- and it leaves a territory that is holding a line where it is -----------

// 'post' guards the homeland against two rivals at once. Attacking either one
// empties it to a single die and lets the other one in.
const borderPost = () => graphState(
  [
    ...homeland(5),
    ['x', { owner: 'p2', dice: 3 }],
    ['behind', { owner: 'p2', dice: 4 }],
  ],
  [...homelandEdges, ['post', 'x'], ['post', 'behind']]
);

test('a border post with a second rival at its back stays put', () => {
  assert.equal(choose(borderPost(), 'p1'), null);
});

test('banked dice release it: there is something to backfill with', () => {
  // and once it is released it goes for 'behind', the fatter of the two — by
  // the time a fight is on offer at all it is one the attacker is favoured in,
  // so the bigger prize is the better one
  assert.deepEqual(
    choose(withReserve(borderPost(), 'p1', 1), 'p1'),
    { from: 'post', to: 'behind' }
  );
});

test('so does being small enough that there is nothing worth defending yet', () => {
  // the same standoff with a two-territory homeland instead of five
  const state = graphState(
    [
      ['h1', { owner: 'p1', dice: 1 }],
      ['post', { owner: 'p1', dice: 5 }],
      ['x', { owner: 'p2', dice: 3 }],
      ['behind', { owner: 'p2', dice: 4 }],
    ],
    [['h1', 'post'], ['post', 'x'], ['post', 'behind']]
  );
  assert.deepEqual(choose(state, 'p1'), { from: 'post', to: 'behind' });
});

test('one rival behind is not two: a lone threat is what a post is for', () => {
  // only the *second* strongest rival counts, because the strongest is the one
  // being attacked — take it and the post has nothing left to guard against
  const state = graphState(
    [
      ...homeland(5),
      ['x', { owner: 'p2', dice: 3 }],
      ['weak', { owner: 'p2', dice: 2 }],
    ],
    [...homelandEdges, ['post', 'x'], ['post', 'weak']]
  );
  assert.deepEqual(choose(state, 'p1'), { from: 'post', to: 'x' });
});

// --- which of several acceptable attacks it picks ---------------------------

// Two attackers of four dice, each with a one-die target. 'seal' has no other
// rival, so taking its target leaves it interior; 'open' has a second rival it
// would still be facing afterwards.
const bothOnOffer = () => graphState(
  [
    ['open', { owner: 'p1', dice: 4 }],
    ['tOpen', { owner: 'p2', dice: 1 }],
    ['other', { owner: 'p2', dice: 2 }],
    ['seal', { owner: 'p1', dice: 4 }],
    ['tSeal', { owner: 'p2', dice: 1 }],
  ],
  [['open', 'tOpen'], ['open', 'other'], ['seal', 'tSeal']]
);

test('prefers the attack that leaves its attacker with nothing left to face', () => {
  assert.deepEqual(choose(bothOnOffer(), 'p1'), { from: 'seal', to: 'tSeal' });
});

test('the pick does not depend on the order the board is scanned', () => {
  // the whole reason the choice is a ranking rather than a running favourite:
  // the original settled on whichever candidate it happened to look at last
  const reversed = graphState(
    [
      ['seal', { owner: 'p1', dice: 4 }],
      ['tSeal', { owner: 'p2', dice: 1 }],
      ['other', { owner: 'p2', dice: 2 }],
      ['tOpen', { owner: 'p2', dice: 1 }],
      ['open', { owner: 'p1', dice: 4 }],
    ],
    [['seal', 'tSeal'], ['open', 'other'], ['open', 'tOpen']]
  );
  assert.deepEqual(choose(reversed, 'p1'), { from: 'seal', to: 'tSeal' });
  assert.deepEqual(choose(bothOnOffer(), 'p1'), choose(reversed, 'p1'));
});

test('between two equal starts, the bigger stack goes first', () => {
  const state = graphState(
    [
      ['small', { owner: 'p1', dice: 3 }],
      ['tSmall', { owner: 'p2', dice: 1 }],
      ['big', { owner: 'p1', dice: 6 }],
      ['tBig', { owner: 'p2', dice: 1 }],
    ],
    [['small', 'tSmall'], ['big', 'tBig']]
  );
  assert.deepEqual(choose(state, 'p1'), { from: 'big', to: 'tBig' });
});

test('every acceptable attack is offered, best first', () => {
  const moves = defensiveMovesFor(bothOnOffer(), 'p1');
  assert.deepEqual(moves[0], { from: 'seal', to: 'tSeal' });
  assert.equal(moves.length, 3, 'the two attacks out of `open` are still on the list');
});

// --- as a turn -------------------------------------------------------------

test('a whole turn terminates and hands play on', () => {
  // it cannot run forever: an attack leaves its attacker on a single die
  // either way, so every move retires the territory that made it
  const state = chainState([
    ['a', { owner: 'p1', dice: 8 }],
    ['b', { owner: 'p2', dice: 1 }],
    ['c', { owner: 'p2', dice: 1 }],
    ['d', { owner: 'p2', dice: 8 }],
  ]);

  const rng = seededRng(11);
  const { state: next, events } = runAiTurn(state, choose, {
    rollDie: () => 1 + Math.floor(rng() * 6),
  });

  assert.ok(events.some((e) => e.type === 'attack'), 'it should have attacked something');
  assert.equal(events.at(-1).type, 'endTurn', 'the turn ends itself rather than running forever');
  assert.equal(getCurrentPlayerId(next), 'p2', 'and play passes on');
});

test('the same board always produces the same move', () => {
  // nothing needs this, but a strategy that never flips a coin is one a
  // reported game can be replayed from
  const state = bothOnOffer();
  assert.deepEqual(choose(state, 'p1'), choose(state, 'p1'));
});
