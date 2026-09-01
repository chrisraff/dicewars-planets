import { pointerToNdc } from './pickTerritory.js';
import { movedPastSlop, YIELD } from './pointerArbiter.js';

/**
 * Tapping a territory, as something `createPointerArbiter` can hand a press
 * to — the first claim on every press, ahead of turning the planet.
 *
 * It holds the press only while it is still plausibly a tap, and gives it up
 * the moment it is not: at once if there is nothing under it worth acting on,
 * and otherwise as soon as it has wandered past the slop for its kind of
 * pointer. Everything it does to the board while it holds one, it undoes on
 * the way out — the mark is a promise about what letting go would do, and
 * neither a drag nor a cancel is going to let go.
 *
 * `sessionFor` is asked per press rather than held onto, because the arbiter
 * is set up once for the page while a session is one match: "new game"
 * replaces the session under a handler that was registered long before it.
 *
 * `blocked` is for the moments the planet is scenery rather than a board — the
 * menu being open, in the real game. A press then is the camera's, since the
 * planet still turns behind the menu.
 *
 * **Cancelling the attack in the air is another thing a press can mean**, and
 * for the second it is offered it is the only thing a press on the planet
 * sensibly means. It lives here rather than in a handler of its own in front
 * of this one, and that is worth a note: a handler that yields on `onDown`
 * hands the press to *this* one through `onAdopt`, which this one does not
 * implement and which `handOn` ignores the return of anyway — so the press
 * would arrive owned but never started, and nothing would ever select again.
 * Two meanings of one press belong in one handler.
 *
 * **Only a tap cancels.** Turning the planet is reading it, and a player who
 * reaches for the planet mid-throw is looking at the board rather than
 * changing their mind about it — so the question is asked on release, once the
 * press has held still long enough to still be a tap, and a drag takes the
 * camera exactly as it always would. That is the whole reason a press is held
 * here at all while there is something to cancel: which of the two it is is
 * not known when it lands.
 */
export function createSelectHandler(canvas, sessionFor, { blocked = () => false } = {}) {
  const ndcOf = (event) =>
    pointerToNdc(event.clientX, event.clientY, canvas.getBoundingClientRect());

  return {
    onDown(press, event) {
      const session = sessionFor();
      if (!session || blocked()) return YIELD;

      // Held, not answered. A tap anywhere cancels the attack in the air —
      // wherever it landed, the ocean included, because the × on the readout
      // is the visible offer but the eye is on the dice that were just thrown,
      // and a window under a second has to have no target to find and hit. A
      // *drag* is the camera's, though, so nothing can be decided until this
      // press either holds still or does not.
      if (session.canCancelAttack()) return undefined;

      // A press with nothing to act on belongs to the camera from its first
      // pixel, rather than sitting dead until it has moved far enough to
      // prove it is a drag.
      return session.pressAt(ndcOf(event)) ? undefined : YIELD;
    },

    onMove(press, event) {
      return movedPastSlop(press, event.clientX, event.clientY) ? YIELD : undefined;
    },

    onUp() {
      const session = sessionFor();
      // It held still, so it was a tap. If there was an attack to cancel this
      // is where it goes, and the press ends there: it must not also go on to
      // mean what it would otherwise have meant, because cancelling puts the
      // attacker back in the player's hand and a press that both cancelled and
      // selected would re-declare the very attack it just cancelled.
      if (session?.cancelAttack()) return;
      session?.releasePress();
    },

    onCancel() {
      sessionFor()?.cancelPress();
    },

    onYield() {
      sessionFor()?.cancelPress();
    },
  };
}
