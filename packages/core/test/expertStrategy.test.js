import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createExpertStrategy,
  expertMovesFor,
  isLegalAttack,
  runAiTurn,
  getCurrentPlayerId,
  winProbability,
} from '../src/index.js';
import { chainState, graphState, seededRng } from './support/index.js';
import { EXPERT_WEIGHTS } from '../src/ai/expertStrategy.js';

const choose = createExpertStrategy();

// The same AI with its second ply switched off — which is exactly what shipped
// before there was one. Every test below that is about the lookahead states
// what this picks instead, so each of them says what it is worth as well as
// what it does.
const flat = { ...EXPERT_WEIGHTS, follow: 0 };

test('only offers attacks the reducer would accept', () => {
  const state = chainState([
    ['a', { owner: 'p1', dice: 3 }],
    ['b', { owner: 'p2', dice: 1 }],
    ['c', { owner: 'p1', dice: 1 }],
    ['d', { owner: 'p2', dice: 2 }],
  ]);

  const moves = expertMovesFor(state, 'p1');
  for (const { from, to } of moves) assert.ok(isLegalAttack(state, from, to));
  assert.deepEqual(
    moves.map(({ from, to }) => ({ from, to })),
    [{ from: 'a', to: 'b' }],
    'c holds a single die, so it cannot attack'
  );
});

test('the moves come back best first, with what each was worth', () => {
  const state = chainState([
    ['a', { owner: 'p1', dice: 6 }],
    ['b', { owner: 'p2', dice: 1 }],
  ]);
  const [best] = expertMovesFor(state, 'p1');
  assert.ok(best.score > 0, 'a free capture is worth something');
  for (const move of expertMovesFor(state, 'p1')) assert.ok(Number.isFinite(move.score));
});

// --- what it is actually playing for ---------------------------------------

test('it takes the territory that joins two regions over a free one that does not', () => {
  // 'join' is the only thing standing between two regions of two, so taking
  // it turns an income of two a turn into five. 'spoils' is a certain capture
  // — eight dice against one — and is still the worse move.
  const state = graphState(
    [
      ['a1', { owner: 'p1', dice: 1 }],
      ['a2', { owner: 'p1', dice: 4 }],
      ['join', { owner: 'p2', dice: 1 }],
      ['b1', { owner: 'p1', dice: 1 }],
      ['b2', { owner: 'p1', dice: 1 }],
      ['far', { owner: 'p1', dice: 8 }],
      ['spoils', { owner: 'p2', dice: 1 }],
    ],
    [['a1', 'a2'], ['a2', 'join'], ['join', 'b1'], ['b1', 'b2'], ['far', 'spoils']]
  );

  assert.deepEqual(choose(state, 'p1'), { from: 'a2', to: 'join' });
});

test('it cuts an opponent in half rather than nibble at their edge', () => {
  // p2 holds a chain of six. 'waist' is the join in the middle of it and
  // 'tip' is the far end, and both are a four-against-one from a territory of
  // mine — so the only thing to choose between them is that taking the waist
  // leaves p2 earning three a turn instead of five.
  const state = graphState(
    [
      ['w1', { owner: 'p2', dice: 1 }],
      ['w2', { owner: 'p2', dice: 1 }],
      ['waist', { owner: 'p2', dice: 1 }],
      ['e1', { owner: 'p2', dice: 1 }],
      ['e2', { owner: 'p2', dice: 1 }],
      ['tip', { owner: 'p2', dice: 1 }],
      ['mine1', { owner: 'p1', dice: 4 }],
      ['mine2', { owner: 'p1', dice: 4 }],
    ],
    [
      ['w1', 'w2'], ['w2', 'waist'], ['waist', 'e1'], ['e1', 'e2'], ['e2', 'tip'],
      ['mine1', 'waist'], ['mine2', 'tip'],
    ]
  );

  assert.deepEqual(choose(state, 'p1'), { from: 'mine1', to: 'waist' });
});

test('it will take a fight it is likely to lose to knock a player out', () => {
  // Four against five is a 22% shot and not worth having — unless it is the
  // last territory its owner holds, because a player removed is a player who
  // never takes another turn. The two boards differ by one territory
  // somewhere else on the map, and that is the whole difference.
  const board = (spare) => graphState(
    [
      ['h', { owner: 'p1', dice: 1 }],
      ['me', { owner: 'p1', dice: 4 }],
      ['last', { owner: 'p3', dice: 5 }],
      ...(spare ? [['elsewhere', { owner: 'p3', dice: 1 }]] : []),
    ],
    [['h', 'me'], ['me', 'last'], ...(spare ? [['last', 'elsewhere']] : [])],
    { playerIds: ['p1', 'p2', 'p3'] }
  );

  assert.equal(choose(board(true), 'p1'), null, 'a 22% fight for one territory is not worth it');
  assert.deepEqual(
    choose(board(false), 'p1'),
    { from: 'me', to: 'last' },
    'the same 22% fight, when winning it ends a player, is'
  );
});

test('it does not throw a stack at a fight it cannot win', () => {
  const state = graphState(
    [
      ['m1', { owner: 'p1', dice: 1 }],
      ['m2', { owner: 'p1', dice: 2 }],
      ['wall', { owner: 'p2', dice: 8 }],
    ],
    [['m1', 'm2'], ['m2', 'wall']]
  );
  assert.equal(choose(state, 'p1'), null, 'two against eight is one throw in a thousand');

  const soft = graphState(
    [
      ['m1', { owner: 'p1', dice: 1 }],
      ['m2', { owner: 'p1', dice: 2 }],
      ['wall', { owner: 'p2', dice: 1 }],
    ],
    [['m1', 'm2'], ['m2', 'wall']]
  );
  assert.deepEqual(choose(soft, 'p1'), { from: 'm2', to: 'wall' }, 'the same board, winnable');
});

test('a stack that is going to be lost anyway is spent rather than left', () => {
  // Both boards offer the same fight — four dice against four, a 46% shot —
  // and differ only in what is standing behind the attacker. With six next
  // door the post is worth keeping and the fight is not worth taking. With
  // eight next door the post is gone whatever it does, so the 46% is free.
  const board = (behind) => graphState(
    [
      ['h1', { owner: 'p1', dice: 1 }],
      ['post', { owner: 'p1', dice: 4 }],
      ['target', { owner: 'p2', dice: 4 }],
      ['threat', { owner: 'p2', dice: behind }],
    ],
    [['h1', 'post'], ['post', 'target'], ['post', 'threat']]
  );

  assert.equal(choose(board(6), 'p1'), null, 'nothing is forcing the issue');
  assert.deepEqual(
    choose(board(8), 'p1'),
    { from: 'post', to: 'target' },
    'the post is lost where it stands, so the even fight is worth having'
  );
});

// --- as a turn -------------------------------------------------------------

test('a whole turn terminates and hands play on', () => {
  const state = chainState([
    ['a', { owner: 'p1', dice: 8 }],
    ['b', { owner: 'p2', dice: 1 }],
    ['c', { owner: 'p2', dice: 1 }],
    ['d', { owner: 'p2', dice: 8 }],
  ]);

  const rng = seededRng(23);
  const { state: next, events } = runAiTurn(state, choose, {
    rollDie: () => 1 + Math.floor(rng() * 6),
  });

  assert.ok(events.some((e) => e.type === 'attack'), 'it should have attacked something');
  assert.equal(events.at(-1).type, 'endTurn', 'the turn ends itself rather than running forever');
  assert.equal(getCurrentPlayerId(next), 'p2', 'and play passes on');
});

test('the same board always produces the same move', () => {
  const state = chainState([
    ['a', { owner: 'p1', dice: 5 }],
    ['b', { owner: 'p2', dice: 2 }],
    ['c', { owner: 'p1', dice: 5 }],
    ['d', { owner: 'p2', dice: 2 }],
  ]);
  assert.deepEqual(choose(state, 'p1'), choose(state, 'p1'));
});

test('the weights are what it believes, and turning them off shows it', () => {
  // The region-joining board again, with the far prize fattened to three dice
  // so it is the better move on every count except the one that matters.
  // Priced normally the join wins by a mile; with income priced at nothing the
  // order reverses, which is the claim that the income term is doing the work
  // rather than something else happening to agree with it.
  const state = graphState(
    [
      ['a1', { owner: 'p1', dice: 1 }],
      ['a2', { owner: 'p1', dice: 4 }],
      ['join', { owner: 'p2', dice: 1 }],
      ['b1', { owner: 'p1', dice: 1 }],
      ['b2', { owner: 'p1', dice: 1 }],
      ['far', { owner: 'p1', dice: 8 }],
      ['spoils', { owner: 'p2', dice: 3 }],
    ],
    [['a1', 'a2'], ['a2', 'join'], ['join', 'b1'], ['b1', 'b2'], ['far', 'spoils']]
  );

  assert.deepEqual(choose(state, 'p1'), { from: 'a2', to: 'join' });
  assert.deepEqual(
    createExpertStrategy({ income: 0 })(state, 'p1'),
    { from: 'far', to: 'spoils' }
  );
});


// --- ground that earns nothing ----------------------------------------------
//
// Reinforcement is paid on the largest connected region but *scattered over
// every territory owned*, so a capture that leaves an outpost still detached
// wins ground that pays nothing and then takes a share of every payout from
// then on. `sprawl` is what that share costs.

test('growing a detached outpost is charged the income it diverts', () => {
  // p1 holds a region of three and a lone outpost. `loot` is four dice of
  // material for a near-certain fight and does not touch the main region;
  // `edge` is one die and grows the ground the payout is counted on.
  const state = outpostBoard();
  const scored = (sprawl) => {
    const moves = expertMovesFor(state, 'p1', { ...EXPERT_WEIGHTS, follow: 0, sprawl });
    return Object.fromEntries(moves.map((m) => [`${m.from}->${m.to}`, m]));
  };
  const free = scored(0);
  const priced = scored(2);

  assert.equal(
    priced['m3->edge'].score,
    free['m3->edge'].score,
    'a capture that grows the largest region is not charged at all'
  );

  // three territories of income over the four held, and the fifth would take
  // its share too — paid only in the branch where the attack actually wins
  const diverted = free['post->loot'].chance * 2 * (3 / 5);
  assert.ok(
    Math.abs((free['post->loot'].score - priced['post->loot'].score) - diverted) < 1e-9,
    'the outpost pays exactly the payout it would soak up'
  );
});

test('a capture that reconnects the outpost is never charged for it', () => {
  // The trap this avoids: an AI that simply refused to attack out of a
  // detached region could be walled off from its own ground for good. Taking
  // `gap` joins the outpost back on, so `gained` is positive and the term does
  // not fire — the same attacker, one neighbour over from the one that is.
  const state = outpostBoard();
  const at = (sprawl) => expertMovesFor(state, 'p1', { ...EXPERT_WEIGHTS, follow: 0, sprawl })
    .find((m) => m.from === 'post' && m.to === 'gap').score;

  assert.equal(at(2), at(0));
  assert.deepEqual(
    createExpertStrategy({ follow: 0 })(state, 'p1'),
    { from: 'post', to: 'gap' },
    'and it is the move, because rejoining is worth the whole region'
  );
});

// m1-m2-m3 is p1's income; `post` is cut off from it by `gap`. The outpost can
// spend itself on `loot` and stay cut off, or on `gap` and come home.
function outpostBoard() {
  return graphState(
    [
      ['m1', { owner: 'p1', dice: 2 }],
      ['m2', { owner: 'p1', dice: 2 }],
      ['m3', { owner: 'p1', dice: 8 }],
      ['edge', { owner: 'p2', dice: 1 }],
      ['post', { owner: 'p1', dice: 8 }],
      ['loot', { owner: 'p2', dice: 4 }],
      ['gap', { owner: 'p2', dice: 4 }],
    ],
    [['m1', 'm2'], ['m2', 'm3'], ['m3', 'edge'], ['post', 'loot'], ['post', 'gap'], ['gap', 'm1']]
  );
}

// --- looking one move further -----------------------------------------------
//
// A turn is a run of attacks, so a capture is worth what it leads to as well
// as what it is. `follow` is the discount on the second half of that, and
// these are the two positions where one ply is not merely worse but blind.

test('it starts a bridge that is worth nothing at all until it is finished', () => {
  // Two regions of three, two enemy territories apart. Taking the first of
  // them joins nothing — the income only arrives with the second — so one ply
  // prices it as an ordinary small capture and takes the free ground on the
  // far side of the board instead. It is the shape income makes commonest and
  // the one a single ply can never see: the whole prize is in the second half.
  const bridge = () => graphState(
    [
      ['a1', { owner: 'p1', dice: 5 }],
      ['a2', { owner: 'p1', dice: 3 }],
      ['a3', { owner: 'p1', dice: 6 }],
      ['b1', { owner: 'p1', dice: 3 }],
      ['b2', { owner: 'p1', dice: 3 }],
      ['b3', { owner: 'p1', dice: 3 }],
      ['g1', { owner: 'p2', dice: 2 }],
      ['g2', { owner: 'p2', dice: 2 }],
      ['spoils', { owner: 'p2', dice: 2 }],
      ['spoils2', { owner: 'p2', dice: 2 }],
    ],
    [
      ['a1', 'a2'], ['a2', 'a3'], ['b1', 'b2'], ['b2', 'b3'],
      ['a1', 'g1'], ['g1', 'g2'], ['g2', 'b1'],
      ['a3', 'spoils'], ['spoils', 'spoils2'],
    ],
    { playerIds: ['p1', 'p2'] }
  );

  assert.deepEqual(choose(bridge(), 'p1'), { from: 'a1', to: 'g1' });
  assert.deepEqual(
    createExpertStrategy(flat)(bridge(), 'p1'), { from: 'a3', to: 'spoils' },
    'one ply takes the free ground and never starts the bridge at all'
  );
});

test('between two captures of the same size it takes the one it can go on from', () => {
  // `x` is a dead end and `y` is a doorway on to `z`. One ply sees only that
  // holding y leaves a rival next to it and takes the quiet one; the run of
  // attacks that y opens is worth more than the quiet is.
  const fork = () => graphState(
    [
      ['a', { owner: 'p1', dice: 4 }],
      ['home', { owner: 'p1', dice: 3 }],
      ['x', { owner: 'p2', dice: 2 }],
      ['y', { owner: 'p2', dice: 1 }],
      ['z', { owner: 'p2', dice: 1 }],
    ],
    [['a', 'x'], ['a', 'y'], ['y', 'z'], ['a', 'home']],
    { playerIds: ['p1', 'p2'] }
  );

  assert.deepEqual(choose(fork(), 'p1'), { from: 'a', to: 'y' });
  assert.deepEqual(
    createExpertStrategy(flat)(fork(), 'p1'), { from: 'a', to: 'x' },
    'one ply prefers the dead end, because nothing borders it afterwards'
  );
});

test('the lookahead is one move deep, not a tree', () => {
  // Every move on the board, counted: the follow-up scan re-enters
  // `expertMovesFor` at depth 1, and a second ply there would fan out again
  // into a search that grows with the board rather than with `breadth`.
  const state = chainState([
    ['a', { owner: 'p1', dice: 8 }],
    ['b', { owner: 'p2', dice: 1 }],
    ['c', { owner: 'p2', dice: 1 }],
    ['d', { owner: 'p2', dice: 1 }],
  ]);

  const deep = expertMovesFor(state, 'p1', EXPERT_WEIGHTS, 1);
  const shallow = expertMovesFor(state, 'p1', flat, 1);
  assert.deepEqual(
    deep.map((m) => [m.from, m.to, m.score]),
    shallow.map((m) => [m.from, m.to, m.score]),
    'a move already being looked at as a follow-up is priced one ply and stops there'
  );
});

test('every move comes back with the odds it was priced on', () => {
  // The lookahead weights what a capture opens up by the chance of getting
  // there, so the two have to travel together.
  const state = chainState([
    ['a', { owner: 'p1', dice: 4 }],
    ['b', { owner: 'p2', dice: 2 }],
  ]);
  const [best] = expertMovesFor(state, 'p1');
  assert.ok(best.chance > 0 && best.chance < 1, 'a real fight, priced as one');
  assert.equal(best.chance, winProbability(4, 2));
});

test('the budgets on the lookahead are budgets, not opinions', () => {
  // `decided` and `dominance` exist to keep the second ply off the frame, and
  // both are justified by the same claim: they only ever skip a look whose
  // answer was already settled. Here the join is worth so much more than
  // anything else on the board that no follow-up could reorder it, and the
  // position is a mopping-up besides — so both budgets fire, and neither
  // changes the move.
  const runaway = () => graphState(
    [
      ['a1', { owner: 'p1', dice: 8 }],
      ['a2', { owner: 'p1', dice: 4 }],
      ['a3', { owner: 'p1', dice: 4 }],
      ['a4', { owner: 'p1', dice: 4 }],
      ['a5', { owner: 'p1', dice: 4 }],
      ['b1', { owner: 'p1', dice: 4 }],
      ['b2', { owner: 'p1', dice: 4 }],
      ['b3', { owner: 'p1', dice: 4 }],
      ['join', { owner: 'p2', dice: 1 }],
      ['scrap', { owner: 'p2', dice: 3 }],
    ],
    [
      ['a1', 'a2'], ['a2', 'a3'], ['a3', 'a4'], ['a4', 'a5'],
      ['b1', 'b2'], ['b2', 'b3'],
      ['a1', 'join'], ['join', 'b1'],
      ['a5', 'scrap'],
    ],
    { playerIds: ['p1', 'p2'] }
  );

  const unbudgeted = { ...EXPERT_WEIGHTS, decided: Infinity, dominance: Infinity };
  assert.deepEqual(choose(runaway(), 'p1'), { from: 'a1', to: 'join' });
  assert.deepEqual(
    createExpertStrategy(unbudgeted)(runaway(), 'p1'), choose(runaway(), 'p1'),
    'looking at everything reaches the same move the budgeted search does'
  );
});
