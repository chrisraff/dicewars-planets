import * as THREE from 'three';
import { generatePlanetWorld } from './world/generateWorld.js';
import { createGame } from './game/createGame.js';
import { createPlanetSurface } from './render/planetSurface.js';
import { createDiceLayer } from './render/diceLayer.js';
import { createRollAnimation } from './render/rollAnimation.js';
import { createTerritoryPicker, pointerToNdc } from './render/pickTerritory.js';
import { createDiePipMaterials } from './render/diceTextures.js';
import { assignPlayerColors } from './render/palette.js';
import { highlightsFor, pulseAt } from './render/highlights.js';
import { playerStatsFor } from './game/playerStats.js';
import { createBattleLog, battleEntry } from './game/battleLog.js';
import { createHud } from './render/hud.js';
import { createViewer } from './render/createViewer.js';

// Named in palette order, so a player's name matches the color of their land.
const PLAYER_NAMES = ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'Orange', 'Cyan', 'White'];
const DEFAULT_PLAYERS = 4;

// `?players=8` fills the table, which is mostly useful for seeing the stats
// row at full width without having to edit anything.
const requested = Number(new URLSearchParams(location.search).get('players'));
const playerCount = Number.isFinite(requested)
  ? Math.min(8, Math.max(2, Math.round(requested)))
  : DEFAULT_PLAYERS;

const playerIds = PLAYER_NAMES.slice(0, playerCount).map((_, i) => `p${i + 1}`);
const playerNames = new Map(playerIds.map((id, i) => [id, PLAYER_NAMES[i]]));

const world = generatePlanetWorld({ subdivisions: 3, playerIds });
const playerColors = assignPlayerColors(playerIds);

const game = createGame({ world, humanPlayerId: 'p1' });

const canvas = document.getElementById('planet-canvas');
const viewer = createViewer(canvas);

const surface = createPlanetSurface(world, playerColors);
const dice = createDiceLayer(world, createDiePipMaterials());
viewer.scene.add(surface.group, dice.group);

const hud = createHud(document.getElementById('hud'), { playerColors, playerNames });
const battles = createBattleLog();
hud.setHistory(battles.entries);
const pickTerritoryAt = createTerritoryPicker({
  planetMesh: surface.mesh,
  camera: viewer.camera,
  faceCellIds: surface.faceCellIds,
  cellTerritory: world.cellTerritory,
});

// --- what's on screen right now ------------------------------------------

let roll = null; // the attack being animated: { animation, event, elapsed, timing }

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
    playerId: game.currentPlayer(),
    isHuman: game.isHumanTurn(),
    canAct: game.isHumanTurn() && !game.isBusy() && !game.isOver(),
  });
}

// --- the game talks, the renderer listens --------------------------------

game.on('attack', ({ event, timing }) => {
  // the dice are known already, but they belong on the planet first — show the
  // readout with blank faces so it fills in as the roll lands
  hud.showBattle(battleEntry(event), { revealed: false });

  roll = {
    event,
    timing,
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
  // before the 'change' handler below sees them
  dice.reroll(event.from, state);
  dice.reroll(event.to, state);
});

game.on('change', (state) => {
  dice.update(state);
  refreshBoard();
});

game.on('eliminated', (event) => {
  battles.record(event);
  hud.setHistory(battles.entries);
});

game.on('over', (winner) => hud.showWinner(winner));

// --- input ----------------------------------------------------------------

// A click is a press and release in roughly the same spot — anything further
// than that was someone orbiting the planet, and must not also select a
// territory just because the drag happened to end over one. A finger wanders
// much further than a mouse does while still meaning "tap".
const DRAG_SLOP = { mouse: 5, pen: 6, touch: 14 }; // pixels
let pressedAt = null;

canvas.addEventListener('pointerdown', (e) => {
  pressedAt = { x: e.clientX, y: e.clientY, slop: DRAG_SLOP[e.pointerType] ?? DRAG_SLOP.mouse };
});
canvas.addEventListener('pointercancel', () => {
  pressedAt = null;
});
canvas.addEventListener('pointerup', (e) => {
  if (!pressedAt) return;
  const moved = Math.hypot(e.clientX - pressedAt.x, e.clientY - pressedAt.y);
  const { slop } = pressedAt;
  pressedAt = null;
  if (moved > slop) return;
  const ndc = pointerToNdc(e.clientX, e.clientY, canvas.getBoundingClientRect());
  game.clickTerritory(pickTerritoryAt(ndc));
  refreshBoard();
});

hud.onEndTurn(() => {
  game.endTurn();
  refreshBoard();
});

// --- the loop -------------------------------------------------------------

game.start();

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1); // a backgrounded tab shouldn't fast-forward

  if (roll) {
    roll.elapsed += dt;
    roll.animation.apply(roll.elapsed);
    refreshBoard(pulseAt(roll.elapsed));
  }

  game.tick(dt);
  viewer.render();
}
animate();
