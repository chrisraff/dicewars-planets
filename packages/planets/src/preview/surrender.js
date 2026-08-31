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

function addScenario({ title, note, match, readout, expects }) {
  const stale = staleness(match, expects);

  const section = document.createElement('section');
  section.className = 'scenario';
  section.innerHTML = '<h2></h2><p class="scenario-stale" hidden></p><p></p>'
    + '<div class="stage is-hud is-planet"></div>'
    + '<p class="scenario-actions"><button class="preview-button" type="button"></button></p>'
    + '<pre class="menu-readout"></pre>';
  section.querySelector('h2').textContent = title;
  section.querySelector('p:not(.scenario-stale)').textContent = note;

  if (stale.length > 0) {
    const warning = section.querySelector('.scenario-stale');
    warning.hidden = false;
    warning.textContent = `Stale: ${stale.join('; ')}. The caption below describes the `
      + 'match these seeds used to grow, not the one on the planet — a seed is only a match '
      + 'while the generator and the AI stay put. Re-choose the seeds, or re-word the claim.';
  }

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

/**
 * What a scenario claims about its match, checked against the match that was
 * actually played — because **a seed is only a match while everything it feeds
 * stays put**, and this page has already been through that once: the terrain
 * rework grew different planets from the same numbers, and both exhibits
 * stopped firing a surrender at all.
 *
 * The failure was silent and total. `readoutFor` dereferenced a `surrender`
 * that was now `null`, and it did so as an *argument* to the first
 * `addScenario` call — so the module threw at the top level and neither
 * scenario drew. A page that exists to be looked at rendered nothing, and
 * nothing in `npm run build` noticed, because compiling a preview only catches
 * a break at compile time.
 *
 * So a scenario now says what it expects and the page checks. The point is not
 * to keep working when the claim has gone stale — it cannot; the caption is
 * prose about a specific game. The point is to **say so on the page**, loudly,
 * instead of dying or, worse, drawing a different match under a caption
 * describing the old one.
 */
function staleness(match, expects = {}) {
  const problems = [];
  const { surrender, watching, winner } = match;

  if (expects.fires && !surrender) {
    problems.push('no surrender fires in this match at all');
  }
  if (expects.fires === false && surrender) {
    problems.push('a surrender fires in this match, which it is here to show does not');
  }
  if (surrender && expects.watchedWins !== undefined) {
    const won = winner === watching;
    if (won !== expects.watchedWins) {
      problems.push(won
        ? `${nameOf(watching)} goes on to win it, so the call was sound`
        : `${nameOf(watching)} does not go on to win it`);
    }
  }
  return problems;
}

function readoutFor(match, verdict) {
  const { surrender } = match;
  const head = [
    `watching          ${nameOf(match.watching)} (${match.settings.players} players, ${match.settings.difficulty})`,
    `seeds             world ${match.seed}, play ${match.gameSeed}`,
    `ratio             a ${match.tuning ? 'quarter — the ratio this game is the argument against'
      : 'sixth — the shipped one'}`,
    '',
  ];

  // The seeds no longer grow the match this exhibit was chosen for. Say what
  // they do grow, which is the only honest thing left to print.
  if (!surrender) {
    return [
      ...head,
      `surrender fires   never — ${match.attacks} attacks over ${match.turns} turns`,
      `won by            ${nameOf(match.winner)}`,
      '',
      verdict,
    ].join('\n');
  }

  const me = surrender.standings.find((row) => row.id === match.watching);
  const best = surrender.standings.find((row) => row.id !== match.watching);
  return [
    ...head,
    `surrender fires   after attack ${surrender.attacks} of ${match.attacks}`
      + `  (turn ${surrender.turn} of ${match.turns}, ${surrender.standings.length} players still alive)`,
    `${nameOf(match.watching)} holds        ${me.terr} territories, ${me.dice} dice, largest region ${me.region}`,
    `best rival        ${nameOf(best.id)} — ${best.terr} territories, ${best.dice} dice, largest region ${best.region}`,
    '',
    `actually won by   ${nameOf(match.winner)}, ${match.attacks - surrender.attacks} attacks later`,
    '',
    verdict,
  ].join('\n');
}

// --- the two matches ------------------------------------------------------
//
// Re-chosen after the terrain rework, which grew different planets from the
// numbers this page used to name and left both exhibits firing nothing at all.
// Found by sweeping 3,566 six-player expert matches and judging every seat at
// both tunings: 3,559 firings at the shipped sixth, none of them wrong; 3,568
// at a quarter, two of them wrong. Both of those two have the same shape the
// original pair had — early, on a full field, on a player who is wide rather
// than deep — which is what makes the argument reproducible rather than lucky.

// Deliberately judged at a quarter rather than the shipped sixth: this is the
// match that argues the ratio down, and at the tuning the game actually uses
// it never fires at all.
const upset = playMatch({
  players: 6, difficulty: 'expert', worldSeed: 1854622640, gameSeed: 531571878, watching: 'p2',
  tuning: { diceRatio: 4, regionRatio: 4 },
});

addScenario({
  title: 'Why the ratio is a sixth',
  note: 'Judged at a quarter, this match calls itself a seventh of the way in. Blue holds more '
    + 'than half the planet and every rival is under a quarter of Blue on both counts — and '
    + 'Yellow goes on to win it anyway, 518 attacks later. Look at what is wrong with the '
    + 'position: nobody has been knocked out yet, and Blue is wide rather than deep, 32 '
    + 'territories carrying 90 dice between them. That is a shape a board can be taken back off '
    + 'you. Scrub forward and watch it happen. At the sixth the game ships with, this never '
    + 'fires at all.',
  match: upset,
  expects: { fires: true, watchedWins: false },
  readout: readoutFor(
    upset,
    'at the shipped sixth this match is never called — the surrender simply never appears'
  ),
});

const sound = playMatch({
  players: 6, difficulty: 'expert', worldSeed: 108541616, gameSeed: 793534623, watching: 'p3',
});

addScenario({
  title: 'The surrender as it usually goes',
  note: 'The same rule on an ordinary match, for contrast: three players left, seven tenths of '
    + 'the way in, and the ninety-seven attacks the banner skips are the mopping up nobody wants '
    + 'to sit through. Scrub past the surrender point and there is no comeback in it — which is '
    + 'the case the feature exists for, and by a wide margin the usual one.',
  match: sound,
  expects: { fires: true, watchedWins: true },
  readout: readoutFor(sound, 'this is what all 3,559 firings at the sixth looked like in that '
    + 'sweep — not one of them wrong'),
});
