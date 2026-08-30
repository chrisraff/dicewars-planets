/**
 * Who owns a press.
 *
 * Two things want every press on the planet, and only one of them can have
 * it: tapping a territory to attack, and dragging to orbit. They used to run
 * side by side — the orbit controls turned the planet from the first pixel,
 * and a tap was worked out afterwards from how far the pointer had travelled
 * by the time it came up. That reads the gesture backwards. Nothing can be
 * said about a press until it is over, so nothing can be *shown* about it
 * either, and the planet slides under a finger that only meant to point at
 * something.
 *
 * So a press is owned, in order. The first handler registered gets it, and
 * keeps it until it hands it on by returning `YIELD` — from any callback, but
 * in practice from `onMove`, once the pointer has travelled far enough that
 * this is plainly a drag. Ownership only ever moves forward down the list, so
 * a press that has become a drag can never go back to being a tap.
 *
 * What that buys is the thing a tap could not have before: while the first
 * handler still owns the press, it knows the press is *live*, and can say so
 * on screen. Release accepts, drag cancels — and both are visible while there
 * is still time to choose.
 *
 * Modelled on the `TouchArbiter` in the 3d-maze project, with one difference
 * worth knowing: this listens for **pointer** events rather than touch ones,
 * so a mouse, a pen and a finger are the same gesture with different slop
 * (see `movedPastSlop`) rather than two code paths that drift apart.
 *
 * A handler is a plain object, every method optional:
 *
 *   onDown(press, event)   the press has just started, and is yours
 *   onMove(press, event)   it has moved; return YIELD to hand it on
 *   onUp(press, event)     it ended while you still owned it
 *   onCancel(press, event) the system took it away (a call, a gesture, …)
 *   onYield(press, event)  you just gave it up — put back whatever you showed
 *   onAdopt(press, event)  it has just become yours, mid-gesture
 *
 * `press` is the arbiter's own record of the gesture: `id`, `pointerType`,
 * where it started (`startX`/`startY`), where it is now (`x`/`y`), and when it
 * began (`startTime`).
 */

/** Returned from a handler to hand the press to whoever is next. */
export const YIELD = Symbol('yield');

/**
 * How far a press may wander and still be a tap, in CSS pixels.
 *
 * A finger wanders much further than a mouse does while still meaning "this
 * one" — it lands on a soft, moving contact patch several millimetres across,
 * and the reported point drifts inside it as the pad spreads. A pen is
 * between the two. These are the numbers the old release-time check used, and
 * they are unchanged: what has changed is when they are consulted, which is
 * now the moment they are exceeded rather than at the end of the gesture.
 */
export const DRAG_SLOP = { mouse: 5, pen: 6, touch: 14 };

export const slopFor = (pointerType) => DRAG_SLOP[pointerType] ?? DRAG_SLOP.mouse;

/**
 * Whether a press has travelled far enough to stop being a tap. Strictly
 * further than the slop, so a press exactly on the limit is still a tap — the
 * limit is the last distance that counts as holding still.
 */
export function movedPastSlop(press, x = press.x, y = press.y) {
  return Math.hypot(x - press.startX, y - press.startY) > slopFor(press.pointerType);
}

/**
 * Watches `element` for presses and hands each one to the registered handlers
 * in turn.
 *
 * `document` is where the rest of the gesture is listened for, so a drag that
 * leaves the element — onto the HUD, or off the window entirely — still
 * finishes properly rather than leaving a press stuck down. Injectable for
 * tests, which drive the whole thing through fakes rather than a browser.
 *
 * **A press the first handler wants is stopped dead at this element**
 * (`stopImmediatePropagation`), so anything else listening here — the orbit
 * controls, in the real game — never sees it. That is the whole of the
 * arbitration: those controls act on the press they are given, so the only
 * way to hold them off is not to give them one. It also means this must be
 * listening *before* they are, since listeners on one element run in the
 * order they were added.
 *
 * The other side of that bargain is `onAdopt`. A handler that takes a press
 * mid-gesture was never told it started, so it is handed the press where it
 * has got to and it is that handler's business to catch up — for the orbit
 * controls, by being given a press of their own (see `createViewer`).
 */
export function createPointerArbiter(element, { document = element.ownerDocument } = {}) {
  const handlers = [];
  const presses = new Map();

  const handlerFor = (press) => handlers[press.owner];
  const isLast = (index) => index >= handlers.length - 1;

  function deliver(press, method, event) {
    const result = handlerFor(press)?.[method]?.(press, event);
    if (result === YIELD) handOn(press, event);
  }

  function handOn(press, event) {
    if (isLast(press.owner)) return; // nobody left to take it; it stays put
    handlerFor(press)?.onYield?.(press, event);
    press.owner += 1;
    handlerFor(press)?.onAdopt?.(press, event);
  }

  function track(event) {
    const press = presses.get(event.pointerId);
    if (!press) return null;
    press.x = event.clientX;
    press.y = event.clientY;
    return press;
  }

  function onPointerDown(event) {
    // A press already being tracked is one of ours coming back around: a
    // handler that adopted mid-gesture may re-dispatch the press it missed,
    // and that copy is meant for whoever is listening after us, not for a
    // second session on the same finger.
    if (presses.has(event.pointerId) || handlers.length === 0) return;

    // A second finger is a pinch, never a tap — so whatever is still holding
    // out as a candidate is out of time the moment one arrives, and the new
    // press goes straight to the handler of last resort. Handing the old one
    // on first keeps the two in the order they were pressed, which is the
    // order the controls downstream expect to be told about them.
    const crowded = presses.size > 0;
    for (const other of presses.values()) while (!isLast(other.owner)) handOn(other, event);

    const press = {
      id: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      startTime: Date.now(),
      // Only a plain primary press can be a tap. A second button is asking
      // for something else entirely, and passing it straight down means the
      // controls get the untouched event rather than one we made up.
      owner: crowded || !isPrimaryPress(event) ? handlers.length - 1 : 0,
    };
    presses.set(press.id, press);

    if (!isLast(press.owner)) event.stopImmediatePropagation();
    deliver(press, 'onDown', event);
  }

  function onPointerMove(event) {
    const press = track(event);
    if (press) deliver(press, 'onMove', event);
  }

  function onPointerUp(event) {
    const press = track(event);
    if (!press) return;
    presses.delete(press.id);
    deliver(press, 'onUp', event);
  }

  function onPointerCancel(event) {
    const press = track(event);
    if (!press) return;
    presses.delete(press.id);
    deliver(press, 'onCancel', event);
  }

  element.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerCancel);

  return {
    /**
     * Adds a handler behind the ones already registered. Order is priority:
     * the first registered sees every press first, and each one after it only
     * ever gets what the one before hands on.
     */
    register(name, handler) {
      handlers.push({ name, ...handler });
    },

    /** Who owns each live press, for a preview page or a test to read. */
    get owners() {
      return new Map([...presses].map(([id, press]) => [id, handlers[press.owner]?.name ?? null]));
    },

    dispose() {
      element.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerCancel);
      presses.clear();
    },
  };
}

// `button` is which button changed, and on a press that is 0 for the left
// one, for a pen tip and for every finger. `isPrimary` is what tells the
// first finger of a gesture from the rest of them.
const isPrimaryPress = (event) => event.button === 0 && event.isPrimary !== false;
