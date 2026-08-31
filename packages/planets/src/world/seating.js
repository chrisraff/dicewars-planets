import { MAX_DICE_PER_NODE } from '@dicewars/core';

/**
 * Who gets dealt what, and the correction that stops the turn order deciding
 * the match before a die is thrown. Moving first is worth an enormous amount:
 * the advantage follows the *turn order* rather than the deal, so reversing
 * the order over an unchanged board reverses the curve with it.
 *
 * Three things happen here, and only the first is a bug fix.
 *
 * **The remainder.** `playerIds[i % playerIds.length]` shorts the *last* seats
 * every single game — 59 territories over six players is five seats with 10
 * and one with 9, always the same one. Rotating where the deal starts removes
 * it and costs nothing.
 *
 * **One extra territory** for the last seat over the first, straight-lined
 * between. A small dose on purpose: land is the strongest currency going,
 * since reinforcement is an income stream where dice are a lump sum, and it is
 * also the currency a *stronger* player exploits best.
 *
 * **A ramp of scattered dice** for the rest. Dice are the more even-handed
 * currency across difficulties, which is what lets one number serve both, and
 * the ramp is paid fractionally because a whole-die ramp leaves two seats
 * given the same bump still unequal — the earlier of the pair keeps its tempo
 * edge. Scattered rather than piled, for the reason reinforcement scatters.
 *
 * `scripts/seats.js` is the tool all of this was measured with (`--level 1`
 * measures what ships); CLAUDE.md carries the numbers and the alternatives
 * that were tried and rejected.
 */

/**
 * How many extra dice the last seat gets, per territory a seat holds on
 * average. One number per table size, flat from five players up.
 *
 * It climbs at small tables because dice saturate: a duel's gap is three times
 * a six-player gap, and a die stops being worth 0.23 log-odds once ten are
 * being handed over. That saturation is why land is in the mix at all.
 *
 * **Every entry is measured rather than fitted, and the column does not scale
 * as one** — the tail runs hot at large tables and cold at small ones, so
 * trimming it uniformly improved six and eight players and took a duel from
 * 1.9 points of spread to 7.0.
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
 * The share is exact — the last seat's a whole `landStep` above the first's —
 * and then has to be rounded onto whole territories, which is the trap here.
 * The step is only one territory wide, so flooring the shares and handing out
 * the leftovers puts *every* seat on one of two integers: at 57 territories
 * over six seats, five on 9.33 and the last on 10.33, the whole step arriving
 * as a cliff on the tail rather than a ramp across the order.
 *
 * So the rounding carries one random offset along the running total instead.
 * Every seat still gets a whole number, they still add to exactly the planet,
 * and each seat's *expected* share is its exact share — which is what makes
 * the average across planets a straight line.
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
