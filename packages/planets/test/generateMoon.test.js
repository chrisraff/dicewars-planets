import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEUTRAL_OWNER } from '@dicewars/core';
import { seededRng } from '@dicewars/core/test-support';
import { generateMoonWorld, MOON_TUNING } from '../src/world/generateMoon.js';

// A moon is generated rather than carved-and-measured, because the spin means
// its shape has a job: whatever faces the planet has to be affordable. Most
// of what is asserted here is that job being done, over enough seeds that a
// lucky one cannot carry it.

const SEEDS = 120;
const moons = function* (count = SEEDS) {
  for (let seed = 1; seed <= count; seed++) {
    yield generateMoonWorld({ rng: seededRng(seed * 7919 + 3) });
  }
};

const adjacencyOf = (world) => {
  const adjacency = new Map(world.nodeIds.map((id) => [id, new Set()]));
  for (const [a, b] of world.edges) {
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
  }
  return adjacency;
};

test('the spin can never present a garrison a losing player cannot afford', () => {
  // The whole balance of the mode rests on this one line. If a fortress can
  // rotate into the dock, the entry price becomes whatever the dice happened
  // to say that round, and the moon is a prize for whoever is already ahead.
  const [, mostBandDice] = MOON_TUNING.bandDice;
  let worst = 0;

  for (const world of moons()) {
    const dice = new Map(world.assignments);
    for (const id of world.dockOrder) worst = Math.max(worst, dice.get(id).dice);
  }

  assert.equal(worst, mostBandDice, 'every dockable territory is band-priced');
  assert.ok(mostBandDice < MOON_TUNING.capDice[0], 'and the caps are dearer than any of them');
});

test('the docking band is a complete ring, in the order the moon spins through it', () => {
  // The dock steps along this list, so a break in it would be a stop where
  // the moon presented ground unreachable from the last one.
  for (const world of moons()) {
    const adjacency = adjacencyOf(world);
    const dock = world.dockOrder;
    assert.equal(dock.length, MOON_TUNING.bandSectors);
    for (let i = 0; i < dock.length; i++) {
      assert.ok(
        adjacency.get(dock[i]).has(dock[(i + 1) % dock.length]),
        `${dock[i]} should touch the sector after it`
      );
    }
  }
});

test('the caps are behind the band and never face the planet', () => {
  for (const world of moons()) {
    assert.equal(world.capTerritoryIds.length, 2 * MOON_TUNING.capSectors);
    for (const id of world.capTerritoryIds) {
      assert.equal(world.dockOrder.includes(id), false, `${id} is a cap and must never dock`);
    }
  }
});

test('each cap is a place you can walk across, not two halves hung off the band', () => {
  // Every meridian meets at the pole, so the distance from the pole to any
  // meridian is zero and the cut there is unavoidable unless it is stopped
  // short on purpose. Left alone it severed every cap in two.
  for (const world of moons()) {
    const adjacency = adjacencyOf(world);
    const [north1, north2, south1, south2] = world.capTerritoryIds;
    assert.ok(adjacency.get(north1).has(north2), 'the north cap holds together over its pole');
    assert.ok(adjacency.get(south1).has(south2), 'and the south cap over its own');
  }
});

test('every territory can be reached from every other', () => {
  // The one unplayable moon this could produce is one with ground nothing
  // touches, where a landing party would be stranded for the rest of the
  // match. `openChannels` digs a way through rather than rejecting the carve.
  for (const world of moons()) {
    const adjacency = adjacencyOf(world);
    const seen = new Set([world.nodeIds[0]]);
    const stack = [world.nodeIds[0]];
    while (stack.length) {
      for (const next of adjacency.get(stack.pop())) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    assert.equal(seen.size, world.nodeIds.length);
  }
});

test('every territory is a single piece of ground', () => {
  for (const world of moons(40)) {
    const byId = new Map(world.cells.map((c) => [c.id, c]));
    for (const territory of world.territories) {
      const members = new Set(territory.cellIds);
      assert.ok(members.size > 0, `${territory.id} has ground`);

      const seen = new Set([territory.cellIds[0]]);
      const stack = [territory.cellIds[0]];
      while (stack.length) {
        for (const n of byId.get(stack.pop()).neighbors) {
          if (members.has(n) && !seen.has(n)) {
            seen.add(n);
            stack.push(n);
          }
        }
      }
      assert.equal(seen.size, members.size, `${territory.id} is in one piece`);
    }
  }
});

test('the moon is dealt unclaimed, and says which world it is on', () => {
  const world = generateMoonWorld({ rng: seededRng(11) });

  for (const [, assignment] of world.assignments) {
    assert.equal(assignment.owner, NEUTRAL_OWNER);
    assert.equal(assignment.body, 'moon');
  }
  // Territory ids are list positions on the planet, so a moon numbering its
  // own from zero would collide the moment the two boards share a state.
  for (const id of world.nodeIds) {
    assert.equal(typeof id, 'string');
    assert.ok(/^m\d+$/.test(id), `${id} is namespaced away from the planet's ids`);
  }
});

test('each cap holds one of each garrison rather than two of a kind', () => {
  const [soft, hard] = MOON_TUNING.capDice;
  for (const world of moons(40)) {
    const dice = new Map(world.assignments);
    const [north1, north2, south1, south2] = world.capTerritoryIds;
    for (const [a, b] of [
      [north1, north2],
      [south1, south2],
    ]) {
      assert.deepEqual(
        [dice.get(a).dice, dice.get(b).dice].sort((x, y) => x - y),
        [soft, hard]
      );
    }
  }
});

test('channels are every cell no territory claimed', () => {
  // The renderer decides what is water by asking whether a cell has a
  // territory, exactly as it does for the planet's ocean, so these two have
  // to be the same set or the moon would be painted with holes in it.
  for (const world of moons(20)) {
    const claimed = new Set(world.territories.flatMap((t) => t.cellIds));
    for (const cell of world.cells) {
      assert.equal(
        world.channelCellIds.has(cell.id),
        !claimed.has(cell.id),
        `cell ${cell.id} is either channel or territory, never both or neither`
      );
    }
    assert.equal(world.cellTerritory.size, claimed.size);
  }
});

test('the same seed grows the same moon', () => {
  // A world is stored as the number it grew from, so this is what makes a
  // saved game with a moon in it reopenable at all.
  const once = generateMoonWorld({ rng: seededRng(42) });
  const twice = generateMoonWorld({ rng: seededRng(42) });

  assert.deepEqual(twice.assignments, once.assignments);
  assert.deepEqual(twice.edges, once.edges);
  assert.deepEqual(twice.dockOrder, once.dockOrder);
  assert.deepEqual(
    twice.territories.map((t) => t.cellIds),
    once.territories.map((t) => t.cellIds)
  );
});

test('a moon is ten territories, and its channels are trenches rather than sea', () => {
  // A channel is one cell wide by construction, so how *narrow* it reads is
  // decided entirely by how big a cell is. On the coarse mesh the moon was
  // first built on, a trench came out as broad as the ground either side of
  // it and the whole moon read as an archipelago — which is the thing this
  // number is really guarding, and why it is stated as a fraction of the
  // world rather than as a count of cells.
  const water = [];
  for (const world of moons(40)) {
    assert.equal(world.nodeIds.length, 10);
    water.push(world.channelCellIds.size / world.cells.length);
  }
  const mean = water.reduce((a, b) => a + b, 0) / water.length;
  assert.ok(mean > 0.1 && mean < 0.25, `channels are ${(mean * 100).toFixed(0)}% of the moon`);
});
