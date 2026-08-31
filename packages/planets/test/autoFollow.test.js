import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AIM_FIGHTS,
  AIM_HOME,
  AIM_REPLAY,
  aimKind,
  createAutoFollow,
  dragTakesCamera,
  panHomeBlocked,
} from '../src/game/autoFollow.js';

// --- which drags count ------------------------------------------------------
//
// Two different rules were conflated here once: whether a drag is recorded,
// and how long the offer that follows stays up. Only the first is decided
// here, and it asks about the turn the drag happened on and nothing else.

test('a drag during somebody else\'s turn takes the camera', () => {
  assert.equal(dragTakesCamera({ isHumanTurn: false }), true);
});

test('a drag during the player\'s own turn does not, because nothing is suppressed', () => {
  // Every automatic move belongs to a turn that is not theirs or to a handover
  // at one end of it, so there would be nothing to hand back — and the offer
  // would be a button up through the one part of the match they are playing.
  assert.equal(dragTakesCamera({ isHumanTurn: true }), false);
});

test('a drag in a replay always counts, whoever the paused board belongs to', () => {
  // The exemption above is about the *live* match. A replay swings to every
  // step it plays regardless of whose turn the board it is standing on was,
  // so there is always something for a drag to suppress.
  assert.equal(dragTakesCamera({ replayOpen: true, isHumanTurn: true }), true);
  assert.equal(dragTakesCamera({ replayOpen: true, isHumanTurn: false }), true);
});

// --- where a press goes -----------------------------------------------------

test('on an AI turn with fights in flight, a press goes to the fight', () => {
  // Not home: the run being shown is the thing the button was pressed to catch
  // up with, and home is the one part of the planet nothing is happening on.
  assert.equal(aimKind({ isAiTurn: true, fightCount: 3 }), AIM_FIGHTS);
});

test('on the player\'s own turn a press goes home', () => {
  assert.equal(aimKind({ isAiTurn: false, fightCount: 3 }), AIM_HOME);
});

test('an AI turn with nothing in flight goes home too', () => {
  // The gaps between runs are just as much "nothing to catch up with" as the
  // player's own turn is.
  assert.equal(aimKind({ isAiTurn: true, fightCount: 0 }), AIM_HOME);
});

test('a replay answers first, whoever the paused board belongs to', () => {
  // The live board underneath is not what is being watched, so neither whose
  // turn it is nor what the AI has queued can reach the answer.
  assert.equal(aimKind({ replayOpen: true, replayStep: 4, isAiTurn: true, fightCount: 9 }), AIM_REPLAY);
  assert.equal(aimKind({ replayOpen: true, replayStep: 4, isAiTurn: false }), AIM_REPLAY);
});

test('a replay standing on its opening board has nowhere to aim', () => {
  // Step 0 is the board before the first attack — there is no fight to swing
  // to, and answering `home` would take the viewer off the replay entirely.
  assert.equal(aimKind({ replayOpen: true, replayStep: 0 }), null);
});

// --- when the pan home is held back -----------------------------------------

test('nothing blocks the pan home in an ordinary handover', () => {
  assert.equal(panHomeBlocked({}), false);
});

test('each of the four states blocks it on its own', () => {
  for (const state of ['humanEliminated', 'isOver', 'replayOpen', 'bannerHolding']) {
    assert.equal(panHomeBlocked({ [state]: true }), true, `${state} should block the pan`);
  }
});

test('being freed is not one of them', () => {
  // A hand on the planet suppresses the pan but *not* the flash that runs with
  // it, so it cannot be folded in here: the flash is information about the
  // match rather than a movement of the camera, and somebody studying the
  // board is exactly who most needs telling their turn has come round.
  assert.equal(panHomeBlocked({ freed: true }), false);
});

// --- the state behind them --------------------------------------------------

test('a session starts out following, with nothing queued', () => {
  const autoFollow = createAutoFollow();
  assert.equal(autoFollow.freed, false);
  assert.deepEqual(autoFollow.fights, []);
});

test('taking the camera reports the change, and reports nothing the second time', () => {
  // The caller repaints the offer off this answer, and `refreshBoard` runs
  // every frame while dice are in the air — so a drag that changes nothing
  // must say so rather than rewriting the HUD sixty times a second.
  const autoFollow = createAutoFollow();
  assert.equal(autoFollow.takeCamera({ isHumanTurn: false }), true);
  assert.equal(autoFollow.freed, true);
  assert.equal(autoFollow.takeCamera({ isHumanTurn: false }), false);
});

test('a drag that does not count leaves the camera alone', () => {
  const autoFollow = createAutoFollow();
  assert.equal(autoFollow.takeCamera({ isHumanTurn: true }), false);
  assert.equal(autoFollow.freed, false);
});

test('giving it back reports the change, and reports nothing when it was never taken', () => {
  const autoFollow = createAutoFollow();
  assert.equal(autoFollow.giveBack(), false, 'nothing to give back');
  autoFollow.takeCamera({ isHumanTurn: false });
  assert.equal(autoFollow.giveBack(), true);
  assert.equal(autoFollow.freed, false);
});

test('handing the planet between the live board and a replay resets outright', () => {
  // One planet, two things that drive it: whichever has just been handed it
  // starts out driving, so this is not a `giveBack` that could decline.
  const autoFollow = createAutoFollow();
  autoFollow.takeCamera({ isHumanTurn: false });
  autoFollow.reset();
  assert.equal(autoFollow.freed, false);
});

test('the offer outlives the turn the drag was taken on', () => {
  // The case this exists for: a drag during an AI turn suppresses the pan
  // home, so the player's own turn *opens* on the view they chose. Taking the
  // offer down at the handover would leave them holding a board they cannot
  // see with nothing on screen to fix it — so nothing about whose turn it is
  // may reach `freed` after the drag.
  const autoFollow = createAutoFollow();
  autoFollow.takeCamera({ isHumanTurn: false });
  assert.equal(autoFollow.freed, true, 'still freed once the turn hands over');
  assert.equal(autoFollow.aimKind({ isAiTurn: false }), AIM_HOME);
  assert.equal(autoFollow.freed, true, 'and asking where to aim does not answer it');
});

test('the run being shown is what a press mid-AI-turn aims at, and empties at endTurn', () => {
  const autoFollow = createAutoFollow();
  assert.equal(autoFollow.aimKind({ isAiTurn: true }), AIM_HOME, 'nothing queued yet');

  autoFollow.showing([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]);
  assert.equal(autoFollow.aimKind({ isAiTurn: true }), AIM_FIGHTS);
  assert.deepEqual(autoFollow.fights, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]);

  autoFollow.showing([]);
  assert.equal(autoFollow.aimKind({ isAiTurn: true }), AIM_HOME, 'the run is over');
});
