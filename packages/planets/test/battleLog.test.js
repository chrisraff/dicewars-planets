import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattleLog } from '../src/game/battleLog.js';

const attackEvent = (over = {}) => ({
  type: 'attack',
  from: 1,
  to: 2,
  attackRolls: [3, 5, 6],
  defendRolls: [2, 4],
  attackRoll: 14,
  defendRoll: 6,
  attackerWins: true,
  attackerOwner: 'p1',
  defenderOwner: 'p2',
  ...over,
});

test('a battle is recorded with every die, per side, and who threw them', () => {
  const log = createBattleLog();
  const entry = log.record(attackEvent());

  assert.equal(entry.kind, 'battle');
  assert.deepEqual(entry.attacker, { playerId: 'p1', rolls: [3, 5, 6], total: 14 });
  assert.deepEqual(entry.defender, { playerId: 'p2', rolls: [2, 4], total: 6 });
  assert.equal(entry.attackerWins, true);
  assert.deepEqual([entry.from, entry.to], [1, 2]);
});

test('the recorded rolls are a copy, not the event’s own arrays', () => {
  const log = createBattleLog();
  const event = attackEvent();
  const entry = log.record(event);

  event.attackRolls.push(99);
  assert.deepEqual(entry.attacker.rolls, [3, 5, 6], 'the log must not change under us');
});

test('eliminations are recorded too, with who did it', () => {
  const log = createBattleLog();
  const entry = log.record({ type: 'eliminated', playerId: 'p2', by: 'p1' });

  assert.equal(entry.kind, 'elimination');
  assert.deepEqual([entry.playerId, entry.by], ['p2', 'p1']);
});

test('a pass is recorded too, with who passed', () => {
  const log = createBattleLog();
  const entry = log.record({ type: 'passed', playerId: 'p1' });

  assert.equal(entry.kind, 'passed');
  assert.equal(entry.playerId, 'p1');
});

test('events with nothing to say are ignored', () => {
  const log = createBattleLog();
  assert.equal(log.record({ type: 'endTurn', playerId: 'p1', earned: 3 }), null);
  assert.equal(log.record({ type: 'adjacencyChanged' }), null);
  assert.equal(log.entries.length, 0);
});

test('entries come out oldest first, each with its own id', () => {
  const log = createBattleLog();
  log.record(attackEvent({ attackRoll: 10 }));
  log.record({ type: 'eliminated', playerId: 'p2', by: 'p1' });
  log.record(attackEvent({ attackRoll: 20 }));

  assert.deepEqual(log.entries.map((e) => e.kind), ['battle', 'elimination', 'battle']);
  assert.equal(new Set(log.entries.map((e) => e.id)).size, 3, 'ids are unique');
  assert.ok(log.entries[0].id < log.entries[2].id, 'and increase with time');
});

test('the readout follows the most recent fight, ignoring the footnotes after it', () => {
  const log = createBattleLog();
  log.record(attackEvent({ attackRoll: 10 }));
  const last = log.record(attackEvent({ attackRoll: 20 }));
  log.record({ type: 'eliminated', playerId: 'p2', by: 'p1' });

  assert.equal(log.latest.kind, 'elimination', 'the newest entry is the knockout');
  assert.equal(log.latestBattle, last, 'but the readout still shows the dice that caused it');
});

test('there is nothing to show before anything has happened', () => {
  const log = createBattleLog();
  assert.equal(log.latest, null);
  assert.equal(log.latestBattle, null);
  assert.deepEqual(log.entries, []);
});

test('a long game drops the oldest entries rather than growing forever', () => {
  const log = createBattleLog({ limit: 5 });
  for (let i = 0; i < 20; i++) log.record(attackEvent({ attackRoll: i }));

  assert.equal(log.entries.length, 5);
  assert.deepEqual(
    log.entries.map((e) => e.attacker.total),
    [15, 16, 17, 18, 19],
    'the five most recent survive, in order'
  );
});

// --- restoring a log with the game it belongs to ------------------------------

test('a restored log still holds the battles it was saved with', () => {
  const first = createBattleLog();
  first.record(attackEvent());
  first.record(attackEvent({ from: 3, to: 4 }));

  const restored = createBattleLog({ entries: first.entries });

  assert.deepEqual(restored.entries, first.entries);
  assert.deepEqual(restored.latestBattle, first.latestBattle);
});

test('a restored log numbers new battles above the ones it came back with', () => {
  // ids are how the history panel tells one entry from another; handing a new
  // battle an id an old one already has would make two entries the same entry
  const saved = createBattleLog();
  saved.record(attackEvent());
  saved.record(attackEvent());

  const restored = createBattleLog({ entries: saved.entries });
  const next = restored.record(attackEvent());

  assert.ok(next.id > saved.latest.id);
  assert.equal(new Set(restored.entries.map((entry) => entry.id)).size, restored.entries.length);
});

test('a restored log is a copy — playing on does not write back into the save', () => {
  const saved = createBattleLog();
  saved.record(attackEvent());
  const written = saved.entries.map((entry) => ({ ...entry }));

  const restored = createBattleLog({ entries: saved.entries });
  restored.record(attackEvent({ from: 9, to: 10 }));

  assert.deepEqual(saved.entries, written);
});

test('a log restored from more entries than it holds keeps the newest', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, kind: 'battle', from: i }));
  const restored = createBattleLog({ limit: 5, entries: many });

  assert.equal(restored.entries.length, 5);
  assert.equal(restored.latest.id, 200);
  assert.equal(restored.record(attackEvent()).id, 201, 'and still numbers on from there');
});
