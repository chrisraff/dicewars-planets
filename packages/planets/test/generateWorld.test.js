import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, reduce, endTurn } from '@dicewars/core';
import { generatePlanetWorld } from '../src/world/generateWorld.js';
import { settingDefinition, MAX_PLAYERS } from '../src/game/settings.js';
import { seededRng } from '@dicewars/core/test-support';

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

test('every planet size the menu offers builds a world a full table can play', () => {
  // the menu renders from the definitions, so anything listed there is a thing
  // a player can pick — including the worst case of the smallest planet and
  // the largest table, where there has to be ground left for everyone
  const playerIds = Array.from({ length: MAX_PLAYERS }, (_, i) => `p${i + 1}`);

  for (const { value: subdivisions, label } of settingDefinition('size').choices) {
    const world = generatePlanetWorld({ subdivisions, playerIds, rng: seededRng(11) });
    const state = createInitialState(world);

    assert.ok(
      world.nodeIds.length >= playerIds.length,
      `${label} has ${world.nodeIds.length} territories for ${playerIds.length} players`
    );
    const owners = new Set([...state.nodes.values()].map((n) => n.owner));
    assert.equal(owners.size, playerIds.length, `${label} left somebody with nothing`);

    // the territory graph has to be one connected piece, or a game on it can
    // never be won — nobody can reach the far side
    const seen = new Set([world.nodeIds[0]]);
    const stack = [world.nodeIds[0]];
    const adjacency = new Map(world.nodeIds.map((id) => [id, []]));
    for (const [a, b] of world.edges) {
      adjacency.get(a).push(b);
      adjacency.get(b).push(a);
    }
    while (stack.length) {
      for (const next of adjacency.get(stack.pop())) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    assert.equal(seen.size, world.nodeIds.length, `${label} generated an unreachable island`);
  }
});
