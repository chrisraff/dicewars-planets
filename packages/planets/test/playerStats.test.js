import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, reduce, endTurn, MAX_RESERVE } from '@dicewars/core';
import { playerStatsFor } from '../src/game/playerStats.js';

function world(assignments, playerIds = ['p1', 'p2', 'p3']) {
  const nodeIds = assignments.map(([id]) => id);
  return {
    nodeIds,
    edges: nodeIds.slice(1).map((id, i) => [nodeIds[i], id]),
    playerIds,
    assignments,
  };
}

const board = () =>
  createInitialState(
    world([
      ['a', { owner: 'p1', dice: 3 }],
      ['b', { owner: 'p1', dice: 2 }],
      ['c', { owner: 'p2', dice: 1 }],
      ['d', { owner: 'p3', dice: 1 }],
    ])
  );

test('counts each player’s territories', () => {
  const stats = playerStatsFor(board());
  assert.deepEqual(
    stats.map((s) => [s.id, s.territories]),
    [['p1', 2], ['p2', 1], ['p3', 1]]
  );
});

test('reports banked dice, which start at zero', () => {
  const stats = playerStatsFor(board());
  assert.ok(stats.every((s) => s.reserve === 0));
});

test('reinforcements that have nowhere to land show up as banked dice', () => {
  // p1 owns one territory and it is already full, so everything it earns banks
  const full = createInitialState(
    world([
      ['a', { owner: 'p1', dice: 8 }],
      ['b', { owner: 'p2', dice: 1 }],
      ['c', { owner: 'p3', dice: 1 }],
    ])
  );
  const { state } = reduce(full, endTurn(), {});

  const p1 = playerStatsFor(state).find((s) => s.id === 'p1');
  assert.equal(p1.reserve, 1, 'the earned die had nowhere to go, so it banked');
  assert.ok(p1.reserve <= MAX_RESERVE);
});

test('marks whose turn it is, and only one player at a time', () => {
  const stats = playerStatsFor(board());
  assert.deepEqual(stats.filter((s) => s.isCurrent).map((s) => s.id), ['p1']);
});

test('a knocked-out player keeps their place in the row, marked out', () => {
  const state = board();
  const conquered = {
    ...state,
    nodes: new Map(state.nodes).set('c', { owner: 'p1', dice: 1 }),
  };

  const stats = playerStatsFor(conquered);
  assert.deepEqual(stats.map((s) => s.id), ['p1', 'p2', 'p3'], 'nobody is removed from the row');

  const p2 = stats.find((s) => s.id === 'p2');
  assert.equal(p2.alive, false);
  assert.equal(p2.territories, 0);
});

test('once the game is over nobody is "current", and the winner is flagged', () => {
  const state = board();
  const finished = { ...state, phase: 'gameover', winner: 'p1' };

  const stats = playerStatsFor(finished);
  assert.equal(stats.filter((s) => s.isCurrent).length, 0);
  assert.deepEqual(stats.filter((s) => s.isWinner).map((s) => s.id), ['p1']);
});

test('handles a full eight-player table', () => {
  const playerIds = Array.from({ length: 8 }, (_, i) => `p${i + 1}`);
  const state = createInitialState(
    world(playerIds.map((id, i) => [`t${i}`, { owner: id, dice: 1 }]), playerIds)
  );

  const stats = playerStatsFor(state);
  assert.equal(stats.length, 8);
  assert.ok(stats.every((s) => s.territories === 1 && s.alive));
});
