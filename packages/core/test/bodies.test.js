import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attack,
  bodiesOf,
  endTurn,
  getCurrentPlayerId,
  incomeFor,
  isPlayerAlive,
  largestConnectedRegionSize,
  reduce,
  reserveOn,
  reviveState,
  serializeState,
  surrenderedPlayerIds,
  NEUTRAL_OWNER,
} from '../src/index.js';
import { graphState, seededRng, boardOf } from './support/index.js';

// A world with a moon in it is two economies rather than one board in two
// pieces. Everything here is about that split holding — and about a board
// with no moon on it behaving exactly as it always did, which is the promise
// the whole feature is built behind.

const endTurnFor = (state, seed = 1) => reduce(state, endTurn(), { rng: seededRng(seed) });
const diceOn = (state, ids) => ids.reduce((sum, id) => sum + state.nodes.get(id).dice, 0);

/**
 * p1 holds three planet territories in one piece, a fourth on its own, and
 * two on the moon. The lone planet territory is what the bridge lands on when
 * there is one, so the two readings of income disagree: measured across one
 * merged graph the best p1 can show is three, and measured per body it is
 * three *and* two.
 */
const splitEmpire = ({ bridged }) =>
  graphState(
    [
      ['a', { owner: 'p1', dice: 2 }],
      ['b', { owner: 'p1', dice: 2 }],
      ['c', { owner: 'p1', dice: 2 }],
      ['d', { owner: 'p2', dice: 2 }],
      ['e', { owner: 'p1', dice: 2 }],
      ['m1', { owner: 'p1', dice: 2, body: 'moon' }],
      ['m2', { owner: 'p1', dice: 2, body: 'moon' }],
      ['m3', { owner: 'p2', dice: 2, body: 'moon' }],
    ],
    [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'e'],
      ['m1', 'm2'],
      ['m2', 'm3'],
      ...(bridged ? [['e', 'm1']] : []),
    ]
  );

test('income is what each body pays, added up — not the best region on the board', () => {
  const state = splitEmpire({ bridged: false });

  assert.equal(largestConnectedRegionSize(state, 'p1'), 3, 'read as one graph it is three');
  assert.equal(incomeFor(state, 'p1'), 5, 'three on the planet and two on the moon, both paid');
});

test('a bridge carries armies, never income', () => {
  // The same board with and without the one edge joining the two worlds. If
  // the bridge merged the economies, standing on it would be worth a round of
  // free reinforcement — a huge swing riding on one coin-flip attack, and the
  // thing stratified income exists to rule out.
  assert.equal(
    incomeFor(splitEmpire({ bridged: true }), 'p1'),
    incomeFor(splitEmpire({ bridged: false }), 'p1')
  );
});

test('dice earned on a body land on that body and nowhere else', () => {
  const state = graphState(
    [
      ['a', { owner: 'p1', dice: 1 }],
      ['b', { owner: 'p1', dice: 1 }],
      ['c', { owner: 'p2', dice: 1 }],
      ['m1', { owner: 'p1', dice: 1, body: 'moon' }],
      ['m2', { owner: 'p2', dice: 1, body: 'moon' }],
    ],
    [
      ['a', 'b'],
      ['b', 'c'],
      ['m1', 'm2'],
      ['b', 'm1'], // bridged, so the only thing keeping the dice apart is the rule
    ]
  );

  const { state: next, events } = endTurnFor(state);

  assert.equal(events[0].earned, 3, 'two on the planet, one on the moon');
  assert.equal(diceOn(next, ['a', 'b']), diceOn(state, ['a', 'b']) + 2);
  assert.equal(diceOn(next, ['m1']), diceOn(state, ['m1']) + 1, 'the moon keeps what it earned');
});

test('a payout with nowhere to land banks on the body that earned it', () => {
  // The moon is full, so its die has nowhere to go. Banking it anywhere but
  // the moon would let it spill onto the planet on some later turn and go
  // round the separation entirely.
  const state = graphState(
    [
      ['a', { owner: 'p1', dice: 1 }],
      ['b', { owner: 'p2', dice: 1 }],
      ['m1', { owner: 'p1', dice: 8, body: 'moon' }],
      ['m2', { owner: 'p2', dice: 1, body: 'moon' }],
    ],
    [
      ['a', 'b'],
      ['m1', 'm2'],
    ]
  );

  const { state: next } = endTurnFor(state);
  const p1 = next.players.get('p1');

  assert.equal(reserveOn(p1, 'moon'), 1, 'the moon banks its own die');
  assert.equal(reserveOn(p1), 0, 'and the planet, which had room, banks nothing');
  assert.equal(next.nodes.get('a').dice, 2, 'the planet paid its own single die out');
});

test('a bank on one body never spills onto the other', () => {
  const state = graphState(
    [
      ['a', { owner: 'p1', dice: 1 }],
      ['b', { owner: 'p2', dice: 1 }],
      ['m1', { owner: 'p1', dice: 8, body: 'moon' }],
      ['m2', { owner: 'p2', dice: 1, body: 'moon' }],
    ],
    [
      ['a', 'b'],
      ['m1', 'm2'],
    ]
  );

  // three of p1's turns, with the moon full throughout and the planet always
  // with room: the moon's earnings must pile up unpaid rather than find the
  // planet's empty ground
  let next = state;
  for (let i = 0; i < 3; i++) {
    next = endTurnFor(next).state; // p1
    next = endTurnFor(next).state; // p2, so the turn comes back round
  }

  assert.equal(reserveOn(next.players.get('p1'), 'moon'), 3);
  assert.equal(next.nodes.get('a').dice, 4, 'the planet paid one a turn, and only its own');
});

// --- unclaimed ground --------------------------------------------------------

const withNeutral = () =>
  graphState(
    [
      ['a', { owner: 'p1', dice: 4 }],
      ['n', { owner: NEUTRAL_OWNER, dice: 1, body: 'moon' }],
      ['c', { owner: 'p2', dice: 2 }],
    ],
    [
      ['a', 'n'],
      ['n', 'c'],
    ]
  );

test('unclaimed ground can be attacked, and taking the last of it is not a knockout', () => {
  const state = withNeutral();
  const { state: next, events } = reduce(state, attack('a', 'n'), {
    rollDie: () => 6, // the attacker cannot lose
  });

  assert.equal(next.nodes.get('n').owner, 'p1', 'unclaimed ground changes hands like any other');
  assert.equal(
    events.some((e) => e.type === 'eliminated'),
    false,
    'nobody was playing it, so there is no rival to announce'
  );
  assert.equal(
    events.some((e) => e.type === 'gameOver'),
    false,
    'and the match is certainly not decided by it'
  );
  assert.equal(next.phase, 'attack');
});

test('a captured territory stays on the world it was captured on', () => {
  // Found by counting territories in a real match rather than by reading the
  // code: `resolveAttack` used to build the prize from scratch, so the moment
  // anybody took moon ground it became planet ground, and the two economies
  // leaked into each other from the first capture onwards.
  const state = withNeutral();
  const { state: next } = reduce(state, attack('a', 'n'), { rollDie: () => 6 });

  assert.equal(next.nodes.get('n').body, 'moon');
  assert.equal(incomeFor(next, 'p1'), 2, 'one territory on each world, paid separately');
});

test('unclaimed ground never takes a turn', () => {
  const { state: next } = endTurnFor(withNeutral());
  assert.equal(getCurrentPlayerId(next), 'p2', 'the turn passes between players only');
});

test('unclaimed ground earns nothing, however much of it there is', () => {
  const state = withNeutral();
  assert.equal(incomeFor(state, NEUTRAL_OWNER), 1, 'the region is there to be measured…');
  assert.equal(state.players.has(NEUTRAL_OWNER), false, '…but nothing ever asks, since it is not a player');

  const { state: next } = endTurnFor(state);
  assert.equal(next.nodes.get('n').dice, 1, 'so its dice sit exactly where they were dealt');
});

test('a player is alive on moon ground alone', () => {
  // Deliberate: the moon is somewhere to flee to, which is most of what makes
  // it worth a losing player's dice.
  const state = graphState(
    [
      ['a', { owner: 'p2', dice: 2 }],
      ['m1', { owner: 'p1', dice: 2, body: 'moon' }],
    ],
    [['a', 'm1']]
  );
  assert.equal(isPlayerAlive(state, 'p1'), true);
  assert.equal(state.phase, 'attack', 'and the match is still running');
});

test('surrender judges a split empire on what it will be paid', () => {
  // p1 is behind on the planet but holds most of the moon. Read as one graph
  // its best region is one territory, which looks finished; read as income it
  // is three, which is not.
  const state = graphState(
    [
      ['a', { owner: 'p2', dice: 6 }],
      ['b', { owner: 'p2', dice: 6 }],
      ['c', { owner: 'p2', dice: 6 }],
      ['d', { owner: 'p2', dice: 6 }],
      ['e', { owner: 'p1', dice: 3 }],
      ['m1', { owner: 'p1', dice: 3, body: 'moon' }],
      ['m2', { owner: 'p1', dice: 3, body: 'moon' }],
      ['m3', { owner: 'p1', dice: 3, body: 'moon' }],
    ],
    [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'e'],
      ['m1', 'm2'],
      ['m2', 'm3'],
    ]
  );

  assert.equal(largestConnectedRegionSize(state, 'p1'), 3, 'the moon holding is the biggest piece');
  assert.equal(incomeFor(state, 'p1'), 4);
  assert.equal(surrenderedPlayerIds(state).has('p1'), false);
});

// --- and none of it touches a board without a moon ---------------------------

test('a single-world board reports one body and pays exactly as it always did', () => {
  const state = graphState(
    [
      ['a', { owner: 'p1', dice: 1 }],
      ['b', { owner: 'p1', dice: 1 }],
      ['c', { owner: 'p2', dice: 1 }],
    ],
    [
      ['a', 'b'],
      ['b', 'c'],
    ]
  );

  assert.deepEqual(bodiesOf(state), ['planet']);
  assert.equal(incomeFor(state, 'p1'), largestConnectedRegionSize(state, 'p1'));
  assert.equal(
    Object.hasOwn(state.nodes.get('a'), 'body'),
    false,
    'a board with no moon carries no trace of the concept'
  );
  assert.equal(
    Object.hasOwn(serializeState(state).nodes[0][1], 'body'),
    false,
    'nor does its save'
  );
});

test('naming the default body explicitly changes nothing at all', () => {
  // The equivalence the whole compatibility argument rests on: `body` absent
  // and `body: 'planet'` are the same board, down to which territory each
  // reinforcement die picked out of the generator.
  const assignments = (body) => [
    ['a', { owner: 'p1', dice: 1, ...(body && { body }) }],
    ['b', { owner: 'p1', dice: 1, ...(body && { body }) }],
    ['c', { owner: 'p1', dice: 2, ...(body && { body }) }],
    ['d', { owner: 'p2', dice: 1, ...(body && { body }) }],
  ];
  const edges = [
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'd'],
  ];

  const bare = endTurnFor(graphState(assignments(null), edges), 7);
  const named = endTurnFor(graphState(assignments('planet'), edges), 7);

  assert.deepEqual(boardOf(named.state), boardOf(bare.state));
  assert.deepEqual(named.events[0].landed, bare.events[0].landed);
  assert.equal(named.events[0].earned, bare.events[0].earned);
});

test('a body travels through a save', () => {
  const state = splitEmpire({ bridged: true });
  const restored = reviveState(serializeState(state));

  assert.equal(restored.nodes.get('m1').body, 'moon');
  assert.equal(incomeFor(restored, 'p1'), incomeFor(state, 'p1'));
  assert.deepEqual(bodiesOf(restored), ['planet', 'moon']);
});

test('a per-body bank travels through a save', () => {
  const state = graphState(
    [
      ['a', { owner: 'p1', dice: 1 }],
      ['b', { owner: 'p2', dice: 1 }],
      ['m1', { owner: 'p1', dice: 8, body: 'moon' }],
      ['m2', { owner: 'p2', dice: 1, body: 'moon' }],
    ],
    [
      ['a', 'b'],
      ['m1', 'm2'],
    ]
  );
  const banked = endTurnFor(state).state;
  const restored = reviveState(serializeState(banked));

  assert.equal(reserveOn(restored.players.get('p1'), 'moon'), 1);
});
