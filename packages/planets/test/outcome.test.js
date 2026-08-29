import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  turnIndicatorText,
  turnIndicatorView,
  outcomeView,
  replayButtonView,
  SURRENDER_DETAIL,
} from '../src/render/hud.js';

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

const line = (status) => turnIndicatorText(turnIndicatorView(status, nameOf));

test('your own turn offers the end-turn button', () => {
  const view = turnIndicatorView(playing(), nameOf);
  assert.equal(turnIndicatorText(view), 'Your turn');
  assert.equal(view.endTurn, 'ready');
});

test('your turn mid-roll shows the button but will not take it', () => {
  const view = turnIndicatorView(playing({ canAct: false }), nameOf);
  assert.equal(turnIndicatorText(view), 'Your turn');
  assert.equal(view.endTurn, 'waiting', 'the button stays put rather than vanishing under the cursor');
});

// The corner is about *you*, not about whoever is playing. Naming the current
// player was three ways redundant — the stats row borders them, the rail
// carries your color while the turn is yours — and it answered a question
// nobody was asking. What a random seat leaves you needing is which of these
// colors you are.
test('between your turns it names your color, not the player taking one', () => {
  const view = turnIndicatorView(playing({ currentPlayerId: 'p2' }), nameOf);
  assert.equal(turnIndicatorText(view), 'You are red');
  assert.equal(view.color, 'red', 'a word set in that color, so it is its own part');
  assert.equal(view.playerId, 'p1', 'and the color is yours, not the player playing');
  assert.equal(view.endTurn, 'hidden');
});

// One sentence at two moments: told you are red, a red dot is what makes
// "Your turn" mean the same red. A second chip spelling the word out again
// would read as a change of subject.
test('the color is a word between your turns and a dot on them', () => {
  assert.equal(turnIndicatorView(playing({ currentPlayerId: 'p2' }), nameOf).dot, false);
  assert.equal(turnIndicatorView(playing(), nameOf).dot, true);
  assert.equal(turnIndicatorView(playing(), nameOf).color, null, 'the dot is the color here');
});

// Persistent means persistent: your color is your seat, the seat is drawn
// fresh every match, and the line is there for every turn of it.
test('it says which color you are on every turn that is not yours', () => {
  for (const current of ['p2', 'p3']) {
    assert.equal(line(playing({ currentPlayerId: current })), 'You are red');
  }
});

// A finished game never moves its turn index off the winner, so asking whose
// turn it is afterwards gives a live-looking answer to a dead question.
test('once it is over the indicator reports the result, not a turn', () => {
  const won = turnIndicatorView(playing({ isOver: true, winner: 'p1' }), nameOf);
  assert.equal(turnIndicatorText(won), 'You win', 'not "Your turn", which the raw state still implies');
  assert.equal(won.endTurn, 'hidden');

  const lost = turnIndicatorView(
    playing({ isOver: true, winner: 'p2', currentPlayerId: 'p2' }),
    nameOf
  );
  assert.equal(turnIndicatorText(lost), 'Blue wins');
  assert.equal(lost.playerId, 'p2');
});

// Every ending marks whoever it is about, in their own color — which for your
// own win is the word "You" and for anyone else's is their name.
test('an ending marks who it is about, in their color', () => {
  const won = turnIndicatorView(playing({ isOver: true, winner: 'p1' }), nameOf);
  assert.equal(won.color, 'You');
  assert.equal(won.playerId, 'p1');

  const lost = turnIndicatorView(playing({ isOver: true, winner: 'p2' }), nameOf);
  assert.equal(lost.color, 'Blue', 'their name, in their color');
  assert.equal(lost.playerId, 'p2');
});

// The rule that makes the dot worth anything: it appears on exactly one line
// in the whole game, so its arrival is part of what says the planet is yours
// again rather than a decoration that has been sitting there changing color.
test('the dot means "yours, now", and appears nowhere else', () => {
  assert.equal(turnIndicatorView(playing(), nameOf).dot, true, 'your own turn');

  const others = [
    playing({ currentPlayerId: 'p2' }),
    playing({ isOver: true, winner: 'p1' }),
    playing({ isOver: true, winner: 'p2' }),
    playing({ isOver: true, winner: null }),
    playing({ humanEliminated: true, currentPlayerId: 'p2' }),
  ];
  for (const status of others) {
    assert.equal(turnIndicatorView(status, nameOf).dot, false, turnIndicatorText(turnIndicatorView(status, nameOf)));
  }
});

// Names nobody, so it marks nobody — neither a chip nor a dot, just the line.
test('a drawn game marks nothing at all', () => {
  const view = turnIndicatorView(playing({ isOver: true, winner: null }), nameOf);
  assert.equal(view.color, null);
  assert.equal(view.dot, false);
});

// Marked rather than dotted, and marked in *your* color. The dot is whoever
// is playing, and once you are out that is never you again — a dot following
// the match around would be the corner quietly going back to reporting other
// people, which is the thing it was rewritten to stop doing.
test('a player knocked out mid-game is told they are watching', () => {
  const view = turnIndicatorView(
    playing({ currentPlayerId: 'p2', humanEliminated: true }),
    nameOf
  );
  assert.equal(turnIndicatorText(view), 'You are out — watching');
  assert.equal(view.color, 'You', 'the word that is set in a color');
  assert.equal(view.playerId, 'p1', 'and the color is yours, not the player still playing');
  assert.equal(view.dot, false);
  assert.equal(view.endTurn, 'hidden');
});

// `humanEliminated` is derived from whether the human seat still holds ground,
// so an empty seat reads as eliminated. Without the autoplay check coming
// first, an unattended match would announce that somebody had been knocked out
// of a game they were never in.
test('an unattended match is not announced as somebody being knocked out', () => {
  const view = turnIndicatorView(
    playing({ humanPlayerId: Symbol('autoplay'), humanEliminated: true }),
    nameOf
  );
  assert.equal(view.show, false);
});

// But a result is worth reading whoever was playing, so it still outranks the
// empty seat.
test('an unattended match still reports how it ended', () => {
  const view = turnIndicatorView(
    playing({ humanPlayerId: Symbol('autoplay'), isOver: true, winner: 'p2' }),
    nameOf
  );
  assert.equal(view.show, true);
  assert.equal(turnIndicatorText(view), 'Blue wins');
});

test('the result outranks being knocked out earlier', () => {
  assert.equal(line(playing({ isOver: true, winner: 'p2', humanEliminated: true })), 'Blue wins');
});

test('a game with no winner at all still says something sensible', () => {
  const view = turnIndicatorView(playing({ isOver: true, winner: null }), nameOf);
  assert.equal(turnIndicatorText(view), 'Nobody wins');
  assert.equal(view.endTurn, 'hidden');
});

// An unattended match — `createGame`'s AUTOPLAY leaves nobody in the human
// seat. A line about which color you are has no subject, so it says nothing
// rather than naming a seat nobody is sitting in.
test('with nobody at the keyboard it says nothing at all', () => {
  const view = turnIndicatorView(playing({ humanPlayerId: Symbol('autoplay') }), nameOf);
  assert.equal(view.show, false);
});

// What the rail under the controls is driven from. Deliberately not "is the
// current player the human" recomputed at the call site: a finished game never
// moves its turn index off the winner, so that keeps answering yes long after
// there is a turn to take.
test('the rail is lit for your turn and for nothing else', () => {
  assert.equal(turnIndicatorView(playing(), nameOf).isYours, true);
  assert.equal(turnIndicatorView(playing({ currentPlayerId: 'p2' }), nameOf).isYours, false);
  assert.equal(turnIndicatorView(playing({ isOver: true, winner: 'p1' }), nameOf).isYours, false);
  assert.equal(turnIndicatorView(playing({ humanEliminated: true }), nameOf).isYours, false);
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

test('winning because everyone gave up still reads as winning', () => {
  const view = outcomeView({ kind: 'surrendered', humanPlayerId: 'p1' }, nameOf);
  assert.equal(view.kind, 'won', 'it wears the same face as any other win');
  assert.equal(view.title, 'You win');
  assert.equal(view.playerId, 'p1');
});

test('a win by surrender does not claim the whole planet, because it is not yours', () => {
  // the board is typically a quarter still in play when this goes up — the
  // one banner in the game whose wording has to survive being read against
  // the planet behind it
  const view = outcomeView({ kind: 'surrendered', humanPlayerId: 'p1' }, nameOf);
  const outright = outcomeView({ kind: 'over', winner: 'p1', humanPlayerId: 'p1' }, nameOf);

  assert.notEqual(view.detail, outright.detail);
  assert.equal(view.detail, SURRENDER_DETAIL);
});

test('a win by surrender offers to play on, in place of looking at the board', () => {
  // dismissing this banner and carrying on with the match are the same act,
  // so there is no separate way to just look
  const view = outcomeView({ kind: 'surrendered', humanPlayerId: 'p1', canReplay: true }, nameOf);

  assert.deepEqual(actionIds(view), ['newGame', 'replay', 'playOn']);
  assert.equal(primary(view).id, 'newGame');
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

// Being knocked out is the moment there is most to look back at: the match you
// were playing is over, whatever the board goes on doing without you.
test('being knocked out offers the replay too, between staying and starting again', () => {
  const knockout = { kind: 'eliminated', by: 'p2', humanPlayerId: 'p1', canReplay: true };
  const view = outcomeView(knockout, nameOf);
  assert.deepEqual(actionIds(view), ['watch', 'replay', 'newGame'], 'gentlest first');
  assert.equal(primary(view).id, 'watch', 'looking back is not the thing that leads');
});

test('every banner that can offer a replay offers it by the same name', () => {
  const offered = [
    outcomeView({ kind: 'over', winner: 'p2', humanPlayerId: 'p1', canReplay: true }, nameOf),
    outcomeView({ kind: 'surrendered', humanPlayerId: 'p1', canReplay: true }, nameOf),
    outcomeView({ kind: 'eliminated', by: 'p2', humanPlayerId: 'p1', canReplay: true }, nameOf),
  ];
  for (const view of offered) {
    const action = view.actions.find((a) => a.id === 'replay');
    assert.ok(action, `${view.kind} should offer a replay`);
    assert.equal(action.label, 'Watch replay');
    assert.equal(action.primary, false, 'it is never the thing that leads');
  }
});

test('a knockout in a match nobody attacked in offers no replay', () => {
  const view = outcomeView({ kind: 'eliminated', by: 'p2', humanPlayerId: 'p1' }, nameOf);
  assert.equal(actionIds(view).includes('replay'), false);
});

test('every banner offers a way out of itself', () => {
  const banners = [
    outcomeView({ kind: 'over', winner: 'p1', humanPlayerId: 'p1' }, nameOf),
    outcomeView({ kind: 'over', winner: 'p2', humanPlayerId: 'p1' }, nameOf),
    outcomeView({ kind: 'over', winner: null, humanPlayerId: 'p1' }, nameOf),
    outcomeView({ kind: 'eliminated', by: 'p2', humanPlayerId: 'p1' }, nameOf),
    outcomeView({ kind: 'surrendered', humanPlayerId: 'p1' }, nameOf),
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

// --- the way back into a replay -------------------------------------------

const afterAttacks = (over = {}) => ({
  hasReplay: true,
  isOver: false,
  humanEliminated: false,
  playedOn: false,
  ...over,
});

test('mid-match there is no replay button', () => {
  assert.equal(replayButtonView(afterAttacks()), 'hidden');
});

// The three states the banner can offer a replay from. Each has to keep
// offering one afterwards, because every one of them has a way of dismissing
// the banner that used to be final: "Look at the board", "Spectate" and
// "Play on" all left the replay one press away and unreachable.
test('every ending the banner can offer a replay from keeps offering one', () => {
  for (const ending of [{ isOver: true }, { humanEliminated: true }, { playedOn: true }]) {
    assert.equal(replayButtonView(afterAttacks(ending)), 'shown', JSON.stringify(ending));
  }
});

// Playing on is the case a session flag would get wrong: the match carries
// straight on, no banner is up, and a reload has nothing to re-raise — so the
// answer has to come from `playedOn` in the save rather than from having
// watched the banner go up.
test('playing on past a surrender keeps the button through the rest of the match', () => {
  const playingOn = afterAttacks({ playedOn: true, isOver: false, humanEliminated: false });
  assert.equal(replayButtonView(playingOn), 'shown');
});

test('a match with nothing fought in it offers nothing, however it ended', () => {
  for (const ending of [{ isOver: true }, { humanEliminated: true }, { playedOn: true }]) {
    const view = replayButtonView(afterAttacks({ ...ending, hasReplay: false }));
    assert.equal(view, 'hidden', 'an empty replay is worse than no button');
  }
});

test('an empty status is answered rather than thrown at', () => {
  assert.equal(replayButtonView({}), 'hidden');
});


