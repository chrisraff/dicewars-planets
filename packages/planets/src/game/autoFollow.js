/**
 * Who is driving the camera, and where an automatic move goes.
 *
 * The camera follows the match on its own — round the back for an AI's
 * fights, home again when the turn hands over. A hand on the planet takes it
 * off that job, because somebody turning the planet is nearly always *reading*
 * it, and every automatic move is off until they hand it back.
 *
 * That is three rules and one flag, and they were spread through `session.js`
 * among the code that actually moves the camera. Here they are on their own,
 * pure and with no three.js in reach, because they are the part worth being
 * sure of: each one has a case it exists for that is easy to write the
 * plausible version of and get backwards.
 *
 * What is deliberately *not* here is anything that knows what a replay or a
 * banner is. Both arrive as a plain answer from the caller — `replayOpen`,
 * `replayStep`, `bannerHolding` — so this stays a policy about a camera rather
 * than a second place the shape of the interface is written down.
 *
 * The one rule that lives elsewhere is *where the offer to hand the camera
 * back is drawn*: that is `autoFollowButtonView` in `hud.js`, with the rest of
 * the view functions, and it stays the only copy of it.
 */

/** Where an automatic move aims. `null` is "nowhere worth going". */
export const AIM_REPLAY = 'replay';
export const AIM_FIGHTS = 'fights';
export const AIM_HOME = 'home';

/**
 * Whether a drag is worth recording as the player taking the camera.
 *
 * A drag during the player's *own* turn is not, and the reason is that there
 * would be nothing to record: every automatic move belongs either to a turn
 * that is not theirs or to the handover at one end of it, so during their own
 * turn nothing is being suppressed. Raising the offer to hand back a camera
 * nobody was going to take would be a button up through the one part of the
 * match they are playing.
 *
 * The replay check in front of it is what keeps that exemption about the
 * *live* match. A replay swings to every step it plays, whoever's turn the
 * paused board happens to be sitting on, so a drag during one always has
 * something to suppress.
 */
export function dragTakesCamera({ replayOpen = false, isHumanTurn = false } = {}) {
  return replayOpen || !isHumanTurn;
}

/**
 * Where the camera would be standing if it had never been taken — which is
 * the only honest answer to a press, and is *not* the same place all match.
 *
 * On somebody else's turn the camera's job is the fight: the run of attacks
 * being shown is what the player pressed the button to catch up with, and
 * taking them home instead shows them the one part of the planet where nothing
 * is happening. On their own turn, and in the gaps where an AI has nothing in
 * flight, home is the answer.
 *
 * A replay is following something of its own, so it answers first and answers
 * `null` on step 0 — the opening board is not a fight, and there is nothing to
 * swing to.
 *
 * `AIM_FIGHTS` is a preference rather than a verdict: a caller that cannot
 * frame the run should still fall back to home rather than doing nothing.
 */
export function aimKind({
  replayOpen = false,
  replayStep = 0,
  isAiTurn = false,
  fightCount = 0,
} = {}) {
  if (replayOpen) return replayStep > 0 ? AIM_REPLAY : null;
  if (isAiTurn && fightCount > 0) return AIM_FIGHTS;
  return AIM_HOME;
}

/**
 * Whether the pan home at a handover should be held back — the four states
 * where moving the planet is wrong rather than merely unhelpful.
 *
 * A player who is out has no turn to be handed and a finished match has no
 * next move; the replay and a banner are both things the player is looking at
 * *instead of* the board, so turning the planet under either would move a
 * board they cannot see and land them somewhere they never watched happen.
 *
 * Distinct from a hand on the planet, which suppresses the pan but not the
 * flash that goes with it — see `session.js`'s `focusOwnGround`.
 */
export function panHomeBlocked({
  humanEliminated = false,
  isOver = false,
  replayOpen = false,
  bannerHolding = false,
} = {}) {
  return humanEliminated || isOver || replayOpen || bannerHolding;
}

/**
 * The state behind those rules: whether the camera has been taken, and the run
 * of attacks the turn being shown is working through.
 *
 * Neither is saved. Both are facts about this sitting — like the pressed
 * territory and unlike anything about the position — and a reload is somebody
 * arriving at the board fresh.
 */
export function createAutoFollow() {
  let freed = false;
  let fights = [];

  return {
    /** Whether the player currently has the camera. */
    get freed() {
      return freed;
    },

    /** The run a press mid-AI-turn would aim at. */
    get fights() {
      return fights;
    },

    /**
     * A hand on the planet. Returns whether this changed anything, so a caller
     * only repaints the offer when there is something new to say.
     */
    takeCamera(context) {
      if (freed || !dragTakesCamera(context)) return false;
      freed = true;
      return true;
    },

    /**
     * Giving it back — by pressing the button, by picking a territory to
     * attack from, or by ending the turn as the backstop for an offer simply
     * ignored. Returns whether this changed anything.
     */
    giveBack() {
      if (!freed) return false;
      freed = false;
      return true;
    },

    /**
     * The planet has just been handed to the replay, or handed back from it.
     *
     * Unconditional rather than a `giveBack`: there is one planet and two
     * things that drive it, and whichever has just been handed it starts out
     * driving. The offer is about the camera being looked through now, not the
     * one a moment ago.
     */
    reset() {
      freed = false;
    },

    /** The run of attacks the shown turn is working through; empty at endTurn. */
    showing(pairs) {
      fights = pairs;
    },

    /** `aimKind` with the run already filled in. */
    aimKind(context) {
      return aimKind({ ...context, fightCount: fights.length });
    },
  };
}
