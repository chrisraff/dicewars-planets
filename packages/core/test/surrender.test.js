import { test } from 'node:test';
import assert from 'node:assert/strict';
import { surrenderedPlayerIds, SURRENDER_TUNING } from '../src/index.js';
import { chainState } from './support/index.js';

/** A chain where each player holds a run of it, at the dice given. */
const board = (runs) =>
  chainState(
    runs.flatMap(([owner, count, dice], run) =>
      Array.from({ length: count }, (_, i) => [`${run}-${i}`, { owner, dice }])
    ),
    { playerIds: runs.map(([owner]) => owner) }
  );

test('whoever is leading can never be the one to give up', () => {
  // the property the whole feature rests on: a surrendering field is one where
  // the player left standing leads, so nobody can be handed a match while
  // somebody else is ahead of them
  for (const ratio of [2, 3, 4, 6, 8]) {
    const state = board([['p1', 12, 3], ['p2', 2, 1]]);
    const surrendered = surrenderedPlayerIds(state, { diceRatio: ratio, regionRatio: ratio });
    assert.ok(!surrendered.has('p1'), `the leader gave up at a ratio of ${ratio}`);
  }
});

test('a player a sixth of the leader on both counts is done', () => {
  // p1: 12 territories in a row at 3 dice — 36 dice, region 12
  // p2: 2 territories at 1 die — 2 dice, region 2. Both exactly a sixth.
  const surrendered = surrenderedPlayerIds(board([['p1', 12, 3], ['p2', 2, 1]]));
  assert.deepEqual([...surrendered], ['p2']);
});

test('one territory the right side of the line is still a game', () => {
  // p2 at 3 territories has a region over a sixth of p1's 12, so whatever the
  // dice say there is still an income here to come back on
  const surrendered = surrenderedPlayerIds(board([['p1', 12, 3], ['p2', 3, 1]]));
  assert.equal(surrendered.size, 0);
});

test('being behind on one measure is not being beaten', () => {
  // The case the dice measure gets wrong on its own, and the reason region is
  // in here: p1 has stacked 3 territories eight deep — 24 dice against p2's
  // 4 — but p2's larger region out-earns it every turn. Dice alone would call
  // p2 finished and hand p1 a game it is losing.
  const state = board([['p1', 3, 8], ['p2', 4, 1]]);

  assert.equal(surrenderedPlayerIds(state).size, 0, 'nobody has given up');
  assert.ok(
    surrenderedPlayerIds(state, { regionRatio: 1 }).has('p2'),
    'sanity: on the dice alone p2 looks finished'
  );
});

test('a player already knocked out is not among those giving up', () => {
  // they have nothing left to surrender, and counting them would let a game end
  // on the strength of players who are not in it
  const state = board([['p1', 12, 3], ['p2', 2, 1], ['p3', 0, 1]]);
  const surrendered = surrenderedPlayerIds(state);

  assert.ok(!surrendered.has('p3'), 'p3 holds nothing and is simply out');
});

test('the tuning is a pair of ratios, and looser really does mean sooner', () => {
  const state = board([['p1', 12, 3], ['p2', 3, 1]]);

  assert.equal(surrenderedPlayerIds(state).size, 0);
  assert.ok(surrenderedPlayerIds(state, { diceRatio: 4, regionRatio: 4 }).has('p2'));
  assert.deepEqual(SURRENDER_TUNING, { diceRatio: 6, regionRatio: 6 });
});
