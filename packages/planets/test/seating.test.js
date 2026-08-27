import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DICE_PER_NODE } from '@dicewars/core';
import { seededRng } from '@dicewars/core/test-support';
import {
  dealSeats,
  diceRampFor,
  scatterExtraDice,
  seatExtraDice,
  seatTerritoryCounts,
  SEAT_DICE_RAMP,
  SEAT_LAND_STEP,
} from '../src/world/seating.js';
import { generatePlanetWorld } from '../src/world/generateWorld.js';
import { MAX_PLAYERS, MIN_PLAYERS } from '../src/game/settings.js';

// What each seat was dealt, as [territories, dice] indexed by seat.
function dealtBySeat(world, playerIds) {
  const seatOf = new Map(playerIds.map((id, seat) => [id, seat]));
  const territories = playerIds.map(() => 0);
  const dice = playerIds.map(() => 0);
  for (const [, node] of world.assignments) {
    const seat = seatOf.get(node.owner);
    territories[seat]++;
    dice[seat] += node.dice;
  }
  return { territories, dice };
}

function averageDeal(playerIds, { games = 300, levelSeats = true } = {}) {
  const territories = playerIds.map(() => 0);
  const dice = playerIds.map(() => 0);
  for (let game = 0; game < games; game++) {
    const world = generatePlanetWorld({
      subdivisions: 3, playerIds, rng: seededRng(game * 977 + 1), levelSeats,
    });
    const dealt = dealtBySeat(world, playerIds);
    dealt.territories.forEach((n, seat) => { territories[seat] += n / games; });
    dealt.dice.forEach((n, seat) => { dice[seat] += n / games; });
  }
  return { territories, dice };
}

const idsFor = (count) => Array.from({ length: count }, (_, i) => `p${i + 1}`);

test('every territory is dealt to exactly one seat, whatever the rounding', () => {
  for (let players = MIN_PLAYERS; players <= MAX_PLAYERS; players++) {
    for (let territories = players; territories <= 120; territories++) {
      const counts = seatTerritoryCounts(territories, players, seededRng(territories * 31 + players));
      assert.equal(counts.reduce((a, b) => a + b, 0), territories,
        `${players} players, ${territories} territories`);
      for (const n of counts) assert.ok(n >= 1, 'no seat is dealt nothing');
    }
  }
});

test('the last seat is dealt a whole territory more than the first', () => {
  // The step is smaller than the rounding, so it only shows in the average —
  // which is the point of rounding a different set of seats up each planet.
  for (const players of [2, 4, 6, 8]) {
    const { territories } = averageDeal(idsFor(players));
    const step = territories.at(-1) - territories[0];
    assert.ok(Math.abs(step - SEAT_LAND_STEP) < 0.15,
      `${players} players: expected about ${SEAT_LAND_STEP}, got ${step.toFixed(2)}`);

    // and it is a straight line, not a step at one end
    for (let seat = 1; seat < players; seat++) {
      assert.ok(territories[seat] > territories[seat - 1],
        `${players} players: seat ${seat + 1} should hold more ground than seat ${seat}`);
    }
  }
});

test('the land step is spread across the order, not dropped on the last seat', () => {
  // The step is one territory wide and seats take whole ones, so rounding is
  // where this can go wrong: flooring the exact shares and handing out the
  // leftovers puts every seat on one of two integers, and at 57 territories
  // over six seats that means five seats on 9.33 and the last on 10.33 — the
  // whole step as a cliff. Measured, that over-paid the last seat by about 1.2
  // points of win rate while the other five sat flat. Averaged over planets
  // each seat should sit on a straight line instead.
  const players = 6;
  const games = 4000;

  for (const territories of [57, 58, 59, 60]) {
    const mean = Array.from({ length: players }, () => 0);
    const rng = seededRng(territories * 17 + 1);
    for (let game = 0; game < games; game++) {
      seatTerritoryCounts(territories, players, rng).forEach((n, seat) => {
        mean[seat] += n / games;
      });
    }

    for (let seat = 1; seat < players; seat++) {
      const step = mean[seat] - mean[seat - 1];
      // a straight line over `players` seats climbs landStep/(players-1) a seat
      assert.ok(Math.abs(step - SEAT_LAND_STEP / (players - 1)) < 0.06,
        `${territories} territories: seat ${seat + 1} rose ${step.toFixed(3)} over seat ${seat}`);
    }
  }
});

test('no seat is systematically shorted by the deal remainder', () => {
  // The bug this replaced: `playerIds[i % playerIds.length]` handed the
  // leftovers to the earliest seats every single game, which was worth about a
  // fifth of the whole seat advantage. With the land step switched off, the
  // deal should be even to within a rounding of the average.
  const players = 6;
  const counts = idsFor(players).map(() => 0);
  const games = 600;
  for (let game = 0; game < games; game++) {
    const seats = seatTerritoryCounts(59, players, seededRng(game * 613 + 5), 0);
    seats.forEach((n, seat) => { counts[seat] += n / games; });
  }
  const spread = Math.max(...counts) - Math.min(...counts);
  assert.ok(spread < 0.15, `expected an even deal, got a spread of ${spread.toFixed(2)}`);
});

test('the old round-robin deal is what this fixes', () => {
  // Guards the claim rather than the code: the deal the game used to make
  // really did short the later seats, so the fix above is not fixing nothing.
  const playerIds = idsFor(6);
  const { territories } = averageDeal(playerIds, { levelSeats: false });
  assert.ok(territories[0] > territories.at(-1) + 0.5,
    `expected the old deal to favour seat 1, got ${territories.map((n) => n.toFixed(2)).join(' ')}`);
});

test('the dice ramp rises with the seat and is worth what it says', () => {
  const players = 6;
  const territories = 59;
  const extra = seatExtraDice(territories, players);

  assert.equal(extra[0], 0, 'the first seat is the baseline and gets nothing');
  for (let seat = 1; seat < players; seat++) {
    assert.ok(extra[seat] > extra[seat - 1], `seat ${seat + 1} should get more than seat ${seat}`);
  }
  // the last seat's ramp is the tabulated rate times a seat's worth of ground
  assert.ok(Math.abs(extra.at(-1) - SEAT_DICE_RAMP[players] * (territories / players)) < 1e-9);
});

test('a fractional ramp is paid as a whole die some of the time', () => {
  // Whole-number ramps force ties between adjacent seats, and the earlier of a
  // tied pair keeps its tempo edge — so the fraction has to survive somewhere.
  const playerIds = ['p1', 'p2'];
  const rng = seededRng(11);
  let given = 0;
  const runs = 400;

  for (let run = 0; run < runs; run++) {
    const assignments = [['a', { owner: 'p2', dice: 1 }], ['b', { owner: 'p2', dice: 1 }]];
    scatterExtraDice(assignments, playerIds, [0, 0.25], rng);
    given += assignments.reduce((sum, [, node]) => sum + node.dice, 0) - 2;
  }
  const mean = given / runs;
  assert.ok(Math.abs(mean - 0.25) < 0.06, `expected about 0.25 dice a run, got ${mean.toFixed(3)}`);
});

test('scattered dice spread out and stop at the cap', () => {
  const playerIds = ['p1'];
  const assignments = Array.from({ length: 4 }, (_, i) => [`t${i}`, { owner: 'p1', dice: 1 }]);

  // more dice than there is room for: 4 territories can hold 4 * 8 = 32
  scatterExtraDice(assignments, playerIds, [100], seededRng(3));

  for (const [, node] of assignments) {
    assert.equal(node.dice, MAX_DICE_PER_NODE, 'every territory fills before any overflows');
  }
});

test('the ramp is scattered rather than piled onto one territory', () => {
  const playerIds = ['p1'];
  const assignments = Array.from({ length: 10 }, (_, i) => [`t${i}`, { owner: 'p1', dice: 1 }]);
  scatterExtraDice(assignments, playerIds, [6], seededRng(19));

  const touched = assignments.filter(([, node]) => node.dice > 1).length;
  assert.ok(touched >= 4, `expected the six dice to spread, only ${touched} territories grew`);
});

test('a seat is only ever dealt whole territories, interleaved', () => {
  const seats = dealSeats([3, 2, 1]);
  assert.equal(seats.length, 6);
  assert.deepEqual(seats.filter((s) => s === 0).length, 3);
  assert.deepEqual(seats.filter((s) => s === 1).length, 2);
  assert.deepEqual(seats.filter((s) => s === 2).length, 1);
  // interleaved, so one seat does not take a contiguous run of the deal order
  assert.deepEqual(seats, [0, 1, 2, 0, 1, 0]);
});

test('every table size the menu offers has a measured dice rate', () => {
  for (let players = MIN_PLAYERS; players <= MAX_PLAYERS; players++) {
    assert.ok(SEAT_DICE_RAMP[players] > 0, `${players} players has no rate`);
  }
  // and the closed form stands in for anything outside that range
  assert.ok(diceRampFor(12) > 0.2 && diceRampFor(12) < 0.3);
});

test('a levelled planet still feeds straight into core', () => {
  const playerIds = idsFor(6);
  const world = generatePlanetWorld({ subdivisions: 3, playerIds, rng: seededRng(4) });

  assert.equal(world.assignments.length, world.territories.length);
  const owners = new Set(world.assignments.map(([, node]) => node.owner));
  assert.equal(owners.size, playerIds.length, 'every seat got ground');

  for (const [, node] of world.assignments) {
    assert.ok(node.dice >= 1 && node.dice <= MAX_DICE_PER_NODE);
  }
});
