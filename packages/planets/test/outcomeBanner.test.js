import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BANNER_RULES, createOutcomeBanner } from '../src/game/outcomeBanner.js';

const OVER = { kind: 'over', winner: 'p1', humanPlayerId: 'p1', canReplay: true };
const SURRENDERED = { kind: 'surrendered', humanPlayerId: 'p1', canReplay: true };
const ELIMINATED = { kind: 'eliminated', by: 'p2', humanPlayerId: 'p1', canReplay: true };

function setup() {
  const shown = [];
  let hidden = 0;
  const banner = createOutcomeBanner({
    show: (outcome) => shown.push(outcome),
    hide: () => { hidden += 1; },
  });
  return { banner, shown, hides: () => hidden };
}

// --- the two columns of the table -------------------------------------------

test('a match still running is held behind its banner', () => {
  // Without the hold the AIs go on taking turns underneath: you are told you
  // are out while the planet carries on being carved up, and dismissing the
  // banner drops you into a board several turns past the one it went up over.
  for (const outcome of [SURRENDERED, ELIMINATED]) {
    const { banner } = setup();
    banner.raise(outcome);
    assert.equal(banner.holding, true, `${outcome.kind} should hold the match`);
  }
});

test('a match that has actually ended is not, because there is nothing to hold', () => {
  const { banner } = setup();
  banner.raise(OVER);
  assert.equal(banner.holding, false);
});

test('a win and a surrender are endings to come back to', () => {
  for (const outcome of [OVER, SURRENDERED]) {
    const { banner } = setup();
    banner.raise(outcome);
    assert.equal(banner.ending, outcome, `${outcome.kind} should be remembered`);
  }
});

test('a knockout is not, because the match carries on without you', () => {
  // A game going on without you has no ending screen to be returned to, so
  // closing a replay opened from here drops you back on the board instead.
  const { banner, shown } = setup();
  banner.raise(ELIMINATED);
  assert.equal(banner.ending, null);

  shown.length = 0;
  banner.restore();
  assert.deepEqual(shown, [], 'nothing to put back');
});

test('an unrecognised banner holds the match, which is the safe way round', () => {
  // A banner that holds can always be answered; one that does not lets the
  // board move underneath it.
  const { banner } = setup();
  banner.raise({ kind: 'something-new' });
  assert.equal(banner.holding, true);
  assert.equal(banner.ending, null);
});

test('the table covers exactly the three banners `outcomeView` can produce', () => {
  assert.deepEqual(Object.keys(BANNER_RULES).sort(), ['eliminated', 'over', 'surrendered']);
});

// --- answering it -----------------------------------------------------------

test('any answer releases the hold', () => {
  const { banner } = setup();
  banner.raise(SURRENDERED);
  banner.answered();
  assert.equal(banner.holding, false);
});

test('but answering does not forget the ending, so the replay door still leads back', () => {
  // "Watch replay" answers the question and hands the hold to the replay; the
  // banner has to still be there when the overlay closes.
  const { banner, shown } = setup();
  banner.raise(SURRENDERED);
  banner.answered();

  shown.length = 0;
  banner.restore();
  assert.deepEqual(shown, [SURRENDERED]);
});

test('playing on does forget it — the banner has been declined', () => {
  // A replay closing afterwards should put the player on the board rather than
  // back in front of a question they have already answered.
  const { banner, shown } = setup();
  banner.raise(SURRENDERED);
  banner.answered();
  banner.playedOn();

  shown.length = 0;
  banner.restore();
  assert.deepEqual(shown, [], 'declined for good');
  assert.equal(banner.ending, null);
});

test('dismissing gets out of the way without answering anything', () => {
  const { banner, hides } = setup();
  banner.raise(OVER);
  banner.dismiss();
  assert.equal(hides(), 1);
  assert.equal(banner.ending, OVER, 'still somewhere to come back to');
});

// --- the round trip through a replay ----------------------------------------

test('a surrender banner restored after a replay takes its hold back', () => {
  // The bug this is the regression test for. Every answer releases the hold
  // and "Watch replay" is an answer, so restoring the banner by only *showing*
  // it left the match running: the AIs took a round of turns behind a "You
  // win" card, the turn-handover flash went off behind it, and "Play on"
  // dropped the player onto a board several turns past the one they were
  // offered — which is the exact thing the hold exists to prevent.
  const { banner } = setup();
  banner.raise(SURRENDERED);
  banner.answered(); // "Watch replay" — the replay holds the match from here
  banner.restore(); // ...and the overlay closed

  assert.equal(banner.holding, true, 'the match is held again, not running');
});

test('a finished match restores without a hold, because there is nothing to hold', () => {
  const { banner } = setup();
  banner.raise(OVER);
  banner.answered(); // "Watch replay"
  banner.restore();

  assert.equal(banner.holding, false);
});

test('a knockout never reaches the restore path at all', () => {
  // Not remembered, so closing a replay opened from one puts the player back
  // on the board rather than in front of a question they have answered.
  const { banner, shown } = setup();
  banner.raise(ELIMINATED);
  banner.answered();

  shown.length = 0;
  banner.restore();
  assert.deepEqual(shown, [], 'nothing shown');
  assert.equal(banner.holding, false, 'and the match is left running, as a spectator expects');
});

// --- a match that ends after something else -----------------------------------

test('an ending raised over a knockout replaces what is remembered', () => {
  // A player knocked out of a match that then finishes: `over` is what there
  // is to come back to, not the knockout that has been superseded.
  const { banner } = setup();
  banner.raise(ELIMINATED);
  banner.answered();
  banner.raise(OVER);

  assert.equal(banner.ending, OVER);
  assert.equal(banner.holding, false, 'and nothing left to hold');
});
