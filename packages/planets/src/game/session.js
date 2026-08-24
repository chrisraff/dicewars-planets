import {
  isPlayerAlive,
  randomSeed,
  reviveState,
  seededRng,
  serializeState,
} from '@dicewars/core';
import { generatePlanetWorld } from '../world/generateWorld.js';
import { createGame } from './createGame.js';
import { orderAiTurnForCamera } from './aiTurnOrder.js';
import { createBattleLog, battleEntry } from './battleLog.js';
import { createReplay, boardAfterAttacks, reservesAfterAttacks, historyThroughStep } from './replay.js';
import { playerStatsFor } from './playerStats.js';
import { playerIdsFor, resolveStartSeat, strategyFor, subdivisionsFor } from './settings.js';
import { cameraSnapshot, gameSave, isUsableCamera, saveMatchesWorld } from './saveGame.js';
import { createPlanetSurface } from '../render/planetSurface.js';
import { createDiceLayer } from '../render/diceLayer.js';
import { createPoleMarkers } from '../render/poleMarkers.js';
import { createRollAnimation } from '../render/rollAnimation.js';
import { createReinforceAnimation } from '../render/reinforceAnimation.js';
import { createCameraFocus } from '../render/cameraFocus.js';
import { fightCenter } from '../render/cameraFraming.js';
import { createTerritoryPicker } from '../render/pickTerritory.js';
import { createHud } from '../render/hud.js';
import { assignPlayerColors } from '../render/palette.js';
import { highlightsFor, pulseAt } from '../render/highlights.js';

// Named in palette order, so a player's name matches the color of their land.
export const PLAYER_NAMES = ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'Orange', 'Cyan', 'White'];

/**
 * One match: a planet, the game being played on it, and everything drawn for
 * it. Created fresh from a set of settings and thrown away whole — which is
 * what makes "new game" a matter of disposing one of these and building the
 * next, rather than trying to reset a dozen things back to how they started.
 *
 * The viewer and the dice materials outlive a match and are passed in;
 * everything else here belongs to this one game.
 *
 * `settings` has already been normalized by the time it gets here — the menu
 * and `resolveSettings` are the two places raw values are parsed.
 *
 * `attackHintSeen` says whether this player has already been told how to
 * attack, and `onAttackHintSeen` is called the once when they have been —
 * same division as `onSave`: the session decides when a hint has done its job,
 * the page decides where that fact is written down.
 *
 * `saved` resumes a match rather than dealing a new one, and `onSave` is
 * handed the state to write after every move — or `null` once the game is
 * over, since a finished game is not one to come back to. Storage itself stays
 * outside: the session says what is worth keeping, the page decides where it
 * goes, and nothing here has to know that localStorage exists.
 */
export function createSession({
  viewer,
  hudRoot,
  pipMaterials,
  settings,
  saved = null,
  attackHintSeen = false,
  onNewGame,
  onMenu,
  onSave,
  onAttackHintSeen,
}) {
  const playerIds = playerIdsFor(settings);
  const playerNames = new Map(playerIds.map((id, i) => [id, PLAYER_NAMES[i]]));
  const playerColors = assignPlayerColors(playerIds);

  const { world, seed, restored } = buildWorld(settings, playerIds, saved);

  // which seat in the turn order the player asked for — a range picks one of
  // its seats now, so the rest of the match has a settled answer. A resumed
  // game already has its answer and keeps it.
  const humanPlayerId = restored ? restored.humanPlayerId : playerIds[resolveStartSeat(settings)];

  const game = createGame({
    world,
    humanPlayerId,
    savedState: restored ? reviveState(restored.state) : null,
    // A resumed game brings its own settings with it, so the difficulty a
    // match was started on is the one it is finished on.
    strategy: strategyFor(settings),
    // Reorders an AI's turn for display so nearby attacks show back to back
    // instead of swinging the camera once per attack — `dice` isn't built
    // yet at this point in construction, but this is only ever *called*
    // later, once it is (see createGame.js's takeAiTurn).
    orderAiTurn: (moves) =>
      orderAiTurnForCamera(moves, (id) => dice.standFor(id).normal, cameraFocus.currentView()),
  });
  const battles = createBattleLog({ entries: restored?.battles });
  // Every attack and reinforcement recorded since this session opened, for
  // the replay offered once the game ends — not saved and not restored,
  // since a finished game's save is cleared the moment it ends and a replay
  // only ever covers the match still open behind it. `initialNodes` and
  // `initialReserves` are the board this session actually opened on — the
  // planet as dealt for a fresh game, or the board a resumed one was picked
  // back up on — which is what `replay`'s own moves build forward from. A
  // replay of a resumed match therefore only reaches back to the reload, not
  // to the game's true start: nothing before that was ever recorded to
  // rebuild it from.
  const replay = createReplay();
  const initialNodes = game.state.nodes;
  const initialReserves = new Map(playerIds.map((id) => [id, game.state.players.get(id).reserve]));

  // A resumed game puts the camera back where it was left; a fresh one
  // leaves it wherever the viewer already starts.
  if (isUsableCamera(restored?.camera)) {
    viewer.camera.position.set(restored.camera.x, restored.camera.y, restored.camera.z);
    viewer.controls.update();
  }

  const surface = createPlanetSurface(world, playerColors);
  const dice = createDiceLayer(world, pipMaterials);
  // Something fixed to read the planet's turn against. It stands on the
  // ground, and steps up onto a dice tower at the pole rather than being cut
  // by one — which is what it needs the die size and the stands for.
  const poles = createPoleMarkers({
    dieSize: dice.dieSize,
    stands: world.nodeIds.map((id) => dice.standFor(id)),
  });
  poles.settle(game.state);
  viewer.scene.add(surface.group, dice.group, poles.group);

  const hud = createHud(hudRoot, { playerColors, playerNames });
  hud.setHistory(battles.entries);
  // A resumed game brings its history with it, so the readout should show the
  // last fight already fought rather than sitting empty until the next one.
  if (battles.latestBattle) hud.showBattle(battles.latestBattle);

  const cameraFocus = createCameraFocus({ camera: viewer.camera, controls: viewer.controls });

  // Whatever camera this match opened with — the viewer's default, or the one
  // a save just put back — the planet has to actually fit the screen it is
  // being played on. Outwards only, exactly as at the end of a turn, so a
  // player who left themselves zoomed out keeps that; but a distance saved on
  // a wider screen, or before this rule existed, is corrected rather than
  // restored faithfully into an unplayable view.
  cameraFocus.framePlanet({ instant: true });

  // Swings the camera to cover as many of the *upcoming* fights as will
  // comfortably fit in one frame, rather than swinging to just the next one
  // — `pairs` is `{from, to}` in the order they're about to be shown,
  // starting with whichever one is about to trigger the swing. Returns
  // whatever `cameraFocus.lookAtCluster` returns — whether it actually
  // started a swing — since a caller may need to wait for it to land.
  function focusFights(pairs) {
    const points = pairs.map(({ from, to }) =>
      fightCenter(dice.standFor(from).normal, dice.standFor(to).normal)
    );
    return cameraFocus.lookAtCluster(points);
  }

  const pickTerritoryAt = createTerritoryPicker({
    planetMesh: surface.mesh,
    camera: viewer.camera,
    faceCellIds: surface.faceCellIds,
    cellTerritory: world.cellTerritory,
  });

  let roll = null; // the attack being animated
  let reinforceAnim = null; // the end-of-turn payout being animated
  // not stored in a save: the board itself says whether you still hold ground
  let humanEliminated = !isPlayerAlive(game.state, humanPlayerId);
  let lastOutcome = null; // so closing the replay can bring the banner back
  // The one-off prompt for somebody who has never played. It has done its job
  // the moment either happens: they dismiss it, or they attack — having just
  // done the thing it describes, being told again next game would be noise.
  let hintSeen = attackHintSeen;
  let pendingReplayStep = null; // a board waiting for the camera to arrive before it shows

  // Repaints the planet as the replay's own board at `step` — surface, dice,
  // the stats row, the battle readout and its history all drawn from the
  // reconstructed board and the attacks that got it there, exactly as they
  // stood at that point in the match rather than as the match eventually
  // finished. `entry` is that step's own attack, so the readout shows it the
  // same way it shows the last fight during live play; the history behind it
  // is truncated to `step` for the same reason — opening it from partway
  // through the track should not spoil what the track hasn't reached yet.
  function applyReplayStep(step, entry, nodes) {
    const atEnd = step >= replay.attacks.length;
    const players = reservesAfterAttacks(initialReserves, replay.moves, step);
    surface.refresh({ nodes });
    dice.update({ nodes });
    poles.settle({ nodes });
    hud.showPlayers(playerStatsFor(
      { nodes, players, phase: 'gameover', winner: atEnd ? game.state.winner : null },
      playerIds
    ));
    hud.showBattle(entry);
    hud.setHistory(historyThroughStep(replay.attacks, step));
  }

  // Live play shows an attack's result while the camera is still swinging to
  // it, because the dice landing *is* the event — arriving late to a roll
  // already in progress is the whole point of the swing existing at all. A
  // replay has no such event to catch up to: the board only ever changes
  // because the track moved, so revealing it before the camera has actually
  // arrived just looks like the planet changed for no reason. So here, and
  // only here, the swing runs first and the board waits for it.
  function showReplayStep(step) {
    const nodes = boardAfterAttacks(initialNodes, replay.moves, step);
    const entry = step > 0 ? replay.attacks[step - 1] : null;

    pendingReplayStep = null; // this seek supersedes whatever was still pending

    // Looks ahead through every attack still to come, not just this one, so
    // a run of nearby fights gets one swing instead of several — the replay
    // order is never reordered (unlike a live AI turn), only clustered.
    if (entry && focusFights(replay.attacks.slice(step - 1))) {
      pendingReplayStep = { step, entry, nodes };
      return; // applied once the swing lands, in tick() below
    }

    applyReplayStep(step, entry, nodes);
  }

  function openReplay() {
    hud.hideOutcome();
    hud.showReplay(replay.attacks.length);
  }

  function closeReplay() {
    hud.hideReplay();
    pendingReplayStep = null;
    cameraFocus.cancel();
    // the replay has been drawing straight into the surface, dice, stats and
    // the battle readout; put the real, finished match back before the
    // banner returns
    dice.update(game.state);
    poles.settle(game.state);
    refreshBoard();
    hud.showBattle(battles.latestBattle);
    hud.setHistory(battles.entries);
    hud.showOutcome(lastOutcome);
  }

  // What it would take to rebuild this match: the planet as the number it grew
  // from, and everything about the game that no amount of regrowing recovers.
  function snapshot() {
    return gameSave({
      seed,
      settings,
      humanPlayerId,
      world,
      state: serializeState(game.state),
      battles: battles.entries,
      camera: cameraSnapshot(viewer.camera),
    });
  }

  function hintDone() {
    if (hintSeen) return;
    hintSeen = true;
    onAttackHintSeen?.();
  }

  function refreshBoard(pulse = 1) {
    const marks = highlightsFor({
      selection: game.selection,
      targets: game.legalTargets(),
      attack: roll?.event ?? null,
      pulse,
    });
    surface.refresh(game.state, (territoryId) => marks.get(territoryId) ?? null);
    hud.showPlayers(playerStatsFor(game.state, playerIds));
    hud.showTurn({
      currentPlayerId: game.currentPlayer(),
      humanPlayerId,
      winner: game.state.winner,
      isOver: game.isOver(),
      humanEliminated,
      canAct: game.isHumanTurn() && !game.isBusy(),
    });
    hud.showHint({
      seen: hintSeen,
      humanPlayerId, // the prompt names the color you are, so it has to know
      isHumanTurn: game.isHumanTurn(),
      isOver: game.isOver(),
      humanEliminated,
    });
  }

  game.on('attack', ({ event, timing, upcoming }) => {
    // the dice are known already, but they belong on the planet first — show
    // the readout with blank faces so it fills in as the roll lands
    hud.showBattle(battleEntry(event), { revealed: false });

    // The AI attacks wherever it likes, including round the back of the
    // planet. Its own fights are the ones worth turning for — the player's
    // are on screen by definition, since they just clicked them. `upcoming`
    // is this attack plus whatever's already queued behind it this turn, so
    // a run of nearby attacks gets one swing instead of one each.
    if (game.currentPlayer() !== humanPlayerId) focusFights(upcoming);
    else hintDone(); // they have just done the thing the prompt describes

    roll = {
      event,
      elapsed: 0,
      animation: createRollAnimation({
        attackerStand: dice.standFor(event.from),
        defenderStand: dice.standFor(event.to),
        event,
        dieSize: dice.dieSize,
        timing,
      }),
    };
  });

  game.on('resolved', (state) => {
    const { event } = roll;
    roll = null;
    hud.showBattle(battles.record(event));
    hud.setHistory(battles.entries);
    replay.record(event);
    // both stacks are still lying on the faces they rolled; stand them back up
    dice.reroll(event.from, state);
    dice.reroll(event.to, state);
  });

  game.on('reinforce', (event) => {
    replay.recordReinforcement(event);
    if (event.passed) {
      battles.record({ type: 'passed', playerId: event.playerId });
      hud.setHistory(battles.entries);
    }
    // Deliberately no cameraFocus.lookAt here: reinforcement dice land on
    // whichever territories they land on, all over the planet, and the drop
    // is fast enough that swinging the camera to chase it would take longer
    // than the animation it's chasing. It reads fine off-screen.
    hud.showReinforce({ playerId: event.playerId, count: event.landed.length });
    reinforceAnim = {
      elapsed: 0,
      dropped: 0, // how many of the HUD's chips have been told their die has landed
      animation: createReinforceAnimation({ landed: event.landed, dice, materials: pipMaterials }),
    };
  });

  game.on('endTurn', (event) => {
    // The payout has landed — `change` is about to rebuild every stack it
    // touched, so the dice animated here have nothing left to do.
    reinforceAnim = null;
    hud.hideReinforce();

    // Handing the planet over: the AI attacks wherever it likes, so the view
    // that suits its turn is the one with the whole planet in it. Only when
    // the player's own turn is the one ending, and only ever outwards — see
    // `framePlanet`. It has the AI's think pause plus its first aim to land
    // in, so it is over before there are dice to read.
    if (event.playerId === humanPlayerId) cameraFocus.framePlanet();
  });

  game.on('eliminated', (event) => {
    battles.record(event);
    hud.setHistory(battles.entries);
    replay.recordElimination(event);

    // Losing your last territory used to pass without a word: the AIs simply
    // played on and nothing said why the board had stopped answering.
    if (event.playerId === humanPlayerId) {
      humanEliminated = true;
      if (!game.isOver()) hud.showOutcome({ kind: 'eliminated', by: event.by, humanPlayerId });
    }
  });

  game.on('change', (state) => {
    dice.update(state);
    poles.settle(state); // a tower may have grown or gone at a pole
    refreshBoard();
    // Every change, rather than on a timer or on the way out of the page:
    // `change` is the only moment the board moves, a pagehide handler is not
    // reliable on mobile, and the alternative is losing whatever happened
    // since the last tick. An attack still being animated is deliberately not
    // saved — the state it will land on has not been applied yet, so a reload
    // mid-roll simply un-throws those dice rather than saving half a battle.
    onSave?.(game.isOver() ? null : snapshot());
  });

  game.on('over', (winner) => {
    // the banner stays until the player dismisses it — winning gets a moment
    // rather than being covered by the menu the instant it happens
    lastOutcome = { kind: 'over', winner, humanPlayerId, canReplay: replay.attacks.length > 0 };
    hud.showOutcome(lastOutcome);
  });

  hud.onOutcomeAction((action) => {
    if (action === 'newGame') return onNewGame?.();
    if (action === 'replay') return openReplay();
    hud.hideOutcome(); // 'watch' and 'dismiss' both just get out of the way
    refreshBoard();
  });

  hud.onReplaySeek(showReplayStep);
  hud.onReplayClose(closeReplay);

  hud.onHintDismiss(() => {
    hintDone();
    refreshBoard();
  });

  hud.onEndTurn(() => {
    game.endTurn();
    refreshBoard();
  });

  hud.onMenu(() => onMenu?.());

  game.start();

  return {
    game,
    settings,

    clickAt(ndc) {
      game.clickTerritory(pickTerritoryAt(ndc));
      refreshBoard();
    },

    tick(dt) {
      cameraFocus.tick(dt);
      if (pendingReplayStep && !cameraFocus.isSwinging) {
        const { step, entry, nodes } = pendingReplayStep;
        pendingReplayStep = null;
        applyReplayStep(step, entry, nodes);
      }
      if (roll) {
        roll.elapsed += dt;
        roll.animation.apply(roll.elapsed);
        refreshBoard(pulseAt(roll.elapsed));
      }
      if (reinforceAnim) {
        reinforceAnim.elapsed += dt;
        const started = reinforceAnim.animation.apply(reinforceAnim.elapsed);
        // the tray peels back in step with the drops themselves, not on its
        // own timer — one call per die, the moment that die starts falling
        while (reinforceAnim.dropped < started) {
          hud.reinforceDropped();
          reinforceAnim.dropped++;
        }
      }
      game.tick(dt);
    },

    dispose() {
      roll = null;
      reinforceAnim = null;
      cameraFocus.dispose();
      viewer.scene.remove(surface.group, dice.group, poles.group);
      surface.dispose();
      dice.dispose();
      poles.dispose();
      hudRoot.replaceChildren();
    },
  };
}

/**
 * The planet this match is played on, and the seed that grows it.
 *
 * A saved game names its seed, so the same planet comes back cell for cell —
 * but only as long as the generator itself has not changed. When the world it
 * rebuilds no longer fits the board that was saved on it, the save is dropped
 * and a fresh planet is grown: a new game is a far better outcome than a
 * board laid over territories that are not there any more.
 */
function buildWorld(settings, playerIds, saved) {
  const subdivisions = subdivisionsFor(settings);
  const grow = (seed) => generatePlanetWorld({ subdivisions, playerIds, rng: seededRng(seed) });

  if (saved) {
    const world = grow(saved.seed);
    if (saveMatchesWorld(saved, world)) return { world, seed: saved.seed, restored: saved };
  }

  const seed = randomSeed();
  return { world: grow(seed), seed, restored: null };
}
