import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_RESERVE } from '@dicewars/core';
import {
  attackHintText,
  attackHintView,
  playerPanelView,
  scrollLeftToReveal,
} from '../src/render/hud.js';
import {
  DEFAULT_PLAYER_COLORS,
  readableTextColor,
  luminance,
  contrastRatio,
} from '../src/render/palette.js';

const player = (over = {}) => ({
  id: 'p1',
  territories: 5,
  reserve: 0,
  alive: true,
  isCurrent: false,
  isWinner: false,
  ...over,
});

test('a panel shows the territory count plainly and the banked dice as a "+"', () => {
  const view = playerPanelView(player({ territories: 12, reserve: 3 }));
  assert.equal(view.territories, '12');
  assert.equal(view.reserve, '+3', 'banked dice read as pending, not as a second total');
});

test('zero banked dice are hidden rather than shown as "+0"', () => {
  assert.equal(playerPanelView(player({ reserve: 0 })).reserveClasses['is-empty'], true);
  assert.equal(playerPanelView(player({ reserve: 1 })).reserveClasses['is-empty'], false);
});

test('a full reserve is called out', () => {
  const view = playerPanelView(player({ reserve: MAX_RESERVE }));
  assert.equal(view.reserveClasses['is-full'], true);
  assert.equal(playerPanelView(player({ reserve: MAX_RESERVE - 1 })).reserveClasses['is-full'], false);
});

test('the player whose turn it is gets the white border, and only them', () => {
  assert.equal(playerPanelView(player({ isCurrent: true })).classes['is-current'], true);
  assert.equal(playerPanelView(player({ isCurrent: false })).classes['is-current'], false);
});

test('a knocked-out player is marked out rather than removed', () => {
  const view = playerPanelView(player({ alive: false, territories: 0 }));
  assert.equal(view.classes['is-out'], true);
  assert.equal(view.territories, '0');
});

test('the key changes when anything visible changes, and only then', () => {
  const base = playerPanelView(player());
  assert.equal(playerPanelView(player()).key, base.key, 'an unchanged player redraws nothing');

  const changed = [
    { territories: 6 },
    { reserve: 1 },
    { isCurrent: true },
    { alive: false },
    { isWinner: true },
  ];
  for (const over of changed) {
    assert.notEqual(playerPanelView(player(over)).key, base.key, `${Object.keys(over)[0]} should redraw`);
  }
});

// readableTextColor only promises the *better* of the two inks; this checks
// the better one is actually good enough on every color in the palette, which
// is a claim about the palette rather than about the picker.
test('every player color gets ink that stays readable on it', () => {
  for (const color of DEFAULT_PLAYER_COLORS) {
    const ink = readableTextColor(color);
    const ratio = contrastRatio(color, ink);
    assert.ok(
      ratio >= 4.5,
      `${color} vs ${ink} is only ${ratio.toFixed(2)}:1 — below AA for the big number`
    );
  }
});

test('ink flips to dark on pale colors and light on dark ones', () => {
  assert.deepEqual(readableTextColor([0.95, 0.95, 0.95]), [0.06, 0.06, 0.09]);
  assert.deepEqual(readableTextColor([0.1, 0.1, 0.12]), [1, 1, 1]);
  assert.ok(luminance([1, 1, 1]) > luminance([0, 0, 0]));
});

test('purple takes dark ink, the one case a luminance threshold gets wrong', () => {
  const purple = DEFAULT_PLAYER_COLORS[4];
  assert.deepEqual(readableTextColor(purple), [0.06, 0.06, 0.09]);
  assert.ok(contrastRatio(purple, [1, 1, 1]) < 4.5, 'white really would have been too weak');
});

// A row 300px wide holding eight 60px panels, laid end to end.
const row = { scrollLeft: 0, viewportWidth: 300, contentWidth: 480, margin: 10 };
const panelAt = (index) => ({ itemStart: index * 60, itemWidth: 60 });

test('a panel already fully in view does not move the row', () => {
  const at = scrollLeftToReveal({ ...row, ...panelAt(2) }); // 120..180, well inside 0..300
  assert.equal(at, row.scrollLeft, 'no scroll at all');
});

test('a panel off the right edge scrolls just far enough to show it', () => {
  const at = scrollLeftToReveal({ ...row, ...panelAt(6) }); // 360..420
  assert.equal(at, 420 + 10 - 300, 'its end, plus a margin, brought to the right edge');

  const visible = { start: at, end: at + 300 };
  assert.ok(visible.start <= 360 && visible.end >= 420, 'the whole panel is on screen');
});

test('the last panel gives up its margin rather than leaving a gap at the end', () => {
  // 420..480 is flush against the end of the content, so there is nothing left
  // to scroll into the margin — showing the panel is what matters
  const at = scrollLeftToReveal({ ...row, ...panelAt(7) });
  assert.equal(at, 480 - 300, 'scrolled to the very end');
  assert.ok(at + 300 >= 480, 'and the panel is still fully visible');
});

test('a panel off the left edge scrolls back just far enough', () => {
  const at = scrollLeftToReveal({ ...row, scrollLeft: 180, ...panelAt(1) }); // 60..120
  assert.equal(at, 50, 'its start, less a margin');
});

test('the row never scrolls past either end', () => {
  assert.equal(scrollLeftToReveal({ ...row, scrollLeft: 5, ...panelAt(0) }), 0, 'clamped at the start');
  assert.equal(
    scrollLeftToReveal({ ...row, scrollLeft: 0, ...panelAt(7) }),
    Math.min(180, 480 - 300 + 10),
    'clamped at the end'
  );
});

test('a row with nothing to scroll stays put', () => {
  const short = { scrollLeft: 0, viewportWidth: 300, contentWidth: 240, margin: 10 };
  assert.equal(scrollLeftToReveal({ ...short, ...panelAt(3) }), 0);
});

test('a panel wider than the row is shown from its start rather than not at all', () => {
  const at = scrollLeftToReveal({
    scrollLeft: 0,
    viewportWidth: 100,
    contentWidth: 600,
    itemStart: 200,
    itemWidth: 250,
    margin: 10,
  });
  assert.equal(at, 190, 'its leading edge is what you want to read');
});

test('it only ever moves the row by the minimum needed', () => {
  // walking the turn from player to player must not jump the row around when
  // the next player is already on screen
  let scrollLeft = 0;
  const moves = [];
  for (let i = 0; i < 8; i++) {
    const next = scrollLeftToReveal({ ...row, scrollLeft, ...panelAt(i) });
    moves.push(next - scrollLeft);
    scrollLeft = next;
  }
  assert.ok(moves.slice(0, 4).every((m) => m === 0), 'the first four panels are already visible');
  assert.ok(moves.every((m) => m >= 0), 'walking forwards never scrolls backwards');
  assert.equal(scrollLeft, 480 - 300, 'and ends up at the far end of the row');
});

// --- the first-turn prompt --------------------------------------------------

const firstTurn = (over = {}) => ({
  seen: false,
  isHumanTurn: true,
  isOver: false,
  humanEliminated: false,
  coarsePointer: false,
  playerName: 'Red',
  ...over,
});
const sentence = (status) => attackHintText(attackHintView(status));

test('a first-time player is told, in one sentence, both halves of the only move', () => {
  const text = sentence(firstTurn());
  assert.match(text, /your red territories/, 'pick one of yours first');
  assert.match(text, /neighboring enemy/, 'then an adjacent enemy — not any enemy');
});

test('the prompt names the color the player is', () => {
  // "one of your territories" is not actionable until you know which of the
  // eight colors on the planet is yours, and nothing else on screen says so
  // to somebody who has never played
  const view = attackHintView(firstTurn({ playerName: 'Purple' }));
  assert.equal(view.color, 'purple', 'set apart from the sentence so it can be shown in color');
  assert.match(attackHintText(view), /one of your purple territories/);
});

test('the color is the one word held apart, and the sentence still reads whole', () => {
  const view = attackHintView(firstTurn({ playerName: 'Cyan' }));
  assert.equal(view.before, 'Click one of your ', 'a space before it');
  assert.equal(attackHintText(view), 'Click one of your cyan territories, then click a neighboring enemy to attack.');
});

test('with no color to name, the sentence closes over the gap', () => {
  // rather than "one of your  territories" with a hole where a name should be
  const view = attackHintView(firstTurn({ playerName: null }));
  assert.equal(view.color, null);
  assert.equal(attackHintText(view), 'Click one of your territories, then click a neighboring enemy to attack.');
});

test('the prompt is worded for the thing the player is actually using', () => {
  // being told to click on a phone is small, but it makes the rest of the
  // sentence less believable — and this is the one sentence that has to land
  assert.match(sentence(firstTurn({ coarsePointer: true })), /^Tap .* then tap /);
  assert.match(sentence(firstTurn({ coarsePointer: false })), /^Click .* then click /);
});

test('it is said once and then never again', () => {
  assert.equal(attackHintView(firstTurn({ seen: true })), null);
});

test('there is nothing to say when there is no turn to say it about', () => {
  // each of these is advice you could not act on, which is worse than silence
  assert.equal(attackHintView(firstTurn({ isHumanTurn: false })), null, 'an opponent is playing');
  assert.equal(attackHintView(firstTurn({ humanEliminated: true })), null, 'you are out');
  assert.equal(attackHintView(firstTurn({ isOver: true })), null, 'the game is decided');
});

test('a game already over outranks its own turn indicator still pointing at you', () => {
  // a finished game never moves its turn index off the winner, so "is it my
  // turn" answers yes long after there is anything to do
  assert.equal(attackHintView(firstTurn({ isHumanTurn: true, isOver: true })), null);
});


// --- which tile is you ----------------------------------------------------

test('the tile the player owns is marked, and only that one', () => {
  assert.equal(playerPanelView(player({ isYou: true })).classes['is-you'], true);
  assert.equal(playerPanelView(player({ isYou: false })).classes['is-you'], false);
  assert.equal(playerPanelView(player()).classes['is-you'], false, 'unset is not yours');
});

// The mark has to survive every other state a tile can be in at the same time,
// because those are exactly the moments it is most worth knowing which one is
// you: your own turn, and your own knockout.
test('being you is independent of whose turn it is and of being out', () => {
  for (const over of [{ isCurrent: true }, { alive: false, territories: 0 }, { isWinner: true }]) {
    assert.equal(playerPanelView(player({ isYou: true, ...over })).classes['is-you'], true);
  }
});
