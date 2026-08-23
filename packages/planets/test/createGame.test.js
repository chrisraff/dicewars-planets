import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, AI_TIMING, AUTOPLAY } from '../src/game/createGame.js';
import { attackDuration, DEFAULT_TIMING } from '../src/render/rollTimeline.js';
import { reinforceDuration, MAX_REINFORCE_DURATION } from '../src/render/reinforceTimeline.js';
import { generatePlanetWorld } from '../src/world/generateWorld.js';
import { createInitialState, reviveState, serializeState } from '@dicewars/core';
import { seededRng, chainWorld, alwaysRolls, boardOf } from '@dicewars/core/test-support';

// A four-territory chain: p1 (human) holds a and c, the AI holds b and d.
const balanced = () =>
  chainWorld([
    ['a', { owner: 'p1', dice: 4 }],
    ['b', { owner: 'p2', dice: 1 }],
    ['c', { owner: 'p1', dice: 2 }],
    ['d', { owner: 'p2', dice: 8 }],
  ]);

// Runs the clock forward in small steps, as a render loop would.
function advance(game, seconds, step = 1 / 60) {
  for (let t = 0; t < seconds; t += step) game.tick(step);
}


test('clicking your own territory picks it up, clicking it again puts it down', () => {
  const game = createGame({ world: balanced() });
  game.clickTerritory('a');
  assert.equal(game.selection, 'a');
  game.clickTerritory('a');
  assert.equal(game.selection, null);
});

test('a territory with a single die cannot be picked up — it has nothing to attack with', () => {
  const game = createGame({
    world: chainWorld([
      ['a', { owner: 'p1', dice: 1 }],
      ['b', { owner: 'p2', dice: 1 }],
      ['c', { owner: 'p1', dice: 2 }],
      ['d', { owner: 'p2', dice: 1 }],
    ]),
  });
  game.clickTerritory('a');
  assert.equal(game.selection, null);
});

test('the selected territory reports exactly the neighbors it may attack', () => {
  const game = createGame({ world: balanced() });
  game.clickTerritory('a');
  assert.deepEqual(game.legalTargets(), ['b']);

  game.clickTerritory('c');
  assert.deepEqual(game.legalTargets().sort(), ['b', 'd']);
});

test('clicking an enemy neighbor starts an attack and reports every die rolled', () => {
  const game = createGame({ world: balanced(), rollDie: alwaysRolls(6) });
  const attacks = [];
  game.on('attack', (a) => attacks.push(a));

  game.clickTerritory('a');
  game.clickTerritory('b');

  assert.equal(attacks.length, 1);
  assert.equal(attacks[0].event.attackRolls.length, 4, 'one value per attacking die');
  assert.equal(attacks[0].event.defendRolls.length, 1);
  assert.equal(game.selection, null, 'the selection is spent on the attack');
  assert.ok(game.isBusy(), 'the dice are rolling');
});

test('the board does not change until the dice have finished rolling', () => {
  const game = createGame({ world: balanced(), rollDie: alwaysRolls(6) });
  game.clickTerritory('a');
  game.clickTerritory('b');

  assert.equal(game.state.nodes.get('b').owner, 'p2', 'still the defender’s, mid-roll');
  advance(game, attackDuration(DEFAULT_TIMING) - 0.05);
  assert.equal(game.state.nodes.get('b').owner, 'p2');

  advance(game, 0.2);
  assert.equal(game.state.nodes.get('b').owner, 'p1', 'captured once the dice land');
  assert.equal(game.state.nodes.get('a').dice, 1);
  assert.ok(!game.isBusy());
});

test('clicks are ignored while the dice are in the air', () => {
  const game = createGame({ world: balanced(), rollDie: alwaysRolls(6) });
  game.clickTerritory('a');
  game.clickTerritory('b');
  game.clickTerritory('c');
  assert.equal(game.selection, null, 'no picking a new territory mid-roll');
});

test('clicking an enemy you are not next to just clears the selection', () => {
  const game = createGame({ world: balanced() });
  game.clickTerritory('a');
  game.clickTerritory('d'); // not adjacent to 'a'
  assert.equal(game.selection, null);
  assert.ok(!game.isBusy());
});

test('ending your turn pays reinforcements and hands play to the AI', () => {
  const game = createGame({ world: balanced() });
  const earned = [];
  game.on('endTurn', (e) => earned.push(e));

  game.endTurn();
  advance(game, MAX_REINFORCE_DURATION + 0.05);

  assert.equal(earned.length, 1);
  assert.equal(game.currentPlayer(), 'p2');
  assert.ok(!game.isHumanTurn());
});

test('ending your turn without attacking is recorded as a pass', () => {
  const game = createGame({ world: balanced() });
  const reinforcements = [];
  game.on('reinforce', (e) => reinforcements.push(e));

  game.endTurn();

  assert.equal(reinforcements.length, 1);
  assert.equal(reinforcements[0].playerId, 'p1');
  assert.equal(reinforcements[0].passed, true);
});

test('ending your turn after attacking is not a pass, even though the attack is long since resolved', () => {
  const game = createGame({ world: balanced(), rollDie: alwaysRolls(6) });
  const reinforcements = [];
  game.on('reinforce', (e) => reinforcements.push(e));

  game.clickTerritory('a');
  game.clickTerritory('b');
  advance(game, attackDuration(DEFAULT_TIMING) + 0.05); // the roll has to land first
  game.endTurn();

  assert.equal(reinforcements[0].passed, false);
});

test('a pass is per turn — attacking on the next one is not tainted by passing the last', () => {
  const w = chainWorld([
    ['a', { owner: 'p1', dice: 4 }],
    ['b', { owner: 'p2', dice: 1 }], // one die: never a legal attacker, so the AI always just passes
    ['c', { owner: 'p2', dice: 1 }], // p2's other ground — losing 'b' must not end the game mid-test
  ]);
  const game = createGame({ world: w, rollDie: alwaysRolls(6) });
  const reinforcements = [];
  game.on('reinforce', (e) => reinforcements.push(e));

  game.endTurn(); // p1 passes on purpose
  advance(game, 5); // the payout lands, then the AI takes (and passes) its own turn

  game.clickTerritory('a');
  game.clickTerritory('b'); // p1 attacks on their second turn
  advance(game, attackDuration(DEFAULT_TIMING) + 0.05);
  game.endTurn();
  advance(game, 5);

  const p1Turns = reinforcements.filter((e) => e.playerId === 'p1');
  assert.equal(p1Turns.length, 2);
  assert.equal(p1Turns[0].passed, true, 'the first turn really was a pass');
  assert.equal(p1Turns[1].passed, false, 'passing once does not stick to the next turn');
});

test('the board does not change until the reinforcement has finished landing', () => {
  const game = createGame({ world: balanced() });
  const before = game.state.nodes.get('a').dice;

  game.endTurn();
  assert.equal(game.currentPlayer(), 'p1', 'still the reinforcing player, mid-payout');
  assert.equal(game.state.nodes.get('a').dice, before, 'no dice have landed yet');
  assert.ok(game.isBusy());

  // exactly one region, so exactly one die — advancing just past its own
  // landing time (rather than the worst-case cap) keeps this clear of the
  // AI's own next move, which starts its own busy spell a beat later
  advance(game, reinforceDuration(1) + 0.05);
  assert.equal(game.currentPlayer(), 'p2', 'the turn has now actually passed');
});

test('the human cannot act on the AI’s turn', () => {
  const game = createGame({ world: balanced() });
  game.endTurn();
  game.clickTerritory('a');
  assert.equal(game.selection, null);
});

test('the AI takes its own turn and hands play back', () => {
  const game = createGame({ world: balanced(), rollDie: alwaysRolls(3) });
  game.endTurn();
  advance(game, MAX_REINFORCE_DURATION + 0.05);
  assert.equal(game.currentPlayer(), 'p2');

  advance(game, 10 * (attackDuration(AI_TIMING) + 1));

  assert.equal(game.currentPlayer(), 'p1', 'play comes back to the human');
  assert.ok(game.isHumanTurn());
});

test('the AI’s attacks are animated too, just faster', () => {
  const game = createGame({ world: balanced(), rollDie: alwaysRolls(3) });
  const attacks = [];
  game.on('attack', (a) => attacks.push(a));

  game.endTurn();
  advance(game, 10);

  assert.ok(attacks.length > 0, 'the AI should have attacked something');
  assert.deepEqual(attacks[0].timing, AI_TIMING);
  assert.ok(attackDuration(AI_TIMING) < attackDuration(DEFAULT_TIMING));
});

test('the game ends when one player holds everything, and stops accepting input', () => {
  const game = createGame({
    world: chainWorld([
      ['a', { owner: 'p1', dice: 8 }],
      ['b', { owner: 'p2', dice: 1 }],
      ['c', { owner: 'p1', dice: 8 }],
      ['d', { owner: 'p2', dice: 1 }],
    ]),
    rollDie: alwaysRolls(6),
  });
  const winners = [];
  game.on('over', (w) => winners.push(w));

  game.clickTerritory('a');
  game.clickTerritory('b');
  advance(game, 3);
  game.clickTerritory('c');
  game.clickTerritory('d');
  advance(game, 3);
  game.endTurn();
  advance(game, MAX_REINFORCE_DURATION + 0.05);

  assert.deepEqual(winners, ['p1']);
  assert.ok(game.isOver());

  game.clickTerritory('a');
  assert.equal(game.selection, null, 'the board is dead once the game is over');
});

test('the winning attack fires "over" on its own — nobody has to end their turn to see it', () => {
  const game = createGame({
    world: chainWorld([
      ['a', { owner: 'p1', dice: 8 }],
      ['b', { owner: 'p2', dice: 1 }],
      ['c', { owner: 'p1', dice: 8 }],
      ['d', { owner: 'p2', dice: 1 }],
    ]),
    rollDie: alwaysRolls(6),
  });
  const winners = [];
  game.on('over', (w) => winners.push(w));

  game.clickTerritory('a');
  game.clickTerritory('b');
  advance(game, 3);
  assert.equal(winners.length, 0, 'p2 still holds d — the match is not decided yet');

  game.clickTerritory('c');
  game.clickTerritory('d'); // the last territory p2 has
  advance(game, 3);

  // decided the instant that attack landed — no endTurn() anywhere in this test
  assert.deepEqual(winners, ['p1']);
  assert.ok(game.isOver());
});

test('a whole game plays itself out without stalling', () => {
  // nobody in the human seat, so every player is on autopilot
  const game = createGame({ world: balanced(), humanPlayerId: AUTOPLAY });
  game.start();

  advance(game, 600, 0.05);

  // the deciding attack can end the match on the spot, before anyone's turn
  // ends — so reaching game over is the whole story, not a turn count
  assert.ok(game.isOver(), 'expected a winner');
  assert.ok(['p1', 'p2'].includes(game.state.winner));
});

test('a real generated planet plays through to a winner', () => {
  const playerIds = ['p1', 'p2', 'p3', 'p4'];
  const rng = seededRng(2024);
  const world = generatePlanetWorld({ subdivisions: 3, playerIds, rng });

  // nobody at the human seat, so every player is on autopilot
  const game = createGame({
    world,
    humanPlayerId: AUTOPLAY,
    rollDie: () => 1 + Math.floor(rng() * 6),
  });

  const attacks = [];
  game.on('attack', ({ event }) => attacks.push(event));
  game.start();

  advance(game, 60 * 60, 0.25); // an hour of game time is plenty

  assert.ok(game.isOver(), 'the game should reach a winner rather than deadlock');
  assert.ok(playerIds.includes(game.state.winner));
  assert.ok(attacks.length > 20, `expected a real fight, saw ${attacks.length} attacks`);

  for (const event of attacks) {
    assert.ok(event.attackRolls.every((v) => v >= 1 && v <= 6), 'every die is a real face');
    assert.equal(event.attackRoll, event.attackRolls.reduce((a, b) => a + b, 0));
    assert.equal(event.attackerWins, event.attackRoll > event.defendRoll);
  }

  const owners = new Set([...game.state.nodes.values()].map((n) => n.owner));
  assert.deepEqual([...owners], [game.state.winner], 'the winner holds the whole planet');
});

// --- resuming a saved game ---------------------------------------------------

test('a game handed a saved board carries on from it rather than dealing a new one', () => {
  const world = balanced();
  const savedState = reviveState(
    serializeState(
      createInitialState({
        ...world,
        assignments: [
          ['a', { owner: 'p1', dice: 1 }],
          ['b', { owner: 'p1', dice: 7 }],
          ['c', { owner: 'p2', dice: 3 }],
          ['d', { owner: 'p2', dice: 2 }],
        ],
      })
    )
  );

  const game = createGame({ world, savedState });

  assert.equal(game.state.nodes.get('b').dice, 7, 'the board that was saved, not the dealt one');
  assert.equal(game.state.nodes.get('c').owner, 'p2');
});

test('a resumed game picks up whose turn it was, not the top of the order', () => {
  const savedState = reviveState({
    ...serializeState(createInitialState(balanced())),
    currentTurnIndex: 1,
  });
  const game = createGame({ world: balanced(), savedState, humanPlayerId: 'p1' });

  assert.equal(game.currentPlayer(), 'p2');
  assert.equal(game.isHumanTurn(), false);
});

test('a resumed game lets the AI take the turn it was in the middle of', () => {
  // reloading on the AI's turn must not leave the board waiting for a player
  // who is not due to move — `start` has to get the thinking clock going
  const savedState = reviveState({
    ...serializeState(createInitialState(balanced())),
    currentTurnIndex: 1,
  });
  const game = createGame({
    world: balanced(),
    savedState,
    humanPlayerId: 'p1',
    rollDie: alwaysRolls(6),
  });

  game.start();
  advance(game, 5);

  assert.notEqual(game.currentPlayer(), 'p2', 'the AI played its turn and passed it on');
});

// --- reordering an AI turn for display (orderAiTurn) ------------------------

// p1's two attackers each reach one of p2's two territories, and neither
// shares a territory with the other — so they're free to be shown in either
// order. p3 sits untouched, so wiping out p2 doesn't also end the game (which
// would force the deciding move to stay last regardless of orderAiTurn).
function twoFrontsWorld() {
  return {
    nodeIds: ['a1', 'a2', 'x', 'y', 'z'],
    edges: [['a1', 'x'], ['a2', 'y']],
    playerIds: ['p1', 'p2', 'p3'],
    assignments: [
      ['a1', { owner: 'p1', dice: 4 }],
      ['a2', { owner: 'p1', dice: 4 }],
      ['x', { owner: 'p2', dice: 1 }],
      ['y', { owner: 'p2', dice: 1 }],
      ['z', { owner: 'p3', dice: 2 }],
    ],
  };
}

// Always attacks a1 -> x first, then a2 -> y, then stops — true order is
// fixed, regardless of what orderAiTurn goes on to do with it for display.
function twoFrontsStrategy() {
  let calls = 0;
  return () => {
    calls += 1;
    if (calls === 1) return { from: 'a1', to: 'x' };
    if (calls === 2) return { from: 'a2', to: 'y' };
    return null;
  };
}

test('an AI turn plays out identically whether or not it is reordered for display', () => {
  // fixed, so the two runs draw the same reinforcement-placement sequence —
  // otherwise an unseeded Math.random would make the boards differ for a
  // reason that has nothing to do with reordering
  const outcomeOf = (orderAiTurn) => {
    const game = createGame({
      world: twoFrontsWorld(),
      humanPlayerId: AUTOPLAY,
      strategy: twoFrontsStrategy(),
      rollDie: alwaysRolls(6),
      rng: seededRng(1),
      orderAiTurn,
    });
    game.start();
    advance(game, 10);
    return boardOf(game.state);
  };

  const unordered = outcomeOf((moves) => moves);
  const reversed = outcomeOf((moves) => [...moves].reverse());
  assert.deepEqual(reversed, unordered, 'display order must never change the actual outcome');
});

test('reordering independent moves recomputes elimination off the board as shown, not the true order', () => {
  const game = createGame({
    world: twoFrontsWorld(),
    humanPlayerId: AUTOPLAY,
    strategy: twoFrontsStrategy(),
    rollDie: alwaysRolls(6),
    // shows a2 -> y before a1 -> x — the reverse of the true, planned order
    orderAiTurn: (moves) => [...moves].reverse(),
  });

  let resolvedCount = 0;
  const eliminatedAtResolvedCount = [];
  game.on('resolved', () => { resolvedCount += 1; });
  game.on('eliminated', (e) => eliminatedAtResolvedCount.push({ count: resolvedCount, event: e }));

  game.start();
  advance(game, 10);

  assert.equal(resolvedCount, 2, 'both attacks landed');
  assert.deepEqual(eliminatedAtResolvedCount.map((e) => e.count), [2],
    'p2 is wiped out by whichever move actually empties the board second, not whichever move was ' +
    'second in the true, unshown order');
  assert.equal(eliminatedAtResolvedCount[0].event.playerId, 'p2');
  assert.equal(game.state.nodes.get('x').owner, 'p1');
  assert.equal(game.state.nodes.get('y').owner, 'p1');
});

test('the terminal, game-ending move of a turn is never reordered ahead of anything else', () => {
  // Same two independent fronts, but only p1 and p2 this time — taking p2's
  // second territory ends the whole match on the spot, so it must stay last
  // even though orderAiTurn asks for the opposite order.
  const world = {
    nodeIds: ['a1', 'a2', 'x', 'y'],
    edges: [['a1', 'x'], ['a2', 'y']],
    playerIds: ['p1', 'p2'],
    assignments: [
      ['a1', { owner: 'p1', dice: 4 }],
      ['a2', { owner: 'p1', dice: 4 }],
      ['x', { owner: 'p2', dice: 1 }],
      ['y', { owner: 'p2', dice: 1 }],
    ],
  };

  const game = createGame({
    world,
    humanPlayerId: AUTOPLAY,
    strategy: twoFrontsStrategy(),
    rollDie: alwaysRolls(6),
    orderAiTurn: (moves) => [...moves].reverse(),
  });

  const winners = [];
  game.on('over', (w) => winners.push(w));

  game.start();
  advance(game, 10);

  assert.deepEqual(winners, ['p1']);
  assert.ok(game.isOver());
  assert.equal(game.state.nodes.get('x').owner, 'p1');
  assert.equal(game.state.nodes.get('y').owner, 'p1');
});
