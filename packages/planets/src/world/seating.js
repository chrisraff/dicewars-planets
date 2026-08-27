import { MAX_DICE_PER_NODE } from '@dicewars/core';

/**
 * Who gets dealt what, and the correction that stops the turn order deciding
 * the match before a die is thrown.
 *
 * Moving first is worth an enormous amount. Measured with every seat played by
 * the same AI — so nothing separates them but where they sit — seat 1 of six
 * won 25.9% of 20,006 games and seat 6 won 10.3%. Head to head it is 91.9%
 * against 8.1%. The advantage follows the *turn order* rather than the deal:
 * reverse the order over an unchanged board and the curve reverses with it.
 *
 * Three things happen here, and only the first is a bug fix.
 *
 * **The remainder.** A round-robin deal of 59 territories to six players gives
 * five of them 10 and one of them 9 — and `playerIds[i % playerIds.length]`
 * always shorts the *last* seats, every single game. Averaged over 20,000
 * planets that was 9.82 territories for seat 1 against 8.98 for seat 6, worth
 * about a fifth of the whole gap. Rotating where the deal starts costs nothing
 * and removes it.
 *
 * **One extra territory.** The last seat is dealt one more than the first,
 * straight-lined across the seats between. Land is the strongest currency
 * available — reinforcement is paid every turn on the largest connected
 * region, so it is an income stream where dice are a lump sum — and land alone
 * can flatten every table size. It is deliberately used in a small dose: a
 * land-only fix needed the last of six seats to open with 11.3 territories
 * against 8.4, an empire visibly half again the size.
 *
 * **A ramp of scattered dice.** The rest of the correction is dice, which is
 * the cheapest currency to hide and the most even-handed one. Per unit it
 * delivers 2.35 to the weaker AI and 2.32 to the stronger; land delivers 2.15
 * and 1.72, because a better player compounds an income advantage. Dice are
 * also the only lever that a whole-number ramp gets wrong — two seats given
 * the same bump stay unequal, since the earlier of the pair keeps its tempo
 * edge — which is why the ramp is paid fractionally.
 *
 * Scattered rather than piled, and scattered rather than used to raise the
 * one-die territories to two. Both alternatives were measured. A per-seat
 * floor costs the same dice and leaves more imbalance behind (2.4 points of
 * spread against 1.6): a single die is defenceless, but it is also cheap to
 * lose, so protecting it buys less than spending the die where it can fight.
 *
 * What is left afterwards, six-handed, is 0.7 points of spread against 15.6 —
 * about 95% of the advantage gone, for one more territory and about 2.3 more
 * dice. A duel goes from 91.9/8.1 to 49.0/51.0. `scripts/seats.js` is the tool
 * all of this was measured with, and `--level 1` measures what ships.
 */

/**
 * How many extra dice the last seat gets, per territory a seat holds on
 * average. One number per table size, and from five players up it is flat.
 *
 * It climbs at small tables because dice saturate. The gap to close in a duel
 * is three times a six-player gap, and a die stops being worth 0.23 log-odds
 * once you are handing over ten of them — by then it is worth about 0.15. Two
 * players need roughly 14 extra dice where eight players need two.
 *
 * Every entry is measured against the Normal AI through the real generator,
 * 30,002 games apiece, and each is the best of the values tried rather than a
 * curve fitted through them — the tail runs slightly hot at large tables and
 * slightly cold at small ones, so a single scaling of the column made six and
 * eight players better while taking a duel from 1.9 points of spread to 7.0.
 *
 * The column leans a little toward Hard on purpose. The two difficulties want
 * different numbers, but the mix has cut the disagreement to 14% — six-handed,
 * Normal is flattest at 0.245 and Hard at 0.28 — where land doing all the work
 * put them 66% apart. That is the other reason most of the correction is dice.
 */
export const SEAT_DICE_RAMP = {
  2: 0.47,
  3: 0.37,
  4: 0.29,
  5: 0.24,
  6: 0.23,
  7: 0.23,
  8: 0.24,
};

/** Territories the last seat is dealt over the first. */
export const SEAT_LAND_STEP = 1;

/**
 * `SEAT_DICE_RAMP` for a table size it does not list — the closed form the
 * measured column follows, within 0.03 everywhere except three players. It is
 * here so a player count outside 2–8 cannot land on nothing rather than
 * because it is better than the table.
 */
export function diceRampFor(players) {
  return SEAT_DICE_RAMP[players] ?? 0.22 + 0.95 / (players * players);
}

/** 0 for the first seat, 1 for the last, straight line between. */
function seatFraction(seat, players) {
  return players < 2 ? 0 : seat / (players - 1);
}

/**
 * How many territories each seat is dealt.
 *
 * The share is exact — the last seat's is a whole `landStep` above the first's
 * — and then has to be rounded onto whole territories, which is where the
 * remainder goes. Those leftovers are handed to a run of seats starting at a
 * random offset, so no seat is systematically the one that comes up short.
 *
 * The rounding matters more than it looks, because the step is only one
 * territory wide and a seat can only be dealt whole ones. Flooring the exact
 * shares and handing out the leftovers puts *every* seat in one of two
 * integers, and which two depends on the planet: at 57 territories over six
 * seats that deals five seats 9.33 and the last one 10.33, so the whole step
 * lands on the tail as a cliff rather than spreading across the order as a
 * ramp. Measured, that over-paid the last seat by about 1.2 points of win rate
 * while seats 1 to 5 sat flat.
 *
 * So the shares are rounded by carrying one random offset along their running
 * total instead. Every seat still gets a whole number, they still add to
 * exactly the planet, and each seat's *expected* share is its exact share —
 * which is what makes the average across planets a straight line rather than
 * a step.
 */
export function seatTerritoryCounts(territories, players, rng, landStep = SEAT_LAND_STEP) {
  const even = territories / players;
  // A seat dealt nothing is a player eliminated before the first move, so on a
  // board too small to carry the step — which nothing currently playable is,
  // but a smaller planet would be — the step gives way rather than the floor
  // of one territory each.
  const step = Math.max(0, Math.min(landStep, 2 * (even - 1)));

  const offset = rng();
  const counts = [];
  let exactSoFar = 0;
  let dealtSoFar = 0;

  for (let seat = 0; seat < players; seat++) {
    exactSoFar += even + step * (seatFraction(seat, players) - 0.5);
    // `exactSoFar` reaches exactly `territories` on the last seat, so the
    // counts always add back up to the planet whatever the offset was
    const throughHere = Math.floor(exactSoFar + offset);
    counts.push(throughHere - dealtSoFar);
    dealtSoFar = throughHere;
  }
  return counts;
}

/**
 * Which seat each position in the deal order belongs to.
 *
 * Interleaved rather than run seat by seat: the deal order is a shuffle, so a
 * contiguous block would not clump a seat's territories together on the
 * planet, but it would hand one seat every territory whose dice were rolled
 * last. Interleaving keeps the two independent.
 */
export function dealSeats(counts) {
  const seats = [];
  const left = counts.slice();
  let placed = true;

  while (placed) {
    placed = false;
    for (let seat = 0; seat < left.length; seat++) {
      if (left[seat] > 0) {
        seats.push(seat);
        left[seat]--;
        placed = true;
      }
    }
  }
  return seats;
}

/**
 * Extra dice per seat — fractional, so a ramp between adjacent seats need not
 * be a whole die wide. `scatterExtraDice` is what turns the fraction into a
 * die some of the time.
 *
 * Priced off the *average* territories per seat rather than each seat's own
 * count, so the ramp does not compound with the land step.
 */
export function seatExtraDice(territories, players, perTerritory = diceRampFor(players)) {
  const last = perTerritory * (territories / players);
  return Array.from({ length: players }, (_, seat) => last * seatFraction(seat, players));
}

/**
 * Pays each seat's ramp out across the territories it was dealt, at random and
 * stopping at the dice cap.
 *
 * Scattered for the same reason end-of-turn reinforcement scatters: eight dice
 * on one territory is an army that can only ever walk in one direction. Mutates
 * the assignment entries in place.
 */
export function scatterExtraDice(assignments, playerIds, extraBySeat, rng) {
  const seatOf = new Map(playerIds.map((id, seat) => [id, seat]));
  const withRoom = playerIds.map(() => []);

  for (const [, node] of assignments) {
    const seat = seatOf.get(node.owner);
    if (seat !== undefined && node.dice < MAX_DICE_PER_NODE) withRoom[seat].push(node);
  }

  playerIds.forEach((_, seat) => {
    const want = extraBySeat[seat] ?? 0;
    let owed = Math.floor(want) + (rng() < want - Math.floor(want) ? 1 : 0);
    const room = withRoom[seat];

    while (owed > 0 && room.length > 0) {
      const pick = Math.min(room.length - 1, Math.floor(rng() * room.length));
      const node = room[pick];
      node.dice++;
      owed--;

      // full now, so it is out of the running — swap-with-last keeps this O(1)
      // and the order of what remains does not matter, since the pick is random
      if (node.dice >= MAX_DICE_PER_NODE) {
        room[pick] = room[room.length - 1];
        room.pop();
      }
    }
  });
  return assignments;
}
