import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlightsFor, pulseAt, HIGHLIGHT } from '../src/render/highlights.js';

test('nothing is highlighted when nothing is going on', () => {
  assert.equal(highlightsFor().size, 0);
});

test('the picked-up territory goes dark, the ones it could hit lift slightly', () => {
  const marks = highlightsFor({ selection: 'a', targets: ['b', 'c'] });
  assert.deepEqual(marks.get('a'), HIGHLIGHT.selected);
  assert.deepEqual(marks.get('b'), HIGHLIGHT.target);

  const brightness = (mark) => mark.color.reduce((x, y) => x + y, 0);
  assert.ok(brightness(marks.get('a')) < brightness(marks.get('b')),
    'the selection tints toward dark, targets toward light — never the same kind of mark');
  assert.ok(marks.get('a').amount > marks.get('b').amount, 'and it is the stronger tint');
});

test('a territory that is both selected and a target reads as selected', () => {
  // can't normally happen, but the selection is the more specific fact
  const marks = highlightsFor({ selection: 'a', targets: ['a', 'b'] });
  assert.deepEqual(marks.get('a'), HIGHLIGHT.selected);
});

test('a fight lights up both sides and nothing else', () => {
  const marks = highlightsFor({ attack: { from: 'a', to: 'b' }, pulse: 1 });
  assert.deepEqual([...marks.keys()].sort(), ['a', 'b']);
  assert.deepEqual(marks.get('a'), HIGHLIGHT.attacker);
  assert.deepEqual(marks.get('b'), HIGHLIGHT.defender);
});

test('the attacker in a fight is marked exactly as a picked-up territory is', () => {
  // whoever is attacking, human or AI, holds that territory to attack with —
  // one mark for one meaning, so an AI turn reads the way your own does
  assert.deepEqual(HIGHLIGHT.attacker, HIGHLIGHT.selected);
});

test('the pulse throbs the defender without ever switching it off', () => {
  const dim = highlightsFor({ attack: { from: 'a', to: 'b' }, pulse: 0.3 });
  assert.ok(dim.get('b').amount < HIGHLIGHT.defender.amount);
  assert.ok(dim.get('b').amount > 0);
});

test('the attacker holds steady through the throb', () => {
  // its dice are being thrown across that ground; a mark that makes them
  // legible must not fade out from under them
  const bright = highlightsFor({ attack: { from: 'a', to: 'b' }, pulse: 1 });
  const dim = highlightsFor({ attack: { from: 'a', to: 'b' }, pulse: 0.3 });
  assert.equal(dim.get('a').amount, bright.get('a').amount);
});

test('the pulse is a smooth throb that stays visible throughout', () => {
  const samples = Array.from({ length: 60 }, (_, i) => pulseAt(i / 60));
  assert.ok(Math.min(...samples) > 0.25, 'never blinks out entirely');
  assert.ok(Math.max(...samples) <= 1);
  assert.ok(Math.abs(pulseAt(0) - pulseAt(0.6)) < 1e-9, 'one beat per period');
});
