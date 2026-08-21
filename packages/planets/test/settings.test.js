import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTING_DEFINITIONS,
  DEFAULT_SETTINGS,
  MIN_PLAYERS,
  MAX_PLAYERS,
  normalizeSettings,
  settingsFromQuery,
  settingsToQuery,
  resolveSettings,
  readStoredSettings,
  writeStoredSettings,
  playerIdsFor,
  settingDefinition,
  resolveStartSeat,
  seatsInRange,
} from '../src/game/settings.js';

// A stand-in for localStorage, and one that refuses to co-operate.
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

test('every option declares what the menu needs to draw it', () => {
  for (const setting of SETTING_DEFINITIONS) {
    assert.ok(setting.key, 'each option needs a key');
    assert.ok(setting.label, `${setting.key} needs a label`);
    assert.ok(setting.help, `${setting.key} needs a line of explanation`);
    assert.ok(['choice', 'toggle', 'seat'].includes(setting.kind), `${setting.key} has an odd kind`);
    assert.notEqual(setting.default, undefined, `${setting.key} needs a default`);
    if (setting.kind === 'choice') assert.ok(setting.choices.length > 1);
    if (setting.kind === 'seat') assert.ok(setting.modes.length > 1, `${setting.key} needs ranges`);
    if (!setting.available) assert.ok(setting.note, `${setting.key} should say why it is off`);
  }
});

test('the defaults are a playable game', () => {
  assert.deepEqual(normalizeSettings(DEFAULT_SETTINGS), { ...DEFAULT_SETTINGS });
  assert.ok(DEFAULT_SETTINGS.players >= MIN_PLAYERS && DEFAULT_SETTINGS.players <= MAX_PLAYERS);
});

test('missing settings fall back rather than coming through undefined', () => {
  assert.deepEqual(normalizeSettings({}), { ...DEFAULT_SETTINGS });
  assert.deepEqual(normalizeSettings(), { ...DEFAULT_SETTINGS });
});

test('a player count outside the range is pulled back into it', () => {
  assert.equal(normalizeSettings({ players: 99 }).players, MAX_PLAYERS);
  assert.equal(normalizeSettings({ players: 0 }).players, MIN_PLAYERS);
  assert.equal(normalizeSettings({ players: -3 }).players, MIN_PLAYERS);
});

test('a player count that is not a number falls back to the default', () => {
  for (const nonsense of ['many', '', null, undefined, NaN, {}]) {
    assert.equal(normalizeSettings({ players: nonsense }).players, DEFAULT_SETTINGS.players);
  }
});

test('a fractional player count is rounded, not truncated to nonsense', () => {
  assert.equal(normalizeSettings({ players: '5.6' }).players, 6);
});

test('an option whose feature is not built cannot be switched on', () => {
  // the menu greys it out, but nothing stops a URL or stale storage asking for
  // it — the pipeline is what guarantees downstream never sees it enabled
  const moon = settingDefinition('moon');
  assert.equal(moon.available, false, 'this test is about an unavailable option');
  assert.equal(normalizeSettings({ moon: true }).moon, moon.default);
  assert.equal(normalizeSettings({ moon: '1' }).moon, moon.default);
});

test('the query string is read for anything it names, and only that', () => {
  assert.deepEqual(settingsFromQuery('?players=6'), { players: '6' });
  assert.deepEqual(settingsFromQuery(''), {});
  assert.deepEqual(settingsFromQuery('?nothing=here'), {});
});

test('a plain game has a plain URL', () => {
  assert.equal(settingsToQuery(DEFAULT_SETTINGS), '', 'defaults add nothing');
  assert.equal(settingsToQuery({ ...DEFAULT_SETTINGS, players: 7 }), '?players=7');
});

test('a URL round-trips back to the same settings', () => {
  for (const players of [2, 5, 8]) {
    const settings = normalizeSettings({ ...DEFAULT_SETTINGS, players });
    const query = settingsToQuery(settings);
    assert.deepEqual(normalizeSettings(settingsFromQuery(query)), settings, query);
  }
});

test('the URL beats what was stored, which beats the defaults', () => {
  const storage = fakeStorage();
  writeStoredSettings(storage, { players: 6 });

  assert.equal(resolveSettings({ storage }).players, 6, 'stored beats the default');
  assert.equal(
    resolveSettings({ storage, search: '?players=3' }).players,
    3,
    'and a URL beats both, being the more deliberate of the two'
  );
});

test('a setup is remembered between visits', () => {
  const storage = fakeStorage();
  const chosen = normalizeSettings({ players: 7 });

  assert.equal(writeStoredSettings(storage, chosen), true);
  assert.deepEqual(readStoredSettings(storage), chosen);
});

test('storage that refuses to work does not stop a game starting', () => {
  // private browsing throws on localStorage in some engines
  assert.deepEqual(readStoredSettings(brokenStorage()), {});
  assert.equal(writeStoredSettings(brokenStorage(), DEFAULT_SETTINGS), false);
  assert.deepEqual(resolveSettings({ storage: brokenStorage() }), { ...DEFAULT_SETTINGS });
});

test('no storage at all is fine too', () => {
  assert.deepEqual(resolveSettings(), { ...DEFAULT_SETTINGS });
  assert.deepEqual(readStoredSettings(undefined), {});
});

test('corrupt stored settings are ignored rather than fatal', () => {
  const storage = fakeStorage({ 'dicewars-planets:settings': '{not json' });
  assert.deepEqual(resolveSettings({ storage }), { ...DEFAULT_SETTINGS });
});

test('stored settings that are out of range are still normalized', () => {
  const storage = fakeStorage();
  writeStoredSettings(storage, { players: 400 });
  assert.equal(resolveSettings({ storage }).players, MAX_PLAYERS);
});

test('player ids match the count asked for', () => {
  assert.deepEqual(playerIdsFor({ players: 3 }), ['p1', 'p2', 'p3']);
  assert.equal(playerIdsFor({ players: MAX_PLAYERS }).length, MAX_PLAYERS);
  assert.equal(playerIdsFor({}).length, DEFAULT_SETTINGS.players, 'and defaults when unset');
  assert.equal(new Set(playerIdsFor({ players: 8 })).size, 8, 'ids are unique');
});

// --- where you sit in the turn order --------------------------------------

const always = (value) => () => value;

test('a range is kept as a range, not resolved at settings time', () => {
  // it has to survive into the menu so the row can paint it; the seat is only
  // drawn when a game actually starts
  for (const mode of ['any', 'early', 'late']) {
    assert.equal(normalizeSettings({ start: mode }).start, mode);
  }
});

test('a chosen seat outside the table is pulled back onto it', () => {
  assert.equal(normalizeSettings({ players: 4, start: 9 }).start, 4);
  assert.equal(normalizeSettings({ players: 4, start: 0 }).start, 1);
  assert.equal(normalizeSettings({ players: 8, start: '6' }).start, 6);
});

test('the player count is settled before anything bounded by it', () => {
  // whatever order the definitions happen to be declared in
  assert.equal(normalizeSettings({ start: 9, players: 3 }).start, 3);
});

test('nonsense for a seat falls back to the default range', () => {
  for (const nonsense of ['middle', '', null, {}, NaN]) {
    assert.equal(normalizeSettings({ start: nonsense }).start, DEFAULT_SETTINGS.start);
  }
});

test('an exact seat is honoured exactly, however the dice fall', () => {
  for (const seat of [1, 4, 8]) {
    assert.equal(resolveStartSeat({ players: 8, start: seat }, always(0.99)), seat - 1);
    assert.equal(resolveStartSeat({ players: 8, start: seat }, always(0)), seat - 1);
  }
});

test('a range only ever lands inside itself', () => {
  for (const players of [2, 3, 4, 5, 8]) {
    for (const mode of ['any', 'early', 'late']) {
      const allowed = new Set(seatsInRange(mode, players));
      for (let r = 0; r < 1; r += 0.01) {
        const seat = resolveStartSeat({ players, start: mode }, always(r));
        assert.ok(allowed.has(seat), `${mode} with ${players} players gave seat ${seat}`);
      }
    }
  }
});

test('a range can reach every seat it covers', () => {
  const reached = new Set();
  for (let r = 0; r < 1; r += 0.001) {
    reached.add(resolveStartSeat({ players: 6, start: 'any' }, always(r)));
  }
  assert.deepEqual([...reached].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
});

test('an rng returning its very top value stays in range', () => {
  // Math.random never returns 1, but a stub or a seeded generator might
  for (const players of [2, 5, 8]) {
    assert.ok(resolveStartSeat({ players, start: 'any' }, always(1)) < players);
    assert.ok(resolveStartSeat({ players, start: 'late' }, always(1)) < players);
  }
});

test('early is the front of the table and late is the back', () => {
  assert.deepEqual(seatsInRange('early', 6), [0, 1, 2]);
  assert.deepEqual(seatsInRange('late', 6), [3, 4, 5]);
  assert.deepEqual(seatsInRange('any', 3), [0, 1, 2]);
});

test('with an odd table the middle seat belongs to both halves', () => {
  // better than a seat neither range can ever land on
  const middle = 2;
  assert.ok(seatsInRange('early', 5).includes(middle));
  assert.ok(seatsInRange('late', 5).includes(middle));
});

test('a two-player table still has a front and a back', () => {
  assert.deepEqual(seatsInRange('early', 2), [0]);
  assert.deepEqual(seatsInRange('late', 2), [1]);
});

test('the start position survives a trip through a URL', () => {
  for (const start of ['early', 'late', 5]) {
    const settings = normalizeSettings({ players: 8, start });
    const back = normalizeSettings({
      ...settingsFromQuery(settingsToQuery(settings)),
      players: 8,
    });
    assert.equal(back.start, settings.start, `start=${start}`);
  }
});
