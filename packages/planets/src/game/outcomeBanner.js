/**
 * The banner that interrupts play, and what the match does behind it.
 *
 * Three things put one up and they differ in two ways that were previously
 * decided at the call sites — which is why they are a table here instead. Get
 * either column wrong and the failure is quiet: a match that goes on being
 * carved up behind a question, or a win that stops existing on reload.
 *
 * - **Does it hold the match?** Two of the three go up over a match that is
 *   still running, and the AIs would otherwise take turns underneath: you are
 *   told you are out while the planet carries on, and dismissing the banner
 *   drops you into a board several turns past the one it went up over. A
 *   question that goes stale while it is being asked is worse than not asking
 *   it. Holding is safe because both arrive at settled moments — a knockout
 *   after its attack is applied, a surrender at the end of a turn — so unlike
 *   the replay there is never a move in mid-air to put down first, and the
 *   banner covers the whole HUD, so answering it is the only way out and the
 *   hold cannot be stranded.
 *
 * - **Is it an ending to come back to?** Only if the match actually has one.
 *   Closing a replay puts the remembered banner back, hold and all; a game
 *   carrying on without you has no ending screen to be returned to, so a
 *   knockout is deliberately not remembered and closing a replay opened from
 *   one drops you back on the board instead.
 *
 * The two columns meet on the way back from a replay, which is where this used
 * to go wrong: every answer releases the hold and "Watch replay" is an answer,
 * so a banner that came back without re-applying its rule came back over a
 * match that was running again. `restore` is a full `raise` for that reason.
 *
 * Everything about *what a banner says* is `outcomeView` in `hud.js`. This is
 * only what the match does while one is up.
 */
export const BANNER_RULES = {
  // The match is finished. Nothing left to play, so nothing to hold — and the
  // ending is exactly what a closing replay should come back to.
  over: { holds: false, remembers: true },
  // Handed the win because every opponent gave up. The board says otherwise
  // and the AIs are still playing, so the match is held until it is answered.
  surrendered: { holds: true, remembers: true },
  // Knocked out of a match that carries on without you. Held for the same
  // reason, and deliberately not remembered.
  eliminated: { holds: true, remembers: false },
};

// Anything unrecognised is treated as a question over a running match, which
// is the safe way round to be wrong: a banner that holds can always be
// answered, where one that does not lets the board move underneath it.
const UNKNOWN = { holds: true, remembers: false };

export function createOutcomeBanner({ show, hide }) {
  let holding = false;
  let ending = null;

  function raise(outcome) {
    const rule = BANNER_RULES[outcome.kind] ?? UNKNOWN;
    holding = rule.holds;
    if (rule.remembers) ending = outcome;
    show(outcome);
  }

  return {
    /** Whether the match is held for an answer. Read by the session's `tick`. */
    get holding() {
      return holding;
    },

    /** The banner a closing replay should put back, or null for none. */
    get ending() {
      return ending;
    },

    /** Puts a banner up, and applies its rule. */
    raise,

    /**
     * The player answered, whatever they answered — so the match is no longer
     * held for it. "Watch replay" hands the hold straight over to the replay,
     * which keeps it until the overlay closes.
     */
    answered() {
      holding = false;
    },

    /**
     * ...and one answer needs more than that. Refusing a surrender means there
     * is no longer an ending to come back to, so a replay closing afterwards
     * puts the player on the board rather than back in front of a banner they
     * have already declined.
     */
    playedOn() {
      ending = null;
    },

    /**
     * Puts the remembered banner back, if there is one — for a replay closing
     * over a match that actually ended.
     *
     * A full `raise` rather than just showing it again, because the hold has
     * to come back with it. Every answer releases the hold, and "Watch replay"
     * is an answer — so a surrender banner restored by only *showing* it came
     * back over a match that was running again, and the AIs took a round of
     * turns behind the card that exists to stop exactly that.
     *
     * Re-applying the rule is also what keeps the two kinds apart without this
     * having to know which is which: a win holds nothing because there is
     * nothing left to play, and a knockout is never remembered in the first
     * place, so it never reaches here.
     */
    restore() {
      if (ending) raise(ending);
    },

    /** Out of the way, without answering anything. */
    dismiss() {
      hide();
    },
  };
}
