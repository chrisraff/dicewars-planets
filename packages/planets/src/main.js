import * as THREE from 'three';
import { generatePlanetWorld } from './world/generateWorld.js';
import { createGame } from './game/createGame.js';
import { createPlanetSurface } from './render/planetSurface.js';
import { createDiceLayer } from './render/diceLayer.js';
import { createRollAnimation } from './render/rollAnimation.js';
import { createTerritoryPicker, pointerToNdc, ndcToScreen } from './render/pickTerritory.js';
import { createDiePipMaterials } from './render/diceTextures.js';
import { assignPlayerColors } from './render/palette.js';
import { highlightsFor, pulseAt } from './render/highlights.js';
import { createHud } from './render/hud.js';
import { createViewer } from './render/createViewer.js';

const playerIds = ['p1', 'p2', 'p3', 'p4'];
const playerNames = new Map([
  ['p1', 'Red'],
  ['p2', 'Blue'],
  ['p3', 'Yellow'],
  ['p4', 'Green'],
]);

const world = generatePlanetWorld({ subdivisions: 3, playerIds });
const playerColors = assignPlayerColors(playerIds);

const game = createGame({ world, humanPlayerId: 'p1' });

const canvas = document.getElementById('planet-canvas');
const viewer = createViewer(canvas);

const surface = createPlanetSurface(world, playerColors);
const dice = createDiceLayer(world, createDiePipMaterials());
viewer.scene.add(surface.group, dice.group);

const hud = createHud(document.getElementById('hud'), { playerColors, playerNames });
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
  hud.showTurn({
    playerId: game.currentPlayer(),
    isHuman: game.isHumanTurn(),
    canAct: game.isHumanTurn() && !game.isBusy() && !game.isOver(),
  });
}

// Parks a roll total on the canvas above the stack it belongs to, and hides
// it while that stack is round the far side of the planet.
const toCamera = new THREE.Vector3();
function placeRollLabel(side, territoryId, total, winning) {
  const stand = dice.standFor(territoryId);
  const position = stand.object.position.clone().multiplyScalar(1.14);
  toCamera.subVectors(viewer.camera.position, position);
  const facingUs = stand.normal.dot(toCamera) > 0;

  hud.showRoll(side, {
    total,
    winning,
    screen: facingUs
      ? ndcToScreen(position.project(viewer.camera), canvas.getBoundingClientRect())
      : null,
  });
}

// --- the game talks, the renderer listens --------------------------------

game.on('attack', ({ event, timing }) => {
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
  hud.hideRolls();
  // both stacks are still lying on the faces they rolled; stand them back up
  // before the 'change' handler below sees them
  dice.reroll(event.from, state);
  dice.reroll(event.to, state);
});

game.on('change', (state) => {
  dice.update(state);
  refreshBoard();
});

game.on('over', (winner) => hud.showWinner(winner));

// --- input ----------------------------------------------------------------

// A click is a press and release in roughly the same spot — anything further
// than that was someone orbiting the planet, and must not also select a
// territory just because the drag happened to end over one.
const DRAG_SLOP = 5; // pixels
let pressedAt = null;

canvas.addEventListener('pointerdown', (e) => {
  pressedAt = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerup', (e) => {
  if (!pressedAt) return;
  const moved = Math.hypot(e.clientX - pressedAt.x, e.clientY - pressedAt.y);
  pressedAt = null;
  if (moved > DRAG_SLOP) return;
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
    const beat = roll.animation.apply(roll.elapsed);
    refreshBoard(pulseAt(roll.elapsed));

    if (beat.phase === 'read' || beat.phase === 'done') {
      const { event } = roll;
      placeRollLabel('attacker', event.from, event.attackRoll, event.attackerWins);
      placeRollLabel('defender', event.to, event.defendRoll, !event.attackerWins);
    }
  }

  game.tick(dt);
  viewer.render();
}
animate();
