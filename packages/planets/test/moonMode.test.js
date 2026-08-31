import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEUTRAL_OWNER, withReserveOn } from '@dicewars/core';
import { graphState, seededRng } from '@dicewars/core/test-support';
import { orbitDialView } from '../src/render/hud.js';
import { highlightsFor, HIGHLIGHT } from '../src/render/highlights.js';
import { makeCellColorer } from '../src/render/colorByOwner.js';
import { NEUTRAL_COLOR, CHANNEL_COLOR, OCEAN_COLOR } from '../src/render/palette.js';
import { playerStatsFor } from '../src/game/playerStats.js';
import { gameSave, worldFingerprint, saveMatchesWorld } from '../src/game/saveGame.js';
import { generateSystem } from '../src/world/generateSystem.js';
import { gateView } from '../src/game/orbit.js';

const orbit = { ports: ['A', 'B'], dockOrder: ['m0', 'm1', 'm2', 'm3', 'm4', 'm5'] };

// --- the dial -----------------------------------------------------------------

test('a match with no moon has no dial at all', () => {
  // Which is the whole of what keeps the controls row exactly as it was for a
  // single-world game.
  assert.equal(orbitDialView({ gate: null, shown: 'planet' }), null);
});

test('the dial names where pressing it goes, not where you are', () => {
  const gate = gateView(orbit, 0);
  assert.equal(orbitDialView({ gate, shown: 'planet' }).label, 'Moon');
  assert.equal(orbitDialView({ gate, shown: 'moon' }).label, 'Planet');
  assert.equal(orbitDialView({ gate, shown: 'moon' }).to, 'planet');
});

test('the ticks show the whole circuit, so the next window can be read off it', () => {
  // The reason the orbit is a published timetable rather than something that
  // moves when it feels like it: a player can answer "when do I get up there"
  // by looking, without being told.
  const view = orbitDialView({ gate: gateView(orbit, 1), shown: 'planet' });
  assert.deepEqual(
    view.stops.map((stop) => stop.open),
    [true, false, true, false],
    'doors and open space, alternating'
  );
  assert.deepEqual(
    view.stops.map((stop) => stop.current),
    [false, true, false, false],
    'and a ring on wherever the moon has got to'
  );
});

test('the dial says whose window it is', () => {
  const open = orbitDialView({ gate: gateView(orbit, 0), shown: 'planet', portName: 'Red' });
  assert.match(open.title, /Docked at Red's port/);
  assert.match(open.title, /open space next round/);

  const shut = orbitDialView({ gate: gateView(orbit, 1), shown: 'planet' });
  assert.match(shut.title, /Over open space/);
  assert.match(shut.title, /a port opens next round/);
});

test('a replay cannot be switched out from under itself', () => {
  // The board a replay is drawing is part of what is being watched, not the
  // seat it is watched from.
  const gate = gateView(orbit, 0);
  assert.equal(orbitDialView({ gate, shown: 'planet' }).disabled, false);
  assert.equal(orbitDialView({ gate, shown: 'planet', replayOpen: true }).disabled, true);
});

// --- the marks on the board ---------------------------------------------------

test('a spaceport is marked all match, and the docked pair more brightly', () => {
  const gate = gateView(orbit, 0);
  const marks = highlightsFor({ ports: ['A', 'B'], gate });

  assert.equal(marks.get('B'), HIGHLIGHT.port, 'the port with no moon over it is still a port');
  assert.equal(marks.get('A'), HIGHLIGHT.docked);
  assert.equal(marks.get('m0'), HIGHLIGHT.docked, 'and the moon end of it, on the other board');
  assert.ok(HIGHLIGHT.docked.amount > HIGHLIGHT.port.amount);
});

test('nothing about the gate ever covers a mark about the move in hand', () => {
  // These two are furniture — they say where the door is, which is a standing
  // fact rather than anything about what you are about to do.
  const marks = highlightsFor({
    ports: ['A', 'B'],
    gate: gateView(orbit, 0),
    selection: 'A',
    targets: ['B'],
    pressed: 'm0',
  });

  assert.equal(marks.get('A'), HIGHLIGHT.selected);
  assert.equal(marks.get('B'), HIGHLIGHT.target);
  assert.equal(marks.get('m0'), HIGHLIGHT.pressed);
});

test('a shut gate marks neither end', () => {
  const marks = highlightsFor({ ports: ['A', 'B'], gate: gateView(orbit, 1) });
  assert.equal(marks.get('A'), HIGHLIGHT.port);
  assert.equal(marks.get('m1'), undefined, 'the moon is facing, but nothing is beneath it');
});

// --- colour -------------------------------------------------------------------

const colorFixture = () => {
  const world = { cellTerritory: new Map([[1, 't'], [2, 'n']]) };
  const state = graphState(
    [
      ['t', { owner: 'p1', dice: 1 }],
      ['n', { owner: NEUTRAL_OWNER, dice: 4 }],
    ],
    [['t', 'n']]
  );
  return { world, state };
};

test('unclaimed ground has a colour of its own, not the missing-territory one', () => {
  // `UNOWNED_COLOR` means "this cell's territory is not in the state", which
  // is a bug rather than a board position. Naming the two apart is what stops
  // a real fault looking like the moon working correctly.
  const { world, state } = colorFixture();
  const colorFor = makeCellColorer(world, state, new Map([['p1', [1, 0, 0]]]));
  assert.deepEqual(colorFor(2), NEUTRAL_COLOR);
  assert.deepEqual(colorFor(1), [1, 0, 0]);
});

test('a cell with no territory is the world’s own empty colour', () => {
  const { world, state } = colorFixture();
  const colors = new Map([['p1', [1, 0, 0]]]);
  assert.deepEqual(makeCellColorer(world, state, colors)(99), OCEAN_COLOR, 'the planet');
  assert.deepEqual(
    makeCellColorer(world, state, colors, () => null, { emptyColor: CHANNEL_COLOR })(99),
    CHANNEL_COLOR,
    'and the moon'
  );
});

// --- the banked-dice badge ----------------------------------------------------

test('the banked badge counts every world', () => {
  // It is one number on one tile, so it has to be everything the player is
  // owed. Reading only the planet's bank made dice earned on the moon simply
  // vanish from the interface until they landed.
  const state = graphState(
    [
      ['a', { owner: 'p1', dice: 8 }],
      ['m1', { owner: 'p1', dice: 8, body: 'moon' }],
      ['b', { owner: 'p2', dice: 1 }],
    ],
    [
      ['a', 'b'],
      ['a', 'm1'],
    ]
  );
  const banked = {
    ...state,
    players: new Map(state.players).set(
      'p1',
      withReserveOn(withReserveOn(state.players.get('p1'), 'planet', 3), 'moon', 5)
    ),
  };

  const [p1] = playerStatsFor(banked, ['p1', 'p2']);
  assert.equal(p1.reserve, 8);
});

// --- the save -----------------------------------------------------------------

const systemFor = (moon) =>
  generateSystem({ subdivisions: 3, playerIds: ['p1', 'p2'], moon, rng: seededRng(21) });

test('a saved moon game comes back as a moon game', () => {
  // The seed rebuilds both worlds, so the fingerprint has to cover both — the
  // planet alone would happily accept a save from a match that had a moon in
  // it and then be handed ten territories it has never heard of.
  const withMoon = systemFor(true);
  const without = systemFor(false);

  assert.notEqual(worldFingerprint(withMoon), worldFingerprint(without));
  assert.equal(worldFingerprint(systemFor(true)), worldFingerprint(withMoon), 'and it is stable');
});

test('the save keeps where the moon had got to, and nothing else about the orbit', () => {
  // Everything about the orbit is a function of the round — which port is
  // under it, which territory is facing, when the gate next opens — so one
  // integer is the whole of what has to survive a reload.
  const world = systemFor(true);
  const save = gameSave({
    seed: 21,
    settings: { players: 2, moon: true },
    humanPlayerId: 'p1',
    world,
    state: { nodes: [], turnOrder: ['p1', 'p2'] },
    replay: null,
    camera: null,
    round: 7,
  });

  assert.equal(save.round, 7);
  assert.ok(saveMatchesWorld(save, world), 'and the world it names is the one it rebuilt');
});

test('a save written before the moon existed is not refused for missing it', () => {
  const save = gameSave({
    seed: 21,
    settings: { players: 2 },
    humanPlayerId: 'p1',
    world: systemFor(false),
    state: { nodes: [] },
    replay: null,
    camera: null,
  });
  assert.equal(save.round, 0, 'it simply means the moon has not moved');
});

// --- and a single-world game is untouched -------------------------------------

test('with the moon off, the world is the planet and nothing else', () => {
  // Not "equivalent to" — the identical object the planet generator has always
  // returned, so a single-world match runs the code path it always ran.
  const world = systemFor(false);
  assert.equal(world.moon, undefined);
  assert.equal(world.orbit, undefined);
  assert.equal(world.spaceports, undefined);
  assert.equal(
    world.nodeIds.every((id) => typeof id === 'number'),
    true,
    'and its territory ids are the plain list positions they always were'
  );
});
