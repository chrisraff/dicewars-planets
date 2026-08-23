import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  battleView,
  battleSideView,
  historyRowView,
  scrollFades,
} from '../src/render/battleReadout.js';
import { createBattleLog } from '../src/game/battleLog.js';

const entry = (over = {}) => ({
  id: 7,
  kind: 'battle',
  from: 1,
  to: 2,
  attacker: { playerId: 'p1', rolls: [3, 5, 6], total: 14 },
  defender: { playerId: 'p2', rolls: [2, 4], total: 6 },
  attackerWins: true,
  ...over,
});

test('a battle draws one die per die rolled, on each side', () => {
  const view = battleView(entry());
  assert.deepEqual(view.attacker.dice.map((d) => d.value), [3, 5, 6]);
  assert.deepEqual(view.defender.dice.map((d) => d.value), [2, 4]);
});

test('each side carries its own player, so the dice take that player’s color', () => {
  const view = battleView(entry());
  assert.equal(view.attacker.playerId, 'p1');
  assert.equal(view.defender.playerId, 'p2');
});

test('totals are shown per side, and the winning side is marked', () => {
  const won = battleView(entry());
  assert.deepEqual([won.attacker.total, won.defender.total], [14, 6]);
  assert.equal(won.attacker.winner, true);
  assert.equal(won.defender.winner, false);

  const lost = battleView(entry({ attackerWins: false }));
  assert.equal(lost.attacker.winner, false);
  assert.equal(lost.defender.winner, true);
});

test('while the dice are still in the air the faces are withheld', () => {
  const view = battleView(entry(), { revealed: false });

  assert.equal(view.attacker.dice.length, 3, 'the right number of dice is known immediately');
  assert.ok(view.attacker.dice.every((d) => d.value === null), 'but not what they landed on');
  assert.equal(view.attacker.total, null, 'nor the total');
  assert.equal(view.attacker.winner, false, 'and nothing is marked as won yet');
  assert.equal(view.attacker.playerId, 'p1', 'the colors are known, though');
});

test('a single-die defender still gets its one die', () => {
  const view = battleView(entry({ defender: { playerId: 'p2', rolls: [4], total: 4 } }));
  assert.deepEqual(view.defender.dice.map((d) => d.value), [4]);
});

test('there is nothing to draw for a non-battle', () => {
  assert.equal(battleView(null), null);
  assert.equal(battleView({ kind: 'elimination', playerId: 'p2', by: 'p1' }), null);
});

test('a side view can be built on its own', () => {
  const side = battleSideView({ playerId: 'p3', rolls: [1, 1], total: 2 }, { winner: true });
  assert.deepEqual(side, {
    playerId: 'p3',
    dice: [{ value: 1 }, { value: 1 }],
    total: 2,
    winner: true,
  });
});

test('history rows render battles as dice and knockouts as a line of text', () => {
  const names = new Map([['p1', 'Red'], ['p2', 'Blue']]);
  const nameOf = (id) => names.get(id) ?? id;

  const fight = historyRowView(entry(), nameOf);
  assert.equal(fight.kind, 'battle');
  assert.deepEqual(fight.battle.attacker.dice.map((d) => d.value), [3, 5, 6]);

  const knockout = historyRowView({ id: 8, kind: 'elimination', playerId: 'p2', by: 'p1' }, nameOf);
  assert.equal(knockout.kind, 'elimination');
  assert.equal(knockout.text, 'Blue knocked out by Red');
  assert.equal(knockout.playerId, 'p2', 'so the row can be dotted in their color');
});

test('history rows fall back to raw ids when there are no names', () => {
  const row = historyRowView({ id: 1, kind: 'elimination', playerId: 'p2', by: 'p1' });
  assert.equal(row.text, 'p2 knocked out by p1');
});

test('a pass renders as a line of text too, dotted in the passing player\'s color', () => {
  const names = new Map([['p1', 'Red']]);
  const nameOf = (id) => names.get(id) ?? id;

  const row = historyRowView({ id: 9, kind: 'passed', playerId: 'p1' }, nameOf);
  assert.equal(row.kind, 'passed');
  assert.equal(row.text, 'Red passed');
  assert.equal(row.playerId, 'p1');
});

test('a battle logged from a real attack event draws correctly end to end', () => {
  const log = createBattleLog();
  const recorded = log.record({
    type: 'attack',
    from: 4,
    to: 9,
    attackRolls: [6, 6, 1],
    defendRolls: [5, 5, 5],
    attackRoll: 13,
    defendRoll: 15,
    attackerWins: false,
    attackerOwner: 'p1',
    defenderOwner: 'p4',
  });

  const view = battleView(recorded);
  assert.deepEqual(view.attacker.dice.map((d) => d.value), [6, 6, 1]);
  assert.equal(view.defender.winner, true, 'the defender held, so their total is the one lit up');
  assert.equal(view.defender.playerId, 'p4');
});

// --- the scroll-edge fades ------------------------------------------------

// A strip 200px wide holding 500px of dice: 300px of scrolling to do.
const strip = (scrollLeft) => ({ scrollLeft, scrollWidth: 500, clientWidth: 200 });

test('a strip with nothing to scroll fades on neither side', () => {
  assert.deepEqual(
    scrollFades({ scrollLeft: 0, scrollWidth: 200, clientWidth: 200 }),
    { left: false, right: false }
  );
});

test('unscrolled, it fades only on the right, where the rest of the dice are', () => {
  assert.deepEqual(scrollFades(strip(0)), { left: false, right: true });
});

test('part way along, it fades on both sides', () => {
  assert.deepEqual(scrollFades(strip(150)), { left: true, right: true });
});

test('scrolled to the end, it fades only on the left', () => {
  assert.deepEqual(scrollFades(strip(300)), { left: true, right: false });
});

test('a strip already at the end does not claim there is more to the right', () => {
  // scrollLeft is fractional on a zoomed or high-DPI display, so the end is
  // never reached exactly and a strict comparison would fade forever
  assert.equal(scrollFades(strip(299.6)).right, false);
  assert.equal(scrollFades({ ...strip(0.4) }).left, false, 'and likewise at the start');
});

test('the fades follow the scroll all the way across', () => {
  const seen = [0, 100, 200, 300].map((at) => scrollFades(strip(at)));
  assert.deepEqual(seen.map((f) => `${f.left ? 'L' : '-'}${f.right ? 'R' : '-'}`), [
    '-R', 'LR', 'LR', 'L-',
  ]);
});
