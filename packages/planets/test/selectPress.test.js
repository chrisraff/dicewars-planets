import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSelectHandler } from '../src/render/selectPress.js';
import { YIELD, DRAG_SLOP } from '../src/render/pointerArbiter.js';

// A 200x100 canvas at the top-left of the page, so the middle of it is the
// middle of the planet and the arithmetic in the assertions is readable.
const canvas = {
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
};

function fakeSession(action = 'select', { cancels = false } = {}) {
  const calls = [];
  return {
    calls,
    // Every press now opens with "is there an attack to cancel?" and every
    // release with "then cancel it". That is its own claim, tested on its own
    // at the bottom of this file; the tests about what a press does to the
    // *board* read past it rather than restating it a dozen times.
    get boardCalls() {
      return calls.filter(([name]) => !name.endsWith('CancelAttack') && name !== 'cancelAttack');
    },
    canCancelAttack() {
      calls.push(['canCancelAttack']);
      return typeof cancels === 'function' ? cancels() : cancels;
    },
    cancelAttack() {
      calls.push(['cancelAttack']);
      return typeof cancels === 'function' ? cancels() : cancels;
    },
    pressAt(ndc) {
      calls.push(['pressAt', ndc]);
      return action;
    },
    releasePress() {
      calls.push(['releasePress']);
    },
    cancelPress() {
      calls.push(['cancelPress']);
    },
  };
}

const press = (over = {}) => ({
  id: 1,
  pointerType: 'mouse',
  startX: 100,
  startY: 50,
  x: 100,
  y: 50,
  ...over,
});

const at = (x, y) => ({ clientX: x, clientY: y });

test('a press on something worth acting on is kept, and shown', () => {
  const session = fakeSession('select');
  const handler = createSelectHandler(canvas, () => session);

  const answer = handler.onDown(press(), at(100, 50));

  assert.equal(answer, undefined, 'kept: this is still a tap until it proves otherwise');
  assert.deepEqual(session.boardCalls, [['pressAt', { x: 0, y: 0 }]], 'asked about the middle');
});

// The camera should have the press from its first pixel rather than after a
// dead zone, because there was never a tap here to wait for.
test('a press with nothing under it is handed on at once', () => {
  const session = fakeSession(null);
  const handler = createSelectHandler(canvas, () => session);

  assert.equal(handler.onDown(press(), at(100, 50)), YIELD);
});

test('a press that holds still is acted on when it comes up', () => {
  const session = fakeSession();
  const handler = createSelectHandler(canvas, () => session);

  handler.onDown(press(), at(100, 50));
  assert.equal(handler.onMove(press(), at(102, 51)), undefined, 'a wobble is still a tap');
  handler.onUp(press(), at(102, 51));

  assert.deepEqual(session.boardCalls.map(([name]) => name), ['pressAt', 'releasePress']);
});

test('a press that becomes a drag is given up, and takes its mark with it', () => {
  const session = fakeSession();
  const handler = createSelectHandler(canvas, () => session);

  handler.onDown(press(), at(100, 50));
  const answer = handler.onMove(press(), at(100 + DRAG_SLOP.mouse + 1, 50));
  handler.onYield(press(), at(100 + DRAG_SLOP.mouse + 1, 50));

  assert.equal(answer, YIELD);
  assert.deepEqual(session.boardCalls.map(([name]) => name), ['pressAt', 'cancelPress']);
});

test('a press the system takes away is cancelled the same way', () => {
  const session = fakeSession();
  const handler = createSelectHandler(canvas, () => session);

  handler.onDown(press(), at(100, 50));
  handler.onCancel(press(), at(100, 50));

  assert.deepEqual(session.boardCalls.map(([name]) => name), ['pressAt', 'cancelPress']);
});

// The planet still turns behind the menu, so a press there is the camera's —
// and nothing should be marked on a board nobody can see.
test('a press is not even offered to a match that is not being played', () => {
  const session = fakeSession();
  const blocked = createSelectHandler(canvas, () => session, { blocked: () => true });
  const gameless = createSelectHandler(canvas, () => null);

  assert.equal(blocked.onDown(press(), at(100, 50)), YIELD);
  assert.equal(gameless.onDown(press(), at(100, 50)), YIELD);
  assert.deepEqual(session.calls, [], 'the session is never asked');
});

// A new game is a new session under a handler registered long before it.
test('the session is asked for per press, not held from when it was registered', () => {
  let session = fakeSession();
  const handler = createSelectHandler(canvas, () => session);

  handler.onDown(press(), at(100, 50));
  const first = session;
  session = fakeSession();
  handler.onDown(press(), at(150, 50));

  assert.equal(first.boardCalls.length, 1, 'the old match hears nothing more');
  assert.equal(session.boardCalls.length, 1, 'and the new one gets the press');
});

test('the press is reported in the corner of the canvas it actually landed in', () => {
  const session = fakeSession();
  const handler = createSelectHandler(canvas, () => session);

  handler.onDown(press(), at(0, 0));
  handler.onDown(press(), at(200, 100));

  assert.deepEqual(session.boardCalls[0][1], { x: -1, y: 1 }, 'top left');
  assert.deepEqual(session.boardCalls[1][1], { x: 1, y: -1 }, 'bottom right');
});


// --- cancelling the attack in the air -------------------------------------

// The regression. Cancelling is another thing a tap can mean, so it is asked
// here rather than by a handler sitting in front of this one — a handler that
// yields on `onDown` hands the press over through `onAdopt`, which this one
// has none of, so every press arrived owned but never started and nothing
// selected at all. See the note on `createSelectHandler`.
test('a press that has no attack to cancel goes on to select, as it always did', () => {
  const session = fakeSession('select', { cancels: false });
  const handler = createSelectHandler(canvas, () => session);

  assert.equal(handler.onDown(press(), at(100, 50)), undefined, 'kept, because it selects');
  assert.deepEqual(
    session.calls.map(([name]) => name),
    ['canCancelAttack', 'pressAt'],
    'asked, told no, and then treated as the ordinary press it is'
  );
});

// Held rather than answered on the way down: whether it is a tap or a drag is
// not known yet, and only a tap cancels.
test('a tap anywhere cancels, and does not also select', () => {
  const session = fakeSession('select', { cancels: true });
  const handler = createSelectHandler(canvas, () => session);

  assert.equal(handler.onDown(press(), at(100, 50)), undefined, 'kept while it might be a tap');
  assert.deepEqual(session.boardCalls, [], 'the board is never asked what is under it');

  handler.onUp(press(), at(100, 50));
  assert.deepEqual(
    session.calls.map(([name]) => name),
    ['canCancelAttack', 'cancelAttack'],
    'and the release is what cancels'
  );
  assert.deepEqual(session.boardCalls, [], 'still nothing to the board — the press ends here');
});

// What this is really for. Turning the planet is reading it, and a player who
// reaches for the planet mid-throw is looking at the board rather than
// changing their mind about it.
test('a drag pans the planet and cancels nothing', () => {
  const session = fakeSession('select', { cancels: true });
  const handler = createSelectHandler(canvas, () => session);

  handler.onDown(press(), at(100, 50));
  const far = 100 + DRAG_SLOP.mouse + 1;
  assert.equal(handler.onMove(press(), at(far, 50)), YIELD, 'handed to the camera');
  handler.onYield(press(), at(far, 50));

  assert.deepEqual(
    session.calls.map(([name]) => name),
    ['canCancelAttack', 'cancelPress'],
    'asked once on the way in, and never cancelled'
  );
});

// The window can shut between the press landing and it coming up — it is under
// a second wide. The tap then does nothing at all rather than falling through
// to mean something else, which is right: the attack it was too late to stop
// is still in the air, so there is nothing on the board to act on either.
test('a tap that comes up after the window has shut cancels nothing', () => {
  let open = true;
  const session = fakeSession('select', { cancels: () => open });
  const handler = createSelectHandler(canvas, () => session);

  assert.equal(handler.onDown(press(), at(100, 50)), undefined, 'held: it was offered when it landed');
  open = false;
  handler.onUp(press(), at(100, 50));

  assert.deepEqual(
    session.calls.map(([name]) => name),
    ['canCancelAttack', 'cancelAttack', 'releasePress'],
    'it asks, is refused, and puts down a press it never picked anything up with'
  );
  assert.deepEqual(session.boardCalls, [['releasePress']], 'which the board reads as nothing');
});

// The planet is scenery while the menu is over it, and a match paused mid-throw
// still has an attack in the air behind it.
test('a press on a planet behind the menu cancels nothing', () => {
  const session = fakeSession('select', { cancels: true });
  const handler = createSelectHandler(canvas, () => session, { blocked: () => true });

  assert.equal(handler.onDown(press(), at(100, 50)), YIELD);
  assert.deepEqual(session.calls, [], 'not even asked');
});
