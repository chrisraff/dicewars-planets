import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSimpleStrategy,
  legalAttacksFor,
  isLegalAttack,
  runAiTurn,
  getCurrentPlayerId,
} from '../src/index.js';
import { chainState as chain, rollsOf, seededRng } from './support/index.js';

test('only offers attacks the reducer would accept', () => {
  const state = chain([
    ['a', { owner: 'p1', dice: 3 }],
    ['b', { owner: 'p2', dice: 1 }],
    ['c', { owner: 'p1', dice: 1 }],
    ['d', { owner: 'p2', dice: 2 }],
  ]);

  const moves = legalAttacksFor(state, 'p1');
  for (const { from, to } of moves) assert.ok(isLegalAttack(state, from, to));
  // 'a' can hit 'b'; 'c' has a single die so it can't attack at all
  assert.deepEqual(moves, [{ from: 'a', to: 'b' }]);
});

test('takes the biggest dice advantage on offer', () => {
  const state = chain([
    ['a', { owner: 'p1', dice: 4 }],
    ['b', { owner: 'p2', dice: 3 }],
    ['c', { owner: 'p1', dice: 5 }],
    ['d', { owner: 'p2', dice: 1 }],
  ]);

  const move = createSimpleStrategy({ rng: seededRng(1) })(state, 'p1');
  assert.deepEqual(move, { from: 'c', to: 'd' }, '5 vs 1 beats 4 vs 3');
});

test('declines a fight it is not favored to win', () => {
  const state = chain([
    ['a', { owner: 'p1', dice: 2 }],
    ['b', { owner: 'p2', dice: 2 }],
  ]);
  assert.equal(createSimpleStrategy({ rng: seededRng(2) })(state, 'p1'), null);
});

test('a full stack will take an even fight, since it cannot grow', () => {
  const state = chain([
    ['a', { owner: 'p1', dice: 8 }],
    ['b', { owner: 'p2', dice: 8 }],
  ]);
  assert.deepEqual(createSimpleStrategy({ rng: seededRng(3) })(state, 'p1'), { from: 'a', to: 'b' });
});

test('a whole AI turn terminates and hands play on', () => {
  const state = chain([
    ['a', { owner: 'p1', dice: 8 }],
    ['b', { owner: 'p2', dice: 1 }],
    ['c', { owner: 'p2', dice: 1 }],
    ['d', { owner: 'p2', dice: 8 }], // too strong to take, so p2 survives the turn
  ]);

  const rng = seededRng(4);
  const { state: next, events } = runAiTurn(state, createSimpleStrategy({ rng }), {
    rollDie: () => 1 + Math.floor(rng() * 6),
  });

  assert.ok(events.some((e) => e.type === 'attack'), 'it should have attacked something');
  assert.equal(events.at(-1).type, 'endTurn', 'the turn ends itself rather than running forever');
  assert.equal(getCurrentPlayerId(next), 'p2', 'and play passes on');
});

test('an attack reports every die that was rolled, not just the totals', () => {
  const state = chain([
    ['a', { owner: 'p1', dice: 3 }],
    ['b', { owner: 'p2', dice: 2 }],
  ]);
  const { events } = runAiTurn(state, createSimpleStrategy({ rng: seededRng(5) }), {
    rollDie: rollsOf([4, 5, 6, 1, 2]),
  });

  const [first] = events;
  assert.deepEqual(first.attackRolls, [4, 5, 6]);
  assert.deepEqual(first.defendRolls, [1, 2]);
  assert.equal(first.attackRoll, 15);
  assert.equal(first.defendRoll, 3);
  assert.equal(first.attackRolls.length, 3, 'one value per attacking die');
});
