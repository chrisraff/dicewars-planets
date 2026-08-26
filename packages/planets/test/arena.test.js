import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPERT_WEIGHTS } from '@dicewars/core';
import { graphState } from '@dicewars/core/test-support';
import { parseArgs, parseStrategy, summarize } from '../scripts/arena.js';

// The arena is measurement tooling and most of it can only be checked by
// running it for minutes. These are the parts that cannot: the spec a run is
// described by, and the arithmetic the answer is reported in. Both are easy to
// get quietly wrong, and a run reported against the wrong opponent — or with
// an override that never reached the AI — is worse than no run at all.

test('a bare name is the strategy of that name', () => {
  for (const name of ['simple', 'defensive', 'expert']) {
    const parsed = parseStrategy(name);
    assert.equal(parsed.name, name);
    assert.deepEqual(parsed.weights, {});
    assert.equal(typeof parsed.make(), 'function');
  }
});

test('weights are read off the spec and left as numbers', () => {
  const parsed = parseStrategy('expert:follow=0,breadth=6');
  assert.deepEqual(parsed.weights, { follow: 0, breadth: 6 });
});

// The whole point of the tool is measuring an AI against itself with one thing
// changed, so an override that parsed but never reached the strategy would
// report a difference of zero and look like a finding.
test('an override actually reaches the AI it is describing', () => {
  // The two-territory bridge from the expert's own tests: the second ply takes
  // it, one ply takes the free ground on the other side of the board instead.
  const bridge = () => graphState(
    [
      ['a1', { owner: 'p1', dice: 5 }],
      ['a2', { owner: 'p1', dice: 3 }],
      ['a3', { owner: 'p1', dice: 6 }],
      ['b1', { owner: 'p1', dice: 3 }],
      ['b2', { owner: 'p1', dice: 3 }],
      ['b3', { owner: 'p1', dice: 3 }],
      ['g1', { owner: 'p2', dice: 2 }],
      ['g2', { owner: 'p2', dice: 2 }],
      ['spoils', { owner: 'p2', dice: 2 }],
      ['spoils2', { owner: 'p2', dice: 2 }],
    ],
    [
      ['a1', 'a2'], ['a2', 'a3'], ['b1', 'b2'], ['b2', 'b3'],
      ['a1', 'g1'], ['g1', 'g2'], ['g2', 'b1'],
      ['a3', 'spoils'], ['spoils', 'spoils2'],
    ],
    { playerIds: ['p1', 'p2'] }
  );

  assert.deepEqual(parseStrategy('expert').make()(bridge(), 'p1'), { from: 'a1', to: 'g1' });
  assert.deepEqual(
    parseStrategy('expert:follow=0').make()(bridge(), 'p1'), { from: 'a3', to: 'spoils' },
    'expert:follow=0 has to be the AI that shipped before the second ply, not the one that did'
  );
});

test('a spec that cannot mean anything says so rather than measuring something else', () => {
  assert.throws(() => parseStrategy('nonsense'), /unknown strategy/);
  assert.throws(() => parseStrategy('expert:wibble=3'), /not one of EXPERT_WEIGHTS/);
  assert.throws(() => parseStrategy('expert:follow'), /weight=value/);
  assert.throws(() => parseStrategy('expert:follow=high'), /not a number/);
  // a weight handed to an AI that has none would be silently ignored, and the
  // run would report a comparison nobody made
  assert.throws(() => parseStrategy('simple:follow=0'), /only the expert takes weights/);
});

test('every weight the expert has can be overridden, and nothing else can', () => {
  for (const key of Object.keys(EXPERT_WEIGHTS)) {
    assert.doesNotThrow(() => parseStrategy(`expert:${key}=1`), key);
  }
});

test('options fall back to the defaults rather than to NaN', () => {
  const options = parseArgs(['duel']);
  assert.equal(options.command, 'duel');
  assert.equal(options.a, 'expert');
  assert.equal(options.b, 'expert');
  assert.ok(options.games > 0 && options.players > 0);
  assert.throws(() => parseArgs(['duel', '--games']), /needs a value/);
  assert.throws(() => parseArgs(['duel', '--nope', '1']), /unknown option/);
});

test('a drawn game counts towards neither side rather than towards both', () => {
  const nanos = { a: [0, 0], b: [0, 0] };
  const r = summarize({ aWins: 60, bWins: 40, draws: 10, nanos });
  assert.equal(r.decided, 100, 'the rate is out of the games that decided something');
  assert.equal(r.rate, 0.6);
});

test('an even result reads as even, however many games it took', () => {
  const nanos = { a: [0, 0], b: [0, 0] };
  const few = summarize({ aWins: 20, bWins: 20, draws: 0, nanos });
  const many = summarize({ aWins: 2000, bWins: 2000, draws: 0, nanos });
  assert.equal(few.rate, 0.5);
  assert.equal(few.z, 0);
  assert.equal(many.rate, 0.5);
  // the interval is what says which of the two is worth believing
  assert.ok(many.margin < few.margin / 5, 'a hundred times the games, a tenth of the interval');
});

test('nothing played is reported as nothing, not as a divide by zero', () => {
  const r = summarize({ aWins: 0, bWins: 0, draws: 0, nanos: { a: [0, 0], b: [0, 0] } });
  assert.equal(r.rate, 0);
  assert.equal(r.z, 0);
  assert.equal(r.msPerTurnA, 0);
});
