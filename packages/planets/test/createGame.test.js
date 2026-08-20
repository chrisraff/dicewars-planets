import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, AI_TIMING } from '../src/game/createGame.js';
import { attackDuration, DEFAULT_TIMING } from '../src/render/rollTimeline.js';
import { generatePlanetWorld } from '../src/world/generateWorld.js';

function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// A four-territory chain: p1 (human) holds a and c, the AI holds b and d.
function chainWorld(assignments) {
  const nodeIds = ['a', 'b', 'c', 'd'];
  return {
    nodeIds,
    edges: [['a', 'b'], ['b', 'c'], ['c', 'd']],
    playerIds: ['p1', 'p2'],
    assignments,
  };
}

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

const alwaysRoll = (value) => () => value;

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
  const game = createGame({ world: balanced(), rollDie: alwaysRoll(6) });
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
  const game = createGame({ world: balanced(), rollDie: alwaysRoll(6) });
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
  const game = createGame({ world: balanced(), rollDie: alwaysRoll(6) });
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

  assert.equal(earned.length, 1);
  assert.equal(game.currentPlayer(), 'p2');
  assert.ok(!game.isHumanTurn());
});

test('the human cannot act on the AI’s turn', () => {
  const game = createGame({ world: balanced() });
  game.endTurn();
  game.clickTerritory('a');
  assert.equal(game.selection, null);
});

test('the AI takes its own turn and hands play back', () => {
  const game = createGame({ world: balanced(), rollDie: alwaysRoll(3) });
  game.endTurn();
  assert.equal(game.currentPlayer(), 'p2');

  advance(game, 10 * (attackDuration(AI_TIMING) + 1));

  assert.equal(game.currentPlayer(), 'p1', 'play comes back to the human');
  assert.ok(game.isHumanTurn());
});

test('the AI’s attacks are animated too, just faster', () => {
  const game = createGame({ world: balanced(), rollDie: alwaysRoll(3) });
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
    rollDie: alwaysRoll(6),
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

  assert.deepEqual(winners, ['p1']);
  assert.ok(game.isOver());

  game.clickTerritory('a');
  assert.equal(game.selection, null, 'the board is dead once the game is over');
});

test('a whole game plays itself out without stalling', () => {
  // both sides on autopilot: the human seat just ends its turn every time
  const game = createGame({ world: balanced(), humanPlayerId: null });
  let turns = 0;
  game.on('endTurn', () => turns++);
  game.start();

  advance(game, 600, 0.05);

  assert.ok(game.isOver(), `expected a winner after ${turns} turns`);
  assert.ok(turns > 1);
});

test('a real generated planet plays through to a winner', () => {
  const playerIds = ['p1', 'p2', 'p3', 'p4'];
  const rng = seededRng(2024);
  const world = generatePlanetWorld({ subdivisions: 3, playerIds, rng });

  // nobody at the human seat, so every player is on autopilot
  const game = createGame({
    world,
    humanPlayerId: null,
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
