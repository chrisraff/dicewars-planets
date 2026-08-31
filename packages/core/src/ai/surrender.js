import { largestConnectedRegionSize, livingPlayerIds } from '../state.js';

/**
 * How far behind a player has to be before they give the game up: a sixth of
 * the leader's dice, and a sixth of the leader's largest region. Found by
 * playing rather than derived — see CLAUDE.md for the sweep.
 *
 * The thing to know before touching it is that **tightening the ratio does not
 * stop the game being called, only delays it**. A sixth and a quarter fire on
 * all but the same number of seats; what changes is when, and how often the
 * call is wrong. Quote that error rate per *firing*, never per seat — the
 * seats this never speaks up for are not evidence of anything.
 */
export const SURRENDER_TUNING = { diceRatio: 6, regionRatio: 6 };

/**
 * Everyone still on the board who has no realistic way back into the game.
 *
 * Two measures, and a player has to be behind on **both**: total dice, the
 * army they have, and largest connected region, the income they are going to
 * get, since reinforcement is paid on it. Neither works alone — region on its
 * own calls one game in three for the wrong player, because a third of the
 * planet in four clumps looks feeble and is not, and dice on its own is fooled
 * by stacks piled eight deep on a handful of territories, a huge army earning
 * almost nothing.
 *
 * What makes it safe to end a game on is that **the leader can never be in
 * this set**: whoever leads a measure is compared against themselves, and
 * `dice * ratio <= dice` is false at any ratio above one for anybody still
 * holding a die. So a field that has surrendered is one where the player left
 * standing leads both the army and the income — construction, not measurement.
 *
 * Not a judgement any *strategy* makes and not anything the reducer knows:
 * surrendering changes no rule and no state. It is an opinion about the
 * position, which is why a caller is free to ignore it.
 */
export function surrenderedPlayerIds(state, tuning = SURRENDER_TUNING) {
  const { diceRatio, regionRatio } = { ...SURRENDER_TUNING, ...tuning };
  const living = livingPlayerIds(state);
  if (living.length === 0) return new Set();

  const standing = new Map(
    living.map((id) => [id, { dice: 0, region: largestConnectedRegionSize(state, id) }])
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
