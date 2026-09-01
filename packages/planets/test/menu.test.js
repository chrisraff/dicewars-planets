import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingRowView, menuView, menuActionsView } from '../src/render/menu.js';
import {
  MENU_SETTINGS,
  DEFAULT_SETTINGS,
  settingDefinition,
  normalizeSettings,
} from '../src/game/settings.js';

const players = settingDefinition('players');
const moon = settingDefinition('moon');

test('a choice row marks exactly the value in force', () => {
  const row = settingRowView(players, 6);
  assert.equal(row.choices.filter((choice) => choice.selected).length, 1);
  assert.equal(row.choices.find((choice) => choice.selected).value, 6);
});

test('a choice row offers every value the setting allows, in order', () => {
  const row = settingRowView(players, 4);
  assert.deepEqual(
    row.choices.map((choice) => choice.value),
    players.choices.map((choice) => choice.value)
  );
});

test('an option that is available is not disabled and carries no note', () => {
  const row = settingRowView(players, 4);
  assert.equal(row.disabled, false);
  assert.equal(row.note, null);
});

test('an option whose feature is unbuilt is disabled, and says why', () => {
  const row = settingRowView(moon, false);
  assert.equal(row.disabled, true);
  assert.equal(row.note, moon.note, 'the menu should not leave it a mystery');
  assert.ok(row.help.length > 0, 'and should still explain what it will do');
});

// The line under an option is optional, and an option that has had its line
// taken away must not leave an empty paragraph propping the gap open.
test('an option with nothing worth adding says nothing, rather than saying it blankly', () => {
  const bare = { key: 'k', label: 'L', kind: 'choice', default: 1, available: true,
    choices: [{ value: 1, label: 'one' }, { value: 2, label: 'two' }] };

  assert.equal(settingRowView(bare, 1).help, null, 'no help at all');
  assert.equal(settingRowView({ ...bare, help: '' }, 1).help, null, 'and an empty one is none');
});

test('an unavailable toggle shows its default however it is asked', () => {
  // a stale stored setting or a hand-edited URL must not make the menu claim
  // something is on when the pipeline will refuse to turn it on
  assert.equal(settingRowView(moon, true).checked, moon.default);
  assert.equal(settingRowView(moon, false).checked, moon.default);
});

test('every row carries what the menu needs to draw it', () => {
  for (const row of menuView(DEFAULT_SETTINGS)) {
    assert.ok(row.key && row.label, `${row.key} is missing its text`);
    // Either a real sentence or nothing at all — never the empty string, which
    // the menu would hold a paragraph open for.
    assert.ok(row.help === null || row.help.length > 0, `${row.key} has a blank help line`);
    assert.ok(['choice', 'toggle', 'seat'].includes(row.kind), `${row.key} has an odd kind`);

    if (row.kind === 'choice') assert.ok(row.choices.length > 1);
    if (row.kind === 'toggle') assert.equal(typeof row.checked, 'boolean');
    if (row.kind === 'seat') {
      assert.ok(row.modes.length > 1, 'a seat row needs its ranges');
      assert.equal(row.seats.length, DEFAULT_SETTINGS.players, 'one seat per player');
    }
  }
});

test('the menu draws one row per offered option, in declaration order', () => {
  // MENU_SETTINGS rather than every definition: an option can be declared and
  // carried through the pipeline without being shown to anyone yet
  assert.deepEqual(
    menuView(DEFAULT_SETTINGS).map((row) => row.key),
    MENU_SETTINGS.map((setting) => setting.key)
  );
});

test('the menu normalizes what it is given rather than trusting it', () => {
  const row = menuView({ players: 99 }).find((r) => r.key === 'players');
  const selected = row.choices.find((choice) => choice.selected);

  assert.ok(selected, 'an out-of-range value still leaves something selected');
  assert.equal(selected.value, normalizeSettings({ players: 99 }).players);
});

test('a menu built from no settings at all still shows the defaults', () => {
  for (const row of menuView({})) {
    const setting = settingDefinition(row.key);
    if (row.kind === 'toggle') assert.equal(row.checked, setting.default);
    if (row.kind === 'choice') assert.equal(row.choices.find((c) => c.selected).value, setting.default);
    if (row.kind === 'seat') assert.equal(row.modes.find((m) => m.selected).value, setting.default);
  }
});

// --- the seat row --------------------------------------------------------

const start = settingDefinition('start');
const seatRow = (settings) => menuView(settings).find((row) => row.key === 'start');
const shape = (row) =>
  row.seats.map((s) => (s.picked ? 'X' : s.inRange ? '=' : '.')).join('');

test('the row has one seat per player, and follows the player count', () => {
  assert.equal(seatRow({ players: 3 }).seats.length, 3);
  assert.equal(seatRow({ players: 8 }).seats.length, 8);
  assert.deepEqual(seatRow({ players: 4 }).seats.map((s) => s.seat), [1, 2, 3, 4]);
});

test('a range paints the part of the row it covers, and picks no single seat', () => {
  assert.equal(shape(seatRow({ players: 6, start: 'any' })), '======');
  assert.equal(shape(seatRow({ players: 6, start: 'early' })), '===...');
  assert.equal(shape(seatRow({ players: 6, start: 'late' })), '...===');
});

test('with an odd table the middle seat is in both halves, not neither', () => {
  assert.equal(shape(seatRow({ players: 5, start: 'early' })), '===..');
  assert.equal(shape(seatRow({ players: 5, start: 'late' })), '..===');
});

test('picking a seat lights that one alone and clears the range', () => {
  const row = seatRow({ players: 6, start: 4 });
  assert.equal(shape(row), '...X..');
  assert.equal(row.modes.some((mode) => mode.selected), false, 'no range is in force');
});

test('exactly one range is marked when a range is in force', () => {
  const row = seatRow({ players: 4, start: 'late' });
  assert.deepEqual(row.modes.filter((m) => m.selected).map((m) => m.value), ['late']);
  assert.equal(row.seats.some((s) => s.picked), false);
});

test('each seat carries the color that seat plays as', () => {
  const row = seatRow({ players: 8 });
  const colors = row.seats.map((s) => s.color.join());
  assert.equal(new Set(colors).size, 8, 'every seat is a different color');
  for (const seat of row.seats) assert.equal(seat.color.length, 3);
});

test('a seat that no longer exists is pulled back onto the row', () => {
  // choose seat 7, then turn the table down to four
  const row = seatRow({ players: 4, start: 7 });
  assert.equal(shape(row), '...X', 'the last seat, rather than nothing selected');
});

test('the ranges offered are the ones the setting declares', () => {
  assert.deepEqual(
    seatRow(DEFAULT_SETTINGS).modes.map((mode) => mode.value),
    start.modes.map((mode) => mode.value)
  );
});

// --- the buttons along the bottom ---------------------------------------

test('a first visit offers one way on, and it leads', () => {
  const actions = menuActionsView();

  assert.equal(actions.resume.hidden, true, 'there is no game behind this menu');
  assert.equal(actions.continue.hidden, true, 'and none saved from before');
  assert.equal(actions.start.label, 'New game');
  assert.equal(actions.focus, 'start');
});

test('a saved game is what the menu leads with, and starting over steps aside', () => {
  const actions = menuActionsView({ canContinue: true });

  assert.equal(actions.continue.hidden, false);
  assert.equal(actions.start.secondary, true, 'the filled button is the one that continues');
  assert.equal(actions.focus, 'continue', 'so pressing enter picks the game back up');
});

test('opened from inside a match, starting again says what it costs', () => {
  const actions = menuActionsView({ canResume: true });

  assert.equal(actions.resume.hidden, false, 'and there is a way back');
  assert.equal(
    actions.start.label,
    'Start over',
    'a game is already running — "New game" would not say it is being thrown away'
  );
});

test('a match already on screen is never also offered as one to continue', () => {
  // both at once would be two buttons for the same game, one of them restarting
  // it from the last save rather than from where it actually is
  const actions = menuActionsView({ canResume: true, canContinue: false });
  assert.equal(actions.continue.hidden, true);
  assert.equal(actions.start.secondary, false, 'so starting over keeps the primary look');
});
