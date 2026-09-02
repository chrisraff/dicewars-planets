import { createViewer } from '../render/createViewer.js';
import { createDiePipMaterials } from '../render/diceTextures.js';
import { createPlanetSurface } from '../render/planetSurface.js';
import { createDiceLayer } from '../render/diceLayer.js';
import { createPoleMarkers } from '../render/poleMarkers.js';
import { framingDistance, narrowHalfFov } from '../render/cameraFraming.js';
import { assignPlayerColors } from '../render/palette.js';
import { playedMatch } from './playedMatch.js';

/**
 * A planet filling the window, with a match to scrub through — for taking a
 * screenshot of.
 *
 * The screenshot itself is not this page's job: the operating system already
 * takes a better one than a canvas readback would, at whatever the display's
 * real pixel density is. All this has to do is *find* the shot, which is two
 * problems — which match, and which moment — and neither can be answered by
 * looking at a still.
 *
 * Hence the two seeds and the scrubber. A planet worth photographing is a few
 * dozen seeds away, and the moment worth photographing is somewhere in the
 * middle of a match: the opening board is confetti and the last one is a
 * single colour, and everything interesting is in between.
 *
 * `H` hides every control, because the last thing between finding a shot and
 * taking one is the furniture used to find it.
 */

const MAX_TURNS = 800; // longer than any match anyone will scrub through

const options = {
  seed: 99991,
  play: 11,
  players: 4,
  difficulty: 'expert',
  poles: false,
};

const canvas = document.getElementById('planet');
const panel = document.getElementById('panel');
const readout = document.getElementById('readout');
const track = document.getElementById('track');

const viewer = createViewer(canvas);
const pipMaterials = createDiePipMaterials();

let scene = null;
let frame = 0;

// --- the planet ------------------------------------------------------------

function build({ keepCamera = false } = {}) {
  if (scene) {
    viewer.scene.remove(scene.surface.group, scene.dice.group);
    if (scene.poles) viewer.scene.remove(scene.poles.group);
    scene.surface.dispose();
    scene.dice.dispose();
    scene.poles?.dispose();
  }

  const match = playedMatch({ ...options, turns: MAX_TURNS });
  const surface = createPlanetSurface(match.world, assignPlayerColors(match.ids));
  const dice = createDiceLayer(match.world, pipMaterials);
  viewer.scene.add(surface.group, dice.group);

  // Built with the dice, because the markers stand clear of whatever tower is
  // under them and need to know how tall a die is to do it.
  let poles = null;
  if (options.poles) {
    poles = createPoleMarkers({
      dieSize: dice.dieSize,
      stands: match.world.nodeIds.map((id) => dice.standFor(id)),
    });
    viewer.scene.add(poles.group);
  }

  scene = { ...match, surface, dice, poles };

  // A new planet is a new subject; the same planet part way through a match is
  // not. So the camera is only re-framed when the world underneath it changed.
  if (!keepCamera) frameWholePlanet();

  track.max = String(scene.boards.length - 1);
  // Mid-match by default: the two ends of a match are the two boards least
  // worth photographing.
  show(Math.floor((scene.boards.length - 1) / 2));
}

function frameWholePlanet() {
  const halfFov = narrowHalfFov(viewer.camera.fov, canvas.clientWidth / canvas.clientHeight);
  viewer.camera.position.set(0, 0, framingDistance(halfFov));
  viewer.controls.target.set(0, 0, 0);
  viewer.controls.update();
}

function show(next) {
  frame = Math.max(0, Math.min(next, scene.boards.length - 1));
  const nodes = scene.boards[frame];
  scene.surface.refresh({ nodes });
  scene.dice.update({ nodes });
  scene.poles?.settle({ nodes });

  track.value = String(frame);
  const alive = new Set([...nodes.values()].map((node) => node.owner)).size;
  readout.textContent = `turn ${frame} of ${scene.boards.length - 1}`
    + `   ·   ${alive} players holding ground`
    + `   ·   planet ${options.seed} / match ${options.play}`
    + (scene.over ? '   ·   played to the end' : `   ·   stopped at ${MAX_TURNS} turns`);
}

// --- the controls ----------------------------------------------------------

/**
 * A field's value, back to what it was. A `<select>` hands everything back as
 * a string, and `'false'` is perfectly truthy — which is the whole reason this
 * exists rather than a bare `Number()`.
 */
function parse(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw === '' || Number.isNaN(Number(raw)) ? raw : Number(raw);
}

function field(label, key, { type = 'number', values = null, rebuild = 'world' } = {}) {
  const wrap = document.createElement('label');
  const input = document.createElement(values ? 'select' : 'input');

  if (values) {
    for (const value of values) {
      const item = document.createElement('option');
      item.value = String(value);
      item.textContent = String(value);
      item.selected = options[key] === value;
      input.append(item);
    }
  } else {
    input.type = type;
    input.value = String(options[key]);
  }

  input.addEventListener('change', () => {
    options[key] = parse(input.value);
    // Only a new world earns a new camera — see `build`.
    build({ keepCamera: rebuild !== 'world' });
  });

  wrap.append(`${label} `, input);
  panel.querySelector('.fields').append(wrap);
  return input;
}

const seedField = field('planet', 'seed');
const playField = field('match', 'play', { rebuild: 'scene' });
field('players', 'players', { values: [2, 3, 4, 5, 6, 7, 8], rebuild: 'scene' });
field('AI', 'difficulty', { values: ['expert', 'normal'], rebuild: 'scene' });
field('poles', 'poles', { values: [false, true], rebuild: 'scene' });

const buttons = panel.querySelector('.buttons');

function button(label, onClick) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', onClick);
  buttons.append(element);
  return element;
}

button('New planet', () => {
  options.seed = Math.floor(Math.random() * 1e6);
  seedField.value = String(options.seed);
  build();
});

button('New match', () => {
  options.play = Math.floor(Math.random() * 1e6);
  playField.value = String(options.play);
  build({ keepCamera: true });
});

button('Frame the planet', frameWholePlanet);
button('Hide controls (H)', () => panel.classList.add('is-hidden'));

track.addEventListener('input', () => show(Number(track.value)));

// Arrow keys step a turn at a time, which is how the exact moment gets found
// once the scrubber has got close. `H` puts the furniture away.
window.addEventListener('keydown', (event) => {
  if (event.key === 'h' || event.key === 'H') panel.classList.toggle('is-hidden');
  else if (event.key === 'ArrowLeft') show(frame - 1);
  else if (event.key === 'ArrowRight') show(frame + 1);
  else return;
  event.preventDefault();
});

// --- the loop --------------------------------------------------------------

build();

function tick() {
  viewer.render();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
