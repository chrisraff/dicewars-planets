import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCellColorer } from '../src/render/colorByOwner.js';
import { assignPlayerColors, UNOWNED_COLOR } from '../src/render/palette.js';

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
