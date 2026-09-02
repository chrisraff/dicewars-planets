import * as THREE from 'three';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { createViewer } from '../render/createViewer.js';
import { createDiePipMaterials } from '../render/diceTextures.js';
import { createPlanetSurface } from '../render/planetSurface.js';
import { createDiceLayer } from '../render/diceLayer.js';
import { framingDistance, narrowHalfFov } from '../render/cameraFraming.js';
import { assignPlayerColors } from '../render/palette.js';
import { playedMatch } from './playedMatch.js';

/**
 * A match, as an animated GIF.
 *
 * One camera, one frame per turn, no roll animation — the planet changing
 * colour is the whole of it. What it is for is showing somebody the game
 * without asking them to play it, and a still cannot do that: a Dicewars board
 * only means anything as a *sequence*, one empire eating another.
 *
 * Everything here is the real thing. The match is `runAiTurn`, so the game
 * playing itself is the game; the planet is `createPlanetSurface` and
 * `createDiceLayer`; and each frame is rendered at exactly the size it is
 * encoded at, the same way `figures.js` shoots its captures.
 *
 * Three things worth knowing before changing any of it.
 *
 * **A match is not a fixed length.** Two experts six-handed can grind for a
 * hundred rounds while four of them settle it in twelve, so the number of
 * turns is a knob rather than a property of the game — take the first `turns`
 * and stop, which is what a viewer will watch anyway.
 *
 * **The palette is global.** Quantizing per frame costs a colour table on
 * every one of them and makes flat ground shimmer between frames as the
 * quantizer picks different neighbours for the same colour. So the palette is
 * built once, from frames sampled across the whole match, and every frame is
 * mapped onto it.
 *
 * **Frames are rendered, not scaled.** The renderer is sized to the output for
 * the whole run, so nothing depends on the stage's size on screen — the same
 * mistake that stretched every capture on the figures page until it was fixed.
 */

// Where the palette is sampled from. A match starts as confetti and ends as
// one colour, so a palette built from the first frame alone runs out of greens
// halfway through — and one built from the last has nothing but the winner.
const PALETTE_SAMPLES = 8;
const PALETTE_SIZE = 256;

// What a slow rotation turns about: the planet's own axis. `orientEquator` has
// already rolled the world so its strongest ring of territories runs along the
// equator, so this is the one spin that sweeps *along* the interesting ground
// rather than across it.
const SPIN_AXIS = new THREE.Vector3(0, 1, 0);

const options = {
  seed: 99991,
  play: 11,
  players: 4,
  difficulty: 'expert',
  turns: 40,
  fps: 4,
  spin: 0, // degrees of planet per frame

  width: 480,
  height: 360,
};

const scenarios = document.getElementById('scenarios');
const pipMaterials = createDiePipMaterials();

const section = document.createElement('section');
section.className = 'scenario';
section.innerHTML = `
  <h2>The match</h2>
  <p>One camera, one frame per turn. The preview below plays at the same rate the GIF will.</p>
  <div class="stage is-planet is-capture"></div>
  <div class="controls"></div>
  <pre class="menu-readout"></pre>
`;
scenarios.append(section);

const stage = section.querySelector('.stage');
const controls = section.querySelector('.controls');
const readout = section.querySelector('.menu-readout');
const canvas = document.createElement('canvas');
stage.append(canvas);

const viewer = createViewer(canvas);

// Drag to turn the planet: the camera *is* the shot here. Unlike the capture
// harness — where a nudged frame is a shot that cannot be taken twice — the
// whole job of this page is choosing which part of the world the match is
// watched from, and no two planets have their interesting corner in the same
// place. Whatever the camera is on when Render is pressed is what gets encoded.
//
// Rebuilding the match leaves it exactly where it is; "Reset view" is the way
// back to the whole planet.

let scene = null; // { world, surface, dice, boards }
let preview = null; // the interval running the on-screen playback
// While this is set the frame loop keeps its hands off the renderer: encoding
// resizes it to the output and reads it back, and a stray `viewer.render()` in
// between would put the stage's size back under the frame being read.
let encoding = false;
// The camera is aimed once, on the first build. Every rebuild after that keeps
// whatever view was chosen — changing the length of the match is no reason to
// throw away the corner of the planet somebody just lined up.
let first = true;

// The view with no spin on it — where the camera would be at frame zero.
// Every frame is this turned by `spin` degrees times its own index, so the GIF
// opens on exactly the view that was framed and drifts from there.
//
// `applying` is what tells our own writes from a hand on the planet: the
// controls announce both the same way, and without it the spin would fold back
// into the base and compound frame over frame.
let base = null;
let applying = false;

viewer.controls.addEventListener('change', () => {
  if (!applying) base = viewer.camera.position.clone();
});

/** Puts the camera where frame `index` wants it. */
function aimAtFrame(index) {
  if (!base) return;
  applying = true;
  viewer.camera.position
    .copy(base)
    .applyAxisAngle(SPIN_AXIS, (options.spin * Math.PI) / 180 * index);
  viewer.controls.update();
  applying = false;
}

// --- the match -------------------------------------------------------------


/** Builds the planet for a match and points the camera at the whole of it. */
function build() {
  if (scene) {
    viewer.scene.remove(scene.surface.group, scene.dice.group);
    scene.surface.dispose();
    scene.dice.dispose();
  }

  const match = playedMatch(options);
  const surface = createPlanetSurface(match.world, assignPlayerColors(match.ids));
  const dice = createDiceLayer(match.world, pipMaterials);
  viewer.scene.add(surface.group, dice.group);

  // The stage is given the output's shape, so what is framed on screen is what
  // ends up in the file. Without it the camera would be aimed through one
  // aspect and encoded through another, and a view lined up by eye would come
  // out cropped — the same trap the figures page fell into.
  stage.style.aspectRatio = `${options.width} / ${options.height}`;

  scene = { ...match, surface, dice };
  if (first) frameWholePlanet();
  first = false;
  paint(0);
  report();
  return scene;
}

/** The whole planet in frame, for the output's aspect rather than the stage's. */
function frameWholePlanet() {
  const halfFov = narrowHalfFov(viewer.camera.fov, options.width / options.height);
  viewer.camera.position.set(0, 0, framingDistance(halfFov));
  viewer.controls.target.set(0, 0, 0);
  viewer.controls.update();
  base = viewer.camera.position.clone();
}

/** The board at `frame`, on the planet, seen from where that frame is seen. */
function paint(frame) {
  const nodes = scene.boards[Math.min(frame, scene.boards.length - 1)];
  scene.surface.refresh({ nodes });
  scene.dice.update({ nodes });
  aimAtFrame(frame);
}

// --- rendering a frame at the output size ----------------------------------

const readback = document.createElement('canvas');

/**
 * One frame's pixels, rendered at exactly the size it will be encoded at.
 *
 * The renderer is resized for the whole run rather than per frame — resizing a
 * WebGL context is not free, and every frame here is the same shape.
 */
function useOutputSize() {
  const { renderer, camera } = viewer;
  renderer.setPixelRatio(1);
  renderer.setSize(options.width, options.height, false);
  camera.aspect = options.width / options.height;
  camera.updateProjectionMatrix();

  readback.width = options.width;
  readback.height = options.height;
}

function restoreStageSize() {
  const { renderer, camera } = viewer;
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  camera.aspect = canvas.clientWidth / canvas.clientHeight;
  camera.updateProjectionMatrix();
}

function framePixels() {
  viewer.renderer.render(viewer.scene, viewer.camera);
  const context = readback.getContext('2d', { willReadFrequently: true });
  context.drawImage(canvas, 0, 0);
  return context.getImageData(0, 0, options.width, options.height).data;
}

// --- encoding --------------------------------------------------------------

async function encode(onProgress) {
  encoding = true;
  useOutputSize();

  const frames = [];
  for (let i = 0; i < scene.boards.length; i++) {
    paint(i);
    frames.push(framePixels());
    // Yielding keeps the tab answering while a long match encodes, and lets
    // the count on the button move.
    if (i % 4 === 0) {
      onProgress(i, scene.boards.length);
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    }
  }

  // One palette for the whole match, sampled across it — see the note at the
  // top for what a per-frame palette does to flat ground.
  const step = Math.max(1, Math.floor(frames.length / PALETTE_SAMPLES));
  const sampled = frames.filter((_, i) => i % step === 0);
  const merged = new Uint8ClampedArray(sampled.length * frames[0].length);
  sampled.forEach((f, i) => merged.set(f, i * frames[0].length));
  const palette = quantize(merged, PALETTE_SIZE);

  const gif = GIFEncoder();
  const delay = Math.round(1000 / options.fps);
  for (const rgba of frames) {
    gif.writeFrame(applyPalette(rgba, palette), options.width, options.height, { palette, delay });
  }
  gif.finish();

  restoreStageSize();
  encoding = false;
  return gif.bytes();
}

// --- the page --------------------------------------------------------------

function report(extra = '') {
  const seconds = (scene.boards.length / options.fps).toFixed(1);
  readout.textContent = [
    `${scene.boards.length} frames at ${options.fps}/s  =  ${seconds}s of GIF`,
    `${options.width}×${options.height}, ${options.players} players, ${options.difficulty}`,
    options.spin > 0
      ? `${options.spin.toFixed(2)}°/frame  =  `
        + `${(options.spin * (scene.boards.length - 1)).toFixed(0)}° of planet over the whole GIF`
      : 'no rotation - the camera holds still',
    scene.over
      ? `the match ends inside this many turns (${scene.left} left standing)`
      : `${scene.left} players still standing when it stops`,
    extra,
  ].filter(Boolean).join('\n');
}

function playPreview() {
  clearInterval(preview);
  let frame = 0;
  preview = setInterval(() => {
    paint(frame);
    frame = (frame + 1) % scene.boards.length;
  }, 1000 / options.fps);
}

function knob(label, key, values) {
  const wrap = document.createElement('label');
  wrap.className = 'count';
  const select = document.createElement('select');
  for (const value of values) {
    const item = document.createElement('option');
    item.value = String(value);
    item.textContent = String(value);
    item.selected = options[key] === value;
    select.append(item);
  }
  select.addEventListener('change', () => {
    const raw = select.value;
    options[key] = Number.isNaN(Number(raw)) ? raw : Number(raw);
    build();
    playPreview();
  });
  wrap.append(`${label} `, select);
  controls.append(wrap);
}

knob('players', 'players', [2, 3, 4, 5, 6, 8]);
knob('difficulty', 'difficulty', ['expert', 'normal']);
knob('turns', 'turns', [20, 30, 40, 60, 80, 120]);
knob('frames/s', 'fps', [2, 3, 4, 6, 8, 12]);
knob('width', 'width', [320, 400, 480, 600]);
knob('height', 'height', [240, 300, 360, 400]);
knob('planet seed', 'seed', [99991, 7, 42, 1234, 20260831]);
knob('match seed', 'play', [11, 12, 13, 14, 15]);

/**
 * A knob with a range on it, for the one setting that wants judging by eye
 * rather than choosing from a list.
 */
function slider(label, key, { min, max, step, format }) {
  const wrap = document.createElement('label');
  wrap.className = 'count';
  const input = document.createElement('input');
  input.type = 'range';
  Object.assign(input, { min, max, step, value: options[key] });

  const text = document.createTextNode(`${label} ${format(options[key])} `);
  input.addEventListener('input', () => {
    options[key] = Number(input.value);
    text.textContent = `${label} ${format(options[key])} `;
    report();
  });
  wrap.append(text, input);
  controls.append(wrap);
}

slider('rotation', 'spin', {
  min: 0,
  max: 2,
  step: 0.05,
  format: (v) => `${v.toFixed(2)}°/frame`,
});

const resetButton = document.createElement('button');
resetButton.type = 'button';
resetButton.textContent = 'Reset view';
resetButton.addEventListener('click', frameWholePlanet);
controls.append(resetButton);

const saveButton = document.createElement('button');
saveButton.type = 'button';
saveButton.textContent = 'Render GIF';
saveButton.addEventListener('click', async () => {
  clearInterval(preview);
  saveButton.disabled = true;
  const done = () => { saveButton.disabled = false; saveButton.textContent = 'Render GIF'; };

  try {
    const bytes = await encode((i, n) => { saveButton.textContent = `Rendering ${i}/${n}`; });
    const blob = new Blob([bytes], { type: 'image/gif' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dicewars-${options.players}p-${options.seed}-${options.play}.gif`;
    link.click();
    URL.revokeObjectURL(url);
    report(`saved ${(bytes.length / 1024 / 1024).toFixed(2)}MB`);
  } finally {
    done();
    playPreview();
  }
});
controls.append(saveButton);

// The planet has to be drawn by somebody. `paint` only moves the board; this
// is what puts it on the screen, and it stands aside while a GIF is being
// encoded — see `encoding`.
function frame() {
  if (!encoding) viewer.render();
  requestAnimationFrame(frame);
}

build();
playPreview();
requestAnimationFrame(frame);
