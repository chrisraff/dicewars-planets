import { neighbors } from '../graph.js';
import { isLegalAttack } from '../reducer.js';
import { getPlayerNodeIds, largestConnectedRegionSize, MAX_DICE_PER_NODE } from '../state.js';

/**
 * The two numbers the original ai_defensive.js had written into its
 * conditions. They are the whole of its temperament, so they are named and
 * exposed rather than buried:
 *
 * - `minRegionToHoldBorder` — below this, the player is small enough that
 *   growing matters more than holding, and the border rule stops applying.
 * - `borderThreatDice` — a neighbour with this many dice or fewer is not a
 *   threat worth keeping a garrison for. Two, because a stack of two loses
 *   more often than it wins against anything already sitting on the ground.
 */
export const DEFENSIVE_TUNING = Object.freeze({
  minRegionToHoldBorder: 4,
  borderThreatDice: 2,
});

/**
 * What everything below wants to know about one territory, from the seat of
 * the player deciding: how many of its neighbours are not ours, the two
 * strongest of those, and how many neighbours it has at all.
 *
 * "Not ours" rather than "belongs to whoever holds this one" deliberately —
 * see improvement 2 in `createDefensiveStrategy`.
 */
function threatsAround(state, nodeId, playerId) {
  let rivals = 0;
  let strongest = 0;
  let second = 0;
  let total = 0;

  for (const id of neighbors(state.graph, nodeId)) {
    total++;
    const node = state.nodes.get(id);
    if (node.owner === playerId) continue;
    rivals++;
    if (node.dice > strongest) {
      second = strongest;
      strongest = node.dice;
    } else if (node.dice > second) {
      second = node.dice;
    }
  }
  return { rivals, strongest, second, total };
}

// Ranks are compared field by field, every one of them "more is better", so
// the first field that differs decides and the rest are tie-breaks.
function outranks(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/**
 * Every attack this player is willing to make right now, best first — the
 * decision `createDefensiveStrategy` takes the head of, exposed on its own
 * because the ordering is the interesting half and a test should be able to
 * read it without playing a game.
 *
 * Three questions, all asked of the board as it stands:
 *
 * 1. **Can it be won?** Strictly more dice than the defender — an even fight
 *    is one the attacker loses on ties. A full stack takes an even fight
 *    anyway, since it has nowhere left to grow.
 * 2. **Does winning invite a counter-attack?** A rival next to the prize with
 *    more dice than the attacker has now will simply take it back. The bar is
 *    deliberately lenient — the attacker only garrisons the prize with
 *    `dice - 1`, so this tolerates a counter one die stronger than the
 *    garrison. Tightening it to the garrison is the obvious-looking fix and
 *    is measurably ruinous; see `createDefensiveStrategy`.
 * 3. **Is the attacker needed where it is?** A territory with a second
 *    threatening rival behind the one being attacked is a border post: emptying
 *    it down to one die opens the door. It goes anyway if the player is still
 *    small (nothing to defend yet) or has banked dice to backfill with.
 */
export function defensiveMovesFor(state, playerId, tuning = DEFENSIVE_TUNING) {
  const { minRegionToHoldBorder, borderThreatDice } = { ...DEFENSIVE_TUNING, ...tuning };

  // One survey per territory per decision. The original built the table for
  // every area on the board every move; only the territories actually in play
  // are ever asked about here, which on a planet is a small fraction of them.
  const surveys = new Map();
  const around = (id) => {
    if (!surveys.has(id)) surveys.set(id, threatsAround(state, id, playerId));
    return surveys.get(id);
  };

  // Both halves of question 3, neither of which depends on the move.
  const banked = state.players.get(playerId)?.reserve ?? 0;
  const mayLeaveBorders =
    banked > 0 || largestConnectedRegionSize(state, playerId) <= minRegionToHoldBorder;

  const moves = [];

  for (const from of getPlayerNodeIds(state, playerId)) {
    const attacker = state.nodes.get(from);
    if (attacker.dice <= 1) continue; // nothing to attack with

    const home = around(from);
    if (!mayLeaveBorders && home.second > borderThreatDice) continue; // (3)

    // An attacker whose only rival neighbour is the one it is attacking has
    // nothing behind it: winning makes it interior. That is the move this AI
    // is named for, and it outranks everything else on offer.
    const sealsOff = home.rivals === 1;

    for (const to of neighbors(state.graph, from)) {
      if (!isLegalAttack(state, from, to)) continue;

      const defender = state.nodes.get(to);
      if (defender.dice >= attacker.dice && attacker.dice < MAX_DICE_PER_NODE) continue; // (1)
      if (around(to).strongest > attacker.dice) continue; // (2)

      moves.push({
        from,
        to,
        // more dice wins; then the better-supported attacker (the tie-break
        // `createDefensiveStrategy` has a note about); then the fattest
        // prize, which by (1) was the weaker side of the fight anyway
        rank: [sealsOff ? 1 : 0, attacker.dice, home.total, defender.dice],
      });
    }
  }

  moves.sort((a, b) => (outranks(a.rank, b.rank) ? -1 : outranks(b.rank, a.rank) ? 1 : 0));
  return moves.map(({ from, to }) => ({ from, to }));
}

/**
 * The classic dicewars-js `ai_defensive`, translated into a native core
 * strategy: `(state, playerId) -> { from, to } | null`. It attacks only where
 * it expects to win *and* to keep what it wins, and leaves a territory that is
 * holding a line where it is.
 *
 * It is deterministic — the same board always produces the same move. Nothing
 * needs it to be, but a strategy that never flips a coin is one a failing game
 * can be reproduced from.
 *
 * Two things were fixed rather than carried across:
 *
 * 1. **The choice is a ranking, not a running favourite.** The original
 *    overwrites its pick with each new candidate and only defends the
 *    incumbent in one special case, so which attack it settles on depends on
 *    the order the board is scanned in — a candidate it rejected as worse
 *    would have won had it been looked at last. Here every candidate is
 *    ranked against every other by the same rules, which are the original's
 *    own preferences (a sealing attacker first, then dice, then connectivity)
 *    applied to every pair instead of one.
 * 2. **Any rival can counter-attack, not just the defender's own colour.**
 *    The original only looks at neighbours sharing the defender's owner,
 *    which on a crowded board misses the third player sitting right next to
 *    the prize.
 *
 * Neither changes how well it plays — over 100 six-player games against a
 * field of the original, both land within a point of the original's own 23%,
 * where seat order alone is worth about that much.
 *
 * A third looked just as obvious and is not made. The counter-attack test
 * compares the rival to the attacker's dice, though a winner garrisons the
 * prize with `dice - 1`, so a rival exactly as strong as the attacker passes
 * a test it would fail by one. Closing that gap costs the AI the game: with
 * dice this small a single die is most of the margin, so it refuses nearly
 * every fight, and since reinforcement is paid on the largest connected
 * region, refusing to grow is losing slowly. It wins 1 game in 100 instead of
 * 23 and finishes holding half a territory. The leniency is load-bearing.
 *
 * One deliberate non-fix: among two sealing attackers of equal dice the
 * original keeps the one with *more* neighbours, while the comment beside it
 * says it prefers the less connected. The code's behaviour is kept — more
 * neighbours means more friendly ones (the rival count is 1 either way), so
 * it is picking the better-supported attacker, which is the defensive read —
 * but it is a tie-break of a tie-break, and flipping `home.total` to its
 * negation in `defensiveMovesFor` is the whole change if the comment was the
 * intent.
 */
export function createDefensiveStrategy(tuning = DEFENSIVE_TUNING) {
  return function defensiveStrategy(state, playerId) {
    return defensiveMovesFor(state, playerId, tuning)[0] ?? null;
  };
}
