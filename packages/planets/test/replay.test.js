import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '@dicewars/core';
import { chainState, chainWorld, alwaysRolls, rollsOf } from '@dicewars/core/test-support';
import { createGame } from '../src/game/createGame.js';
import {
  createReplay,
  boardAfterAttacks,
  reservesAfterAttacks,
  historyThroughStep,
} from '../src/game/replay.js';

function advance(game, seconds, step = 1 / 60) {
  for (let t = 0; t < seconds; t += step) game.tick(step);
}

const world = () =>
  chainWorld([
    ['a', { owner: 'p1', dice: 8 }],
    ['b', { owner: 'p2', dice: 1 }],
    ['c', { owner: 'p1', dice: 8 }],
    ['d', { owner: 'p2', dice: 1 }],
  ]);

// Wires a replay log to a game the same way the session does: recorded once
// the attack has actually resolved, not the moment it is merely declared.
function replayedGame(w, options) {
  const game = createGame({ world: w, ...options });
  const replay = createReplay();
  let pendingEvent = null;
  game.on('attack', ({ event }) => {
    pendingEvent = event;
  });
  game.on('resolved', () => replay.record(pendingEvent));
  game.on('eliminated', (event) => replay.recordElimination(event));
  game.on('reinforce', (event) => replay.recordReinforcement(event));
  return { game, replay };
}

test('.attacks is only ever the fights, however much reinforcement lands in between', () => {
  const { game, replay } = replayedGame(world(), { rollDie: alwaysRolls(6) });

  game.clickTerritory('a');
  game.clickTerritory('b');
  advance(game, 3);
  game.endTurn();
  advance(game, 10);

  assert.equal(replay.attacks.length, 1, 'exactly the one attack fought');
  assert.equal(replay.attacks[0].from, 'a');
  assert.equal(replay.attacks[0].to, 'b');
  assert.ok(
    replay.moves.some((move) => move.kind === 'reinforce'),
    'the reinforcement from ending the turn is still on the record, just not as an "attack"'
  );
});

test('attacks are recorded in the order they were fought', () => {
  const { game, replay } = replayedGame(world(), { rollDie: alwaysRolls(6) });

  game.clickTerritory('a');
  game.clickTerritory('b');
  advance(game, 3);
  game.clickTerritory('c');
  game.clickTerritory('d');
  advance(game, 3);

  assert.deepEqual(
    replay.attacks.map((a) => [a.from, a.to]),
    [['a', 'b'], ['c', 'd']]
  );
});

test('a game played all the way through replays back to the exact same board', () => {
  const w = world();
  const { game, replay } = replayedGame(w, { rollDie: alwaysRolls(6) });

  game.clickTerritory('a');
  game.clickTerritory('b');
  advance(game, 3);
  game.clickTerritory('c');
  game.clickTerritory('d');
  advance(game, 3);

  const initialNodes = createInitialState(w).nodes;
  const replayed = boardAfterAttacks(initialNodes, replay.moves, replay.attacks.length);

  assert.deepEqual([...replayed], [...game.state.nodes]);
});

test('step zero is the board before anything was fought over', () => {
  const w = world();
  const { game, replay } = replayedGame(w, { rollDie: alwaysRolls(6) });

  game.clickTerritory('a');
  game.clickTerritory('b');
  advance(game, 3);

  const initialNodes = createInitialState(w).nodes;
  assert.deepEqual(
    [...boardAfterAttacks(initialNodes, replay.moves, 0)],
    [...initialNodes]
  );
});

test('an untouched territory keeps its starting dice — a replay of the fights, not the whole game', () => {
  const w = world();
  const { game, replay } = replayedGame(w, { rollDie: alwaysRolls(6) });

  game.clickTerritory('a');
  game.clickTerritory('b');
  advance(game, 3);

  const initialNodes = createInitialState(w).nodes;
  const replayed = boardAfterAttacks(initialNodes, replay.moves, replay.attacks.length);

  assert.deepEqual(replayed.get('c'), initialNodes.get('c'), 'never attacked or defended');
  assert.deepEqual(replayed.get('d'), initialNodes.get('d'));
});

test('a step past the last attack is no different from the last attack itself', () => {
  const w = world();
  const { game, replay } = replayedGame(w, { rollDie: alwaysRolls(6) });

  game.clickTerritory('a');
  game.clickTerritory('b');
  advance(game, 3);

  const initialNodes = createInitialState(w).nodes;
  const atEnd = boardAfterAttacks(initialNodes, replay.moves, replay.attacks.length);
  const wayPast = boardAfterAttacks(initialNodes, replay.moves, 999);

  assert.deepEqual([...wayPast], [...atEnd]);
});

test('a replay only ever reaches back to the board it started recording from, not the planet as first dealt', () => {
  // Stands in for a session resumed from a save: `world`'s own assignments
  // are the planet as it was originally dealt, but this session is not
  // starting from there — `savedState` is a board that has already moved on,
  // the same way `session.js` hands `createGame` a revived save instead of
  // letting it build a fresh state from `world`.
  const w = chainWorld([
    ['a', { owner: 'p2', dice: 1 }],
    ['b', { owner: 'p2', dice: 1 }],
  ]);
  const resumedState = chainState([
    ['a', { owner: 'p1', dice: 8 }], // already captured and built up before this session began
    ['b', { owner: 'p2', dice: 1 }],
  ]);

  const game = createGame({ world: w, savedState: resumedState, rollDie: alwaysRolls(6) });
  const replay = createReplay();
  let pendingEvent = null;
  game.on('attack', ({ event }) => { pendingEvent = event; });
  game.on('resolved', () => replay.record(pendingEvent));

  // what session.js now seeds `initialNodes` with: the board this session
  // actually opened on, not `createInitialState(w).nodes`
  const initialNodes = game.state.nodes;

  game.clickTerritory('a');
  game.clickTerritory('b');
  advance(game, 3);

  const replayed = boardAfterAttacks(initialNodes, replay.moves, replay.attacks.length);
  assert.deepEqual([...replayed], [...game.state.nodes], 'matches how the live game actually ended up');

  // proving the point: rebuilding from the planet's true starting deal instead
  // gets the wrong answer — exactly the bug this baseline exists to avoid
  const pristineNodes = createInitialState(w).nodes;
  const wrongly = boardAfterAttacks(pristineNodes, replay.moves, replay.attacks.length);
  assert.notDeepEqual([...wrongly], [...game.state.nodes]);
});

test('a losing attack still shows up in the replay, dice down to one and nothing changing hands', () => {
  // 'e' attacks 'f' with 3 dice rolling 1,1,1 (3) against 1 die rolling 6 —
  // the defender wins outright
  const w = chainWorld([
    ['e', { owner: 'p1', dice: 3 }],
    ['f', { owner: 'p2', dice: 1 }],
  ]);
  const { game, replay } = replayedGame(w, { rollDie: rollsOf([1, 1, 1, 6]) });

  game.clickTerritory('e');
  game.clickTerritory('f');
  advance(game, 3);

  const initialNodes = createInitialState(w).nodes;
  const replayed = boardAfterAttacks(initialNodes, replay.moves, replay.attacks.length);

  assert.equal(replay.attacks[0].attackerWins, false);
  assert.equal(replayed.get('e').dice, 1, 'the attacker is stripped down regardless of the outcome');
  assert.deepEqual(replayed.get('f'), initialNodes.get('f'), 'the defender is untouched by a failed attack');
});

// --- reinforcement, replayed alongside the fights it landed between -------

// x starts already at the dice cap, so the one die p1 earns for ending their
// first turn without attacking has nowhere to go but z — the one territory
// this scenario never otherwise fights over.
const reinforceWorld = () =>
  chainWorld([
    ['x', { owner: 'p1', dice: 8 }],
    ['y', { owner: 'p2', dice: 1 }],
    ['z', { owner: 'p1', dice: 2 }],
  ]);

test('reinforcement between attacks reaches the territory it actually landed on', () => {
  const w = reinforceWorld();
  const { game, replay } = replayedGame(w, { rollDie: alwaysRolls(6) });

  game.endTurn(); // p1 banks a turn before attacking; z is the only legal landing spot
  advance(game, 5); // the payout lands, then the AI (p2) takes its own turn

  game.clickTerritory('x');
  game.clickTerritory('y'); // p1's only attack, on their second turn
  advance(game, 3);

  assert.equal(replay.attacks.length, 1);

  const initialNodes = createInitialState(w).nodes;
  const replayed = boardAfterAttacks(initialNodes, replay.moves, replay.attacks.length);

  assert.equal(replayed.get('z').dice, 3, 'reinforced from 2 to 3 despite never being fought over');
  assert.deepEqual(replayed.get('y'), game.state.nodes.get('y'), 'matches how the live game actually ended up');
});

test('a step before any attack shows the board as dealt, reinforcement included', () => {
  const w = reinforceWorld();
  const { game, replay } = replayedGame(w, { rollDie: alwaysRolls(6) });

  game.endTurn();
  advance(game, 5);
  game.clickTerritory('x');
  game.clickTerritory('y');
  advance(game, 3);

  const initialNodes = createInitialState(w).nodes;
  // the reinforcement happened before the one attack this replay reaches,
  // but step 0 is still the board exactly as dealt — it never gets a look in
  assert.equal(boardAfterAttacks(initialNodes, replay.moves, 0).get('z').dice, 2);
});

// --- reserve, replayed through the same bank-then-cap logic core applies --

// x stays full for the whole test — reinforcement never lands there — so
// every die p1 earns has to compete for the one seat still open on 'a'.
const capWorld = () =>
  chainWorld([
    ['x', { owner: 'p1', dice: 8 }],
    ['a', { owner: 'p1', dice: 7 }],
    ['b', { owner: 'p2', dice: 1 }],
  ]);

test('reserve is reconstructed through the cap, not read off `landed` alone', () => {
  const w = capWorld();
  const { game, replay } = replayedGame(w, { rollDie: alwaysRolls(6) });

  game.endTurn(); // p1 earns 2 (x + a); only 1 die finds room, on 'a' — 1 stays banked
  advance(game, 5); // the payout lands, then the AI (p2) takes its own turn

  game.endTurn(); // p1 earns 2 again; 'a' is full too now, so none of it lands this time
  advance(game, 5);

  game.clickTerritory('a');
  game.clickTerritory('b'); // the one attack this replay reaches
  advance(game, 3);

  assert.equal(replay.attacks.length, 1);
  assert.equal(game.state.players.get('p1').reserve, 3, 'sanity: matches the live game');

  const initialReserves = new Map([['p1', 0], ['p2', 0]]);
  const atEnd = reservesAfterAttacks(initialReserves, replay.moves, replay.attacks.length);
  assert.equal(atEnd.get('p1').reserve, 3, 'both earn-2s counted, even though only one die ever landed');
});

test('reserve at step zero is whatever the replay started recording from, not necessarily zero', () => {
  const w = capWorld();
  const { game, replay } = replayedGame(w, { rollDie: alwaysRolls(6) });

  game.endTurn();
  advance(game, 5);
  game.clickTerritory('a');
  game.clickTerritory('b');
  advance(game, 3);

  // A resumed session's baseline isn't always zero — this is what session.js's
  // `initialReserves` would be seeded with for a save where p1 already had 5
  // dice banked before this session began.
  const initialReserves = new Map([['p1', 5], ['p2', 0]]);
  assert.equal(
    reservesAfterAttacks(initialReserves, replay.moves, 0).get('p1').reserve,
    5,
    'the reinforcement that happened before the one attack this replay reaches has not landed yet at step 0'
  );
});

// --- the history a replayed step is watched with --------------------------

test('an elimination is tagged onto the attack that caused it, not recorded as its own entry', () => {
  const { game, replay } = replayedGame(world(), { rollDie: alwaysRolls(6) });

  game.clickTerritory('a');
  game.clickTerritory('b');
  advance(game, 3);
  assert.equal(replay.attacks[0].elimination, undefined, 'p2 still holds d — nobody is out yet');

  game.clickTerritory('c');
  game.clickTerritory('d'); // p2's last territory
  advance(game, 3);

  assert.equal(replay.attacks.length, 2, 'still just the two attacks fought');
  assert.deepEqual(replay.attacks[1].elimination, { playerId: 'p2', by: 'p1' });
});

test('the history at a step includes only what had happened by then', () => {
  const { game, replay } = replayedGame(world(), { rollDie: alwaysRolls(6) });

  game.clickTerritory('a');
  game.clickTerritory('b');
  advance(game, 3);
  game.clickTerritory('c');
  game.clickTerritory('d');
  advance(game, 3);

  assert.deepEqual(historyThroughStep(replay.attacks, 0), [], 'nothing fought yet');

  const throughFirst = historyThroughStep(replay.attacks, 1);
  assert.deepEqual(throughFirst.map((e) => e.kind), ['battle'], 'the elimination has not happened yet');

  const throughSecond = historyThroughStep(replay.attacks, 2);
  assert.deepEqual(
    throughSecond.map((e) => e.kind),
    ['battle', 'battle', 'elimination'],
    'the elimination follows the attack that caused it'
  );
  assert.deepEqual(throughSecond.at(-1), { kind: 'elimination', playerId: 'p2', by: 'p1' });
});

test('a step past the end has the same history as the end itself', () => {
  const { game, replay } = replayedGame(world(), { rollDie: alwaysRolls(6) });
  game.clickTerritory('a');
  game.clickTerritory('b');
  advance(game, 3);

  assert.deepEqual(historyThroughStep(replay.attacks, 999), historyThroughStep(replay.attacks, 1));
});
