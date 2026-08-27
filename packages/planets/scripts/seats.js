import { execFile } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
  createExpertStrategy,
  createSimpleStrategy,
  createInitialState,
  getCurrentPlayerId,
  largestConnectedRegionSize,
  livingPlayerIds,
  runAiTurn,
  seededRng,
} from '@dicewars/core';
import { generatePlanetWorld } from '../src/world/generateWorld.js';

/**
 * Whether the seat you are dealt decides the match before a die is thrown.
 *
 * Same question as `arena.js` and the same shape of answer — thousands of
 * games, a rate with an interval round it — but the thing held still is the
 * AI rather than the seat: every seat plays the same strategy, so anything
 * that separates them is the board and the turn order rather than the player.
 *
 *   node packages/planets/scripts/seats.js --players 6
 *   node packages/planets/scripts/seats.js --players 6 --handicap '{"dice":[0,0,0,1,1,2]}'
 */

const MAX_TURNS = 3000;
const STRATEGIES = { simple: createSimpleStrategy, expert: createExpertStrategy };
const LINEUP_ROLES = ['simple', 'expert'];

// --- the levers a generator could pull --------------------------------------

/**
 * Extra starting dice for a seat, spread over the territories it was dealt and
 * stopping at the 8-dice cap. Scattered rather than piled, for the same reason
 * reinforcement scatters: eight on one territory is an army that can only ever
 * walk in one direction.
 */
function addDice(assignments, playerIds, extraBySeat, rng) {
  const next = assignments.map(([id, a]) => [id, { ...a }]);
  const byOwner = new Map(playerIds.map((id) => [id, []]));
  for (const [, a] of next) byOwner.get(a.owner)?.push(a);

  playerIds.forEach((id, seat) => {
    const want = extraBySeat[seat] ?? 0;
    // a fractional handicap is paid as a whole die some fraction of the time,
    // so a ramp between seats need not be a whole number of dice wide
    let extra = Math.floor(want) + (rng() < want - Math.floor(want) ? 1 : 0);
    const mine = byOwner.get(id) ?? [];
    while (extra > 0 && mine.some((n) => n.dice < 8)) {
      const pick = mine[Math.floor(rng() * mine.length)];
      if (pick.dice < 8) { pick.dice++; extra--; }
    }
  });
  return next;
}

/**
 * The compensation ramp: seat 1 gets nothing, the last seat gets `perTerritory`
 * extra dice for every territory it holds, and the seats between are placed by
 * `curve` (1 is a straight line; below 1 leans the help towards the early
 * seats, which is what small tables want).
 */
export function diceRamp({ players, territories, perTerritory, curve = 1 }) {
  const last = perTerritory * (territories / players);
  return Array.from({ length: players }, (_, seat) =>
    (players < 2 ? 0 : last * ((seat / (players - 1)) ** curve)));
}

/**
 * How many territories each seat is dealt.
 *
 * `weights` sets the proportion; the leftovers that no proportion can divide
 * are what `remainder` is about. Round-robin hands them to the earliest seats
 * every single game, which is a bias rather than a rounding — hence `late`
 * (to the seats that move last) and `spread` (to a different set each planet).
 */
function seatCounts(count, playerIds, { weights, remainder = 'early' }, rng) {
  const players = playerIds.length;
  const w = weights ?? playerIds.map(() => 1);
  const total = w.reduce((s, v) => s + v, 0);
  const exact = w.map((v) => (v / total) * count);
  const counts = exact.map((e) => Math.floor(e));
  let left = count - counts.reduce((s, c) => s + c, 0);

  const order = exact
    .map((e, i) => [i, e - Math.floor(e)])
    .sort((x, y) => (y[1] - x[1]) || (remainder === 'late' ? y[0] - x[0] : x[0] - y[0]))
    .map(([seat]) => seat);
  if (remainder === 'spread') {
    const offset = Math.floor(rng() * players);
    order.sort((x, y) => ((x - offset + players) % players) - ((y - offset + players) % players));
  }
  for (const seat of order) { if (left-- <= 0) break; counts[seat]++; }
  return counts;
}

/**
 * Deal territories to seats, in blobs of `clumpSize[seat]` adjacent
 * territories rather than one at a time.
 *
 * Scattering is what the round-robin deal does today, and it is the reason
 * the largest connected region — the thing reinforcement is actually paid on —
 * starts at about 3 out of 10 territories held. A seat dealt in pairs or
 * triples starts with the same army on better ground.
 */
function clumpedDeal(nodeIds, edges, playerIds, counts, clumpSize, rng) {
  const adjacency = new Map(nodeIds.map((id) => [id, []]));
  for (const [a, b] of edges) { adjacency.get(a).push(b); adjacency.get(b).push(a); }

  const free = new Set(nodeIds);
  const owner = new Map();
  const remaining = counts.slice();
  const pickFrom = (items) => items[Math.floor(rng() * items.length)];

  // Seats take blobs in turn, largest quota first, so no seat is left picking
  // over whatever the others did not want.
  while (free.size > 0) {
    let seat = -1;
    for (let s = 0; s < playerIds.length; s++) {
      if (remaining[s] > 0 && (seat < 0 || remaining[s] > remaining[seat])) seat = s;
    }
    if (seat < 0) break;

    const want = Math.min(remaining[seat], Math.max(1, clumpSize[seat] ?? 1));
    const start = pickFrom([...free]);
    const blob = [start];
    free.delete(start);
    while (blob.length < want) {
      const border = blob.flatMap((id) => adjacency.get(id)).filter((id) => free.has(id));
      if (border.length === 0) break;
      const next = pickFrom(border);
      blob.push(next);
      free.delete(next);
    }
    for (const id of blob) owner.set(id, seat);
    remaining[seat] -= blob.length;
  }
  return owner;
}

function applyHandicap(world, playerIds, handicap, rng) {
  if (!handicap) return world;
  let assignments = world.assignments;

  if (handicap.weights || handicap.tilt || handicap.remainder || handicap.clump) {
    // `tilt` is the one-number form of `weights`: a straight ramp from the
    // first seat to the last, so a sweep has a single knob to turn.
    const bend = handicap.tiltCurve ?? 1;
    const weights = handicap.weights ?? (handicap.tilt === undefined ? null
      : playerIds.map((_, seat) =>
        1 + handicap.tilt * ((playerIds.length < 2 ? 0 : seat / (playerIds.length - 1)) ** bend)));
    const counts = seatCounts(assignments.length, playerIds, { ...handicap, weights }, rng);
    const dice = assignments.map(([, a]) => a.dice);
    const nodeIds = assignments.map(([id]) => id);

    if (handicap.clump) {
      const owner = clumpedDeal(world.nodeIds, world.edges, playerIds, counts,
        handicap.clump, rng);
      assignments = nodeIds.map((id, i) => [id, { owner: playerIds[owner.get(id)], dice: dice[i] }]);
    } else {
      const queue = [];
      const remaining = counts.slice();
      while (queue.length < nodeIds.length) {
        for (let seat = 0; seat < playerIds.length; seat++) {
          if (remaining[seat] > 0) { queue.push(seat); remaining[seat]--; }
        }
      }
      assignments = nodeIds.map((id, i) => [id, { owner: playerIds[queue[i]], dice: dice[i] }]);
    }
  }
  // A floor is a different kind of gift from a scattered die. A territory
  // holding one die cannot attack at all and is the cheapest capture on the
  // board, so raising the floor removes a target rather than adding mass —
  // which is why it has to be measured per die spent, not per die given.
  if (handicap.floor) {
    const seatOf = new Map(playerIds.map((id, i) => [id, i]));
    assignments = assignments.map(([id, a]) => {
      const want = handicap.floor[seatOf.get(a.owner)] ?? 0;
      const floorHere = Math.floor(want) + (rng() < want - Math.floor(want) ? 1 : 0);
      return [id, { ...a, dice: Math.max(a.dice, Math.min(floorHere, 8)) }];
    });
  }

  const extra = handicap.ramp
    ? diceRamp({ players: playerIds.length, territories: assignments.length, ...handicap.ramp })
    : handicap.dice;
  if (extra) assignments = addDice(assignments, playerIds, extra, rng);
  return { ...world, assignments };
}

// --- one match ---------------------------------------------------------------

function startingProfile(state, playerIds) {
  const seatOf = new Map(playerIds.map((id, i) => [id, i]));
  const terr = playerIds.map(() => 0);
  const dice = playerIds.map(() => 0);
  const ones = playerIds.map(() => 0);
  for (const node of state.nodes.values()) {
    const seat = seatOf.get(node.owner);
    terr[seat]++;
    dice[seat] += node.dice;
    if (node.dice === 1) ones[seat]++;
  }
  return { terr, dice, ones, region: playerIds.map((id) => largestConnectedRegionSize(state, id)) };
}

/**
 * Who moves next — the structural alternative to handicapping.
 *
 * `fixed` is the game as it stands: seat 1, seat 2, … round after round.
 * `snake` reverses every other round (1..P, P..1), so over a pair of rounds
 * the wait between a seat's turns is the same wherever it sits. `random`
 * reshuffles the living players every round, which has no seats left to be
 * unfair to.
 *
 * A handicap pays the first mover's advantage back; these remove it. That
 * distinction is the whole question of whether neutrality can be independent
 * of how well the players play.
 */
function makeSequencer(order, playerIds, rng) {
  let queue = [];
  let round = 0;

  const refill = (living) => {
    const alive = playerIds.filter((id) => living.has(id));
    if (order === 'random') {
      const shuffledAlive = alive.slice();
      for (let i = shuffledAlive.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffledAlive[i], shuffledAlive[j]] = [shuffledAlive[j], shuffledAlive[i]];
      }
      queue = shuffledAlive;
    } else if (order === 'snake' && round % 2 === 1) {
      queue = alive.reverse();
    } else {
      queue = alive;
    }
    round++;
  };

  return (living) => {
    while (queue.length && !living.has(queue[0])) queue.shift();
    if (!queue.length) refill(living);
    while (queue.length && !living.has(queue[0])) queue.shift();
    return queue.shift() ?? null;
  };
}

export function playGame({
  worldSeed, gameSeed, playerIds, subdivisions, strategy, handicap,
  order = 'fixed', lineup, level = false,
}) {
  const rng = seededRng(worldSeed);
  // `level` measures the correction the generator now ships with; everything
  // else here measures the raw board, which is what the handicaps are for.
  const world = applyHandicap(
    generatePlanetWorld({ subdivisions, playerIds, rng, levelSeats: level }),
    playerIds, handicap, rng
  );
  const die = seededRng(gameSeed);
  const deps = { rollDie: () => 1 + Math.floor(die() * 6), rng: seededRng(gameSeed + 7919) };

  let state = createInitialState(world);
  const profile = startingProfile(state, playerIds);
  const strategies = new Map(playerIds.map((id, seat) =>
    [id, STRATEGIES[lineup ? lineup[seat] : strategy]()]));

  // The sequencer drives every turn, including the first — so `fixed` runs
  // through exactly the same code path as the alternatives and reproduces
  // core's own round-robin rather than sitting beside it.
  const nextPlayer = makeSequencer(order, playerIds, seededRng(gameSeed + 31));
  let turns = 0;

  while (state.phase !== 'gameover' && turns < MAX_TURNS) {
    const up = nextPlayer(new Set(livingPlayerIds(state)));
    if (up === null) break;
    // only the index moves — the rules are untouched
    state = { ...state, currentTurnIndex: state.turnOrder.indexOf(up) };
    state = runAiTurn(state, strategies.get(getCurrentPlayerId(state)), deps).state;
    turns++;
  }
  return { seat: playerIds.indexOf(state.winner), turns, profile };
}

export function runBatch({
  games, players, subdivisions, seed, strategy, handicap, rows, order, lineup, rotate, level,
}) {
  const playerIds = Array.from({ length: players }, (_, i) => `p${i + 1}`);
  const wins = playerIds.map(() => 0);
  const startTerr = playerIds.map(() => 0);
  const startDice = playerIds.map(() => 0);
  const startOnes = playerIds.map(() => 0);
  const sample = [];
  let draws = 0;
  let turns = 0;

  // A mixed field asks a different question than a uniform one. Rotating the
  // lineup one seat per game and recording where the odd strategy sat lets the
  // two effects be read apart: how often the newcomer wins from each seat, and
  // how often everyone else does. Neutrality means both are flat — and one
  // handicap has to make them flat at the same time.
  const roleWins = LINEUP_ROLES.map(() => playerIds.map(() => 0));
  const roleGames = LINEUP_ROLES.map(() => playerIds.map(() => 0));

  for (let game = 0; game < games; game++) {
    const s = seed + game * 1013;
    const shift = rotate && lineup ? game % players : 0;
    const seated = lineup
      ? Array.from({ length: players }, (_, seat) => lineup[(seat - shift + players * players) % lineup.length])
      : undefined;

    const r = playGame({ worldSeed: s, gameSeed: s + 7, playerIds, subdivisions,
      strategy, handicap, order, lineup: seated, level });
    if (r.seat < 0) draws++; else wins[r.seat]++;
    turns += r.turns;
    r.profile.terr.forEach((v, i) => { startTerr[i] += v; });
    r.profile.dice.forEach((v, i) => { startDice[i] += v; });
    r.profile.ones.forEach((v, i) => { startOnes[i] += v; });
    if (rows) sample.push([r.seat, r.profile.terr, r.profile.dice, r.profile.region]);

    if (seated) {
      for (let seat = 0; seat < players; seat++) {
        const role = LINEUP_ROLES.indexOf(seated[seat]);
        if (role < 0) continue;
        roleGames[role][seat]++;
        if (r.seat === seat) roleWins[role][seat]++;
      }
    }
  }
  return { wins, draws, turns, rows: sample, roleWins, roleGames,
    startTerr, startDice, startOnes, counted: games };
}

// --- sharding ----------------------------------------------------------------

async function sharded(options) {
  const jobs = options.jobs || Math.max(1, Math.min(14, cpus().length - 2));
  const here = fileURLToPath(import.meta.url);
  const run = promisify(execFile);
  const each = Math.ceil(options.games / jobs);

  const slices = await Promise.all(
    Array.from({ length: jobs }, (_, i) =>
      run(process.execPath, [
        here,
        '--shard', '1',
        '--games', String(each),
        '--players', String(options.players),
        '--subdivisions', String(options.subdivisions),
        '--seed', String(options.seed + i * 1000003),
        '--strategy', options.strategy,
        '--rows', String(options.rows),
        '--order', options.order,
        '--lineup', options.lineup ? options.lineup.join(',') : '',
        '--rotate', String(options.rotate),
        '--level', String(options.level),
        '--handicap', JSON.stringify(options.handicap ?? null),
      ], { maxBuffer: 1 << 28 })
    )
  );

  const wins = Array.from({ length: options.players }, () => 0);
  const zero = () => LINEUP_ROLES.map(() => Array.from({ length: options.players }, () => 0));
  const roleWins = zero();
  const roleGames = zero();
  const rows = [];
  const startTerr = Array.from({ length: options.players }, () => 0);
  const startDice = Array.from({ length: options.players }, () => 0);
  const startOnes = Array.from({ length: options.players }, () => 0);
  let counted = 0;
  let draws = 0;
  let turns = 0;
  for (const { stdout } of slices) {
    const part = JSON.parse(stdout);
    part.wins.forEach((w, i) => { wins[i] += w; });
    draws += part.draws;
    turns += part.turns;
    rows.push(...part.rows);
    part.roleWins?.forEach((row, r) => row.forEach((v, i) => { roleWins[r][i] += v; }));
    part.roleGames?.forEach((row, r) => row.forEach((v, i) => { roleGames[r][i] += v; }));
    part.startTerr.forEach((v, i) => { startTerr[i] += v; });
    part.startDice.forEach((v, i) => { startDice[i] += v; });
    part.startOnes.forEach((v, i) => { startOnes[i] += v; });
    counted += part.counted;
  }
  return { wins, draws, turns, rows, roleWins, roleGames,
    startTerr, startDice, startOnes, counted, played: each * jobs };
}

export function parseArgs(argv) {
  const options = {
    games: 2000, players: 6, subdivisions: 3, seed: 1, jobs: 0,
    strategy: 'expert', handicap: null, shard: 0, rows: 0, json: 0,
    order: 'fixed', lineup: null, rotate: 0, profile: 0, level: 0,
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`--${key} needs a value`);
    if (key === 'strategy') options.strategy = value;
    else if (key === 'order') options.order = value;
    else if (key === 'lineup') options.lineup = value ? value.split(',') : null;
    else if (key === 'handicap') options.handicap = value === 'null' ? null : JSON.parse(value);
    else if (key in options) options[key] = Number(value);
    else throw new Error(`unknown option --${key}`);
  }
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.shard) {
    process.stdout.write(JSON.stringify(runBatch(options)));
    return;
  }

  const started = Date.now();
  const { wins, draws, turns, rows, roleWins, roleGames,
    startTerr, startDice, startOnes, counted, played } = await sharded(options);
  const decided = wins.reduce((s, w) => s + w, 0);
  const rate = wins.map((w) => w / decided);
  const margin = rate.map((r) => 1.96 * Math.sqrt((r * (1 - r)) / decided));
  const fair = 1 / options.players;
  const spread = Math.max(...rate) - Math.min(...rate);

  const report = {
    players: options.players,
    strategy: options.strategy,
    order: options.order,
    lineup: options.lineup,
    handicap: options.handicap,
    games: played,
    decided,
    draws,
    fair,
    rate,
    margin,
    spread,
    // one number for "how unfair" — chi-square against an even split
    chi2: wins.reduce((s, w) => s + ((w - decided * fair) ** 2) / (decided * fair), 0),
    turnsPerGame: turns / played,
    seconds: (Date.now() - started) / 1000,
    rows: options.rows ? rows : undefined,
  };

  if (options.json) {
    process.stdout.write(JSON.stringify(report));
    return;
  }

  const who = options.lineup ? options.lineup.join('/') : options.strategy;
  console.log(`${who}, ${options.players} players, ${played} games, ${options.order} order`
    + `${options.level ? ', SHIPPED leveller' : ''}`
    + `${options.handicap ? `, handicap ${JSON.stringify(options.handicap)}` : ''}`);
  rate.forEach((r, seat) => {
    const bar = '#'.repeat(Math.round(r * 200));
    console.log(`  seat ${seat + 1}  ${(r * 100).toFixed(1)}% ±${(margin[seat] * 100).toFixed(1)}  ${bar}`);
  });
  console.log(`  fair ${(fair * 100).toFixed(1)}%   spread ${(spread * 100).toFixed(1)}pt   `
    + `chi2 ${report.chi2.toFixed(1)}   ${report.seconds.toFixed(0)}s`);

  if (options.profile) {
    const per = (a) => a.map((v) => (v / counted).toFixed(2).padStart(6)).join('');
    console.log(`  territories ${per(startTerr)}`);
    console.log(`  dice        ${per(startDice)}`);
    console.log(`  1-die terrs ${per(startOnes)}`);
    const spent = startDice.map((v, i) => (v - startDice[0]) / counted);
    console.log(`  dice spent  ${spent.map((v) => v.toFixed(2).padStart(6)).join('')}`
      + `   total ${spent.reduce((a, b) => a + b, 0).toFixed(1)}`);
  }

  if (options.rotate && options.lineup) {
    // Each role's win rate against the seat it happened to be sitting in.
    // Flat means the seat told you nothing about that role's chances.
    LINEUP_ROLES.forEach((role, r) => {
      const played_ = roleGames[r];
      if (!played_.some((n) => n > 0)) return;
      const rates = roleWins[r].map((w, i) => (played_[i] ? w / played_[i] : 0));
      const seen = rates.filter((_, i) => played_[i] > 0);
      const chi = roleWins[r].reduce((acc, w, i) => {
        if (!played_[i]) return acc;
        const mean = seen.reduce((a, b) => a + b, 0) / seen.length;
        return acc + ((w - played_[i] * mean) ** 2) / (played_[i] * mean);
      }, 0);
      console.log(`  ${role.padEnd(7)} by its own seat: `
        + rates.map((v, i) => (played_[i] ? `${(v * 100).toFixed(1)}` : '  - ')).join(' ')
        + `   spread ${((Math.max(...seen) - Math.min(...seen)) * 100).toFixed(1)}pt  chi2 ${chi.toFixed(1)}`);
    });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`seats: ${error.message}`);
    process.exit(1);
  });
}
