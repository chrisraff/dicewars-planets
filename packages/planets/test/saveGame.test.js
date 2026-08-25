import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, reviveState, serializeState, seededRng } from '@dicewars/core';
import {
  SAVE_VERSION,
  gameSave,
  readSavedGame,
  writeSavedGame,
  clearSavedGame,
  saveMatchesWorld,
  worldFingerprint,
  cameraSnapshot,
  isUsableCamera,
} from '../src/game/saveGame.js';
import { generatePlanetWorld } from '../src/world/generateWorld.js';
import { createGame, AUTOPLAY } from '../src/game/createGame.js';
import { normalizeSettings } from '../src/game/settings.js';
import { createReplay, reviveReplay, serializeReplay } from '../src/game/replay.js';
import { boardOf } from '@dicewars/core/test-support';

/**
 * A replay wired to a game the way the session wires one: an attack recorded
 * once it has actually resolved rather than the moment it is declared.
 */
function recordedReplay(game) {
  const replay = createReplay({
    nodes: game.state.nodes,
    reserves: new Map([...game.state.players].map(([id, player]) => [id, player.reserve])),
  });
  let declared = null;
  game.on('attack', ({ event }) => {
    declared = event;
  });
  game.on('resolved', () => replay.record(declared));
  game.on('eliminated', (event) => replay.recordElimination(event));
  game.on('reinforce', (event) => replay.recordReinforcement(event));
  return replay;
}

/** Runs the clock forward in small steps, as the render loop would. */
function advance(game, seconds, step = 1 / 60) {
  for (let t = 0; t < seconds; t += step) game.tick(step);
}

/** Dice that fall the same way twice, so a match plays out reproducibly. */
function seededRoll(seed) {
  const rng = seededRng(seed);
  return () => 1 + Math.floor(rng() * 6);
}

/** localStorage, near enough: string in, string out, and it can be broken. */
function fakeStorage({ failing = false } = {}) {
  const items = new Map();
  return {
    items,
    getItem(key) {
      if (failing) throw new Error('the browser refuses to store anything');
      return items.get(key) ?? null;
    },
    setItem(key, value) {
      if (failing) throw new Error('out of quota');
      items.set(key, String(value));
    },
    removeItem(key) {
      if (failing) throw new Error('nope');
      items.delete(key);
    },
  };
}

const settings = normalizeSettings({ players: 3 });
const playerIds = ['p1', 'p2', 'p3'];

const worldOf = (seed) =>
  generatePlanetWorld({ subdivisions: 2, playerIds, rng: seededRng(seed) });

const saveOf = (seed, over = {}) => {
  const world = worldOf(seed);
  return gameSave({
    seed,
    settings,
    humanPlayerId: 'p2',
    world,
    state: serializeState(createInitialState(world)),
    replay: serializeReplay(createReplay()),
    ...over,
  });
};

const stored = (save) => {
  const storage = fakeStorage();
  writeSavedGame(storage, save);
  return storage;
};

test('a game written down comes back the same game', () => {
  const save = saveOf(11);
  const read = readSavedGame(stored(save));

  assert.equal(read.seed, save.seed);
  assert.equal(read.humanPlayerId, 'p2');
  assert.deepEqual(read.state, save.state);
});

test('a match saved on Hard is resumed on Hard', () => {
  // A save carries its whole setup, and `readSavedGame` normalizes it on the
  // way back out — so a difficulty the normalizer did not recognise would
  // quietly downgrade the opponent halfway through a game rather than fail
  // anywhere visible.
  const save = saveOf(11, { settings: normalizeSettings({ players: 3, difficulty: 'hard' }) });
  assert.equal(readSavedGame(stored(save)).settings.difficulty, 'hard');
});

test('there is nothing to continue when nothing was ever saved', () => {
  assert.equal(readSavedGame(fakeStorage()), null);
});

test('a finished game is kept, because its replay is still worth coming back to', () => {
  // it used to be dropped on the grounds that there was nothing left to play.
  // The replay travels in the save now, and a match played out is the one most
  // worth watching — so a reload lands back on the ending rather than dealing
  // a fresh planet over it.
  const save = saveOf(11);
  save.state.phase = 'gameover';
  save.state.winner = 'p1';

  const read = readSavedGame(stored(save));
  assert.equal(read.state.phase, 'gameover');
  assert.equal(read.state.winner, 'p1');
});

test('a save from an older version of the game is discarded, not half-read', () => {
  const save = { ...saveOf(11), version: SAVE_VERSION - 1 };
  assert.equal(readSavedGame(stored(save)), null);
});

test('a save missing the pieces a game cannot be rebuilt without is refused', () => {
  for (const broken of [
    { seed: undefined },
    { seed: 'not a number' },
    { humanPlayerId: undefined },
    { world: undefined },
    { state: undefined },
    { state: { phase: 'attack' } }, // a state, but with no board in it
    { replay: undefined }, // no record of how the board got that way
    { replay: { nodes: [], reserves: [] } }, // half a replay is not a replay
  ]) {
    assert.equal(readSavedGame(stored({ ...saveOf(11), ...broken })), null, JSON.stringify(broken));
  }
});

test('a storage entry that is not a saved game at all is shrugged off', () => {
  const storage = fakeStorage();
  storage.items.set('dicewars-planets:game', '{ half a jso');

  assert.equal(readSavedGame(storage), null);
});

test('a browser that refuses to store anything is not a reason to fail', () => {
  // private browsing throws on the way in *and* on the way out
  const storage = fakeStorage({ failing: true });

  assert.equal(writeSavedGame(storage, saveOf(11)), false);
  assert.equal(readSavedGame(storage), null);
  assert.equal(clearSavedGame(storage), false);
});

test('settings come back normalized, so nothing downstream re-parses them', () => {
  // a save written when the table could be bigger than it can be now
  const save = { ...saveOf(11), settings: { players: 99, start: 'any', size: 2, moon: true } };
  const read = readSavedGame(stored(save));

  assert.deepEqual(read.settings, normalizeSettings(save.settings));
  assert.notEqual(read.settings.players, 99);
});

test('clearing means the next visit gets the menu, not the game before it', () => {
  const storage = stored(saveOf(11));
  clearSavedGame(storage);
  assert.equal(readSavedGame(storage), null);
});

// --- the camera the player left the planet at ---------------------------------

test('the camera is exactly where a save leaves it, angle, pitch and zoom alike', () => {
  const camera = cameraSnapshot({ position: { x: 1, y: 2.5, z: -3 } });
  const save = saveOf(11, { camera });
  const read = readSavedGame(stored(save));

  assert.deepEqual(read.camera, { x: 1, y: 2.5, z: -3 });
});

test('an old save with no camera in it is still a save worth continuing', () => {
  // camera wasn't always part of the save shape — reading one written before
  // it was must not refuse the whole game over one missing field
  const read = readSavedGame(stored(saveOf(11)));
  assert.equal(read.camera, undefined);
});

test('a camera is only usable once its numbers actually are', () => {
  assert.equal(isUsableCamera({ x: 1, y: 2, z: 3 }), true);
  assert.equal(isUsableCamera(undefined), false);
  assert.equal(isUsableCamera({ x: 1, y: 2 }), false, 'z is missing');
  assert.equal(isUsableCamera({ x: 1, y: NaN, z: 3 }), false, 'a hand-edited save broke a number');
});

// --- laying a save back onto a planet ----------------------------------------

test('the same seed grows the same planet, which is what a save is betting on', () => {
  const a = worldOf(2024);
  const b = worldOf(2024);

  assert.deepEqual(a.nodeIds, b.nodeIds);
  assert.deepEqual(a.assignments, b.assignments, 'down to who was dealt what');
  assert.deepEqual(a.cells, b.cells, 'and every cell of the geometry');
});

test('a save belongs on the world its own seed grew', () => {
  assert.equal(saveMatchesWorld(saveOf(11), worldOf(11)), true);
});

test('a fingerprint is the same number for the same planet, every time', () => {
  assert.equal(worldFingerprint(worldOf(7)), worldFingerprint(worldOf(7)));
});

test('a save is refused by a planet that is not the one it was played on', () => {
  // this is the failure the seed trade has to survive: change the generator,
  // and the seed that grew this board grows something else entirely
  assert.equal(saveMatchesWorld(saveOf(11), worldOf(12)), false);
});

test('two planets are told apart by their shape, not by counting territories', () => {
  // territory ids are positions in a list, so any two planets with the same
  // number of territories agree on every id — that is the check this replaces
  const [a, b] = [worldOf(11), worldOf(12)];
  const sameShape = { ...a, edges: b.edges };

  assert.deepEqual(a.nodeIds, sameShape.nodeIds, 'same ids, right down the list');
  assert.notEqual(
    worldFingerprint(a),
    worldFingerprint(sameShape),
    'and still a different planet, because different territories touch'
  );
});

test('a planet redrawn under the same territory graph is a different planet', () => {
  // the land each territory is made of can change without the graph moving at
  // all, and a board laid over the wrong cells is drawn on the wrong ground
  const world = worldOf(11);
  const redrawn = { ...world, cellTerritory: new Map([...world.cellTerritory].reverse()) };

  assert.notEqual(worldFingerprint(world), worldFingerprint(redrawn));
});

test('a save is refused when it is short of the territories the planet has', () => {
  const world = worldOf(11);
  const save = gameSave({
    ...saveOf(11),
    world: { ...world, nodeIds: world.nodeIds.slice(0, -1) },
  });

  assert.equal(saveMatchesWorld(save, world), false);
});

test('a save is refused when it seats players this game does not have', () => {
  const world = worldOf(11);

  assert.equal(saveMatchesWorld({ ...saveOf(11), humanPlayerId: 'p9' }, world), false);

  const fourHanded = saveOf(11);
  fourHanded.state.turnOrder = ['p1', 'p2', 'p3', 'p4'];
  assert.equal(saveMatchesWorld(fourHanded, world), false);
});

// --- the whole round trip -----------------------------------------------------

test('a game played, saved and picked up again is the same game', () => {
  // the promise the whole feature rests on, end to end: a match is played out
  // for a while, written down, and rebuilt from nothing but what was written
  const seed = 4242;
  const world = worldOf(seed);
  const game = createGame({ world, humanPlayerId: 'p2', rollDie: seededRoll(9) });
  const replay = recordedReplay(game);

  for (let i = 0; i < 40; i++) advance(game, 1);

  const save = gameSave({
    seed,
    settings,
    humanPlayerId: game.humanPlayerId,
    world,
    state: serializeState(game.state),
    replay: serializeReplay(replay),
  });

  const read = readSavedGame(stored(save));
  const rebuilt = worldOf(read.seed);
  assert.ok(saveMatchesWorld(read, rebuilt), 'the planet grows back from its seed');

  const resumed = createGame({
    world: rebuilt,
    humanPlayerId: read.humanPlayerId,
    savedState: reviveState(read.state),
  });

  assert.deepEqual(boardOf(resumed.state), boardOf(game.state), 'every owner and every die');
  assert.equal(resumed.currentPlayer(), game.currentPlayer(), 'and whose turn it is');
  assert.deepEqual(
    [...resumed.state.players].map(([id, p]) => [id, p.reserve]),
    [...game.state.players].map(([id, p]) => [id, p.reserve]),
    'banked dice included'
  );

  // and the record of how it got there, which is the other half of what a
  // save is for now — the same match arrives with its replay intact, and that
  // replay still walks forward onto the very board that was just restored
  const replayed = reviveReplay(read.replay);
  assert.deepEqual(replayed.moves, replay.moves, 'every move, down to the faces rolled');
  // every move, not every attack: a step of the replay is a fight, so the
  // payout this match happened to stop just after belongs to no step at all
  assert.deepEqual(
    boardOf({ nodes: replayed.boardAt(Infinity) }),
    boardOf(game.state),
    'and replaying them lands on the board the save was taken from'
  );
});

test('a game rebuilt from a save is played on, not merely looked at', () => {
  // a board that revives but cannot be advanced would pass every check above
  // and still be a museum piece
  const world = worldOf(77);
  const game = createGame({ world, humanPlayerId: AUTOPLAY, rollDie: seededRoll(5) });
  game.start();
  for (let i = 0; i < 20; i++) advance(game, 1);
  const saved = serializeState(game.state);

  const resumed = createGame({
    world,
    humanPlayerId: AUTOPLAY,
    savedState: reviveState(saved),
    rollDie: seededRoll(6),
  });
  resumed.start();
  for (let i = 0; i < 60; i++) advance(resumed, 1);

  assert.notDeepEqual(boardOf(resumed.state), boardOf(reviveState(saved)), 'the game moved on');
  assert.equal(resumed.state.nodes.size, world.nodeIds.length, 'on the same planet it resumed on');
});
