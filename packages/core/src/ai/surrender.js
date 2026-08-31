import { incomeFor, livingPlayerIds } from '../state.js';

/**
 * How far behind a player has to be before they give the game up.
 *
 * Both are ratios against whoever leads that measure: a sixth of the leader's
 * dice, and a sixth of the leader's largest region. Found by playing rather
 * than derived — 700 seeded games across 2 to 8 players on both difficulties,
 * each replayed once per seat to ask whether that seat would have been handed
 * a match it was not going to win.
 *
 * The thing to understand about the ratio is that **tightening it does not
 * stop the game being called, it only calls it later**. Across those games a
 * sixth fires on 694 seats and a quarter on 695 — all but identical — but the
 * sixth waits until 84% of the match has been played rather than 73%, with
 * one opponent left rather than two and 86% of the planet already taken. What
 * it costs is the time saved: about 42 seconds of watching against 71.
 *
 * A quarter was wrong once in those 695 firings and a sixth was wrong in none
 * of them. Quote that rate per *firing*, never per seat — the seats this
 * never speaks up for are not evidence of anything. Both of the misfires
 * found at a quarter share a shape: they fire while the field is still full,
 * on a player who is wide rather than deep, and neither one fires at a sixth.
 * `preview/surrender.html` stands on one of them and is the record of why
 * this number is what it is.
 */
export const SURRENDER_TUNING = { diceRatio: 6, regionRatio: 6 };

/**
 * Everyone still on the board who has no realistic way back into the game.
 *
 * Two measures, and a player has to be behind on **both**: total dice, which
 * is the army they have accumulated, and largest connected region, which is
 * the income they will accumulate — reinforcement is paid on it, so a player
 * behind on region falls further behind every single turn. That is the
 * mechanism this is trying to detect, and neither number finds it alone:
 *
 * - Region on its own is badly wrong (a third of the planet in four
 *   disconnected clumps looks feeble and is not), wrong often enough to hand
 *   out false wins in one game in three.
 * - Dice on its own can be gamed by a board nobody in these tests played but
 *   a person might: stacks piled eight deep on a handful of territories look
 *   like a huge army while earning almost nothing. Requiring region too means
 *   the tall-stack player is not mistaken for the leader.
 *
 * The property that makes this safe to end a game on is that **the leader
 * can never be in this set**. Whoever leads a measure is compared against
 * themselves, and `dice * ratio <= dice` is false at any ratio above one for
 * anybody still holding a die — so a field that has surrendered is one where
 * the player left standing leads both the army and the income. Nobody can be
 * handed a win while another player is ahead of them, and that is by
 * construction rather than by measurement.
 *
 * The region measure is `incomeFor` rather than the largest region on the
 * board, so that a player whose ground is split between the planet and the
 * moon is judged on what they will actually be paid. On a single-world board
 * the two are the same function; on a two-world one, reading it as one graph
 * would call a player finished for holding two halves of a real income.
 *
 * Deliberately not a judgement any *strategy* makes, and deliberately not
 * anything the reducer knows: surrendering changes no rule and no state. It
 * is only an opinion about the position, which is why a caller is free to
 * ignore it and play the match out.
 */
export function surrenderedPlayerIds(state, tuning = SURRENDER_TUNING) {
  const { diceRatio, regionRatio } = { ...SURRENDER_TUNING, ...tuning };
  const living = livingPlayerIds(state);
  if (living.length === 0) return new Set();

  const standing = new Map(
    living.map((id) => [id, { dice: 0, region: incomeFor(state, id) }])
  );
  for (const node of state.nodes.values()) {
    const player = standing.get(node.owner);
    if (player) player.dice += node.dice;
  }

  const values = [...standing.values()];
  const bestDice = Math.max(...values.map((player) => player.dice));
  const bestRegion = Math.max(...values.map((player) => player.region));

  const surrendered = new Set();
  for (const [id, player] of standing) {
    if (player.dice * diceRatio <= bestDice && player.region * regionRatio <= bestRegion) {
      surrendered.add(id);
    }
  }
  return surrendered;
}
