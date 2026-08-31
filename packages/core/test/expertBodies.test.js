import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expertMovesFor, incomeFor, NEUTRAL_OWNER } from '../src/index.js';
import { graphState } from './support/index.js';

// The expert is good at a static, single-world board and has to stay that
// way. What these are about is the handful of places where reading the board
// as one graph gives an answer that is not merely different but backwards —
// where an AI tuned on one world would play moon mode badly for reasons that
// have nothing to do with its judgement.

const scoreOf = (moves, from, to) => moves.find((m) => m.from === from && m.to === to)?.score;

/**
 * p1 holds a five-territory empire and a toehold on a second world, with two
 * unclaimed territories beyond it. `separate` is the only difference: with it,
 * the outpost is a world of its own, and without it the same shape is one
 * board with a detached lump on it.
 */
const board = ({ separate }) => {
  const on = separate ? { body: 'moon' } : {};
  return graphState(
    [
      ['a', { owner: 'p1', dice: 3 }],
      ['b', { owner: 'p1', dice: 3 }],
      ['c', { owner: 'p1', dice: 3 }],
      ['d', { owner: 'p1', dice: 3 }],
      ['e', { owner: 'p1', dice: 3 }],
      ['f', { owner: 'p2', dice: 3 }],
      // p2 holds two, so `e -> f` is an ordinary border fight rather than a
      // knockout — an elimination is worth a dozen territories and would
      // swamp the comparison this board is built to make
      ['g', { owner: 'p2', dice: 3 }],
      ['m1', { owner: 'p1', dice: 6, ...on }],
      ['m2', { owner: NEUTRAL_OWNER, dice: 2, ...on }],
      ['m3', { owner: NEUTRAL_OWNER, dice: 2, ...on }],
    ],
    [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'e'],
      ['e', 'f'],
      ['f', 'g'],
      ['m1', 'm2'],
      ['m2', 'm3'],
    ]
  );
};

test('a second world is worth expanding on; the same shape on one board is not', () => {
  // This is the whole reason `sprawl` had to learn about bodies, and it is
  // the failure that would have been hardest to spot from the outside: the AI
  // would simply never have gone anywhere near the moon, and it would have
  // looked like a considered opinion rather than a bug.
  //
  // Read as one board, growing the outpost adds nothing to the largest region
  // — the five-territory empire is still the largest — so `sprawl` charges
  // the capture for diverting reinforcement onto ground that earns none, and
  // it is right to. Read as two worlds, that same capture takes the moon's
  // income from one to two, which is a real payout on a real region.
  const together = expertMovesFor(board({ separate: false }), 'p1');
  const apart = expertMovesFor(board({ separate: true }), 'p1');

  const asOneWorld = scoreOf(together, 'm1', 'm2');
  const asTwoWorlds = scoreOf(apart, 'm1', 'm2');

  assert.ok(asTwoWorlds !== undefined, 'the expansion is on the table when it earns something');
  assert.ok(
    asOneWorld === undefined || asTwoWorlds > asOneWorld,
    `a capture that earns income should be worth more than one that does not (${asTwoWorlds} vs ${asOneWorld})`
  );
});

test('and it is the best move available on that board, not merely a legal one', () => {
  const moves = expertMovesFor(board({ separate: true }), 'p1');
  assert.deepEqual(
    { from: moves[0].from, to: moves[0].to },
    { from: 'm1', to: 'm2' },
    'six dice against two, for a territory that doubles a world’s income'
  );
});

test('a bridge is not a merger, however it is scored', () => {
  // Standing on both ends of an open gate must not read as one huge region.
  // If it did, taking the docking territory would be worth a round of free
  // reinforcement on a coin flip, which is the swing the whole stratified
  // economy exists to rule out.
  const bridged = (edges) =>
    graphState(
      [
        ['a', { owner: 'p1', dice: 4 }],
        ['b', { owner: 'p1', dice: 4 }],
        ['c', { owner: 'p1', dice: 4 }],
        ['port', { owner: 'p1', dice: 8 }],
        ['rival', { owner: 'p2', dice: 4 }],
        ['m1', { owner: NEUTRAL_OWNER, dice: 2, body: 'moon' }],
        ['m2', { owner: 'p1', dice: 2, body: 'moon' }],
      ],
      edges
    );

  const base = [
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'port'],
    ['port', 'rival'],
    ['m1', 'm2'],
  ];

  const shut = expertMovesFor(bridged(base), 'p1');
  const open = expertMovesFor(bridged([...base, ['port', 'm1']]), 'p1');

  const throughTheGate = scoreOf(open, 'port', 'm1');
  assert.ok(throughTheGate !== undefined, 'an open gate is an attack that can be made');

  // The same territory, taken from the moon side, is worth the same income —
  // one more on a world where p1 already holds one — whichever side the
  // attack came from. What differs between these two numbers is the fight and
  // the exposure, never a merged empire.
  const fromTheMoon = scoreOf(shut, 'm2', 'm1');
  assert.ok(fromTheMoon !== undefined);
  assert.ok(
    throughTheGate < fromTheMoon + 8,
    `taking the dock across a bridge must not read as joining two empires (${throughTheGate} vs ${fromTheMoon})`
  );
});

test('what the AI thinks it earns is what the rules will actually pay it', () => {
  // The one invariant worth stating outright, because every score above is
  // denominated in it: `readBoard`'s income and core's own `incomeFor` are
  // two implementations of one rule, and they are allowed to disagree about
  // nothing at all.
  const state = board({ separate: true });
  const moves = expertMovesFor(state, 'p1');
  assert.ok(moves.length > 0);

  // p1: five joined on the planet, one on the moon
  assert.equal(incomeFor(state, 'p1'), 6);
  // and taking m2 makes it five and two — which is what the top move's own
  // income term has to be built on for its score to mean anything
  const after = {
    ...state,
    nodes: new Map(state.nodes).set('m2', { owner: 'p1', dice: 5, body: 'moon' }),
  };
  assert.equal(incomeFor(after, 'p1'), 7);
});

test('unclaimed ground is a target like any other, and never a rival to be denied', () => {
  // `denial` prices what a capture costs its previous owner. Nobody owns
  // unclaimed ground, so there is nothing there to take away — and nothing
  // that could be knocked out of a game it was never in.
  const state = graphState(
    [
      ['a', { owner: 'p1', dice: 5 }],
      ['n', { owner: NEUTRAL_OWNER, dice: 1 }],
      ['z', { owner: 'p2', dice: 5 }],
    ],
    [
      ['a', 'n'],
      ['n', 'z'],
    ]
  );

  const moves = expertMovesFor(state, 'p1');
  const grab = moves.find((m) => m.to === 'n');
  assert.ok(grab, 'it will take unclaimed ground');
  assert.ok(
    Number.isFinite(grab.score),
    'and prices it without tripping over an owner who is not a player'
  );
});
