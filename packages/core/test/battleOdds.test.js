import { test } from 'node:test';
import assert from 'node:assert/strict';
import { winProbability, MAX_DICE_PER_NODE } from '../src/index.js';

const sizes = Array.from({ length: MAX_DICE_PER_NODE }, (_, i) => i + 1);
const close = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 1e-12, `${message}: got ${actual}, wanted ${expected}`);

// Every tuple of `count` dice, by total. Deliberately the slow way — this is
// the independent answer the fast one is checked against, so it shares nothing
// with it beyond the rules of the game.
function everyRoll(count, each, sum = 0) {
  if (count === 0) return each(sum);
  for (let face = 1; face <= 6; face++) everyRoll(count - 1, each, sum + face);
}

function countedOut(attackerDice, defenderDice) {
  let wins = 0;
  let rolls = 0;
  everyRoll(attackerDice, (attack) => {
    everyRoll(defenderDice, (defend) => {
      rolls++;
      if (attack > defend) wins++;
    });
  });
  return wins / rolls;
}

test('the table agrees with counting every possible pair of rolls', () => {
  // only the small ones — 3 against 3 is already 46,656 outcomes, and the
  // point is to check the method, not to re-enumerate the whole table
  for (let attack = 1; attack <= 3; attack++) {
    for (let defend = 1; defend <= 3; defend++) {
      close(
        winProbability(attack, defend),
        countedOut(attack, defend),
        `${attack} against ${defend}`
      );
    }
  }
});

test('a single die against a single die is the 15 ways out of 36', () => {
  close(winProbability(1, 1), 15 / 36, 'six faces beaten by six faces');
});

test('an even fight is never even, because the defender takes the ties', () => {
  for (const dice of sizes) {
    assert.ok(
      winProbability(dice, dice) < 0.5,
      `${dice} against ${dice} came out at ${winProbability(dice, dice)}`
    );
  }
  // and the ties are worth less as the stacks grow, since two large sums are
  // less likely to land on the same number
  for (let dice = 2; dice <= MAX_DICE_PER_NODE; dice++) {
    assert.ok(
      winProbability(dice, dice) > winProbability(dice - 1, dice - 1),
      `${dice} even is closer to a coin flip than ${dice - 1} even`
    );
  }
});

test('the three ways a battle can go account for all of it', () => {
  // attacker ahead, defender ahead, or level. The table is one side of that,
  // so the two sides together are everything except the ties — and the ties
  // are most likely of all between two single dice, where they are one throw
  // in six.
  for (const attack of sizes) {
    for (const defend of sizes) {
      const decided = winProbability(attack, defend) + winProbability(defend, attack);
      assert.ok(decided <= 1 + 1e-12, `${attack} v ${defend} came to more than certainty`);
      assert.ok(decided >= 5 / 6, `${attack} v ${defend} left more unaccounted for than 1 v 1 does`);
    }
  }
  close(winProbability(1, 1) * 2, 5 / 6, 'a tie between single dice is one throw in six');
});

test('more dice never hurt the attacker and never help them defend', () => {
  // Never *strictly* better, because the table saturates: seven dice cannot
  // total less than seven and one die cannot total more than six, so seven
  // against one is already certain and an eighth die has nothing left to buy.
  // Everywhere short of certain, though, another die has to be worth
  // something — and "certain" here means exactly 1, which is a claim about
  // how the table is built as much as about the dice.
  for (const defend of sizes) {
    for (let attack = 2; attack <= MAX_DICE_PER_NODE; attack++) {
      const better = winProbability(attack, defend);
      const worse = winProbability(attack - 1, defend);
      assert.ok(better >= worse, `${attack} against ${defend} lost ground on ${attack - 1}`);
      if (worse < 1) assert.ok(better > worse, `${attack} against ${defend} bought nothing`);
    }
  }
  for (const attack of sizes) {
    for (let defend = 2; defend <= MAX_DICE_PER_NODE; defend++) {
      const harder = winProbability(attack, defend);
      const easier = winProbability(attack, defend - 1);
      assert.ok(harder <= easier, `${attack} against ${defend} was easier than against ${defend - 1}`);
      if (easier > 0) assert.ok(harder < easier, `defending with ${defend} bought nothing`);
    }
  }
});

test('"one die up" is not one number, which is the reason this exists', () => {
  // the whole case against ranking attacks by dice difference: the same
  // advantage is worth 17 points more at the bottom of the range than the top
  const twoOnOne = winProbability(2, 1);
  const eightOnSeven = winProbability(8, 7);
  assert.ok(twoOnOne > 0.83 && twoOnOne < 0.84, `two against one was ${twoOnOne}`);
  assert.ok(eightOnSeven > 0.67 && eightOnSeven < 0.68, `eight against seven was ${eightOnSeven}`);
  assert.ok(twoOnOne - eightOnSeven > 0.16, 'and the gap between them is not a rounding error');
});

test('stack sizes the rules cannot produce are clamped rather than refused', () => {
  // a caller reaching for `dice - 1` on a single die, or asking about a stack
  // bigger than the game allows, gets an answer rather than an exception
  assert.equal(winProbability(99, 1), winProbability(MAX_DICE_PER_NODE, 1));
  assert.equal(winProbability(1, 99), winProbability(1, MAX_DICE_PER_NODE));
  assert.equal(winProbability(0, 1), 0, 'nothing to attack with never wins');
  assert.equal(winProbability(1, 0), 1, 'nothing to defend with never holds');
});
