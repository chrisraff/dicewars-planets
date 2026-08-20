import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, reduce, endTurn } from '@dicewars/core';
import { generatePlanetWorld } from '../src/world/generateWorld.js';

function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

test('a generated planet feeds straight into @dicewars/core', () => {
  const world = generatePlanetWorld({
    subdivisions: 2,
    playerIds: ['p1', 'p2', 'p3'],
    rng: seededRng(42),
  });

  const state = createInitialState(world);

  assert.equal(state.nodes.size, world.territories.length);
  for (const node of state.nodes.values()) {
    assert.ok(world.playerIds.includes(node.owner));
    assert.ok(node.dice >= 1 && node.dice <= 3);
  }

  // every player actually got at least one territory
  const owners = new Set([...state.nodes.values()].map((n) => n.owner));
  assert.equal(owners.size, 3);

  // and the state is actually playable end to end
  const { state: next } = reduce(state, endTurn(), {});
  assert.equal(next.currentTurnIndex, 1);
});

test('territory size knobs pass through to the generated territories', () => {
  const world = generatePlanetWorld({
    subdivisions: 3,
    playerIds: ['p1', 'p2'],
    rng: seededRng(7),
    minTerritorySize: 3,
    targetTerritorySize: 7,
    territorySizeSigma: 2,
  });

  const sizes = world.territories.map((t) => t.cellIds.length);
  for (const size of sizes) assert.ok(size >= 3);

  const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  assert.ok(mean > 4 && mean < 10);
});
