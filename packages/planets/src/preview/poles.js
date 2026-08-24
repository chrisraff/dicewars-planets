import * as THREE from 'three';
import { seededRng } from '@dicewars/core';
import { createViewer } from '../render/createViewer.js';
import { createDiePipMaterials } from '../render/diceTextures.js';
import { createPlanetSurface } from '../render/planetSurface.js';
import { createDiceLayer } from '../render/diceLayer.js';
import { axisFalloff, createPoleMarkers, POLE_MARKER } from '../render/poleMarkers.js';
import { MAX_DICE_PER_STACK } from '../render/diceStacks.js';
import { assignPlayerColors } from '../render/palette.js';
import { generatePlanetWorld } from '../world/generateWorld.js';
import { createGame } from '../game/createGame.js';

const scenarios = document.getElementById('scenarios');
const pipMaterials = createDiePipMaterials();

// Which territory sits closest to a pole — the one whose dice tower is in the
// marker's way, and so the one the occlusion test has to load up.
function territoryAtPole(world, sign) {
  const cellsById = new Map(world.cells.map((cell) => [cell.id, cell]));
  let best = null;

  for (const territory of world.territories) {
    const height = territory.cellIds.reduce(
      (sum, id) => sum + cellsById.get(id).center.y * sign,
      0
    ) / territory.cellIds.length;
    if (!best || height > best.height) best = { id: territory.id, height };
  }
  return best.id;
}

/**
 * A real planet with real dice and the real markers on it — the only way to
 * judge a view-dependent effect is to be able to turn the thing.
 */
function addScenario({ title, note, seed, overrides = {}, poleDice = 0 }) {
  const section = document.createElement('section');
  section.className = 'scenario';
  section.innerHTML = '<h2></h2><p></p><div class="stage is-planet"></div>';
  section.querySelector('h2').textContent = title;
  section.querySelector('p').textContent = note;
  scenarios.append(section);

  const stage = section.querySelector('.stage');
  const canvas = document.createElement('canvas');
  stage.append(canvas);

  const playerIds = ['p1', 'p2', 'p3', 'p4'];
  const world = generatePlanetWorld({ subdivisions: 3, playerIds, rng: seededRng(seed) });
  const game = createGame({ world, humanPlayerId: playerIds[0] });

  const viewer = createViewer(canvas);
  const surface = createPlanetSurface(world, assignPlayerColors(playerIds));
  const dice = createDiceLayer(world, pipMaterials);
  const poles = createPoleMarkers({
    dieSize: dice.dieSize,
    stands: world.nodeIds.map((id) => dice.standFor(id)),
    ...overrides,
  });
  viewer.scene.add(surface.group, dice.group, poles.group);

  // A board of its own, so the dice at the poles can be forced without
  // touching the game the surface was coloured from.
  const nodes = new Map([...game.state.nodes].map(([id, node]) => [id, { ...node }]));
  const northPole = territoryAtPole(world, 1);
  const southPole = territoryAtPole(world, -1);

  function paintDice(count) {
    for (const id of [northPole, southPole]) {
      const node = nodes.get(id);
      if (node) node.dice = count > 0 ? count : node.dice;
    }
    surface.refresh({ nodes });
    dice.update({ nodes });
    poles.settle({ nodes });
  }
  paintDice(poleDice);

  const readout = document.createElement('pre');
  readout.className = 'menu-readout';
  section.append(readout);

  const controls = document.createElement('div');
  controls.className = 'controls';
  section.append(controls);

  /**
   * The axis falloff as numbers, which is the only way to tell the two knobs
   * apart: `sideOn` is the value in the 90 degree column and nothing else
   * moves it, while `axisPower` only reshapes the columns between the ends.
   */
  function falloffTable() {
    const angles = [0, 15, 30, 45, 60, 75, 90];
    const kept = angles.map((degrees) =>
      axisFalloff(Math.cos((degrees * Math.PI) / 180), poles.options).toFixed(2)
    );
    return `${angles.map((d) => `${d}°`.padStart(6)).join('')}\n`
      + `${kept.map((value) => value.padStart(6)).join('')}`;
  }

  function report() {
    const shown = Object.fromEntries(
      Object.keys(POLE_MARKER).map((key) => [key, poles.options[key]])
    );
    readout.textContent = `${JSON.stringify(shown)}\n\n`
      + `strength kept, by angle off the pole:\n${falloffTable()}\n\n`
      + '0° is looking straight down it, 90° is edge-on. The 90° figure IS sideOn — '
      + 'axisPower cannot move it, only the shape of the columns in between.';
  }

  // Every knob that is worth turning by eye rather than by argument.
  for (const [key, min, max, step] of [
    ['strength', 0, 1.5, 0.05],
    ['sideOn', 0, 1, 0.02],
    ['axisPower', 0.5, 8, 0.1],
    ['heightInDice', 1, 16, 0.5],
    ['radiusInDice', 0.2, 4, 0.05],
    ['sinkInDice', 0, 3, 0.1],
    ['taper', 0.2, 4, 0.1],
    ['body', 0, 1, 0.02],
    ['foot', 0.01, 0.8, 0.01],
  ]) {
    const label = document.createElement('label');
    label.className = 'count';
    const input = document.createElement('input');
    input.type = 'range';
    Object.assign(input, { min, max, step, value: poles.options[key] });
    input.addEventListener('input', () => {
      poles.set({ [key]: Number(input.value) });
      label.firstChild.textContent = `${key} ${Number(input.value).toFixed(3)} `;
      report();
    });
    label.append(`${key} ${Number(poles.options[key]).toFixed(3)} `, input);
    controls.append(label);
  }

  // The question this page exists to answer: walk a tower up under the marker
  // one die at a time and watch the cone step up off it rather than be cut.
  for (let count = 1; count <= MAX_DICE_PER_STACK * 2; count++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = count === 1 ? 'no tower' : `${count} dice`;
    button.addEventListener('click', () => {
      for (const id of [northPole, southPole]) {
        const node = nodes.get(id);
        if (node) node.dice = count;
      }
      dice.update({ nodes });
      poles.settle({ nodes }); // the whole point: the base moves with the tower
    });
    controls.append(button);
  }

  // Straight down the axis and square to it: the two ends of what the axis
  // term does, without having to find them by dragging.
  for (const [text, position] of [
    ['Look down the pole', new THREE.Vector3(0, 3.2, 0.001)],
    ['Side on', new THREE.Vector3(0, 0, 3.2)],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', () => {
      viewer.camera.position.copy(position);
      viewer.controls.update();
    });
    controls.append(button);
  }

  report();

  // Live, because a view-dependent effect judged from a still is not judged.
  function animate() {
    requestAnimationFrame(animate);
    viewer.render();
  }
  animate();
}

addScenario({
  title: 'On a planet, with the poles clear',
  note: 'Drag to turn it. The marker should come up strongly as a pole swings toward you and '
    + 'fall back to almost nothing edge-on — that is the axis term. The outline staying brighter '
    + 'than the middle is the rim term, and is what stops it reading as a painted solid.',
  seed: 20260823,
});

addScenario({
  title: 'With a dice tower on each pole',
  note: 'Walk the tower up a die at a time with the buttons. The cone rests on the ground with '
    + 'no tower, and steps up onto the top of one as it grows — so a die never crosses its wall, '
    + 'which is the artifact worth avoiding (a hard line cut across a soft volume). A tower in '
    + 'front of the marker still hides the part behind it, which is right, and is just depth '
    + 'testing doing its job. Watch the base as you click through: it should look like it is '
    + 'standing on the dice, not growing out of them.',
  seed: 20260823,
  poleDice: MAX_DICE_PER_STACK * 2,
});

addScenario({
  title: 'Turned up, to see what each knob does',
  note: 'The same planet with the effect exaggerated, since the defaults are deliberately quiet '
    + 'and quiet is hard to judge a shape from. Pull `strength` back down once the shape reads '
    + 'right — and note `sideOn` at 1 disables the axis term entirely, which is worth a look to '
    + 'see how much work it is doing.',
  seed: 20260823,
  overrides: { strength: 1.1, sideOn: 0.35, heightInDice: 9 },
  poleDice: MAX_DICE_PER_STACK * 2,
});
