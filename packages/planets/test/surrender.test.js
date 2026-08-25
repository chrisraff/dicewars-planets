import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, AUTOPLAY } from '../src/game/createGame.js';
import { chainWorld, alwaysRolls } from '@dicewars/core/test-support';

// A board already decided: the player holds a run of twelve at three dice
// apiece, the AI two territories at one. Both of the AI's measures are a
// sixth of the leader's, which is what `surrenderedPlayerIds` asks for.
const decided = (options) =>
  chainWorld([
    ...Array.from({ length: 12 }, (_, i) => [`mine${i}`, { owner: 'p1', dice: 3 }]),
    ['theirs0', { owner: 'p2', dice: 1 }],
    ['theirs1', { owner: 'p2', dice: 1 }],
  ], options);

// Still a game: the AI's four territories out-earn the player's three, however
// deep the player has stacked them.
const contested = () =>
  chainWorld([
    ...Array.from({ length: 3 }, (_, i) => [`mine${i}`, { owner: 'p1', dice: 8 }]),
    ...Array.from({ length: 4 }, (_, i) => [`theirs${i}`, { owner: 'p2', dice: 1 }]),
  ]);

function advance(game, seconds, step = 1 / 60) {
  for (let t = 0; t < seconds; t += step) game.tick(step);
}

/** A game with every `surrendered` event it emits collected as it goes. */
function watched(options = {}) {
  const game = createGame({ world: decided(), rollDie: alwaysRolls(1), ...options });
  const offers = [];
  game.on('surrendered', (event) => offers.push(event));
  game.start();
  return { game, offers };
}

test('a beaten field is offered to the player at the end of their own turn', () => {
  const { game, offers } = watched();

  assert.deepEqual(offers, [], 'the board already qualifies, but the turn is still theirs');

  game.endTurn();
  advance(game, 5);

  assert.equal(offers.length, 1);
  assert.deepEqual(offers[0].surrendered, ['p2'], 'every rival still standing, named');
});

test('an offer waits for the player’s own turn to end, not for any turn to end', () => {
  // The AI moves first on this board, and the position already qualifies
  // while it does. Being told you have won belongs at the moment the board is
  // settled and you are the one looking at it — not part-way through someone
  // else's run of attacks.
  const game = createGame({
    world: decided({ playerIds: ['p2', 'p1'] }),
    humanPlayerId: 'p1',
    rollDie: alwaysRolls(1),
  });
  const offers = [];
  game.on('surrendered', (event) => offers.push(event));
  game.start();

  advance(game, 8); // p2 has nothing it can attack with, so its turn ends
  assert.deepEqual(offers, [], 'the AI finishing its turn is not the moment');

  game.endTurn();
  advance(game, 5);
  assert.equal(offers.length, 1, 'the player finishing theirs is');
});

test('the game itself carries on regardless — nothing about it has ended', () => {
  // the whole point of doing this outside the rules: an offer is an opinion,
  // and the player is free to disagree with it and finish the job
  const { game, offers } = watched();
  game.endTurn();
  advance(game, 5);

  assert.equal(offers.length, 1);
  assert.equal(game.isOver(), false);
  assert.equal(game.state.phase, 'attack');
  assert.equal(game.state.winner, null);
});

test('a game still in the balance is not called early', () => {
  const game = createGame({ world: contested(), rollDie: alwaysRolls(1) });
  const offers = [];
  game.on('surrendered', (event) => offers.push(event));
  game.start();

  game.endTurn();
  advance(game, 5);

  assert.deepEqual(offers, [], 'the AI holds less of everything and is still in it');
});

test('it is asked once, not every turn until the player answers', () => {
  const { game, offers } = watched();

  game.endTurn();
  advance(game, 8); // the AI takes its turn, and play comes back round
  game.endTurn();
  advance(game, 8);

  assert.equal(offers.length, 1);
});

test('playing on is final — the match runs to a real finish without asking again', () => {
  const { game, offers } = watched();
  game.endTurn();
  advance(game, 5);
  assert.equal(offers.length, 1);

  game.playOn();
  assert.equal(game.playedOn, true);

  game.endTurn();
  advance(game, 8);
  assert.equal(offers.length, 1, 'the answer stuck');
});

test('a game resumed after the offer was refused does not reopen it', () => {
  // `playedOn` travels in the save for exactly this: a reload is not a fresh
  // chance to ask something already answered
  const { game, offers } = watched({ playedOn: true });

  game.endTurn();
  advance(game, 5);

  assert.deepEqual(offers, []);
});

test('a match with nobody in the human seat is never offered anything', () => {
  // there is no one to make the offer to, and a demo playing itself out should
  // play itself out
  const { game, offers } = watched({ humanPlayerId: AUTOPLAY });
  advance(game, 30);

  assert.deepEqual(offers, []);
});

test('the player in the losing seat is not handed the game they are losing', () => {
  // p2 is the one being beaten here. The check runs at the end of p2's turn
  // and asks about p1 — who is leading, and so can never have surrendered.
  const { game, offers } = watched({ humanPlayerId: 'p2' });
  advance(game, 20); // p1 (now the AI) plays, then it is p2's turn

  game.endTurn();
  advance(game, 5);

  assert.deepEqual(offers, []);
});

// The session holds the match behind the surrender banner until it is
// answered — otherwise the AIs take turns underneath a question about the
// position, and pressing "Play on" drops the player into a board several turns
// past the one they were being asked about. Holding outright is only safe
// because the offer lands at a settled moment: it is judged at the end of a
// turn, with the payout already applied and no attack pending.
test('a surrender is offered with nothing left in the air behind it', () => {
  const game = createGame({ world: decided(), rollDie: alwaysRolls(1) });
  const busyAtOffer = [];
  game.on('surrendered', () => busyAtOffer.push(game.isBusy()));

  game.start();
  game.endTurn();
  advance(game, 5);

  assert.deepEqual(busyAtOffer, [false], 'the banner goes up over a settled board');
});
