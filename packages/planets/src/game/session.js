import { isPlayerAlive, randomSeed, reviveState, seededRng, serializeState } from '@dicewars/core';
import { generatePlanetWorld } from '../world/generateWorld.js';
import { createGame } from './createGame.js';
import { createBattleLog, battleEntry } from './battleLog.js';
import { playerStatsFor } from './playerStats.js';
import { playerIdsFor, resolveStartSeat, subdivisionsFor } from './settings.js';
import { cameraSnapshot, gameSave, isUsableCamera, saveMatchesWorld } from './saveGame.js';
import { createPlanetSurface } from '../render/planetSurface.js';
import { createDiceLayer } from '../render/diceLayer.js';
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
  onNewGame,
  onMenu,
  onSave,
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
  });
  const battles = createBattleLog({ entries: restored?.battles });

  // A resumed game puts the camera back where it was left; a fresh one
  // leaves it wherever the viewer already starts.
  if (isUsableCamera(restored?.camera)) {
    viewer.camera.position.set(restored.camera.x, restored.camera.y, restored.camera.z);
    viewer.controls.update();
  }

  const surface = createPlanetSurface(world, playerColors);
  const dice = createDiceLayer(world, pipMaterials);
  viewer.scene.add(surface.group, dice.group);

  const hud = createHud(hudRoot, { playerColors, playerNames });
  hud.setHistory(battles.entries);
  // A resumed game brings its history with it, so the readout should show the
  // last fight already fought rather than sitting empty until the next one.
  if (battles.latestBattle) hud.showBattle(battles.latestBattle);

  const cameraFocus = createCameraFocus({ camera: viewer.camera, controls: viewer.controls });

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
  }

  game.on('attack', ({ event, timing }) => {
    // the dice are known already, but they belong on the planet first — show
    // the readout with blank faces so it fills in as the roll lands
    hud.showBattle(battleEntry(event), { revealed: false });

    // The AI attacks wherever it likes, including round the back of the
    // planet. Its own fights are the ones worth turning for — the player's
    // are on screen by definition, since they just clicked them.
    if (game.currentPlayer() !== humanPlayerId) {
      const attacker = dice.standFor(event.from).normal;
      const defender = dice.standFor(event.to).normal;
      cameraFocus.lookAt(fightCenter(attacker, defender));
    }

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
    // both stacks are still lying on the faces they rolled; stand them back up
    dice.reroll(event.from, state);
    dice.reroll(event.to, state);
  });

  game.on('reinforce', (event) => {
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

  game.on('endTurn', () => {
    // The payout has landed — `change` is about to rebuild every stack it
    // touched, so the dice animated here have nothing left to do.
    reinforceAnim = null;
    hud.hideReinforce();
  });

  game.on('eliminated', (event) => {
    battles.record(event);
    hud.setHistory(battles.entries);

    // Losing your last territory used to pass without a word: the AIs simply
    // played on and nothing said why the board had stopped answering.
    if (event.playerId === humanPlayerId) {
      humanEliminated = true;
      if (!game.isOver()) hud.showOutcome({ kind: 'eliminated', by: event.by, humanPlayerId });
    }
  });

  game.on('change', (state) => {
    dice.update(state);
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
    hud.showOutcome({ kind: 'over', winner, humanPlayerId });
  });

  hud.onOutcomeAction((action) => {
    if (action === 'newGame') return onNewGame?.();
    hud.hideOutcome(); // 'watch' and 'dismiss' both just get out of the way
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
      viewer.scene.remove(surface.group, dice.group);
      surface.dispose();
      dice.dispose();
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
