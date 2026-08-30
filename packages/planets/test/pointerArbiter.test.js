import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPointerArbiter,
  movedPastSlop,
  slopFor,
  DRAG_SLOP,
  YIELD,
} from '../src/render/pointerArbiter.js';

// Enough of an event target to drive the arbiter without a browser: it only
// ever adds listeners and reads the fields of the events it is handed.
function target() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn));
    },
    emit(type, event) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
      return event;
    },
    count(type) {
      return (listeners.get(type) ?? []).length;
    },
  };
}

const pointerEvent = (over = {}) => ({
  pointerId: 1,
  pointerType: 'touch',
  clientX: 100,
  clientY: 100,
  button: 0,
  isPrimary: true,
  stopped: false,
  stopImmediatePropagation() {
    this.stopped = true;
  },
  ...over,
});

// Records every callback it is given, so a test can say what a handler was
// told rather than only what it did.
function recorder(name, { onDown, onMove } = {}) {
  const calls = [];
  const note = (what) => (press, event) => {
    calls.push(what);
    if (what === 'onDown') return onDown?.(press, event);
    if (what === 'onMove') return onMove?.(press, event);
    return undefined;
  };
  return {
    name,
    calls,
    handler: {
      onDown: note('onDown'),
      onMove: note('onMove'),
      onUp: note('onUp'),
      onCancel: note('onCancel'),
      onYield: note('onYield'),
      onAdopt: note('onAdopt'),
    },
  };
}

function arbiterWith(first, second) {
  const element = target();
  const doc = target();
  const arbiter = createPointerArbiter(element, { document: doc });
  arbiter.register('select', first.handler);
  if (second) arbiter.register('orbit', second.handler);
  return { arbiter, element, doc };
}

test('a press goes to the handler registered first', () => {
  const select = recorder('select');
  const orbit = recorder('orbit');
  const { element } = arbiterWith(select, orbit);

  element.emit('pointerdown', pointerEvent());

  assert.deepEqual(select.calls, ['onDown']);
  assert.deepEqual(orbit.calls, [], 'nothing behind it hears about a press it has not been given');
});

// The whole of the arbitration: the orbit controls listen on this same
// element, and the only way to hold them off is for the press never to reach
// them. Stopping it here is what makes a tap a tap rather than a drag of zero
// pixels that also happened to select something.
test('a press the first handler takes is stopped before anything else on the element sees it', () => {
  const select = recorder('select');
  const { element } = arbiterWith(select, recorder('orbit'));

  const event = element.emit('pointerdown', pointerEvent());

  assert.equal(event.stopped, true);
});

test('a press stays with its owner to the end when it never moves', () => {
  const select = recorder('select');
  const orbit = recorder('orbit');
  const { element, doc } = arbiterWith(select, orbit);

  element.emit('pointerdown', pointerEvent());
  doc.emit('pointermove', pointerEvent({ clientX: 102, clientY: 101 }));
  doc.emit('pointerup', pointerEvent({ clientX: 102, clientY: 101 }));

  assert.deepEqual(select.calls, ['onDown', 'onMove', 'onUp']);
  assert.deepEqual(orbit.calls, [], 'a tap is never handed on');
});

test('yielding hands the press on, tells the handler that had it, and tells the one that gets it', () => {
  const select = recorder('select', { onMove: () => YIELD });
  const orbit = recorder('orbit');
  const { element, doc } = arbiterWith(select, orbit);

  element.emit('pointerdown', pointerEvent());
  doc.emit('pointermove', pointerEvent({ clientX: 400 }));
  doc.emit('pointerup', pointerEvent({ clientX: 400 }));

  assert.deepEqual(select.calls, ['onDown', 'onMove', 'onYield']);
  assert.deepEqual(orbit.calls, ['onAdopt', 'onUp'], 'the rest of the gesture is the new owner’s');
});

// Ownership only ever moves forward, so a drag can never turn back into a tap
// halfway through — which is what stops a press that wandered and came home
// from firing an attack the player thought they had cancelled.
test('a press that has been handed on never goes back', () => {
  const select = recorder('select', { onMove: () => YIELD });
  const orbit = recorder('orbit');
  const { element, doc } = arbiterWith(select, orbit);

  element.emit('pointerdown', pointerEvent());
  doc.emit('pointermove', pointerEvent({ clientX: 400 }));
  doc.emit('pointermove', pointerEvent({ clientX: 100 })); // back where it started
  doc.emit('pointerup', pointerEvent());

  assert.deepEqual(select.calls, ['onDown', 'onMove', 'onYield']);
  assert.deepEqual(orbit.calls, ['onAdopt', 'onMove', 'onUp']);
});

test('a handler that turns a press down at the start gives it up there and then', () => {
  // pressing the ocean: there is nothing to select, so the camera should have
  // it from the first pixel rather than after a dead zone
  const select = recorder('select', { onDown: () => YIELD });
  const orbit = recorder('orbit');
  const { element } = arbiterWith(select, orbit);

  element.emit('pointerdown', pointerEvent());

  assert.deepEqual(select.calls, ['onDown', 'onYield']);
  assert.deepEqual(orbit.calls, ['onAdopt']);
});

test('the last handler has nobody to yield to, and keeps the press', () => {
  const orbit = recorder('orbit', { onMove: () => YIELD });
  const { element, doc } = arbiterWith(orbit);

  element.emit('pointerdown', pointerEvent());
  doc.emit('pointermove', pointerEvent({ clientX: 400 }));
  doc.emit('pointerup', pointerEvent({ clientX: 400 }));

  assert.deepEqual(orbit.calls, ['onDown', 'onMove', 'onUp'], 'no onYield, and no press dropped');
});

// A pinch is two fingers, and neither of them is a tap. The first is out of
// time the moment the second lands.
test('a second finger ends the tap and lands on the last handler itself', () => {
  const select = recorder('select');
  const orbit = recorder('orbit');
  const { element } = arbiterWith(select, orbit);

  element.emit('pointerdown', pointerEvent({ pointerId: 1 }));
  const second = element.emit('pointerdown', pointerEvent({ pointerId: 2, isPrimary: false }));

  assert.deepEqual(select.calls, ['onDown', 'onYield'], 'the first finger is given up');
  assert.deepEqual(orbit.calls, ['onAdopt', 'onDown']);
  assert.equal(second.stopped, false, 'and the second is left alone for the controls to see');
});

test('a press with a second mouse button is never a tap', () => {
  const select = recorder('select');
  const orbit = recorder('orbit');
  const { element } = arbiterWith(select, orbit);

  const event = element.emit('pointerdown', pointerEvent({ pointerType: 'mouse', button: 2 }));

  assert.deepEqual(select.calls, []);
  assert.deepEqual(orbit.calls, ['onDown']);
  assert.equal(event.stopped, false);
});

// How a handler that adopts mid-gesture catches up: it re-dispatches the
// press its own listeners never saw. That copy has to fall straight through,
// or the finger would be tracked twice over.
test('a press already being tracked is not started again', () => {
  const select = recorder('select');
  const orbit = recorder('orbit');
  const { element } = arbiterWith(select, orbit);

  element.emit('pointerdown', pointerEvent());
  const again = element.emit('pointerdown', pointerEvent());

  assert.deepEqual(select.calls, ['onDown'], 'one press, one onDown');
  assert.equal(again.stopped, false, 'and it is left to reach whatever it was dispatched for');
});

test('a press that ends is forgotten, so the next one starts clean', () => {
  const select = recorder('select');
  const { element, doc } = arbiterWith(select, recorder('orbit'));

  element.emit('pointerdown', pointerEvent());
  doc.emit('pointerup', pointerEvent());
  element.emit('pointerdown', pointerEvent());

  assert.deepEqual(select.calls, ['onDown', 'onUp', 'onDown']);
});

test('a cancel takes the press away from whoever has it', () => {
  const select = recorder('select');
  const { element, doc } = arbiterWith(select, recorder('orbit'));

  element.emit('pointerdown', pointerEvent());
  doc.emit('pointercancel', pointerEvent());
  doc.emit('pointerup', pointerEvent());

  assert.deepEqual(select.calls, ['onDown', 'onCancel'], 'and the up that follows is nobody’s');
});

test('moves and ups for a pointer nobody is tracking are ignored', () => {
  const select = recorder('select');
  const { doc } = arbiterWith(select, recorder('orbit'));

  doc.emit('pointermove', pointerEvent({ pointerId: 9 }));
  doc.emit('pointerup', pointerEvent({ pointerId: 9 }));

  assert.deepEqual(select.calls, []);
});

test('the press a handler is given says where it started and where it is now', () => {
  let seen = null;
  const select = recorder('select', { onMove: (press) => { seen = { ...press }; } });
  const { element, doc } = arbiterWith(select, recorder('orbit'));

  element.emit('pointerdown', pointerEvent({ clientX: 10, clientY: 20 }));
  doc.emit('pointermove', pointerEvent({ clientX: 14, clientY: 26 }));

  assert.deepEqual(
    { startX: seen.startX, startY: seen.startY, x: seen.x, y: seen.y },
    { startX: 10, startY: 20, x: 14, y: 26 }
  );
  assert.equal(seen.pointerType, 'touch');
});

test('disposing takes every listener back off', () => {
  const element = target();
  const doc = target();
  const arbiter = createPointerArbiter(element, { document: doc });
  arbiter.dispose();

  assert.equal(element.count('pointerdown'), 0);
  assert.equal(doc.count('pointermove') + doc.count('pointerup') + doc.count('pointercancel'), 0);
});

// --- how far a press may wander ------------------------------------------

test('a finger is allowed to wander further than a mouse', () => {
  assert.ok(slopFor('touch') > slopFor('pen'));
  assert.ok(slopFor('pen') > slopFor('mouse'));
  assert.equal(slopFor('anything else'), DRAG_SLOP.mouse, 'an unknown pointer is held to the tightest');
});

test('a press exactly on the limit is still holding still', () => {
  const press = { startX: 0, startY: 0, pointerType: 'mouse' };
  assert.equal(movedPastSlop(press, DRAG_SLOP.mouse, 0), false);
  assert.equal(movedPastSlop(press, DRAG_SLOP.mouse + 0.01, 0), true);
});

test('the distance is the diagonal, not the further of the two axes', () => {
  // 3-4-5: a press 4 across and 3 down has gone 5, which is past the mouse's
  // slop even though neither axis is
  const press = { startX: 0, startY: 0, pointerType: 'mouse' };
  assert.equal(movedPastSlop(press, 4, 3), false, 'exactly 5 is still the limit');
  assert.equal(movedPastSlop(press, 8, 6), true);
});
