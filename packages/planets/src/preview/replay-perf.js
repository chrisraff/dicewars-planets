import { seededRng, serializeState } from '@dicewars/core';
import { generatePlanetWorld } from '../world/generateWorld.js';
import { createGame, AUTOPLAY } from '../game/createGame.js';
import { createReplay, reviveReplay, serializeReplay, REPLAY_LIMIT } from '../game/replay.js';
import { normalizeSettings, playerIdsFor, strategyFor, subdivisionsFor } from '../game/settings.js';
import { gameSave, readSavedGame, writeSavedGame } from '../game/saveGame.js';

const scenarios = document.getElementById('scenarios');
const runButton = document.getElementById('run');

/**
 * Real localStorage, under a key belonging to this page.
 *
 * Timing a save against a stub Map would time nothing worth knowing —
 * `setItem` is a synchronous write on the main thread and its cost is the
 * whole reason a save's size matters at all. So `readSavedGame` and
 * `writeSavedGame` are handed the real thing, with the key swapped out
 * underneath them: same engine, same write, and a game in progress in the
 * next tab is left exactly where it was.
 */
const PREVIEW_KEY = 'dicewars-planets:preview-perf';

const scratchStorage = {
  getItem: () => window.localStorage.getItem(PREVIEW_KEY),
  setItem: (_key, value) => window.localStorage.setItem(PREVIEW_KEY, value),
  removeItem: () => window.localStorage.removeItem(PREVIEW_KEY),
};

/**
 * A match played out by nobody, recorded exactly the way `session.js` records
 * one: the replay anchored on the board the game opens with, an attack
 * written down once it has resolved rather than when it is declared, and the
 * payout at the end of every turn.
 *
 * `stopAtMoves` stops the clock once the replay holds that many moves rather
 * than waiting for a winner — the only way to reach the cap in a sensible
 * amount of time, since the planets big enough to hit it are also the ones
 * that take tens of thousands of moves to finish.
 */
function playMatch({ players, subdivisions, seed, stopAtMoves = Infinity }) {
  const settings = normalizeSettings({ players, difficulty: 'hard' });
  const playerIds = playerIdsFor(settings);
  const world = generatePlanetWorld({
    subdivisions: subdivisions ?? subdivisionsFor(settings),
    playerIds,
    rng: seededRng(seed),
  });

  const game = createGame({ world, humanPlayerId: AUTOPLAY, strategy: strategyFor(settings) });
  const replay = createReplay({
    nodes: game.state.nodes,
    reserves: new Map([...game.state.players].map(([id, player]) => [id, player.reserve])),
  });

  let declared = null;
  game.on('attack', ({ event }) => {
    declared = event;
  });
  game.on('resolved', () => replay.record(declared));
  game.on('eliminated', (event) => replay.recordElimination(event));
  game.on('reinforce', (event) => replay.recordReinforcement(event));

  game.start();
  while (!game.isOver() && replay.moves.length < stopAtMoves) game.tick(1 / 30);

  return { world, game, replay, settings, playerIds, territories: world.nodeIds.length };
}

/** Milliseconds a piece of work takes, averaged over enough runs to mean it. */
function time(fn, runs = 20) {
  fn(); // whatever the first call has to warm up is not what a player pays
  const started = performance.now();
  for (let i = 0; i < runs; i++) fn();
  return (performance.now() - started) / runs;
}

const ms = (value) => `${value.toFixed(3)} ms`;
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

/**
 * Every number this page exists for, for one match: what a save of it costs
 * to build, to write, to read back and to decode, plus what one step of the
 * replay costs to draw once it is open.
 *
 * The save is built and written the same way a real move does it — the whole
 * snapshot, every time — because that is what `session.js` does on every
 * `change` event, and a per-move cost is the one that has to stay invisible.
 */
function measure({ world, game, replay, settings, playerIds }) {
  const snapshot = () =>
    gameSave({
      seed: 1,
      settings,
      humanPlayerId: playerIds[0],
      world,
      state: serializeState(game.state),
      replay: serializeReplay(replay),
      camera: { x: 0, y: 0, z: 4 },
    });

  const save = snapshot();
  const encoded = JSON.stringify(save);
  const replayBytes = JSON.stringify(save.replay).length;
  const step = replay.attacks.length;

  writeSavedGame(scratchStorage, save);
  const read = readSavedGame(scratchStorage);

  return [
    ['moves recorded', `${replay.moves.length} (${replay.attacks.length} fights)`],
    ['save, written down', `${kb(encoded.length)} — of which replay ${kb(replayBytes)}`],
    ['snapshot + stringify', ms(time(() => JSON.stringify(snapshot())))],
    ['localStorage.setItem', ms(time(() => writeSavedGame(scratchStorage, save)))],
    ['readSavedGame', ms(time(() => readSavedGame(scratchStorage)))],
    ['reviveReplay', ms(time(() => reviveReplay(read.replay)))],
    [
      'one seek, to the last fight',
      ms(time(() => {
        replay.boardAt(step);
        replay.playersAt(step);
        replay.historyAt(step);
      })),
    ],
  ];
}

function addScenario({ title, note }) {
  const section = document.createElement('section');
  section.className = 'scenario';
  section.innerHTML = '<h2></h2><p></p><pre class="menu-readout">measuring…</pre>';
  section.querySelector('h2').textContent = title;
  section.querySelector('p').textContent = note;
  scenarios.append(section);
  return section.querySelector('.menu-readout');
}

function render(readout, rows) {
  const width = Math.max(...rows.map(([label]) => label.length));
  readout.textContent = rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`).join('\n');
}

// One frame between scenarios, so the page paints what it has before the next
// match blocks the thread for a second working out the one after it.
const painted = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

const CASES = [
  {
    title: 'Two players, played out',
    note: 'The shortest match there is: two seats on a default planet, fought to a winner. '
      + 'A save at this length is mostly board — the replay has barely anything in it yet.',
    match: { players: 2, seed: 7 },
  },
  {
    title: 'Six players, played out',
    note: 'The usual game, end to end. This is the length nearly every real save sits at, and '
      + 'the one the per-move cost has to disappear into.',
    match: { players: 6, seed: 11 },
  },
  {
    title: 'Eight players, played out',
    note: 'A full table on a default planet — the longest match anything currently offered can '
      + 'produce, and still comfortably short of the cap.',
    match: { players: 8, seed: 13 },
  },
  {
    title: `At the cap — ${REPLAY_LIMIT} moves`,
    note: 'Eight players on a subdivision-4 planet, which is four times the territory the menu '
      + 'offers and takes tens of thousands of moves to finish. It is here because it is the '
      + 'only way to reach the cap: the clock stops the moment the replay is full, which is '
      + 'exactly the worst save the trimming rule allows anyone to write.',
    match: { players: 8, subdivisions: 4, seed: 17, stopAtMoves: REPLAY_LIMIT },
  },
];

async function run() {
  scenarios.replaceChildren();
  runButton.disabled = true;

  for (const { title, note, match } of CASES) {
    const readout = addScenario({ title, note });
    await painted();

    const played = playMatch(match);
    render(readout, [
      ['planet', `${played.territories} territories, ${played.playerIds.length} players`],
      ...measure(played),
    ]);
    await painted();
  }

  // nothing of this page's is left behind in the browser's storage
  window.localStorage.removeItem(PREVIEW_KEY);
  runButton.disabled = false;
}

runButton.addEventListener('click', run);
run();
