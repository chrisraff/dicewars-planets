import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCellColorer } from '../src/render/colorByOwner.js';
import { assignPlayerColors, UNOWNED_COLOR, SELECTION_COLOR, WHITE, mix, lighten } from '../src/render/palette.js';

test('colors a cell by its territory owner', () => {
  const world = { cellTerritory: new Map([[0, 't1'], [1, 't2']]) };
  const state = {
    nodes: new Map([
      ['t1', { owner: 'p1' }],
      ['t2', { owner: 'p2' }],
    ]),
  };
  const playerColors = assignPlayerColors(['p1', 'p2']);
  const colorFor = makeCellColorer(world, state, playerColors);

  assert.deepEqual(colorFor(0), playerColors.get('p1'));
  assert.deepEqual(colorFor(1), playerColors.get('p2'));
});

test('falls back to the unowned color when a territory has no node', () => {
  const world = { cellTerritory: new Map([[0, 't1']]) };
  const state = { nodes: new Map() };
  const colorFor = makeCellColorer(world, state, assignPlayerColors(['p1']));

  assert.deepEqual(colorFor(0), UNOWNED_COLOR);
});

function twoTerritoryWorld() {
  return {
    world: { cellTerritory: new Map([[0, 't1'], [1, 't2']]) },
    state: { nodes: new Map([['t1', { owner: 'p1' }], ['t2', { owner: 'p1' }]]) },
    playerColors: assignPlayerColors(['p1']),
  };
}

test('a selected territory goes dark, its neighbors untouched', () => {
  const { world, state, playerColors } = twoTerritoryWorld();
  const base = playerColors.get('p1');
  const colorFor = makeCellColorer(world, state, playerColors, (id) =>
    id === 't1' ? { color: SELECTION_COLOR, amount: 0.72 } : null
  );

  assert.deepEqual(colorFor(1), base, 'untinted cells keep the player color exactly');
  const selected = colorFor(0);
  selected.forEach((channel, i) => {
    assert.ok(channel < base[i], 'a selected cell is darker on every channel');
    assert.ok(channel >= 0);
  });
});

test('a territory under attack lifts toward white instead', () => {
  const { world, state, playerColors } = twoTerritoryWorld();
  const base = playerColors.get('p1');
  const colorFor = makeCellColorer(world, state, playerColors, () => ({ color: WHITE, amount: 0.5 }));

  colorFor(0).forEach((channel, i) => {
    assert.ok(channel > base[i], 'a cell in a fight is brighter on every channel');
    assert.ok(channel <= 1);
  });
});

test('mix is a no-op at 0 and lands exactly on the target color at 1', () => {
  assert.deepEqual(mix([0.2, 0.4, 0.6], [1, 1, 1], 0), [0.2, 0.4, 0.6]);
  assert.deepEqual(mix([0.2, 0.4, 0.6], [0, 0, 0], 1), [0, 0, 0]);
  assert.deepEqual(lighten([0.2, 0.4, 0.6], 1), [1, 1, 1]);
  assert.deepEqual(mix([0, 0, 0], [1, 1, 1], 0.5), [0.5, 0.5, 0.5]);
});
