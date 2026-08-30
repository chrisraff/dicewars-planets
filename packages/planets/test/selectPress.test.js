import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSelectHandler } from '../src/render/selectPress.js';
import { YIELD, DRAG_SLOP } from '../src/render/pointerArbiter.js';

// A 200x100 canvas at the top-left of the page, so the middle of it is the
// middle of the planet and the arithmetic in the assertions is readable.
const canvas = {
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
};

function fakeSession(action = 'select') {
  const calls = [];
  return {
    calls,
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
  assert.deepEqual(session.calls, [['pressAt', { x: 0, y: 0 }]], 'asked about the middle');
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

  assert.deepEqual(session.calls.map(([name]) => name), ['pressAt', 'releasePress']);
});

test('a press that becomes a drag is given up, and takes its mark with it', () => {
  const session = fakeSession();
  const handler = createSelectHandler(canvas, () => session);

  handler.onDown(press(), at(100, 50));
  const answer = handler.onMove(press(), at(100 + DRAG_SLOP.mouse + 1, 50));
  handler.onYield(press(), at(100 + DRAG_SLOP.mouse + 1, 50));

  assert.equal(answer, YIELD);
  assert.deepEqual(session.calls.map(([name]) => name), ['pressAt', 'cancelPress']);
});

test('a press the system takes away is cancelled the same way', () => {
  const session = fakeSession();
  const handler = createSelectHandler(canvas, () => session);

  handler.onDown(press(), at(100, 50));
  handler.onCancel(press(), at(100, 50));

  assert.deepEqual(session.calls.map(([name]) => name), ['pressAt', 'cancelPress']);
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

  assert.equal(first.calls.length, 1, 'the old match hears nothing more');
  assert.equal(session.calls.length, 1, 'and the new one gets the press');
});

test('the press is reported in the corner of the canvas it actually landed in', () => {
  const session = fakeSession();
  const handler = createSelectHandler(canvas, () => session);

  handler.onDown(press(), at(0, 0));
  handler.onDown(press(), at(200, 100));

  assert.deepEqual(session.calls[0][1], { x: -1, y: 1 }, 'top left');
  assert.deepEqual(session.calls[1][1], { x: 1, y: -1 }, 'bottom right');
});
