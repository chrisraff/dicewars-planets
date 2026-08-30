import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphState } from '@dicewars/core/test-support';
import {
  SETTING_DEFINITIONS,
  MENU_SETTINGS,
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
  subdivisionsFor,
  settingDefinition,
  resolveStartSeat,
  seatsInRange,
  strategyFor,
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
    // a greyed-out row has to say why it is greyed out; a hidden one is never
    // drawn, so a note on it would be text nobody can read
    if (!setting.available && !setting.hidden) {
      assert.ok(setting.note, `${setting.key} is greyed out and should say why`);
    }
    if (setting.hidden) {
      assert.equal(setting.note, undefined, `${setting.key} is hidden, so its note is dead text`);
    }
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
  assert.equal(new Set(playerIdsFor({ players: 8 })).size, 8, 'ids are unique');

  // filling in what was not asked for is normalizeSettings' job and nobody
  // else's, so that there is one answer to what a missing option means
  assert.equal(playerIdsFor(normalizeSettings({})).length, DEFAULT_SETTINGS.players);
});

// --- how big a planet ------------------------------------------------------

test('planet size is carried through as the subdivision the generator wants', () => {
  assert.equal(subdivisionsFor({ size: 2 }), 2);
  assert.equal(subdivisionsFor(normalizeSettings({})), DEFAULT_SETTINGS.size);
});

test('a hidden option cannot be set from a URL or from stale storage either', () => {
  // hiding it from the menu is not the guarantee — the pipeline is, exactly as
  // for an unavailable one, or a link could hand the game an untuned planet
  const size = settingDefinition('size');
  assert.equal(size.hidden, true, 'this test is about a hidden option');
  assert.equal(normalizeSettings({ size: 4 }).size, size.default);
  assert.equal(normalizeSettings({ size: '2' }).size, size.default);
  assert.equal(resolveSettings({ search: '?size=4' }).size, size.default);
});

test('a hidden option is still declared, normalized and readable', () => {
  // the point of hiding rather than deleting: it stays one flag from being
  // offered, and nothing downstream has to change when it is
  assert.ok(SETTING_DEFINITIONS.some((setting) => setting.key === 'size'));
  assert.equal(DEFAULT_SETTINGS.size, settingDefinition('size').default);
  assert.equal(subdivisionsFor(normalizeSettings({})), settingDefinition('size').default);
});

test('every size the setting lists is one the generator could build', () => {
  // they are not offered yet, but they are what will be offered — a value that
  // cannot make a planet should not be sitting in the list waiting
  for (const { value } of settingDefinition('size').choices) {
    assert.ok(Number.isInteger(value) && value >= 1, `subdivision ${value} is not buildable`);
  }
});

// --- who you are playing against -------------------------------------------

test('a difficulty is chosen by name, and an unknown one is simply the default', () => {
  // the other choices in the list are numbers, which get rounded and clamped
  // onto the nearest one offered. There is no nearest `hard`, so anything that
  // is not one of the names on the menu falls back rather than landing
  // somewhere arbitrary.
  assert.equal(normalizeSettings({ difficulty: 'expert' }).difficulty, 'expert');
  assert.equal(normalizeSettings({ difficulty: 'hard' }).difficulty, 'hard');
  assert.equal(normalizeSettings({ difficulty: 'normal' }).difficulty, 'normal');
  for (const nonsense of ['brutal', 'HARD', 2, '', null, undefined, {}]) {
    assert.equal(
      normalizeSettings({ difficulty: nonsense }).difficulty,
      DEFAULT_SETTINGS.difficulty,
      `${JSON.stringify(nonsense)} is not a difficulty`
    );
  }
});

test('a numbered option still rounds and clamps, which naming must not have broken', () => {
  assert.equal(normalizeSettings({ players: '5.6' }).players, 6);
  assert.equal(normalizeSettings({ players: 99 }).players, MAX_PLAYERS);
});

test('the difficulty travels in a link and comes back out of one', () => {
  assert.equal(settingsToQuery({ ...DEFAULT_SETTINGS, difficulty: 'hard' }), '?difficulty=hard');
  assert.equal(resolveSettings({ search: '?difficulty=hard' }).difficulty, 'hard');
  assert.equal(
    settingsToQuery({ ...DEFAULT_SETTINGS, difficulty: 'normal' }),
    '',
    'the default setup still has a plain URL'
  );
});

test('the difficulties really are different opponents', () => {
  // Named rather than identified: on this board the two strategies disagree.
  // 'far' can take 'spoils' with eight dice against one, which is the biggest
  // advantage anywhere on the map and what Normal goes for. 'join' is the only
  // thing between two regions of two, so taking it triples what the player
  // earns each turn — which is what Hard is able to see.
  const board = graphState(
    [
      ['a1', { owner: 'p1', dice: 1 }],
      ['a2', { owner: 'p1', dice: 4 }],
      ['join', { owner: 'p2', dice: 1 }],
      ['b1', { owner: 'p1', dice: 1 }],
      ['b2', { owner: 'p1', dice: 1 }],
      ['far', { owner: 'p1', dice: 8 }],
      ['spoils', { owner: 'p2', dice: 1 }],
    ],
    [['a1', 'a2'], ['a2', 'join'], ['join', 'b1'], ['b1', 'b2'], ['far', 'spoils']]
  );

  assert.deepEqual(
    strategyFor({ difficulty: 'hard' })(board, 'p1'),
    { from: 'a2', to: 'join' },
    'Hard plays for the reinforcement'
  );
  assert.deepEqual(
    strategyFor({ difficulty: 'normal' })(board, 'p1'),
    { from: 'far', to: 'spoils' },
    'Normal takes the fattest advantage in front of it'
  );
});

test('Hard is Expert with one thing taken away, and the board can show which', () => {
  // Every attack here is launched from p1's largest region, so the ground is
  // worth taking on all three counts none of them disagree about. What is left
  // to disagree over is what a capture is *for*.
  //
  // 'join' is one die and joins two regions of two into five. 'edge' is four
  // dice of material and grows the region by one. Normal takes the eight
  // against one because it is the fattest advantage on the board; Expert takes
  // the same territory for the income; Hard, which cannot see income at all,
  // takes the four dice instead. Three opponents, one board, and Normal and
  // Expert agreeing on the move for entirely different reasons.
  const board = graphState(
    [
      ['a1', { owner: 'p1', dice: 1 }],
      ['a2', { owner: 'p1', dice: 8 }],
      ['join', { owner: 'p2', dice: 1 }],
      ['b1', { owner: 'p1', dice: 1 }],
      ['b2', { owner: 'p1', dice: 1 }],
      ['edge', { owner: 'p2', dice: 4 }],
    ],
    [['a1', 'a2'], ['a2', 'join'], ['join', 'b1'], ['b1', 'b2'], ['a2', 'edge']]
  );

  assert.deepEqual(strategyFor({ difficulty: 'expert' })(board, 'p1'), { from: 'a2', to: 'join' });
  assert.deepEqual(strategyFor({ difficulty: 'hard' })(board, 'p1'), { from: 'a2', to: 'edge' });
  assert.deepEqual(strategyFor({ difficulty: 'normal' })(board, 'p1'), { from: 'a2', to: 'join' });
});

test('and it keeps the half of Expert that makes it a step up from Normal', () => {
  // 'trap' is a free capture with eight dice behind it, so whoever takes it
  // hands the stack straight back; 'safe' is a smaller prize with nothing
  // waiting. Normal counts the dice advantage and walks in. Hard prices the
  // counter-attack exactly as Expert does — it is the same code with a
  // different `income` — which is what stops the middle rung being Normal in a
  // hat.
  const board = graphState(
    [
      ['x', { owner: 'p1', dice: 8 }],
      ['trap', { owner: 'p2', dice: 1 }],
      ['big', { owner: 'p2', dice: 8 }],
      ['w', { owner: 'p1', dice: 5 }],
      ['safe', { owner: 'p2', dice: 1 }],
    ],
    [['x', 'trap'], ['trap', 'big'], ['w', 'safe']]
  );

  assert.deepEqual(strategyFor({ difficulty: 'normal' })(board, 'p1'), { from: 'x', to: 'trap' });
  assert.deepEqual(strategyFor({ difficulty: 'hard' })(board, 'p1'), { from: 'w', to: 'safe' });
  assert.deepEqual(strategyFor({ difficulty: 'expert' })(board, 'p1'), { from: 'w', to: 'safe' });
});

test('every setup names an opponent, including one that names no difficulty', () => {
  for (const difficulty of [undefined, 'normal', 'hard', 'expert']) {
    assert.equal(typeof strategyFor(normalizeSettings({ difficulty })), 'function');
  }
});

// --- what the menu is allowed to draw --------------------------------------

test('the menu is offered every option except the hidden ones', () => {
  const hidden = SETTING_DEFINITIONS.filter((setting) => setting.hidden).map((s) => s.key);
  assert.ok(hidden.includes('size'), 'size is the one being held back');

  const offered = MENU_SETTINGS.map((setting) => setting.key);
  for (const key of hidden) assert.ok(!offered.includes(key), `${key} should not be drawn`);
  assert.equal(offered.length, SETTING_DEFINITIONS.length - hidden.length);
});

test('a hidden option keeps its place in declaration order for the rest', () => {
  const declared = SETTING_DEFINITIONS.filter((setting) => !setting.hidden).map((s) => s.key);
  assert.deepEqual(MENU_SETTINGS.map((setting) => setting.key), declared);
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
