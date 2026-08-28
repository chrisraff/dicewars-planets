import * as THREE from 'three';
import { seededRng } from '@dicewars/core';
import { createViewer } from '../render/createViewer.js';
import {
  createDiePipMaterials,
  createPlayerDiePipMaterials,
  DIE_TINT,
} from '../render/diceTextures.js';
import { createPlanetSurface } from '../render/planetSurface.js';
import { createDiceLayer, DIE_SIZE } from '../render/diceLayer.js';
import { createPoleMarkers } from '../render/poleMarkers.js';
import { LIGHT_RIG, offAxisAngle } from '../render/lightRig.js';
import {
  assignPlayerColors,
  DEFAULT_PLAYER_COLORS,
  lighten,
  readableTextColor,
  srgbRgb,
} from '../render/palette.js';
import { generatePlanetWorld } from '../world/generateWorld.js';
import { createGame } from '../game/createGame.js';

const scenarios = document.getElementById('scenarios');

// A full table, so every colour in the palette is on the board at once and
// the pairs that are hard to tell apart are hard to tell apart here too.
const PLAYER_IDS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
const COLOUR_NAMES = ['red', 'blue', 'yellow', 'green', 'purple', 'orange', 'cyan', 'white'];
const SEED = 20260827;

const rgb = ([r, g, b]) => `rgb(${[r, g, b].map((c) => Math.round(c * 255)).join(', ')})`;

function section(title, note) {
  const element = document.createElement('section');
  element.className = 'scenario';
  element.innerHTML = '<h2></h2><p></p>';
  element.querySelector('h2').textContent = title;
  element.querySelector('p').textContent = note;
  scenarios.append(element);
  return element;
}

function slider(parent, { label, min, max, step, value, format = (v) => v.toFixed(2) }, onInput) {
  const wrap = document.createElement('label');
  wrap.className = 'count';
  const input = document.createElement('input');
  input.type = 'range';
  Object.assign(input, { min, max, step, value });
  const text = document.createTextNode(`${label} ${format(value)} `);
  input.addEventListener('input', () => {
    text.textContent = `${label} ${format(Number(input.value))} `;
    onInput(Number(input.value));
  });
  wrap.append(text, input);
  parent.append(wrap);
  return input;
}

function toggle(parent, label, initial, onChange) {
  const button = document.createElement('button');
  button.type = 'button';
  let on = initial;
  const paint = () => {
    button.textContent = `${label}: ${on ? 'on' : 'off'}`;
  };
  button.addEventListener('click', () => {
    on = !on;
    paint();
    onChange(on);
  });
  paint();
  parent.append(button);
  return button;
}

function pushButton(parent, text, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.addEventListener('click', onClick);
  parent.append(button);
  return button;
}

/**
 * A real planet with real dice under the real viewer, which is the only way
 * to judge a rig that is aimed off the camera: no still frame can show what
 * was wrong with the old one, because what was wrong with it was what
 * happened when you turned the planet.
 */
function planetStage({ title, note, coloured = false, phone = false }) {
  const element = section(title, note);
  const stage = document.createElement('div');
  stage.className = phone ? 'stage is-planet is-phone' : 'stage is-planet';
  const canvas = document.createElement('canvas');
  stage.append(canvas);
  element.append(stage);

  const world = generatePlanetWorld({
    subdivisions: 3,
    playerIds: PLAYER_IDS,
    rng: seededRng(SEED),
  });
  const game = createGame({ world, humanPlayerId: PLAYER_IDS[0] });
  const playerColors = assignPlayerColors(PLAYER_IDS);

  const viewer = createViewer(canvas);
  const surface = createPlanetSurface(world, playerColors);
  viewer.scene.add(surface.group);

  // A board of its own, so dice counts can be forced without touching the
  // game the surface was coloured from.
  const nodes = new Map([...game.state.nodes].map(([id, node]) => [id, { ...node }]));
  const board = { nodes };
  surface.refresh(board);

  const bone = createDiePipMaterials();
  let painted = createPlayerDiePipMaterials(playerColors, { tint: DIE_TINT });
  let useColour = coloured;
  let tint = DIE_TINT;
  let dieSize = DIE_SIZE;
  let dice = null;
  let poles = null;

  // Rebuilt rather than resized: the die's edge length is baked into one
  // shared RoundedBoxGeometry, and the pole markers measure their clearance
  // in dice, so a new size means new versions of both.
  function buildDice() {
    if (dice) {
      viewer.scene.remove(dice.group, poles.group);
      dice.dispose();
      poles.dispose();
    }
    dice = createDiceLayer(world, bone, {
      dieSize,
      materialsFor: (owner) => (useColour ? painted.get(owner) : null),
    });
    poles = createPoleMarkers({
      dieSize: dice.dieSize,
      stands: world.nodeIds.map((id) => dice.standFor(id)),
    });
    viewer.scene.add(dice.group, poles.group);
    dice.update(board);
    poles.settle(board);
  }
  buildDice();

  // Repainting the whole board. `update` would not notice — nothing about the
  // board changed, only what it is painted with — so every stack is asked to
  // restack itself, which is the one path that always re-reads the materials.
  function repaint() {
    for (const id of world.nodeIds) dice.reroll(id, board);
  }

  function setDiceEverywhere(count) {
    for (const node of nodes.values()) node.dice = count;
    dice.update(board);
    poles.settle(board);
  }

  const readout = document.createElement('pre');
  readout.className = 'menu-readout';
  element.append(readout);

  const controls = document.createElement('div');
  controls.className = 'controls';
  element.append(controls);

  function report() {
    const { options } = viewer.lights;
    const shown = Object.fromEntries(Object.keys(LIGHT_RIG).map((k) => [k, options[k]]));
    const describe = (name, angle) => {
      const radians = (angle * Math.PI) / 180;
      return `${name.padEnd(5)} ${angle.toFixed(1)}° off the view axis  ->  `
        + `${Math.cos(radians).toFixed(2)} on an up face, `
        + `${Math.abs(Math.sin(radians)).toFixed(2)} on a side`;
    };

    readout.textContent = `${JSON.stringify(shown)}\n\n`
      + `${describe('key', offAxisAngle(options.keyElevation, options.keyAzimuth))}\n`
      + `${describe('fill', offAxisAngle(options.fillElevation, options.fillAzimuth))}\n\n`
      + `dice  ${dieSize.toFixed(4)} radii (${(dieSize / DIE_SIZE).toFixed(2)}x), `
      + `${useColour ? `tinted ${tint.toFixed(2)} toward white` : 'bone'}\n\n`
      + 'Those two figures are the trade the key angle makes: an up face carries the\n'
      + 'number and wants the cosine high, the sides carry the shape of the cube and\n'
      + 'want the sine high. Nothing can have both.';
  }

  for (const [key, label, min, max, step] of [
    ['ambient', 'ambient', 0, 1.2, 0.01],
    ['key', 'key', 0, 3, 0.05],
    ['keyElevation', 'key up', -90, 90, 1],
    ['keyAzimuth', 'key across', -90, 90, 1],
    ['fill', 'fill', 0, 1.5, 0.05],
    ['fillElevation', 'fill up', -90, 90, 1],
    ['fillAzimuth', 'fill across', -180, 180, 1],
  ]) {
    slider(
      controls,
      {
        label,
        min,
        max,
        step,
        value: viewer.lights.options[key],
        format: (v) => (step >= 1 ? `${v}°` : v.toFixed(2)),
      },
      (value) => {
        viewer.lights.set({ [key]: value });
        report();
      }
    );
  }

  // The comparison the page exists for. Off is a single directional light
  // fixed at (3, 5, 4) — the rig that shipped before this one — so the two can
  // be put on the same board rather than described.
  toggle(controls, 'carried by the camera', true, (on) => {
    viewer.lights.carryWithCamera(on);
    report();
  });

  toggle(controls, 'colour the dice', useColour, (on) => {
    useColour = on;
    repaint();
    report();
  });

  // On `change` rather than `input`: a tint redraws forty-eight face textures
  // and their normal maps, which is a hitch worth paying once per drag rather
  // than once per pixel of one.
  const tintInput = slider(controls, { label: 'tint', min: 0, max: 1, step: 0.05, value: tint },
    () => {});
  tintInput.addEventListener('change', () => {
    tint = Number(tintInput.value);
    painted = createPlayerDiePipMaterials(playerColors, { tint });
    repaint();
    report();
  });

  const sizeInput = slider(
    controls,
    {
      label: 'die size',
      min: 0.02,
      max: 0.06,
      step: 0.0025,
      value: dieSize,
      format: (v) => `${v.toFixed(4)} (${(v / DIE_SIZE).toFixed(2)}x)`,
    },
    () => {}
  );
  sizeInput.addEventListener('change', () => {
    dieSize = Number(sizeInput.value);
    buildDice();
    report();
  });

  for (const count of [1, 3, 5, 8]) {
    pushButton(controls, `${count} dice everywhere`, () => setDiceEverywhere(count));
  }

  // The four viewpoints both rigs were measured at, two of which the old one
  // left on ambient alone. One click apart on purpose: the difference is
  // obvious side by side and easy to miss while dragging.
  for (const [text, position] of [
    ['Down the north pole', new THREE.Vector3(0, 3.2, 0.001)],
    ['Down the south pole', new THREE.Vector3(0, -3.2, 0.001)],
    ['Equator, toward the old light', new THREE.Vector3(1.2, 1.5, 2.6)],
    ['Equator, away from it', new THREE.Vector3(-1.2, -0.6, -2.8)],
  ]) {
    pushButton(controls, text, () => {
      viewer.camera.position.copy(position);
      viewer.controls.update();
    });
  }

  report();

  function animate() {
    requestAnimationFrame(animate);
    viewer.render();
  }
  animate();
}

planetStage({
  title: 'The rig',
  note: 'Turn the planet, then turn "carried by the camera" off and turn it again. Fixed in the '
    + 'world, half the planet’s dice are on ambient alone — flat, and with the pip dimples '
    + 'gone entirely, since ambient light does not shade a normal map. The four buttons are the '
    + 'viewpoints the two rigs were measured at; the south pole and the away-facing equator are '
    + 'the two the old rig had nothing to say about.',
});

planetStage({
  title: 'Coloured dice, at phone width',
  note: 'The same board with the dice painted by owner, small enough that the pips have to work '
    + 'for it. `tint` is how far a die is pulled toward white before its pips go on: at 0 it is '
    + 'the player colour undiluted and reads as a flag with a number somewhere on it, at 1 it is '
    + 'a plain bone die that says nothing about whose it is. The ink flips from black to white '
    + 'wherever the face gets dark enough to need it, measured rather than guessed.',
  coloured: true,
  phone: true,
});

/**
 * The record of a bug that is fixed, kept because the shape of it is worth
 * recognising again.
 *
 * The palette is written as sRGB and the HUD hands it straight to CSS. The
 * planet's vertex colours went to three.js unconverted, which reads them as
 * *linear* and encodes them to sRGB on output — so every colour on the globe
 * was encoded twice and arrived lighter and flatter than it was written. It
 * looked like a plausible planet rather than like a fault, which is why it
 * survived: nothing is obviously wrong with a pastel world until you put it
 * next to the swatches it is supposed to match.
 *
 * `planetSurface` now linearizes at the write, so the left column below is
 * both what the palette says and what the planet shows. The right column is
 * what it used to show.
 */
function paletteComparison() {
  const element = section(
    'The double encoding, and what it cost',
    'Left is the palette as written — which is what the HUD draws and, since the linearize at '
      + 'the buffer write, what the planet draws too. Right is what the planet showed before '
      + 'that: the same numbers encoded a second time. The compression lands hardest at the top '
      + 'of the range, which is where yellow and orange both live — 19.4 apart as written and '
      + '11.4 apart as they were being rendered.'
  );

  const grid = document.createElement('div');
  grid.className = 'faces is-swatches';
  grid.innerHTML = '<span class="head"></span><span class="head">as written, and now shown</span>'
    + '<span class="head">as shown before the fix</span>';

  DEFAULT_PLAYER_COLORS.forEach((color, i) => {
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = COLOUR_NAMES[i];
    grid.append(who);

    // The old planet showed the palette run through the output encoding one
    // extra time, which is exactly `srgbRgb` of the authored numbers.
    for (const shown of [color, srgbRgb(color)]) {
      const chip = document.createElement('span');
      chip.className = 'swatch';
      chip.style.background = rgb(shown);
      chip.style.color = rgb(readableTextColor(shown));
      chip.textContent = shown.map((c) => Math.round(c * 255)).join(', ');
      grid.append(chip);
    }
  });
  element.append(grid);

  const note = document.createElement('pre');
  note.className = 'menu-readout';
  note.textContent = [
    'The conversion sits at the buffer write and nowhere earlier, so every',
    'tint upstream of it — selection, attacker, defender — still means the',
    'fraction between two sRGB colours that it was judged as. The dice were',
    'never affected: their textures already carry SRGBColorSpace.',
  ].join('\n');
  element.append(note);
}
paletteComparison();

/**
 * A tinted die's face and the ink chosen for it, flat and at size, so the one
 * pair that has to clear a contrast bar can be checked without hunting the
 * planet for a territory of that colour.
 */
function tintLadder() {
  const tints = [0, 0.15, 0.3, 0.45, 0.6, 0.75];
  const element = section(
    'Every colour, at every tint',
    'The face a coloured die would be painted, with the ink readableTextColor picks for it. '
      + 'Reading down a column is what a whole board looks like at that tint; reading across a '
      + 'row is one player losing their colour as the die reclaims it. The ink flipping to white '
      + 'part way along a row is the point where the face got dark enough to need it.'
  );

  const grid = document.createElement('div');
  grid.className = 'faces is-tints';
  grid.innerHTML = '<span class="head"></span>'
    + tints.map((t) => `<span class="head">${t.toFixed(2)}</span>`).join('');

  DEFAULT_PLAYER_COLORS.forEach((color, i) => {
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = COLOUR_NAMES[i];
    grid.append(who);

    for (const t of tints) {
      const face = lighten(color, t);
      const chip = document.createElement('span');
      chip.className = 'swatch';
      chip.style.background = rgb(face);
      chip.style.color = rgb(readableTextColor(face));
      chip.textContent = '⚅';
      grid.append(chip);
    }
  });
  element.append(grid);
}
tintLadder();
