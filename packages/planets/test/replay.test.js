import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '@dicewars/core';
import { chainState, chainWorld, alwaysRolls, rollsOf } from '@dicewars/core/test-support';
import { createGame } from '../src/game/createGame.js';
import { createBattleLog } from '../src/game/battleLog.js';
import {
  createReplay,
  reviveReplay,
  serializeReplay,
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

// A longer board than `world()`, so a match runs past the two attacks that
// finish that one — the standings are about a shape over time, and two points
// are not a shape.
const longWorld = () =>
  chainWorld([
    ['a', { owner: 'p1', dice: 8 }],
    ['b', { owner: 'p2', dice: 1 }],
    ['c', { owner: 'p1', dice: 8 }],
    ['d', { owner: 'p2', dice: 1 }],
    ['e', { owner: 'p2', dice: 8 }],
    ['f', { owner: 'p2', dice: 4 }],
  ]);

// Wires a replay log to a game the same way the session does: anchored on the
// board the game opens with, and recorded once the attack has actually
// resolved rather than the moment it is merely declared.
function replayedGame(w, options, replayOptions) {
  const game = createGame({ world: w, ...options });
  const replay = createReplay({
    nodes: game.state.nodes,
    reserves: new Map([...game.state.players].map(([id, player]) => [id, player.reserve])),
    ...replayOptions,
  });
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

// --- the match as a shape --------------------------------------------------

// The chart is drawn over the same planet the track is scrubbing, so the one
// thing it must never do is disagree with it. Both come off the same walk;
// this is the claim that they stay that way.
test('every step of the standings is the board that step actually draws', () => {
  const { game, replay } = replayedGame(longWorld(), { rollDie: alwaysRolls(6) });

  game.clickTerritory('a');
  game.clickTerritory('b');
  advance(game, 3);
  game.clickTerritory('c');
  game.clickTerritory('d');
  advance(game, 3);
  game.endTurn();
  advance(game, 10);

  const standings = replay.standings(['p1', 'p2']);
  assert.ok(replay.attacks.length >= 2, 'sanity: there is more than one step to check');

  for (let step = 0; step <= replay.attacks.length; step++) {
    const board = replay.boardAt(step);
    for (const player of standings) {
      const held = [...board.values()].filter((node) => node.owner === player.playerId);
      assert.equal(player.territories[step], held.length, `territories at step ${step}`);
      assert.equal(
        player.dice[step],
        held.reduce((total, node) => total + node.dice, 0),
        `dice at step ${step}`
      );
    }
  }
});

test('there is a step per attack, plus the board the match opened on', () => {
  const { game, replay } = replayedGame(longWorld(), { rollDie: alwaysRolls(6) });

  game.clickTerritory('a');
  game.clickTerritory('b');
  advance(game, 3);

  const [p1] = replay.standings(['p1', 'p2']);
  assert.equal(p1.territories.length, replay.attacks.length + 1);
  assert.equal(p1.territories[0], 2, 'step zero is the board before anybody attacked');
});

// The stats row never drops a knocked-out player's tile, for the same reason:
// a line that vanished would read as missing data rather than as a defeat.
test('a knocked-out player keeps a line, at zero', () => {
  const { game, replay } = replayedGame(world(), { rollDie: alwaysRolls(6) });

  game.clickTerritory('a');
  game.clickTerritory('b');
  advance(game, 3);
  game.clickTerritory('c');
  game.clickTerritory('d');
  advance(game, 3);

  const p2 = replay.standings(['p1', 'p2']).find((entry) => entry.playerId === 'p2');
  assert.deepEqual(p2.territories, [2, 1, 0]);
  assert.deepEqual(p2.dice.at(-1), 0, 'wiped out, rather than absent');
});

// Reinforcement lands between attacks, and the step it belongs to is decided
// by `boardAfterAttacks` — a payout after the last attack of a turn is part of
// the *next* step, not a bump on the end of this one.
test('a payout shows up on the step whose board it is already on', () => {
  const { game, replay } = replayedGame(longWorld(), { rollDie: alwaysRolls(6) });

  game.clickTerritory('a');
  game.clickTerritory('b');
  advance(game, 3);
  game.endTurn();
  advance(game, 10);

  const [p1] = replay.standings(['p1', 'p2']);
  const afterFirstAttack = [...replay.boardAt(1).values()]
    .filter((node) => node.owner === 'p1')
    .reduce((total, node) => total + node.dice, 0);
  assert.equal(p1.dice[1], afterFirstAttack, 'the payout is not folded back into the fight');
});

// --- the cap, and the anchor that makes trimming lossless -----------------

test('past the cap the oldest moves go, and the board they left behind stays exact', () => {
  // the whole claim behind trimming: dropping a move is only lossless because
  // the anchor absorbs it on the way out, so every step still standing
  // rebuilds the board it actually stood on
  // a longer board than `world()`, so taking two territories off p2 does not
  // end the match before there is anything to trim
  const w = chainWorld([
    ['a', { owner: 'p1', dice: 8 }],
    ['b', { owner: 'p2', dice: 1 }],
    ['c', { owner: 'p1', dice: 8 }],
    ['d', { owner: 'p2', dice: 1 }],
    ['e', { owner: 'p2', dice: 8 }],
    ['f', { owner: 'p2', dice: 4 }],
  ]);
  const game = createGame({ world: w, rollDie: alwaysRolls(6) });
  const anchor = () => ({ nodes: game.state.nodes });
  const trimmed = createReplay({ ...anchor(), limit: 3 });
  const whole = createReplay(anchor());

  let declared = null;
  game.on('attack', ({ event }) => {
    declared = event;
  });
  game.on('resolved', () => {
    trimmed.record(declared);
    whole.record(declared);
  });
  game.on('reinforce', (event) => {
    trimmed.recordReinforcement(event);
    whole.recordReinforcement(event);
  });

  game.clickTerritory('a');
  game.clickTerritory('b');
  advance(game, 3);
  game.clickTerritory('c');
  game.clickTerritory('d');
  advance(game, 3);
  game.endTurn();
  advance(game, 10);

  assert.ok(whole.moves.length > 3, 'sanity: the match ran long enough to be trimmed');
  assert.equal(trimmed.moves.length, 3, 'only the last three moves are on the record');
  assert.deepEqual(trimmed.moves, whole.moves.slice(-3), 'the newest, not the oldest');
  assert.deepEqual(
    [...trimmed.boardAt(Infinity)],
    [...whole.boardAt(Infinity)],
    'and the trimmed replay still ends on the same board, die for die'
  );
});

test('a pass is recorded rather than worked out, so trimming cannot invent one', () => {
  // "no attack since the last payout" would call this turn a pass the moment
  // the attack that disproves it drops off the front of the log
  const { game, replay } = replayedGame(world(), { rollDie: alwaysRolls(6) }, { limit: 1 });

  game.clickTerritory('a');
  game.clickTerritory('b');
  advance(game, 3);
  game.endTurn(); // p1 fought this turn, so it is not a pass

  assert.deepEqual(replay.moves.map((move) => move.kind), ['reinforce'], 'the attack is gone');
  assert.deepEqual(replay.historyAt(), [], 'and the turn it belonged to is still not a pass');
});

// --- a replay, written down and read back ---------------------------------

test('a replay survives being written down, including what was left out of it', () => {
  const { game, replay } = replayedGame(world(), { rollDie: alwaysRolls(6) });

  game.clickTerritory('a');
  game.clickTerritory('b');
  advance(game, 3);
  game.endTurn();
  advance(game, 10);

  const revived = reviveReplay(JSON.parse(JSON.stringify(serializeReplay(replay))));

  // none of this is written down: who was attacking, who was defending, what
  // the totals came to and who won are all read back off the board the moves
  // are walked over
  assert.deepEqual(revived.moves, replay.moves);
  assert.equal(revived.attacks[0].attacker.playerId, 'p1');
  assert.equal(revived.attacks[0].defender.playerId, 'p2');
  assert.equal(revived.attacks[0].attacker.total, 48, 'eight sixes');
  assert.equal(revived.attacks[0].attackerWins, true);
});

test('a fight is written down as the two territories and the faces, and nothing else', () => {
  // this is where a save shrank: five short values out, against two owners,
  // two roll arrays, two totals and a verdict coming back
  const { game, replay } = replayedGame(world(), { rollDie: alwaysRolls(6) });

  game.clickTerritory('a');
  game.clickTerritory('b');
  advance(game, 3);

  assert.deepEqual(serializeReplay(replay).moves, [[0, 'a', 'b', '66666666', '6']]);
});

test('an elimination comes back out of a save, tagged onto the attack that caused it', () => {
  const { game, replay } = replayedGame(world(), { rollDie: alwaysRolls(6) });

  game.clickTerritory('a');
  game.clickTerritory('b');
  advance(game, 3);
  game.clickTerritory('c');
  game.clickTerritory('d'); // p2's last territory
  advance(game, 3);

  const revived = reviveReplay(serializeReplay(replay));
  assert.deepEqual(revived.attacks[1].elimination, { playerId: 'p2', by: 'p1' });
});

test('a turn that passed is a history row of its own, the way the live log shows it', () => {
  // the history panel is read out of the replay now, so anything the battle
  // log used to record on its own has to survive in here — a turn with no
  // fight in it included, or a resumed game loses rows it had before the
  // reload
  const { game, replay } = replayedGame(world(), { rollDie: alwaysRolls(6) });

  game.endTurn(); // p1 passes without attacking

  assert.deepEqual(replay.historyAt(), [{ kind: 'passed', playerId: 'p1' }]);
});

test('the history a reload shows is the history the live log had before it', () => {
  // the whole basis for not saving the battle log any more: what the replay
  // gives back has to be what the log had, row for row — an elimination in
  // its place after the attack that caused it, and a passed turn still there
  const { game, replay } = replayedGame(world(), { rollDie: alwaysRolls(6) });

  // the battle log wired up exactly as session.js wires it during play
  const live = createBattleLog();
  let declared = null;
  game.on('attack', ({ event }) => {
    declared = event;
  });
  game.on('resolved', () => live.record(declared));
  game.on('eliminated', (event) => live.record(event));
  game.on('reinforce', (event) => {
    if (event.passed) live.record({ type: 'passed', playerId: event.playerId });
  });

  game.endTurn(); // p1 passes
  advance(game, 10);
  game.clickTerritory('a');
  game.clickTerritory('b');
  advance(game, 3);
  game.clickTerritory('c');
  game.clickTerritory('d'); // knocks p2 out
  advance(game, 3);

  const restored = reviveReplay(serializeReplay(replay)).historyAt();

  assert.deepEqual(
    restored.map((entry) => entry.kind),
    live.entries.map((entry) => entry.kind),
    'the same rows, in the same order'
  );
  assert.deepEqual(
    restored.map(({ kind, from, to, playerId }) => ({ kind, from, to, playerId })),
    live.entries.map(({ kind, from, to, playerId }) => ({ kind, from, to, playerId })),
    'saying the same things'
  );
});
