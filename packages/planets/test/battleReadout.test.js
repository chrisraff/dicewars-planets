import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FULL_READING_MAX_DICE,
  battleView,
  battleSideView,
  fitsFullReading,
  historyRowView,
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

// --- how many dice the full reading is worth showing ------------------------

const sides = (attacker, defender) => ({
  attacker: { dice: Array(attacker).fill({ value: 1 }) },
  defender: { dice: Array(defender).fill({ value: 1 }) },
});

test('the full reading is offered up to the cap on both sides at once', () => {
  const cap = FULL_READING_MAX_DICE;
  assert.equal(fitsFullReading(sides(cap, cap)), true, 'the widest full reading there is');
  assert.equal(fitsFullReading(sides(cap + 1, 1)), false, 'one side over is enough to compact it');
  assert.equal(fitsFullReading(sides(1, cap + 1)), false, 'either side, not just the attacker');
});

test('the widest fight there can be is never shown full', () => {
  // eight is a full territory, so this is the case the cap exists for
  assert.equal(fitsFullReading(sides(8, 8)), false);
});

test('the cap is about legibility, not about room', () => {
  // it is deliberately below what a desktop readout could fit — five dice a
  // side would still fit and is still refused, because the point where faces
  // become a row to count comes before the point where they stop fitting.
  // Width is the other half of the decision and is measured, not counted.
  assert.ok(FULL_READING_MAX_DICE < 8, 'a rule that only bit at the maximum would never bite');
  assert.equal(fitsFullReading(sides(5, 1)), false);
});
