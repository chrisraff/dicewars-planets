import { MAX_DICE_PER_NODE } from '../state.js';

/**
 * How likely an attack is to succeed, exactly, for every stack size the rules
 * allow: `winProbability(attackerDice, defenderDice)`.
 *
 * A battle is two sums of six-sided dice with the attacker needing to come out
 * *strictly* ahead — the defender holds on a tie. Dice advantage on its own is
 * a poor stand-in for that. "One die up" runs from 84% (two against one) down
 * to 67% (eight against seven), and an even fight is never the coin flip it
 * looks like: the ties the defender collects put it at 42% between single dice
 * and 47% between full stacks, so a stack of eight trading with another is a
 * worse bet than it appears and a stack of two bullying a one is a better one.
 *
 * The whole table is 64 numbers over sums of at most 48, so it is computed
 * once when this module loads rather than approximated or sampled.
 */

// How many ways `count` dice can make each total. Whole numbers of ways
// rather than probabilities, all the way through: the largest count in play
// is 6^8 ways against 6^8, which is 2.8e12 and so still an exact integer in a
// double. Dividing once at the very end makes the table exact — a battle that
// cannot be lost comes out as 1 rather than as 1 minus a few ulps, and one
// that cannot be won comes out as 0.
function waysToTotal(count) {
  let ways = [1]; // no dice makes zero, one way
  for (let die = 0; die < count; die++) {
    const next = new Array(ways.length + 6).fill(0);
    for (let total = 0; total < ways.length; total++) {
      if (ways[total] === 0) continue;
      for (let face = 1; face <= 6; face++) next[total + face] += ways[total];
    }
    ways = next;
  }
  return ways;
}

const distributions = Array.from({ length: MAX_DICE_PER_NODE + 1 }, (_, n) => waysToTotal(n));
const outcomes = Array.from({ length: MAX_DICE_PER_NODE + 1 }, (_, n) => 6 ** n);

// table[a][d] — one row per attacking stack, one column per defending stack.
const table = distributions.map((attack, attackDice) => {
  // Ways the attacker makes at least each total, accumulated from the top
  // down, so `beating(t)` is the ways it comes out strictly above t.
  const atLeast = new Array(attack.length + 1).fill(0);
  for (let total = attack.length - 1; total >= 0; total--) {
    atLeast[total] = atLeast[total + 1] + attack[total];
  }
  const beating = (total) => atLeast[total + 1] ?? 0;

  return distributions.map((defend, defendDice) => {
    let wins = 0;
    for (let total = 0; total < defend.length; total++) {
      if (defend[total] > 0) wins += defend[total] * beating(total);
    }
    return wins / (outcomes[attackDice] * outcomes[defendDice]);
  });
});

/**
 * The chance an attack of `attackerDice` beats a defence of `defenderDice`.
 * Both are clamped to the range the rules allow, so a caller does not have to
 * check before asking.
 */
export function winProbability(attackerDice, defenderDice) {
  const a = Math.min(MAX_DICE_PER_NODE, Math.max(0, attackerDice | 0));
  const d = Math.min(MAX_DICE_PER_NODE, Math.max(0, defenderDice | 0));
  return table[a][d];
}
