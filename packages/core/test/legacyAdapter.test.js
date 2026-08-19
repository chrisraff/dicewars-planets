import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, wrapLegacyAi, runAiTurn } from '../src/index.js';

// A minimal stand-in written against the classic dicewars-js AI contract —
// NOT copied from any dicewars-js source — to exercise the adapter:
// scan areas 1..AREA_MAX-1, attack the first adjacent weaker enemy found,
// or return 0 to end the turn.
function pickFirstWinnableAttack(game) {
  for (let i = 1; i < game.AREA_MAX; i++) {
    const from = game.adat[i];
    if (from.size === 0 || from.arm !== game.get_pn() || from.dice <= 1) continue;

    for (let j = 1; j < game.AREA_MAX; j++) {
      const to = game.adat[j];
      if (to.size === 0 || to.arm === from.arm) continue;
      if (!from.join[j]) continue;
      if (to.dice >= from.dice) continue;

      game.area_from = i;
      game.area_to = j;
      return;
    }
  }
  return 0;
}

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

test('the adapter maps a legacy move back to real node ids', () => {
  const strategy = wrapLegacyAi(pickFirstWinnableAttack);
  const move = strategy(makeState(), 'p1');
  assert.deepEqual(move, { from: 'a', to: 'b' });
});

test('the adapter reports no move when the legacy fn returns 0', () => {
  const strategy = wrapLegacyAi(() => 0);
  assert.equal(strategy(makeState(), 'p1'), null);
});

test('the adapter throws instead of silently attacking with a garbage index', () => {
  const strategy = wrapLegacyAi((game) => {
    game.area_from = 1;
    // area_to left unset — a legacy bug, not our contract's problem
  });
  assert.throws(() => strategy(makeState(), 'p1'));
});

test('runAiTurn can drive a legacy-shaped AI through a full turn', () => {
  const strategy = wrapLegacyAi(pickFirstWinnableAttack);
  const rollDie = () => 6; // equal faces: whoever has more dice wins
  const { state: next, events } = runAiTurn(makeState(), strategy, { rollDie });

  const attacks = events.filter((e) => e.type === 'attack');
  assert.equal(attacks.length, 1); // a beats b, then no more winnable moves remain
  assert.equal(next.nodes.get('b').owner, 'p1');
  assert.equal(events.at(-1).type, 'endTurn');
  assert.equal(next.currentTurnIndex, 1); // handed off to p2
});
