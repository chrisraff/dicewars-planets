import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATTACK_HINT, markHintSeen, readSeenHints } from '../src/game/hints.js';

const fakeStorage = (initial = {}) => {
  const data = { ...initial };
  return {
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    dump: () => data,
  };
};
const brokenStorage = () => ({
  getItem() {
    throw new Error('denied');
  },
  setItem() {
    throw new Error('denied');
  },
});

test('a player nobody has told anything has seen nothing', () => {
  assert.equal(readSeenHints(fakeStorage()).has(ATTACK_HINT), false);
});

test('a hint marked seen stays seen across a reload', () => {
  const storage = fakeStorage();
  assert.equal(markHintSeen(storage, ATTACK_HINT), true);
  assert.equal(readSeenHints(storage).has(ATTACK_HINT), true);
});

test('a second hint does not erase the first', () => {
  // the whole reason these share one key as a set: adding a hint later must
  // not be the thing that starts showing the old one again
  const storage = fakeStorage();
  markHintSeen(storage, ATTACK_HINT);
  markHintSeen(storage, 'something-later');

  const seen = readSeenHints(storage);
  assert.deepEqual([...seen].sort(), [ATTACK_HINT, 'something-later'].sort());
});

test('marking the same hint twice writes it once', () => {
  const storage = fakeStorage();
  markHintSeen(storage, ATTACK_HINT);
  markHintSeen(storage, ATTACK_HINT);
  assert.deepEqual(JSON.parse(storage.dump()['dicewars-planets:hints']), [ATTACK_HINT]);
});

test('storage that refuses to work costs a repeated hint, not a broken game', () => {
  assert.equal(readSeenHints(brokenStorage()).has(ATTACK_HINT), false);
  assert.equal(markHintSeen(brokenStorage(), ATTACK_HINT), false);
  assert.equal(readSeenHints(undefined).size, 0);
});

test('nonsense in storage reads as having seen nothing', () => {
  // a hand edit, or another version of the game that wrote something else
  for (const stored of ['{not json', '"attack"', '{"attack":true}', 'null']) {
    const seen = readSeenHints(fakeStorage({ 'dicewars-planets:hints': stored }));
    assert.equal(seen.has(ATTACK_HINT), false, `${stored} should not be trusted as a list`);
  }
});
