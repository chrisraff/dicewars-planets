import {
  createExpertStrategy,
  createInitialState,
  largestConnectedRegionSize,
  neighbors,
  runAiTurn,
  seededRng,
} from '@dicewars/core';
import { createViewer } from '../render/createViewer.js';
import { narrowHalfFov, visibleAngle } from '../render/cameraFraming.js';
import { angleBetween } from '../geometry/vec3.js';
import { createDiePipMaterials } from '../render/diceTextures.js';
import { createPlanetSurface } from '../render/planetSurface.js';
import { createDiceLayer } from '../render/diceLayer.js';
import { assignPlayerColors } from '../render/palette.js';
import { generatePlanetWorld } from '../world/generateWorld.js';
import { EXPLAINER_CAPTURES } from '../render/explainer.js';

/**
 * The pictures the explainer is made of, shot from the real renderer.
 *
 * The explainer's 3D figures are committed PNGs rather than live planets: a
 * document with five WebGL contexts in it is a document that costs more than
 * it explains, and half of these are before-and-after pairs that have to be
 * looked at together rather than turned.
 *
 * So this page is where they come from. It builds each figure from a pinned
 * seed and a hand-built board, frames it from a fixed camera, and saves it at
 * a fixed size — nothing about the shot depends on the screen it was taken
 * on, which is what makes re-shooting one produce the same picture rather
 * than a similar one.
 *
 * **The orbit controls are off on purpose.** Framing a shot by hand would
 * make it unrepeatable, and these have to be repeatable: a capture is a file
 * that goes stale silently when the renderer moves, and the answer to that is
 * being able to take them all again in one press.
 */

// What every capture is saved at, whatever the screen. The WebGL canvas is
// drawn into a 2D canvas of exactly this size, so a retina display does not
// commit a file twice the weight of everybody else's.
const CAPTURE = { width: 600, height: 400 };

const PLAYER_IDS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const SEED = 99991;

/**
 * The empire the income and payout figures are about: a joined-up handful and
 * a couple of territories cut off from it.
 *
 * Small on purpose. The figure has to show the whole of it at once — the point
 * is the *gap*, and a gap you have to turn the planet to see is not a picture
 * of anything — so six territories that sit comfortably in one view beat
 * eleven that do not.
 */
const REGION_SIZE = 4;
const STRANDED_COUNT = 2;

/**
 * The match behind the "dice pile up inside" figure: which dice it was fought
 * with, how many rounds of it to play, and whose empire to look at.
 *
 * A board that was *played* rather than arranged, because the thing it has to
 * show — a full interior against a ragged front — is not a position anyone
 * would think to build. It is what a fought match looks like after ten rounds,
 * and staging it would be drawing the conclusion rather than finding it.
 *
 * Reproducible without pinning anything extra: `createExpertStrategy` takes no
 * rng of its own (it plays the best move it can find), so the dice and the
 * scatter are the only chance in it and both are seeded here. The planet is
 * still the shared one — only the *play* varies.
 */
const MID_GAME = { dice: 52684, scatter: 52685, rounds: 10, player: 'p5' };

// The frustum a capture is taken through. Known exactly, because a capture is
// always saved at `CAPTURE` whatever screen shot it — which is what lets the
// camera distances below be worked out rather than guessed at.
const CAPTURE_HALF_FOV = narrowHalfFov(45, CAPTURE.width / CAPTURE.height);

const pipMaterials = createDiePipMaterials();
const playerColors = assignPlayerColors(PLAYER_IDS);
const figuresRoot = document.getElementById('figures');
const problemsRoot = document.getElementById('problems');

// One world for every figure. The empires differ, the planet does not — a
// reader going from the fight to the payout should be looking at the same
// place, not at five unrelated worlds.
const world = generatePlanetWorld({
  subdivisions: 3,
  playerIds: PLAYER_IDS,
  rng: seededRng(SEED),
});
const baseState = createInitialState({ ...world, turnOrder: PLAYER_IDS });

// --- picking ground to photograph -----------------------------------------

/** Every territory, with the unit vector pointing at the middle of it. */
function territoryNormals(dice) {
  return new Map(world.nodeIds.map((id) => [id, dice.standFor(id).normal]));
}

const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });

/**
 * A neighbouring pair to stage the fight on, as near the equator as the
 * planet has: the camera is aimed straight at it, and a pair near a pole
 * would be photographed with the world's up axis lying across the frame.
 */
function equatorPair(normals) {
  let best = null;
  for (const id of world.nodeIds) {
    for (const other of neighbors(baseState.graph, id)) {
      const tilt = Math.abs(midpoint(normals.get(id), normals.get(other)).y);
      if (!best || tilt < best.tilt) best = { from: id, to: other, tilt };
    }
  }
  return best;
}

/** A connected run of `size` territories, grown outwards from `start`. */
function growRegion(start, size) {
  const region = [start];
  const seen = new Set(region);

  for (let i = 0; i < region.length && region.length < size; i++) {
    for (const next of neighbors(baseState.graph, region[i])) {
      if (seen.has(next) || region.length >= size) continue;
      seen.add(next);
      region.push(next);
    }
  }
  return region;
}

/**
 * The stranded outposts the income figure is about: territories exactly *two*
 * steps from the region, so there is one territory of somebody else's ground
 * between them and it.
 *
 * Two steps rather than as far away as possible, which is what this used to
 * do. A gap has to be visible to be the point, and an outpost on the far side
 * of the planet is not in the picture at all — while one merely adjacent would
 * not be stranded. Two steps is the nearest a territory can be and still be
 * plainly cut off.
 */
function strandedFrom(region, count) {
  const inner = new Set(region);
  const border = new Set();
  for (const id of region) {
    for (const next of neighbors(baseState.graph, id)) if (!inner.has(next)) border.add(next);
  }

  const found = [];
  for (const id of border) {
    for (const next of neighbors(baseState.graph, id)) {
      if (inner.has(next) || border.has(next) || found.includes(next)) continue;
      found.push(next);
    }
  }
  return found.slice(0, count);
}

/**
 * How far back to stand to see all of `points` at once, in planet radii.
 *
 * Worked out rather than guessed: `visibleAngle` is how far around the planet
 * a camera can see from a given distance, so the answer is the nearest
 * distance whose view covers the spread with room to spare. `fill` is how much
 * of that view the subject is allowed to take — smaller keeps more of the
 * planet around it, which a fight wants and an empire does not.
 *
 * Being derived is the point. These figures are re-shot whenever the renderer
 * moves and re-chosen whenever the seed does, and a hand-picked distance is
 * one more thing that quietly stops being right.
 */
function distanceShowing(points, normals, fill) {
  const aim = aimPoint(points, normals);
  const spread = Math.max(...points.map((id) => angleBetween(aim, normals.get(id))));

  for (let distance = 1.6; distance < 8; distance += 0.02) {
    if (visibleAngle(distance, CAPTURE_HALF_FOV) * fill >= spread) return distance;
  }
  return 8;
}

// --- the boards ------------------------------------------------------------

/**
 * The starting board with some territories handed over and loaded up.
 *
 * `overrides` is a **Map**, and it has to be: territory ids are list positions
 * — numbers — and an object literal keyed by them stringifies every key, so
 * the overrides land beside the territories they were meant to replace rather
 * than on them. The board then quietly has both, and every count taken off it
 * is wrong.
 */
function boardWith(overrides) {
  const nodes = new Map([...baseState.nodes].map(([id, node]) => [id, { ...node }]));
  for (const [id, node] of overrides) nodes.set(id, node);
  return nodes;
}

/**
 * An empire for the income and payout figures: a joined-up region, plus a
 * couple of territories cut off from it. Every figure that shows "your
 * territories" shows this same empire, for the reason there is one world.
 *
 * The generator has already dealt p1 territories of its own all over the
 * planet, and they have to go — the caption counts what this player holds, and
 * `afterPayout` pays income on their largest region, so a stray red territory
 * somewhere off-frame would make both of them wrong. Each is handed to a
 * neighbour rather than to a fixed player, so the board it leaves behind still
 * looks like a planet somebody has been playing on.
 */
function empire() {
  const start = world.nodeIds[Math.floor(world.nodeIds.length / 2)];
  const region = growRegion(start, REGION_SIZE);
  const stranded = strandedFrom(region, STRANDED_COUNT);
  const mine = new Set([...region, ...stranded]);

  const held = new Map();
  for (const id of world.nodeIds) {
    if (mine.has(id) || baseState.nodes.get(id).owner !== 'p1') continue;
    // Spread: `neighbors` answers with a Set, not an array.
    const taker = [...neighbors(baseState.graph, id)]
      .map((next) => baseState.nodes.get(next).owner)
      .find((owner) => owner !== 'p1');
    held.set(id, { ...baseState.nodes.get(id), owner: taker ?? 'p2' });
  }

  // Deliberately not full: the payout figure has to have somewhere to land.
  region.forEach((id, i) => held.set(id, { owner: 'p1', dice: 2 + (i % 3) }));
  stranded.forEach((id) => held.set(id, { owner: 'p1', dice: 2 }));

  return { region, stranded, nodes: boardWith(held) };
}

/**
 * The planet after `MID_GAME.rounds` rounds of a real match, and the empire
 * worth looking at on it.
 *
 * Every turn is the game's own `runAiTurn`, so the board this lands on is one
 * the rules actually produce — the dice piled up inside are there because
 * reinforcement scatters over everything a player owns while only the border
 * ever spends any, which is exactly the claim the figure is under.
 */
function midGame() {
  const roll = seededRng(MID_GAME.dice);
  const deps = { rollDie: () => 1 + Math.floor(roll() * 6), rng: seededRng(MID_GAME.scatter) };
  const strategy = createExpertStrategy();

  let state = baseState;
  for (let turn = 0; turn < MID_GAME.rounds * PLAYER_IDS.length; turn++) {
    if (state.phase === 'gameover') break;
    state = runAiTurn(state, strategy, deps).state;
  }

  const held = [...state.nodes]
    .filter(([, node]) => node.owner === MID_GAME.player)
    .map(([id]) => id);
  return { nodes: state.nodes, held };
}

/**
 * Every capture, as a board and somewhere to stand to look at it.
 *
 * `at` is what the camera aims at — a territory id, or a list of them, whose
 * middle it looks straight down. `distance` is in planet radii, the same unit
 * the controls use.
 */
function recipes(normals) {
  const fight = equatorPair(normals);
  const { region, stranded, nodes: held } = empire();
  const spread = [...region, ...stranded];

  const { nodes: played, held: playedHeld } = midGame();

  // A fight is two territories and wants the ground around them for context;
  // an empire is the subject, so it takes most of the frame.
  const fightDistance = distanceShowing([fight.from, fight.to], normals, 0.4);
  const empireDistance = distanceShowing(spread, normals, 0.75);
  const playedDistance = distanceShowing(playedHeld, normals, 0.8);

  return {
    'fight-before': {
      nodes: boardWith(new Map([
        [fight.from, { owner: 'p1', dice: 5 }],
        [fight.to, { owner: 'p2', dice: 3 }],
      ])),
      at: [fight.from, fight.to],
      distance: fightDistance,
    },
    'fight-after': {
      nodes: boardWith(new Map([
        [fight.from, { owner: 'p1', dice: 1 }],
        [fight.to, { owner: 'p1', dice: 4 }],
      ])),
      at: [fight.from, fight.to],
      distance: fightDistance,
    },
    'income-region': { nodes: held, at: spread, distance: empireDistance },
    'interior-stacks': {
      nodes: played,
      at: playedHeld,
      distance: playedDistance,
      about: MID_GAME.player,
    },
  };
}

/**
 * What a board actually holds, printed under the figure it belongs to.
 *
 * The captions in the explainer make numeric claims — eleven held, nine of
 * them joined — and a caption is prose about a specific board. This is the
 * board answering for itself, so a claim that has stopped being true is
 * visible here rather than only in the picture, where nobody counts.
 *
 * It is not idle worry. The overrides were once keyed by an object literal,
 * and territory ids are numbers: every key stringified, so the edits landed
 * *beside* the territories they were meant to replace instead of on them. The
 * board grew to 65 territories, the player held 20 rather than 11, and their
 * largest joined region was 3. Every picture would have been wrong and every
 * caption would still have read as if it were not.
 */
function describe(nodes, playerId) {
  const state = { ...baseState, nodes, currentTurnIndex: 0 };
  const held = [...nodes].filter(([, node]) => node.owner === playerId).map(([id]) => id);
  const diceOn = (ids) => ids.map((id) => nodes.get(id).dice).sort((a, b) => b - a);

  // Which of their territories the fighting is actually on. The whole of the
  // mid-game figure is the difference between these two lists.
  const border = held.filter((id) =>
    [...neighbors(state.graph, id)].some((next) => nodes.get(next).owner !== playerId));
  const inner = held.filter((id) => !border.includes(id));

  return [
    `${nodes.size} territories on the board (the world has ${world.nodeIds.length})`,
    `${playerId} holds ${held.length}, `
      + `${largestConnectedRegionSize(state, playerId)} of them joined up`,
    `inner  ${diceOn(inner).join(' ') || '(none)'}`,
    `border ${diceOn(border).join(' ') || '(none)'}`,
  ].join('\n');
}

// --- shooting them ---------------------------------------------------------

const normalize = ({ x, y, z }) => {
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
};

function aimPoint(ids, normals) {
  const total = ids.reduce(
    (sum, id) => {
      const n = normals.get(id);
      return { x: sum.x + n.x, y: sum.y + n.y, z: sum.z + n.z };
    },
    { x: 0, y: 0, z: 0 }
  );
  return normalize(total);
}

function addFigure(name, recipe, normals) {
  const capture = EXPLAINER_CAPTURES[name];

  const section = document.createElement('section');
  section.className = 'scenario';
  section.innerHTML = `
    <h2></h2>
    <p></p>
    <div class="stage is-planet is-capture"></div>
    <div class="controls"></div>
  `;
  section.querySelector('h2').textContent = `${name}.png`;
  section.querySelector('p').textContent = capture.shot;
  figuresRoot.append(section);

  const stage = section.querySelector('.stage');
  const canvas = document.createElement('canvas');
  stage.append(canvas);

  const viewer = createViewer(canvas);
  // Nobody frames these by hand — see the note at the top. A shot that can be
  // nudged is a shot that cannot be taken twice.
  viewer.controls.enabled = false;

  const surface = createPlanetSurface(world, playerColors);
  const dice = createDiceLayer(world, pipMaterials);
  viewer.scene.add(surface.group, dice.group);

  surface.refresh({ nodes: recipe.nodes });
  dice.update({ nodes: recipe.nodes });

  const at = aimPoint([recipe.at].flat(), normals);
  viewer.camera.position.set(
    at.x * recipe.distance,
    at.y * recipe.distance,
    at.z * recipe.distance
  );
  viewer.controls.target.set(0, 0, 0);
  viewer.controls.update();

  /**
   * The frame as a PNG data URL, rendered *at* `CAPTURE` rather than scaled
   * into it afterwards.
   *
   * This is the whole of "nothing about the shot depends on the screen it was
   * taken on", and scaling afterwards was not it. The stage carries `padding`,
   * and `aspect-ratio` sizes the content box while an inset canvas fills the
   * padding box — so the canvas was never the 3:2 it looked like, the camera
   * took its aspect from that, and drawing the result down into 600×400
   * stretched every planet about 6% across. Small enough to miss on a square
   * and not on a sphere.
   *
   * So the renderer is resized to the capture, the camera is given the
   * capture's aspect, and both are put back afterwards. `toDataURL` rather
   * than `toBlob` because it reads synchronously: the drawing buffer is not
   * preserved between frames, so anything that reads it after the restore
   * comes back blank.
   */
  function shoot() {
    const { renderer, camera, scene } = viewer;
    const ratio = renderer.getPixelRatio();

    renderer.setPixelRatio(1);
    renderer.setSize(CAPTURE.width, CAPTURE.height, false);
    camera.aspect = CAPTURE.width / CAPTURE.height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const url = canvas.toDataURL('image/png');

    // Back to whatever the stage is, so the page goes on showing the figure.
    // These are the numbers `createViewer`'s own `resize` last recorded, so it
    // will agree with them and leave things alone.
    renderer.setPixelRatio(ratio);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);

    return url;
  }

  function save() {
    const link = document.createElement('a');
    link.href = shoot();
    link.download = `${name}.png`;
    link.click();
  }

  const button = document.createElement('button');
  button.textContent = `Save ${name}.png`;
  button.addEventListener('click', save);
  section.querySelector('.controls').append(button);

  const facts = document.createElement('pre');
  facts.className = 'menu-readout';
  facts.textContent = describe(recipe.nodes, recipe.about ?? 'p1');
  section.append(facts);

  // A still figure, so there is no loop: it is drawn when it is built and
  // again whenever it is saved, and nothing moves in between. The second draw
  // is on the next frame because `createViewer` sizes itself from the canvas
  // and gives up on one that has not been laid out yet — which the very first
  // one, in the same tick it was appended, can still be.
  viewer.render();
  requestAnimationFrame(() => viewer.render());
  return { name, save };
}

// --- the page --------------------------------------------------------------

/**
 * The two ways this page and the explainer can disagree, said on the page
 * rather than left to be discovered as a missing picture in the document.
 */
function reportProblems(names) {
  const wanted = Object.keys(EXPLAINER_CAPTURES);
  const missing = wanted.filter((name) => !names.includes(name));
  const extra = names.filter((name) => !wanted.includes(name));
  if (missing.length === 0 && extra.length === 0) return;

  problemsRoot.hidden = false;
  problemsRoot.textContent = [
    missing.length > 0 ? `No recipe here for: ${missing.join(', ')}` : '',
    extra.length > 0 ? `Shot here but not used by the explainer: ${extra.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

// One dice layer's worth of geometry is needed before anything can be aimed,
// so the normals are read off a throwaway layer built for the purpose.
const normals = territoryNormals(createDiceLayer(world, pipMaterials));
const built = Object.entries(recipes(normals)).map(([name, recipe]) =>
  addFigure(name, recipe, normals)
);

reportProblems(built.map((figure) => figure.name));

document.getElementById('save-all').addEventListener('click', async (event) => {
  event.target.disabled = true;
  // One at a time: a browser asked for five downloads in one tick blocks all
  // but the first.
  for (const figure of built) {
    await figure.save();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  event.target.disabled = false;
});
