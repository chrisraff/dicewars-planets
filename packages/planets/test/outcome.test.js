import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnIndicatorView, outcomeView } from '../src/render/hud.js';

const names = new Map([['p1', 'Red'], ['p2', 'Blue'], ['p3', 'Yellow']]);
const nameOf = (id) => names.get(id) ?? id;

const playing = (over = {}) => ({
  currentPlayerId: 'p1',
  humanPlayerId: 'p1',
  winner: null,
  isOver: false,
  humanEliminated: false,
  canAct: true,
  ...over,
});

// --- whose turn it is -----------------------------------------------------

test('your own turn offers the end-turn button', () => {
  const view = turnIndicatorView(playing(), nameOf);
  assert.equal(view.text, 'Your turn');
  assert.equal(view.endTurn, 'ready');
});

test('your turn mid-roll shows the button but will not take it', () => {
  const view = turnIndicatorView(playing({ canAct: false }), nameOf);
  assert.equal(view.text, 'Your turn');
  assert.equal(view.endTurn, 'waiting', 'the button stays put rather than vanishing under the cursor');
});

test('someone else’s turn names them and hides the button', () => {
  const view = turnIndicatorView(playing({ currentPlayerId: 'p2' }), nameOf);
  assert.equal(view.text, 'Blue is playing');
  assert.equal(view.playerId, 'p2', 'the dot takes their color');
  assert.equal(view.endTurn, 'hidden');
});

// A finished game never moves its turn index off the winner, so asking whose
// turn it is afterwards gives a live-looking answer to a dead question.
test('once it is over the indicator reports the result, not a turn', () => {
  const won = turnIndicatorView(playing({ isOver: true, winner: 'p1' }), nameOf);
  assert.equal(won.text, 'You win', 'not "Your turn", which is what the raw state still implies');
  assert.equal(won.endTurn, 'hidden');

  const lost = turnIndicatorView(
    playing({ isOver: true, winner: 'p2', currentPlayerId: 'p2' }),
    nameOf
  );
  assert.equal(lost.text, 'Blue wins');
  assert.equal(lost.playerId, 'p2');
});

test('a player knocked out mid-game is told they are watching', () => {
  const view = turnIndicatorView(
    playing({ currentPlayerId: 'p2', humanEliminated: true }),
    nameOf
  );
  assert.equal(view.text, 'You are out — watching');
  assert.equal(view.endTurn, 'hidden');
});

test('the result outranks being knocked out earlier', () => {
  const view = turnIndicatorView(
    playing({ isOver: true, winner: 'p2', humanEliminated: true }),
    nameOf
  );
  assert.equal(view.text, 'Blue wins');
});

test('a game with no winner at all still says something sensible', () => {
  const view = turnIndicatorView(playing({ isOver: true, winner: null }), nameOf);
  assert.equal(view.text, 'Nobody wins');
  assert.equal(view.endTurn, 'hidden');
});

// --- the banner -----------------------------------------------------------

const actionIds = (view) => view.actions.map((action) => action.id);
const primary = (view) => view.actions.find((action) => action.primary);

test('winning is announced as yours, not by your color name', () => {
  const view = outcomeView({ kind: 'over', winner: 'p1', humanPlayerId: 'p1' }, nameOf);
  assert.equal(view.kind, 'won');
  assert.equal(view.title, 'You win');
  assert.ok(view.detail.length > 0);
});

test('losing names the winner and takes their color', () => {
  const view = outcomeView({ kind: 'over', winner: 'p2', humanPlayerId: 'p1' }, nameOf);
  assert.equal(view.kind, 'lost');
  assert.equal(view.title, 'Blue wins');
  assert.equal(view.playerId, 'p2');
});

test('a finished game offers a new one, and a way to just look at the board', () => {
  const view = outcomeView({ kind: 'over', winner: 'p1', humanPlayerId: 'p1' }, nameOf);
  assert.deepEqual(actionIds(view), ['newGame', 'dismiss']);
  assert.equal(primary(view).id, 'newGame');
});

test('a match nobody ever attacked in has nothing for a replay to show', () => {
  const view = outcomeView(
    { kind: 'over', winner: 'p1', humanPlayerId: 'p1', canReplay: false },
    nameOf
  );
  assert.deepEqual(actionIds(view), ['newGame', 'dismiss'], 'no replay action offered');
});

test('a fought-out match offers to watch the replay, between starting over and looking on', () => {
  const view = outcomeView(
    { kind: 'over', winner: 'p1', humanPlayerId: 'p1', canReplay: true },
    nameOf
  );
  assert.deepEqual(actionIds(view), ['newGame', 'replay', 'dismiss']);
  assert.equal(primary(view).id, 'newGame', 'starting over still leads');
});

test('being knocked out says who did it and offers to keep watching', () => {
  const view = outcomeView({ kind: 'eliminated', by: 'p3', humanPlayerId: 'p1' }, nameOf);
  assert.equal(view.kind, 'eliminated');
  assert.equal(view.title, 'You are out');
  assert.match(view.detail, /Yellow/, 'it should name whoever finished you off');
  assert.equal(view.playerId, 'p3');
});

test('watching on is the gentler of the two, so it leads', () => {
  const view = outcomeView({ kind: 'eliminated', by: 'p2', humanPlayerId: 'p1' }, nameOf);
  assert.deepEqual(actionIds(view), ['watch', 'newGame']);
  assert.equal(primary(view).id, 'watch', 'nothing is thrown away by carrying on');
});

test('every banner offers a way out of itself', () => {
  const banners = [
    outcomeView({ kind: 'over', winner: 'p1', humanPlayerId: 'p1' }, nameOf),
    outcomeView({ kind: 'over', winner: 'p2', humanPlayerId: 'p1' }, nameOf),
    outcomeView({ kind: 'over', winner: null, humanPlayerId: 'p1' }, nameOf),
    outcomeView({ kind: 'eliminated', by: 'p2', humanPlayerId: 'p1' }, nameOf),
  ];
  for (const view of banners) {
    assert.ok(view.actions.length >= 2, `${view.kind} needs more than one way on`);
    assert.equal(view.actions.filter((a) => a.primary).length, 1, 'exactly one leads');
    assert.ok(view.actions.every((a) => a.label.length > 0));
  }
});

test('a knockout with nobody to blame still reads properly', () => {
  const view = outcomeView({ kind: 'eliminated', by: null, humanPlayerId: 'p1' }, nameOf);
  assert.equal(view.title, 'You are out');
  assert.doesNotMatch(view.detail, /null|undefined/);
});

test('with no names to hand it falls back to raw ids rather than blanks', () => {
  const view = outcomeView({ kind: 'over', winner: 'p9', humanPlayerId: 'p1' });
  assert.equal(view.title, 'p9 wins');
});
