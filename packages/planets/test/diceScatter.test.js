import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scatterDice, scatterSlots } from '../src/render/diceScatter.js';
import { seededRng } from '@dicewars/core/test-support';

const DIE = 0.035;

// Two dice that landed flat are both axis-aligned squares of one die width,
// so they are clear of each other the moment they are a full die apart in
// either axis on their own.
const overlap = (a, b, dieSize = DIE) =>
  Math.abs(a.x - b.x) < dieSize - 1e-12 && Math.abs(a.z - b.z) < dieSize - 1e-12;

function eachPair(dice, visit) {
  for (let i = 0; i < dice.length; i++) {
    for (let j = i + 1; j < dice.length; j++) visit(dice[i], dice[j], i, j);
  }
}

// How far the outermost corner of any die reaches from the middle.
const reach = (dice, dieSize = DIE) =>
  Math.max(...dice.map((d) => Math.hypot(Math.abs(d.x) + dieSize / 2, Math.abs(d.z) + dieSize / 2)));

test('no two dice ever land on top of each other, however tight the ground', () => {
  // right down to a radius with no room at all, which is what a one-cell
  // territory hemmed in on every side comes to
  for (const radius of [0, 0.02, 0.04, 0.08, 0.2, Infinity]) {
    for (let count = 1; count <= 8; count++) {
      for (let seed = 1; seed <= 20; seed++) {
        const dice = scatterDice(count, { dieSize: DIE, radius, rng: seededRng(seed) });
        assert.equal(dice.length, count);
        eachPair(dice, (a, b, i, j) => {
          assert.ok(!overlap(a, b), `${count} dice on radius ${radius}: ${i} and ${j} overlap`);
        });
      }
    }
  }
});

test('the dice stay on the territory when the territory has room for them', () => {
  const radius = 0.12; // a roomy territory, the kind most attacks happen on
  for (let count = 1; count <= 8; count++) {
    for (let seed = 1; seed <= 20; seed++) {
      const dice = scatterDice(count, { dieSize: DIE, radius, rng: seededRng(seed) });
      assert.ok(
        reach(dice) <= radius + 1e-12,
        `${count} dice reached ${reach(dice).toFixed(4)} of ${radius}`
      );
    }
  }
});

test('a cramped territory packs the dice in rather than spilling them over the border', () => {
  const roomy = scatterDice(6, { dieSize: DIE, radius: 0.2, rng: seededRng(3) });
  const cramped = scatterDice(6, { dieSize: DIE, radius: 0.06, rng: seededRng(3) });

  assert.ok(reach(cramped) < reach(roomy), 'the pile draws in when the ground is tight');
  // and it stops drawing in once the dice are touching: past that point there
  // is nothing left to give, so the pile overhangs instead of the dice
  // landing inside one another
  const impossible = scatterDice(8, { dieSize: DIE, radius: 0.01, rng: seededRng(3) });
  eachPair(impossible, (a, b) => assert.ok(!overlap(a, b)));
  assert.ok(reach(impossible) > 0.01, 'eight dice cannot fit on a territory that small');
});

test('the dice are thrown around the middle of the territory, not off to one side', () => {
  for (let count = 1; count <= 8; count++) {
    const dice = scatterDice(count, { dieSize: DIE, radius: 0.2, rng: seededRng(count) });
    const middle = dice.reduce(
      (sum, d) => ({ x: sum.x + d.x / count, z: sum.z + d.z / count }),
      { x: 0, z: 0 }
    );
    assert.ok(
      Math.hypot(middle.x, middle.z) < DIE / 2,
      `${count} dice sit ${Math.hypot(middle.x, middle.z).toFixed(4)} off center`
    );
  }
});

test('every die lands flat on the ground, not hovering over it or sunk into it', () => {
  const dice = scatterDice(8, { dieSize: DIE, radius: 0.15, rng: seededRng(2) });
  for (const die of dice) assert.equal(die.y, DIE / 2);
});

test('the same stack does not drop into the same places twice', () => {
  const first = scatterDice(5, { dieSize: DIE, radius: 0.15, rng: seededRng(1) });
  const again = scatterDice(5, { dieSize: DIE, radius: 0.15, rng: seededRng(2) });

  const moved = first.filter((d, i) => Math.hypot(d.x - again[i].x, d.z - again[i].z) > 1e-9);
  assert.ok(moved.length >= 4, 'a second throw should scatter differently');
});

test('a throw is a function of its generator, so a replay lands the dice identically', () => {
  const a = scatterDice(6, { dieSize: DIE, radius: 0.1, rng: seededRng(7) });
  const b = scatterDice(6, { dieSize: DIE, radius: 0.1, rng: seededRng(7) });
  assert.deepEqual(a, b);
});

test('the slots are laid out as a rounded pile, not a line or a lopsided clump', () => {
  // eight in a row would be as far across as the territory is wide; the
  // lattice should keep the pile within about a die and a half of its middle
  for (let count = 1; count <= 8; count++) {
    const slots = scatterSlots(count);
    const spread = Math.max(...slots.map((s) => Math.hypot(s.x, s.z)));
    assert.ok(spread <= 1.6, `${count} dice spread to ${spread.toFixed(2)} pitches`);
  }
});
