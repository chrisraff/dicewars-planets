import { generatePlanetWorld } from '../world/generateWorld.js';
import { createGame } from './createGame.js';
import { createBattleLog, battleEntry } from './battleLog.js';
import { playerStatsFor } from './playerStats.js';
import { playerIdsFor, resolveStartSeat, subdivisionsFor } from './settings.js';
import { createPlanetSurface } from '../render/planetSurface.js';
import { createDiceLayer } from '../render/diceLayer.js';
import { createRollAnimation } from '../render/rollAnimation.js';
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
 */
export function createSession({ viewer, hudRoot, pipMaterials, settings, onNewGame, onMenu }) {
  const playerIds = playerIdsFor(settings);
  const playerNames = new Map(playerIds.map((id, i) => [id, PLAYER_NAMES[i]]));
  const playerColors = assignPlayerColors(playerIds);

  // which seat in the turn order the player asked for — a range picks one of
  // its seats now, so the rest of the match has a settled answer
  const humanPlayerId = playerIds[resolveStartSeat(settings)];

  const world = generatePlanetWorld({ subdivisions: subdivisionsFor(settings), playerIds });
  const game = createGame({ world, humanPlayerId });
  const battles = createBattleLog();

  const surface = createPlanetSurface(world, playerColors);
  const dice = createDiceLayer(world, pipMaterials);
  viewer.scene.add(surface.group, dice.group);

  const hud = createHud(hudRoot, { playerColors, playerNames });
  hud.setHistory(battles.entries);

  const pickTerritoryAt = createTerritoryPicker({
    planetMesh: surface.mesh,
    camera: viewer.camera,
    faceCellIds: surface.faceCellIds,
    cellTerritory: world.cellTerritory,
  });

  let roll = null; // the attack being animated
  let humanEliminated = false;

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
      if (roll) {
        roll.elapsed += dt;
        roll.animation.apply(roll.elapsed);
        refreshBoard(pulseAt(roll.elapsed));
      }
      game.tick(dt);
    },

    dispose() {
      roll = null;
      viewer.scene.remove(surface.group, dice.group);
      surface.dispose();
      dice.dispose();
      hudRoot.replaceChildren();
    },
  };
}
