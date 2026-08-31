import * as THREE from 'three';
import {
  surrenderedPlayerIds,
  largestConnectedRegionSize,
  livingPlayerIds,
  seededRng,
  serializeState,
} from '@dicewars/core';
import { createViewer } from '../render/createViewer.js';
import { createDiePipMaterials } from '../render/diceTextures.js';
import { createSession, PLAYER_NAMES } from '../game/session.js';
import { createGame, AUTOPLAY } from '../game/createGame.js';
import { createReplay, serializeReplay } from '../game/replay.js';
import { gameSave } from '../game/saveGame.js';
import { generatePlanetWorld } from '../world/generateWorld.js';
import { normalizeSettings, playerIdsFor, strategyFor, subdivisionsFor } from '../game/settings.js';

const scenarios = document.getElementById('scenarios');
const pipMaterials = createDiePipMaterials();

const nameOf = (playerId) => PLAYER_NAMES[Number(playerId.slice(1)) - 1] ?? playerId;

/**
 * One particular match, played out from its seeds.
 *
 * Both sources of chance are pinned — `rollDie` for the dice, `rng` for where
 * reinforcement scatters — so a pair of numbers is the entire game, down to
 * every face rolled. That is the only reason a specific match can be named on
 * this page at all: without it, "the game where the surrender was wrong" is
 * something that happened once in a batch run and can never be seen again.
 *
 * `watching` is the seat to treat as the player's. Nobody actually sits in
 * it — the match plays itself — but it is the seat the surrender is judged
 * for, exactly as `createGame` judges it at the end of a real player's turn.
 *
 * `tuning` is left off to use the shipped one. It is only ever passed here to
 * show what a *looser* ratio used to do, which is the point of the first
 * exhibit below.
 */
function playMatch({ players, difficulty, worldSeed, gameSeed, watching, tuning }) {
  const settings = normalizeSettings({ players, difficulty });
  const playerIds = playerIdsFor(settings);
  const world = generatePlanetWorld({
    subdivisions: subdivisionsFor(settings),
    playerIds,
    rng: seededRng(worldSeed),
  });

  const dice = seededRng(gameSeed);
  const scatter = seededRng(gameSeed + 1);
  const game = createGame({
    world,
    humanPlayerId: AUTOPLAY,
    strategy: strategyFor(settings),
    rollDie: () => 1 + Math.floor(dice() * 6),
    rng: scatter,
  });

  const replay = createReplay({
    nodes: game.state.nodes,
    reserves: new Map([...game.state.players].map(([id, player]) => [id, player.reserve])),
  });

  // Recorded where `session.js` records it — at the declaration, which is
  // where the outcome is decided and therefore where a save has to be able to
  // catch it.
  game.on('attack', ({ event, eliminated }) => {
    replay.record(event);
    if (eliminated) replay.recordElimination(eliminated);
  });
  game.on('reinforce', (event) => replay.recordReinforcement(event));

  let attacks = 0;
  let turns = 0;
  let surrender = null;
  game.on('resolved', () => { attacks++; });
  game.on('endTurn', (event) => {
    turns++;
    if (surrender || event.playerId !== watching) return;

    const living = livingPlayerIds(game.state);
    const rivals = living.filter((id) => id !== watching);
    const surrendered = surrenderedPlayerIds(game.state, tuning);
    if (rivals.length === 0 || !rivals.every((id) => surrendered.has(id))) return;

    surrender = { attacks, turn: turns, standings: standingsOf(game.state, living) };
  });

  game.start();
  for (let ticks = 0; !game.isOver() && ticks < 400000; ticks++) game.tick(1 / 30);

  return {
    settings, world, game, replay, surrender, watching, tuning,
    seed: worldSeed, gameSeed, attacks, turns, winner: game.state.winner,
  };
}

function standingsOf(state, living) {
  const rows = living.map((id) => ({
    id, terr: 0, dice: 0, region: largestConnectedRegionSize(state, id),
  }));
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const node of state.nodes.values()) {
    const row = byId.get(node.owner);
    if (row) { row.terr++; row.dice += node.dice; }
  }
  return rows.sort((a, b) => b.dice - a.dice);
}

/**
 * The match handed to a real session — as a save.
 *
 * This is the whole trick behind the page. A session grows its planet from a
 * seed and restores a replay from a save, so a game played out up here is
 * something it can be given directly: same world, same board, same recorded
 * moves, and every pixel drawn by the code the game itself uses. Nothing here
 * reaches into the renderer, which is what stops the page drifting away from
 * what a player would actually see.
 */
function saveOf(match) {
  return gameSave({
    seed: match.seed,
    settings: match.settings,
    humanPlayerId: match.watching,
    world: match.world,
    state: serializeState(match.game.state),
    replay: serializeReplay(match.replay),
  });
}

/** Drags the replay track to a step, the way a finger on it would. */
function seekTo(hudHost, step) {
  const track = hudHost.querySelector('.hud-replay-track');
  if (!track) return;
  track.value = String(step);
  track.dispatchEvent(new Event('input'));
}

function openReplay(hudHost) {
  const watch = [...hudHost.querySelectorAll('.hud-banner-action')]
    .find((button) => button.textContent === 'Watch replay');
  watch?.click();
}

function addScenario({ title, note, match, readout }) {
  const section = document.createElement('section');
  section.className = 'scenario';
  section.innerHTML = '<h2></h2><p></p><div class="stage is-hud is-planet"></div>'
    + '<p class="scenario-actions"><button class="preview-button" type="button"></button></p>'
    + '<pre class="menu-readout"></pre>';
  section.querySelector('h2').textContent = title;
  section.querySelector('p').textContent = note;
  scenarios.append(section);

  const stage = section.querySelector('.stage');
  const canvas = document.createElement('canvas');
  const hudHost = document.createElement('div');
  hudHost.className = 'hud-host';
  stage.append(canvas, hudHost);

  const viewer = createViewer(canvas);
  const session = createSession({
    viewer,
    hudRoot: hudHost,
    pipMaterials,
    settings: match.settings,
    saved: saveOf(match),
    onNewGame: () => {},
    onMenu: () => {},
    onSave: () => {},
  });

  section.querySelector('.menu-readout').textContent = readout;

  // The match is finished, so the session opens on the ending it reached and
  // offers the replay — the same banner a player reloading a played-out game
  // lands on. Open it, then stand the track on the surrender itself.
  openReplay(hudHost);
  if (match.surrender) seekTo(hudHost, match.surrender.attacks);

  const jump = section.querySelector('.preview-button');
  jump.textContent = match.surrender
    ? `Back to the surrender point — attack ${match.surrender.attacks}`
    : 'No surrender in this match';
  jump.disabled = !match.surrender;
  jump.addEventListener('click', () => {
    openReplay(hudHost); // in case the × was pressed
    seekTo(hudHost, match.surrender.attacks);
  });

  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    session.tick(Math.min(clock.getDelta(), 0.1));
    viewer.render();
  }
  animate();
}

function readoutFor(match, verdict) {
  const { surrender } = match;
  const me = surrender.standings.find((row) => row.id === match.watching);
  const best = surrender.standings.find((row) => row.id !== match.watching);
  const lines = [
    `watching          ${nameOf(match.watching)} (${match.settings.players} players, ${match.settings.difficulty})`,
    `seeds             world ${match.seed}, play ${match.gameSeed}`,
    `ratio             a ${match.tuning ? 'quarter — the ratio this game is the argument against'
      : 'sixth — the shipped one'}`,
    '',
    `surrender fires   after attack ${surrender.attacks} of ${match.attacks}`
      + `  (turn ${surrender.turn} of ${match.turns}, ${surrender.standings.length} players still alive)`,
    `${nameOf(match.watching)} holds        ${me.terr} territories, ${me.dice} dice, largest region ${me.region}`,
    `best rival        ${nameOf(best.id)} — ${best.terr} territories, ${best.dice} dice, largest region ${best.region}`,
    '',
    `actually won by   ${nameOf(match.winner)}, ${match.attacks - surrender.attacks} attacks later`,
    '',
    verdict,
  ];
  return lines.join('\n');
}

// --- the two matches ------------------------------------------------------

// Deliberately judged at a quarter rather than the shipped sixth: this is the
// match that argued the ratio down, and at the tuning the game actually uses
// it never fires at all.
const upset = playMatch({
  players: 6, difficulty: 'expert', worldSeed: 5304, gameSeed: 1015472, watching: 'p2',
  tuning: { diceRatio: 4, regionRatio: 4 },
});

addScenario({
  title: 'Why the ratio is a sixth',
  note: 'Judged at a quarter, this match calls itself over a tenth of the way in. Blue holds half '
    + 'the planet and every rival is under a quarter of Blue on both counts — and Red goes on to '
    + 'win it anyway, 580 attacks later. Look at what is wrong with the position: nobody has been '
    + 'knocked out yet, and Blue is wide rather than deep, 25 territories carrying 54 dice between '
    + 'them. That is a shape a board can be taken back off you. Scrub forward and watch it happen. '
    + 'At the sixth the game ships with, this never fires at all.',
  match: upset,
  readout: readoutFor(
    upset,
    'at the shipped sixth this match is never called — the surrender simply never appears'
  ),
});

const sound = playMatch({
  players: 6, difficulty: 'expert', worldSeed: 4017, gameSeed: 901163, watching: 'p2',
});

addScenario({
  title: 'The surrender as it usually goes',
  note: 'The same rule on an ordinary match, for contrast: three players left, three quarters of '
    + 'the way in, and the hundred attacks the banner skips are the mopping up nobody wants to '
    + 'sit through. Scrub past the surrender point and there is no comeback in it — which is the '
    + 'case the feature exists for, and by a wide margin the usual one.',
  match: sound,
  readout: readoutFor(sound, 'this is what the other 1,196 firings in the search looked like'),
});
