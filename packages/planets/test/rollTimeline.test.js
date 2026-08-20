import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sampleAttack,
  attackDuration,
  DEFAULT_TIMING,
  TUMBLE_TURNS,
} from '../src/render/rollTimeline.js';

const T = DEFAULT_TIMING;

test('the beats run aim, roll, read, done, in that order', () => {
  const phases = [0, T.aim / 2, T.aim + 0.01, T.aim + T.roll + 0.01, attackDuration() + 0.01].map(
    (t) => sampleAttack(t).phase
  );
  assert.deepEqual(phases, ['aim', 'aim', 'roll', 'read', 'done']);
});

test('duration is the three beats back to back', () => {
  assert.equal(attackDuration(), T.aim + T.roll + T.read);
  assert.equal(attackDuration({ aim: 1, roll: 2, read: 3 }), 6);
});

test('nothing moves before the dice are thrown', () => {
  const { lift, spin, settle } = sampleAttack(0);
  assert.deepEqual([lift, spin, settle], [0, 0, 0]);
});

test('dice hop: off the ground in the middle of the roll, back down at both ends', () => {
  assert.equal(sampleAttack(T.aim).lift, 0);
  assert.ok(sampleAttack(T.aim + T.roll / 2).lift > 0.9);
  assert.ok(sampleAttack(T.aim + T.roll * 0.999).lift < 0.01);
  assert.equal(sampleAttack(T.aim + T.roll).lift, 0);
});

test('the tumble only ever goes forwards, and eases to a stop', () => {
  let previous = -1;
  const speeds = [];
  for (let i = 0; i <= 40; i++) {
    const t = T.aim + (T.roll * i) / 40;
    const { spin } = sampleAttack(t);
    assert.ok(spin >= previous, 'dice never spin backwards');
    if (previous >= 0) speeds.push(spin - previous);
    previous = spin;
  }
  assert.ok(speeds[0] > speeds.at(-1) * 5, 'it should be much slower at the end than the start');
});

test('the roll ends on a whole number of turns, square on the rolled face', () => {
  const end = sampleAttack(T.aim + T.roll);
  assert.equal(end.settle, 1, 'fully blended onto the rolled value');
  assert.equal(end.spin / (2 * Math.PI), TUMBLE_TURNS, 'a whole number of turns, so no visible snap');
  assert.equal(end.lift, 0);
});

test('the rolled faces stay put while the totals are being read', () => {
  const reading = sampleAttack(T.aim + T.roll + T.read / 2);
  const done = sampleAttack(attackDuration() + 5);
  assert.equal(reading.settle, 1);
  assert.deepEqual([done.lift, done.settle], [0, 1]);
  assert.equal(done.phase, 'done');
});

test('a faster timing runs the same shape in less time', () => {
  const quick = { aim: 0.05, roll: 0.2, read: 0.1 };
  assert.equal(sampleAttack(0.06, quick).phase, 'roll');
  assert.equal(sampleAttack(0.3, quick).phase, 'read');
  assert.equal(sampleAttack(0.25, quick).settle, sampleAttack(T.aim + T.roll, T).settle);
});
