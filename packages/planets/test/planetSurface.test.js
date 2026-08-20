import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '@dicewars/core';
import { generatePlanetWorld } from '../src/world/generateWorld.js';
import { createPlanetSurface } from '../src/render/planetSurface.js';
import { assignPlayerColors, SELECTION_COLOR } from '../src/render/palette.js';
import { highlightsFor } from '../src/render/highlights.js';

function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const playerIds = ['p1', 'p2'];

function setup() {
  const world = generatePlanetWorld({ subdivisions: 2, playerIds, rng: seededRng(31) });
  const surface = createPlanetSurface(world, assignPlayerColors(playerIds));
  const state = createInitialState(world);
  return { world, surface, state, colors: assignPlayerColors(playerIds) };
}

const colorAttribute = (surface) => surface.mesh.geometry.getAttribute('color');

// The color currently painted on the first cell of a territory.
function paintedColor(surface, world, territoryId) {
  const cellId = world.territories.find((t) => t.id === territoryId).cellIds[0];
  // walk to that cell's vertex offset the same way the geometry builder did
  let start = 0;
  for (const cell of world.cells) {
    if (cell.id === cellId) break;
    start += 1 + cell.corners.length;
  }
  const array = colorAttribute(surface).array;
  return [array[start * 3], array[start * 3 + 1], array[start * 3 + 2]];
}

test('the first paint puts every territory in its owner’s color', () => {
  const { world, surface, state, colors } = setup();
  const changed = surface.refresh(state);

  assert.ok(changed > 0, 'the whole planet gets painted the first time');
  const territory = world.territories[0];
  const owner = state.nodes.get(territory.id).owner;
  assert.deepEqual(
    paintedColor(surface, world, territory.id).map((c) => Math.round(c * 1000)),
    colors.get(owner).map((c) => Math.round(Math.fround(c) * 1000))
  );
});

test('a change of owner repaints that territory *and* flags the buffer for the GPU', () => {
  const { world, surface, state } = setup();
  surface.refresh(state);

  const territory = world.territories.find((t) => state.nodes.get(t.id).owner === 'p1');
  const before = paintedColor(surface, world, territory.id);
  const version = colorAttribute(surface).version;

  const captured = {
    ...state,
    nodes: new Map(state.nodes).set(territory.id, { owner: 'p2', dice: 3 }),
  };
  const changed = surface.refresh(captured);

  assert.ok(changed > 0, 'the captured territory is repainted');
  assert.notDeepEqual(paintedColor(surface, world, territory.id), before);
  // `needsUpdate` is write-only on a BufferAttribute, so the version counter is
  // the only evidence the new colors will ever reach the screen
  assert.ok(colorAttribute(surface).version > version, 'the new colors must be uploaded');
});

test('selecting a territory darkens it, and letting go puts it back', () => {
  const { world, surface, state } = setup();
  surface.refresh(state);

  const territory = world.territories[0];
  const plain = paintedColor(surface, world, territory.id);
  const version = colorAttribute(surface).version;

  const marks = highlightsFor({ selection: territory.id, targets: [] });
  surface.refresh(state, (id) => marks.get(id) ?? null);

  const selected = paintedColor(surface, world, territory.id);
  selected.forEach((channel, i) => {
    assert.ok(channel < plain[i], 'a selected territory reads darker than its plain color');
  });
  assert.ok(
    selected.every((c, i) => Math.abs(c - Math.fround(SELECTION_COLOR[i])) < 0.35),
    'and lands close to the selection gray'
  );
  assert.ok(colorAttribute(surface).version > version, 'the highlight must be uploaded too');

  surface.refresh(state);
  assert.deepEqual(paintedColor(surface, world, territory.id), plain, 'deselecting restores it');
});

test('refreshing with nothing changed does no work at all', () => {
  const { surface, state } = setup();
  surface.refresh(state);
  const version = colorAttribute(surface).version;

  assert.equal(surface.refresh(state), 0, 'no cells repainted');
  assert.equal(colorAttribute(surface).version, version, 'and no pointless GPU upload');
});

test('ocean stays ocean no matter who owns what', () => {
  const { world, surface, state } = setup();
  surface.refresh(state);

  const oceanCell = world.cells.find((c) => !world.cellTerritory.has(c.id));
  assert.ok(oceanCell, 'the generated world has ocean');

  let start = 0;
  for (const cell of world.cells) {
    if (cell.id === oceanCell.id) break;
    start += 1 + cell.corners.length;
  }
  const array = colorAttribute(surface).array;
  const before = [array[start * 3], array[start * 3 + 1], array[start * 3 + 2]];

  const flipped = {
    ...state,
    nodes: new Map([...state.nodes].map(([id, n]) => [id, { ...n, owner: 'p2' }])),
  };
  surface.refresh(flipped);

  assert.deepEqual([array[start * 3], array[start * 3 + 1], array[start * 3 + 2]], before);
});
