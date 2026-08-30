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
 */
export function createSelectHandler(canvas, sessionFor, { blocked = () => false } = {}) {
  const ndcOf = (event) =>
    pointerToNdc(event.clientX, event.clientY, canvas.getBoundingClientRect());

  return {
    onDown(press, event) {
      const session = sessionFor();
      if (!session || blocked()) return YIELD;
      // A press with nothing to act on belongs to the camera from its first
      // pixel, rather than sitting dead until it has moved far enough to
      // prove it is a drag.
      return session.pressAt(ndcOf(event)) ? undefined : YIELD;
    },

    onMove(press, event) {
      return movedPastSlop(press, event.clientX, event.clientY) ? YIELD : undefined;
    },

    onUp() {
      sessionFor()?.releasePress();
    },

    onCancel() {
      sessionFor()?.cancelPress();
    },

    onYield() {
      sessionFor()?.cancelPress();
    },
  };
}
