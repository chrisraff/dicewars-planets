import { execFile } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  createDefensiveStrategy,
  createExpertStrategy,
  createInitialState,
  createSimpleStrategy,
  getCurrentPlayerId,
  runAiTurn,
  seededRng,
  EXPERT_WEIGHTS,
} from '@dicewars/core';
import { generatePlanetWorld } from '../src/world/generateWorld.js';

/**
 * How strong an AI is, and what it costs to be that strong.
 *
 * Neither question can be answered by a test. A win rate is a measurement with
 * an interval around it, and the interval only closes by playing thousands of
 * games — minutes of CPU, not the second `npm test` is allowed. And a
 * wall-clock number cries wolf on a slow machine, which is the same reason the
 * conventions lint is not in the suite either. So this is a tool you run when
 * you are changing an AI, and the numbers it prints go in CLAUDE.md next to the
 * decision they justified.
 *
 * It lives in planets rather than core because it needs a real planet to play
 * on, and core is not allowed to know that planets exist. It lives in
 * `scripts/` because nothing in there is reachable from `index.html`, so it can
 * never end up in the deployed site.
 *
 *   node packages/planets/scripts/arena.js duel --b expert:follow=0
 *   node packages/planets/scripts/arena.js duel --a expert --b simple --players 8
 *   node packages/planets/scripts/arena.js timing --players 2
 *
 * `duel` is the one to reach for. `timing` answers the other question: the cost
 * of an AI turn lands in a single block, because `planAiTurnMoves` works a
 * whole turn out before any of it is shown, so it is the *slowest* turn in a
 * match that decides whether a frame is dropped. An average hides that
 * completely, which is why this reports the tail.
 */

const MAX_TURNS = 3000; // a field that has stopped attacking would otherwise never end

const STRATEGIES = {
  simple: () => createSimpleStrategy(),
  defensive: () => createDefensiveStrategy(),
  expert: (weights) => createExpertStrategy({ ...EXPERT_WEIGHTS, ...weights }),
};

/**
 * A player, written as `name` or `name:weight=value,weight=value`.
 *
 * The overrides are what makes a before-and-after possible at all: an AI is
 * measured against *itself with one thing changed*, which is the only
 * comparison where everything else is held still. `expert:follow=0` is the
 * expert with its second ply switched off, and is exactly the AI that shipped
 * before there was one.
 */
export function parseStrategy(spec) {
  const [name, tuning = ''] = String(spec).split(':');
  const make = STRATEGIES[name];
  if (!make) {
    throw new Error(`unknown strategy "${name}" — one of ${Object.keys(STRATEGIES).join(', ')}`);
  }

  const weights = {};
  for (const pair of tuning.split(',').filter(Boolean)) {
    const [key, raw] = pair.split('=');
    if (raw === undefined) throw new Error(`"${pair}" should be weight=value`);
    if (!(key in EXPERT_WEIGHTS)) throw new Error(`"${key}" is not one of EXPERT_WEIGHTS`);
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`"${pair}" is not a number`);
    weights[key] = value;
  }
  if (Object.keys(weights).length > 0 && name !== 'expert') {
    throw new Error(`only the expert takes weights, and "${name}" is not it`);
  }
  return { spec: String(spec), name, weights, make: () => make(weights) };
}

/**
 * One match, played through core's reducer rather than through `createGame` —
 * no clock, no animation, a few milliseconds a game. `strategyFor` is per seat,
 * which is the whole point: two AIs have to sit at the same table to be
 * compared on the same planet and the same dice.
 */
export function playGame({ worldSeed, gameSeed, playerIds, strategyFor, subdivisions }) {
  const world = generatePlanetWorld({ subdivisions, playerIds, rng: seededRng(worldSeed) });
  const dice = seededRng(gameSeed);
  const deps = { rollDie: () => 1 + Math.floor(dice() * 6), rng: seededRng(gameSeed + 7919) };

  let state = createInitialState(world);
  const nanos = new Map(playerIds.map((id) => [id, 0]));
  const turnsBy = new Map(playerIds.map((id) => [id, 0]));
  let turns = 0;

  while (state.phase !== 'gameover' && turns < MAX_TURNS) {
    const playerId = getCurrentPlayerId(state);
    const started = process.hrtime.bigint();
    state = runAiTurn(state, strategyFor(playerId), deps).state;
    nanos.set(playerId, nanos.get(playerId) + Number(process.hrtime.bigint() - started));
    turnsBy.set(playerId, turnsBy.get(playerId) + 1);
    turns++;
  }

  return { winner: state.winner ?? null, turns, nanos, turnsBy };
}

/**
 * Half the seats each, alternating, and every game played twice with the two
 * camps swapped over the same planet and the same dice.
 *
 * The obvious design — one contender against a field of the other — wastes
 * most of what it plays: the baseline is 1/players, so nearly every game is
 * one the contender loses whatever it does. Sitting three of each at the table
 * puts the baseline at 50%, and mirroring cancels most of what the seeds
 * decided rather than averaging it away, so this sees a small edge on a
 * fraction of the games. An AI against a copy of itself comes out at exactly
 * 50%, which is worth running first whenever the harness itself is in doubt.
 */
export function duel({ a, b, games, players, subdivisions, seed0 }) {
  const playerIds = Array.from({ length: players }, (_, i) => `p${i + 1}`);
  const time = { a: [0, 0], b: [0, 0] }; // [nanoseconds, turns]
  let aWins = 0;
  let bWins = 0;
  let draws = 0;

  for (let game = 0; game < games; game++) {
    for (const offset of [0, 1]) {
      const strategies = { a: a.make(), b: b.make() };
      const campOf = (playerId) =>
        (playerIds.indexOf(playerId) % 2 === offset ? 'a' : 'b');

      const result = playGame({
        worldSeed: seed0 + game * 1000,
        gameSeed: seed0 + game * 1000 + 3,
        playerIds,
        subdivisions,
        strategyFor: (playerId) => strategies[campOf(playerId)],
      });

      if (result.winner === null) draws++;
      else if (campOf(result.winner) === 'a') aWins++;
      else bWins++;

      for (const playerId of playerIds) {
        const camp = campOf(playerId);
        time[camp][0] += result.nanos.get(playerId);
        time[camp][1] += result.turnsBy.get(playerId);
      }
    }
  }

  return { aWins, bWins, draws, nanos: time };
}

/**
 * What one AI turn costs, as a distribution rather than an average — see the
 * note at the top about why the tail is the number that matters.
 */
export function timingOf({ a, games, players, subdivisions, seed0 }) {
  const playerIds = Array.from({ length: players }, (_, i) => `p${i + 1}`);
  const strategy = a.make();
  const millis = [];

  for (let game = 0; game < games; game++) {
    const worldSeed = seed0 + game;
    const world = generatePlanetWorld({ subdivisions, playerIds, rng: seededRng(worldSeed) });
    const dice = seededRng(worldSeed + 500);
    const deps = { rollDie: () => 1 + Math.floor(dice() * 6), rng: seededRng(worldSeed + 900) };

    let state = createInitialState(world);
    for (let turn = 0; state.phase !== 'gameover' && turn < MAX_TURNS; turn++) {
      const started = process.hrtime.bigint();
      state = runAiTurn(state, strategy, deps).state;
      millis.push(Number(process.hrtime.bigint() - started) / 1e6);
    }
  }

  millis.sort((x, y) => x - y);
  const at = (p) => millis[Math.min(millis.length - 1, Math.floor(millis.length * p))];
  return { turns: millis.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: millis.at(-1) };
}

/** A win rate with the interval that says how much of it to believe. */
export function summarize({ aWins, bWins, draws, nanos }) {
  const decided = aWins + bWins;
  const rate = decided > 0 ? aWins / decided : 0;
  const error = decided > 0 ? Math.sqrt((rate * (1 - rate)) / decided) : 0;
  const perTurn = ([total, turns]) => (turns > 0 ? total / turns / 1e6 : 0);
  return {
    aWins,
    bWins,
    draws,
    decided,
    rate,
    // 95%, so a difference is only real when two of these do not overlap
    margin: 1.96 * error,
    z: error > 0 ? (rate - 0.5) / error : 0,
    msPerTurnA: perTurn(nanos.a),
    msPerTurnB: perTurn(nanos.b),
  };
}

// --- the command line --------------------------------------------------------

const DEFAULTS = { games: 250, players: 6, subdivisions: 3, seed: 1, jobs: 0 };

export function parseArgs(argv) {
  const options = { ...DEFAULTS, a: 'expert', b: 'expert', command: argv[0] ?? 'duel' };
  for (let i = 1; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`--${key} needs a value`);
    if (key === 'a' || key === 'b') options[key] = value;
    else if (key in DEFAULTS) options[key] = Number(value);
    else if (key === 'shard') options.shard = Number(value);
    else throw new Error(`unknown option --${key}`);
  }
  return options;
}

/**
 * Games are independent, so the run is split across processes by seed. Worth
 * having: this is the difference between a measurement you wait for and one you
 * abandon — four thousand games is over five minutes on one core.
 */
async function shardedDuel(options, a, b) {
  const jobs = options.jobs || Math.max(1, Math.min(8, cpus().length - 1));
  const here = fileURLToPath(import.meta.url);
  const run = promisify(execFile);

  const each = Math.ceil(options.games / jobs);
  const slices = await Promise.all(
    Array.from({ length: jobs }, (_, i) =>
      run(process.execPath, [
        here, 'duel',
        '--a', options.a, '--b', options.b,
        '--games', String(each),
        '--players', String(options.players),
        '--subdivisions', String(options.subdivisions),
        // each shard gets its own stretch of seeds, so no game is played twice
        '--seed', String(options.seed + i * 100000),
        '--shard', '1',
      ], { maxBuffer: 1 << 26 })
    )
  );

  const total = { aWins: 0, bWins: 0, draws: 0, nanos: { a: [0, 0], b: [0, 0] } };
  for (const { stdout } of slices) {
    const part = JSON.parse(stdout);
    total.aWins += part.aWins;
    total.bWins += part.bWins;
    total.draws += part.draws;
    for (const camp of ['a', 'b']) {
      total.nanos[camp][0] += part.nanos[camp][0];
      total.nanos[camp][1] += part.nanos[camp][1];
    }
  }
  return { total, played: each * jobs };
}

async function main(argv) {
  const options = parseArgs(argv);
  const a = parseStrategy(options.a);
  const seed0 = options.seed;

  if (options.command === 'timing') {
    const t = timingOf({ a, games: Math.min(options.games, 30), players: options.players,
      subdivisions: options.subdivisions, seed0 });
    console.log(`${a.spec}, ${options.players} players — one AI turn, over ${t.turns} turns`);
    console.log(`  median ${t.p50.toFixed(2)}ms   p95 ${t.p95.toFixed(2)}ms   `
      + `p99 ${t.p99.toFixed(2)}ms   worst ${t.max.toFixed(1)}ms`);
    return;
  }

  const b = parseStrategy(options.b);

  // A shard is one slice of the run, and reports rather than prints.
  if (options.shard) {
    const raw = duel({ a, b, games: options.games, players: options.players,
      subdivisions: options.subdivisions, seed0 });
    process.stdout.write(JSON.stringify(raw));
    return;
  }

  const started = Date.now();
  const { total, played } = await shardedDuel(options, a, b);
  const r = summarize(total);

  console.log(`${a.spec}  vs  ${b.spec}`);
  console.log(`  ${options.players} players, ${played * 2} games (each planet played both ways)`);
  console.log(`  ${r.aWins}-${r.bWins}${r.draws ? ` (${r.draws} drawn)` : ''}   `
    + `${(r.rate * 100).toFixed(1)}% ±${(r.margin * 100).toFixed(1)}   z=${r.z.toFixed(2)}`);
  console.log(`  ${r.msPerTurnA.toFixed(3)}ms vs ${r.msPerTurnB.toFixed(3)}ms per AI turn`);
  console.log(`  ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`arena: ${error.message}`);
    process.exit(1);
  });
}
