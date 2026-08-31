import { test } from 'node:test';
import assert from 'node:assert/strict';
import { areAdjacent, seededRng } from '@dicewars/core';
import { createGame, AUTOPLAY } from '../src/game/createGame.js';
import { bridgePatch, gateView, orbitAt, orbitSchedule, ORBIT_STOPS } from '../src/game/orbit.js';
import { generateSystem } from '../src/world/generateSystem.js';
import { chooseSpaceports } from '../src/world/spaceports.js';
import { angleBetween } from '../src/geometry/vec3.js';

// The orbit is a published timetable rather than a simulation, and nearly
// everything here is about that: a player has to be able to say when their
// window is without watching anything move.

const orbit = { ports: ['A', 'B'], dockOrder: ['m0', 'm1', 'm2', 'm3', 'm4', 'm5'] };

test('the gate is open half the rounds, and never the same end twice running', () => {
  const opens = Array.from({ length: 8 }, (_, round) => orbitAt(orbit, round).port);
  assert.deepEqual(opens, ['A', null, 'B', null, 'A', null, 'B', null]);
});

test('the dock steps along the band every stop, open or shut', () => {
  // The moon spins whether or not there is anything under it, which is what
  // stops one player holding a permanent door into the moon.
  const docks = Array.from({ length: 7 }, (_, round) => orbitAt(orbit, round).dock);
  assert.deepEqual(docks, ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm0']);
});

test('six docks against four stops means the pairing takes twelve to repeat', () => {
  // Long enough not to read as a metronome, and still perfectly predictable —
  // which is the whole reason the dial can show the future.
  const pairing = (round) => {
    const at = orbitAt(orbit, round);
    return `${at.port}:${at.dock}`;
  };
  assert.equal(pairing(12), pairing(0));
  for (let round = 1; round < 12; round++) {
    assert.notEqual(pairing(round), pairing(0), `round ${round} should not repeat the opening`);
  }
});

test('the schedule reads forwards from wherever the match is', () => {
  const ahead = orbitSchedule(orbit, 5, 4);
  assert.deepEqual(
    ahead.map((at) => at.round),
    [5, 6, 7, 8]
  );
  assert.deepEqual(
    ahead.map((at) => at.open),
    [false, true, false, true]
  );
});

test('a shut gate says how long until the next one', () => {
  assert.equal(gateView(orbit, 0).roundsToOpen, 0, 'it is open now');
  assert.equal(gateView(orbit, 1).roundsToOpen, 1);
  assert.equal(gateView(orbit, 1).nextPort, 'B', 'and which door the next one is');
});

// --- the patch that actually moves it ---------------------------------------

const moonNeighbors = new Map([
  ['m0', ['m1', 'm5']],
  ['m1', ['m0', 'm2']],
  ['m2', ['m1', 'm3']],
  ['m3', ['m2', 'm4']],
  ['m4', ['m3', 'm5']],
  ['m5', ['m4', 'm0']],
]);

test('moving the gate restates only the moon end of it', () => {
  // `setNeighbors` keeps the reverse edge in step by itself, so writing the
  // dock's neighbours puts the bridge on the port too. Restating the port as
  // well would mean this knowing the port's own planetary neighbours, which
  // is not its business.
  const patch = bridgePatch(orbit, 2, moonNeighbors);
  assert.deepEqual(
    patch.map(([id]) => id).sort(),
    ['m1', 'm2'],
    'the dock it is leaving and the one it is arriving at, and nothing else'
  );
});

test('the territory the gate has left keeps only its own neighbours', () => {
  const patch = new Map(bridgePatch(orbit, 2, moonNeighbors));
  assert.deepEqual(patch.get('m1'), ['m0', 'm2'], 'no port left hanging off it');
  assert.deepEqual(patch.get('m2'), ['m1', 'm3', 'B'], 'and the new dock has one');
});

test('a stop over open space takes the bridge away and puts none back', () => {
  const patch = new Map(bridgePatch(orbit, 1, moonNeighbors));
  for (const [, neighborIds] of patch) {
    assert.equal(
      neighborIds.some((id) => id === 'A' || id === 'B'),
      false,
      'nothing on the moon touches the planet while it is over space'
    );
  }
});

// --- the spaceports ---------------------------------------------------------

test('the two spaceports sit on opposite sides of the planet', () => {
  const world = generateSystem({
    subdivisions: 3,
    playerIds: ['p1', 'p2', 'p3'],
    rng: seededRng(4),
    moon: true,
  });
  const cellsById = new Map(world.cells.map((c) => [c.id, c]));
  const centerOf = (id) => {
    const t = world.territories.find((x) => x.id === id);
    const sum = t.cellIds
      .map((c) => cellsById.get(c).center)
      .reduce((a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }));
    return sum;
  };

  const [a, b] = world.spaceports;
  assert.notEqual(a, b);
  const apart = angleBetween(centerOf(a), centerOf(b));
  assert.ok(apart > Math.PI * 0.6, `ports are ${((apart * 180) / Math.PI).toFixed(0)}° apart`);
});

test('asking for more ports than there are territories stops rather than repeating one', () => {
  const cells = [
    { id: 0, center: { x: 1, y: 0, z: 0 } },
    { id: 1, center: { x: -1, y: 0, z: 0 } },
  ];
  const ports = chooseSpaceports(
    [
      { id: 0, cellIds: [0] },
      { id: 1, cellIds: [1] },
    ],
    new Map(cells.map((c) => [c.id, c])),
    () => 0,
    4
  );
  assert.equal(new Set(ports).size, ports.length, 'no territory is a port twice');
  assert.equal(ports.length, 2);
});

// --- and the whole thing turning over in a real match ------------------------

function moonGame() {
  const playerIds = ['p1', 'p2', 'p3'];
  const world = generateSystem({
    subdivisions: 3,
    playerIds,
    rng: seededRng(9),
    moon: true,
  });
  const game = createGame({
    world,
    humanPlayerId: AUTOPLAY,
    rollDie: (() => {
      const rng = seededRng(5);
      return () => 1 + Math.floor(rng() * 6);
    })(),
    rng: seededRng(6),
  });
  return { world, game, playerIds };
}

test('a match opens with the gate already open at the first port', () => {
  const { world, game } = moonGame();
  const opening = orbitAt(world.orbit, 0);

  assert.equal(game.round, 0);
  assert.equal(game.gate.port, world.spaceports[0]);
  assert.ok(
    areAdjacent(game.state.graph, opening.port, opening.dock),
    'the bridge is in the board as dealt, not added a turn later'
  );
});

test('the moon moves on when the round turns over, not when a turn does', () => {
  const { game, playerIds } = moonGame();
  const seen = [];
  game.on('orbit', (event) => seen.push(event.round));

  game.start();
  // three players, so three turns make a round
  for (let i = 0; i < 3; i++) {
    game.endTurn?.();
    game.tick(1e6);
    game.tick(1e6);
  }

  assert.ok(game.round <= 1, `the round moved at most once over ${playerIds.length} turns`);
});

test('the bridge follows the schedule, round after round', () => {
  const { world, game } = moonGame();
  game.start();

  const before = orbitAt(world.orbit, 0);
  assert.ok(areAdjacent(game.state.graph, before.port, before.dock));

  // run the unattended match until the round has turned over twice
  for (let i = 0; i < 4000 && game.round < 2 && !game.isOver(); i++) game.tick(1e6);
  if (game.isOver()) return; // a very short match; nothing left to check
  // The round turns over inside `finishTurn`, but the board it rewired is
  // held back with the payout it arrived with — so the rewiring is on screen
  // one tick after the counter says it happened.
  game.tick(1e6);

  const now = orbitAt(world.orbit, game.round);
  assert.equal(
    areAdjacent(game.state.graph, before.port, before.dock),
    false,
    'the old bridge is gone'
  );
  if (now.open) {
    assert.ok(areAdjacent(game.state.graph, now.port, now.dock), 'and the new one is there');
  }
});

test('a world with no moon has no orbit and never counts a round', () => {
  const world = generateSystem({
    subdivisions: 3,
    playerIds: ['p1', 'p2'],
    rng: seededRng(3),
  });
  const game = createGame({ world, humanPlayerId: AUTOPLAY, rng: seededRng(1) });

  assert.equal(world.orbit, undefined, 'a planet on its own is exactly what it always was');
  assert.equal(game.gate, null);

  game.start();
  for (let i = 0; i < 500 && !game.isOver(); i++) game.tick(1e6);
  assert.equal(game.round, 0, 'nothing ever moved it');
});

test('the stop count has to be twice the port count for every port to get a turn', () => {
  // Stated as a test because it is the one relationship in the schedule that
  // is a constraint rather than a preference: an odd stop is a stop over
  // space, so half the stops are doors and each port needs one of them.
  assert.equal(ORBIT_STOPS, 4);
  const ports = new Set(
    Array.from({ length: ORBIT_STOPS }, (_, round) => orbitAt(orbit, round).port).filter(Boolean)
  );
  assert.equal(ports.size, orbit.ports.length);
});
