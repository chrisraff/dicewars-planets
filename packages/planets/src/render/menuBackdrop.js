import * as THREE from 'three';
import { createExpertStrategy, createInitialState, runAiTurn } from '@dicewars/core';
import { generatePlanetWorld } from '../world/generateWorld.js';
import { DEFAULT_SETTINGS, playerIdsFor, subdivisionsFor } from '../game/settings.js';
import { distanceForDisc } from './cameraFraming.js';
import { createPlanetSurface } from './planetSurface.js';
import { createDiceLayer } from './diceLayer.js';
import { assignPlayerColors } from './palette.js';
import { prefersReducedMotion } from './turnFlash.js';

/**
 * The planet behind the title screen: a real one, part way through a real
 * match, parked in the top right of the window and turning slowly.
 *
 * It only exists for the one visit that has no game to pick up. Every other
 * time the menu is opened there is a match sitting behind it, and that planet
 * is the backdrop — this is what stands in when there is not one yet.
 *
 * **It is generated and played rather than drawn**, which is the whole of the
 * argument for it costing anything at all. The alternative is a committed
 * picture, and the explainer's figures are the record of what that costs: a
 * file goes stale silently the day the generator or the renderer moves, and
 * this is the first thing anybody ever sees of the game. A planet built by the
 * code that builds the real ones cannot be out of date, and it is a different
 * planet every visit, which is the one claim the title screen is really
 * making. It costs about 35ms to build, once, on the one open with nothing
 * else to do.
 *
 * It is not a session and must not become one. There is no game here, nothing
 * is saved, nothing can be pressed, and the board never changes after it is
 * built — the only thing that moves is the spin.
 */

export const BACKDROP = {
  /**
   * Where the planet sits: its middle on the right edge of the window, the top
   * of it `top` of the way down, and the furthest left it comes in frame at
   * `reach` across the page. Two numbers, and the same two whichever way the
   * window is turned — what differs is their values.
   *
   * `top` is the one both windows have to honour and it is the reason `reach`
   * can be negative. **Landscape** is a planet rising out of the bottom right
   * corner, a quarter of the way down and half of the way across.
   * **Portrait** is a much bigger planet — a panel the full width of the
   * window leaves only the band above it and the band below, so what fills
   * those is a planet that runs *past* the left edge rather than stopping
   * short of it. It still has to crest under the top of the screen: the top of
   * a globe is most of what says it is one, and a disc overrunning the top
   * edge as well as the bottom is a coloured wall.
   *
   * It crests far higher than the quarter landscape uses because on a phone the
   * band between the title and the panel is all the clear sky there is. The
   * panel starts about 70px down on the shortest phone there is — nothing is
   * left to centre it in there — so a crown much below that is behind it, and
   * a quarter of the way down is behind it on every phone.
   */
  wide: { top: 0.25, reach: 0.5 },
  tall: { top: 0.08, reach: -0.15 },

  /**
   * How close the camera is allowed to get, whatever the window asks for.
   *
   * `wide` is a statement about the width and the frame is a fixed lens, so a
   * window wide enough asks the camera to come closer than the orbit controls
   * will go (`minDistance`, 1.5) — an ultrawide asks for 1.22, where the
   * horizon is 35° away and there is barely a handful of territories in shot.
   * A 16:9 window sits at 1.63, so nothing ordinary is touched by this; past
   * about 1.9:1 the planet quietly stops growing instead of the framing
   * silently coming apart against the controls' own clamp.
   */
  nearest: 1.55,

  // Enough colours on the board to read as a planet being fought over. The
  // menu's own player count is deliberately not consulted — this is furniture
  // rather than a preview of the game about to be dealt, and rebuilding a
  // world every time somebody tries a setting would be a stutter for nothing.
  players: 6,

  /**
   * How far into the match "midway" is, as the share of the planet the leader
   * holds. A property of the picture rather than a number of turns, because it
   * is the picture that matters: an opening board is confetti, a finished one
   * is a single colour, and the shot worth showing is the one where empires
   * have shape but the field is still full.
   */
  lead: 1 / 3,

  // A backstop for a match that never produces a leader, which nothing has
  // been seen to do — cheap insurance against an unbounded loop at startup.
  rounds: 60,

  // Radians a second: about three and a half minutes to the revolution. Slow
  // enough to read as drift rather than as something happening, and slow
  // enough that the face `aimSpin` picked is still most of what is on screen
  // for as long as anybody is likely to be looking at it.
  spin: 0.03,

  // How many rotations `aimSpin` tries. 48 is a step of 7.5°, which is finer
  // than the answer is sensitive to — the count it maximizes moves by a
  // territory or two across a step that size.
  aims: 48,
};

/**
 * The radius of the disc that has its top `top` of the way down the window and
 * comes `reach` of the way across it at the furthest left it gets *in frame*.
 *
 * Derived rather than picked, so that both of the things being asked for hold
 * at any aspect: a radius chosen to look right at 16:9 reaches nothing like
 * halfway on an ultrawide and a third of the way on a 4:3.
 *
 * Two cases, and which one applies is geometry rather than orientation. A disc
 * is widest at its own middle, so normally the leftmost point in frame is
 * simply `radius` left of the right edge — that is the portrait answer, and it
 * is what lets `reach` be negative and still mean something. But a planet big
 * enough to put that middle below the bottom of the window is never seen at
 * its widest: the furthest left it gets in shot is where its edge crosses the
 * bottom edge, and it takes a larger radius to reach as far. That is the
 * landscape answer, and it is the sagitta relation on the two points the
 * numbers name.
 */
export function radiusReaching({ top, reach }, width, height) {
  const half = (1 - reach) * width; // how far left of the right edge to come
  if (top * height + half <= height) return half; // its middle is still in frame

  const below = (1 - top) * height; // top of the disc down to the bottom edge
  return (half * half + below * below) / (2 * below);
}

/** How wide the planet's silhouette draws, from `distance`, in pixels. */
const discRadius = (distance, halfFov, height) =>
  (Math.tan(Math.asin(1 / distance)) / Math.tan(halfFov)) * (height / 2);

/**
 * Where the camera goes and how the frame is skewed to put the planet where
 * `BACKDROP.wide` or `BACKDROP.tall` asks for it.
 *
 * The camera is left looking straight at the planet and the *frustum* is
 * shifted instead (`setViewOffset`), which is what keeps the rest of the
 * renderer true: the lights are aimed off the camera, so a camera turned or
 * dollied off the middle of the planet would light it differently and
 * foreshorten it. The origin projects to the middle of the full frustum, so
 * rendering an offset window of a larger one moves where the planet lands and
 * changes nothing else about it.
 *
 * Pure, and the only part of this module with an opinion worth checking.
 */
export function backdropView({ width, height, fov, framing = BACKDROP }) {
  // vertical, because a radius in pixels is compared against the height
  const halfFov = ((fov * Math.PI) / 180) / 2;
  const anchor = height > width ? framing.tall : framing.wide;
  const wanted = radiusReaching(anchor, width, height);

  // Asked for, then read back: `nearest` can refuse the ask, and the placement
  // has to be made against the disc that will actually be drawn rather than
  // the one that was wanted — otherwise a clamped window gets a planet that is
  // both smaller *and* sitting lower than the anchor says.
  const distance = Math.max(framing.nearest, distanceForDisc(wanted / (height / 2), halfFov));
  const radius = discRadius(distance, halfFov, height);

  const center = { x: width, y: anchor.top * height + radius };

  return {
    width,
    height,
    halfFov,
    radius,
    center,
    distance,
    offset: {
      fullWidth: width,
      fullHeight: height,
      x: width / 2 - center.x,
      y: height / 2 - center.y,
      width,
      height,
    },
  };
}

/**
 * Whether a point on the planet lands inside the window, in a view
 * `backdropView` describes.
 *
 * Two things have to be true and the first is the one that is easy to forget:
 * the near side of the planet is not the hemisphere facing the camera but the
 * cap inside the horizon, which is `1 / distance` up the view axis. Without
 * it, ground on the far side projects into the frame and counts.
 */
export function onScreen(point, view) {
  if (point.z <= 1 / view.distance) return false;

  // The projection `backdropView` set up, run forwards: `center` is where the
  // planet's own middle lands, and a point `1 / depth` off the axis lands this
  // many pixels from it.
  const scale = view.height / 2 / Math.tan(view.halfFov);
  const depth = view.distance - point.z;
  const x = view.center.x + (point.x / depth) * scale;
  const y = view.center.y - (point.y / depth) * scale;

  return x >= 0 && x <= view.width && y >= 0 && y <= view.height;
}

/**
 * How much of a planet worth looking at one face of it is showing: the sum of
 * the square roots of what each player holds in frame.
 *
 * Two things make a face worth the title screen and one of them alone is not
 * enough. **Land**, because the corner this is framed in shows about an eighth
 * of the planet and two fifths of a planet is ocean, so an unweighted aim deals
 * a dark blue basin and nothing else often enough to matter. And **more than
 * one colour**, because by the time a leader holds a third of the planet they
 * can hold the whole of the visible eighth — and a face that is one player's
 * empire wall to wall says nothing about a planet being fought over. The blue
 * player's does not even read as land.
 *
 * A square root rather than a weight to tune: it is the standard shape for
 * wanting both mass and spread, being steep where a player has a territory or
 * two and flat where they already have plenty, so a second colour in frame is
 * worth more than a tenth territory of the first one.
 */
export function faceScore(seen) {
  const held = new Map();
  for (const owner of seen) held.set(owner, (held.get(owner) ?? 0) + 1);

  let score = 0;
  for (const count of held.values()) score += Math.sqrt(count);
  return score;
}

/**
 * Which way round to start the planet: the turn about its own axis that shows
 * the best face of it, by `faceScore`.
 *
 * A search rather than an aim point, because the window is a corner of the
 * frame rather than a cone about the view axis — there is no direction to
 * average towards that means "in shot" here. It is 48 turns over a few dozen
 * territories, once, which is nothing beside generating the planet.
 */
export function aimSpin(territories, view, steps = BACKDROP.aims) {
  let best = 0;
  let most = -1;

  for (let step = 0; step < steps; step++) {
    const spin = (step / steps) * Math.PI * 2;
    const cos = Math.cos(spin);
    const sin = Math.sin(spin);

    const seen = [];
    for (const { normal, owner } of territories) {
      // about Y, the axis `group.rotation.y` turns the planet on
      const turned = {
        x: normal.x * cos + normal.z * sin,
        y: normal.y,
        z: normal.z * cos - normal.x * sin,
      };
      if (onScreen(turned, view)) seen.push(owner);
    }

    const score = faceScore(seen);
    if (score > most) {
      most = score;
      best = spin;
    }
  }

  return best;
}

/** What share of the planet the player holding most of it holds. */
function largestShare(state) {
  const held = new Map();
  for (const node of state.nodes.values()) held.set(node.owner, (held.get(node.owner) ?? 0) + 1);
  return Math.max(...held.values()) / state.nodes.size;
}

/**
 * A planet, and the board a few rounds of a real match leave on it.
 *
 * Nothing is seeded, and that is a decision rather than an oversight: this
 * board is never saved, never replayed and never looked at twice, so a seed
 * would be a number kept for nobody. The world, the dice and the scatter are
 * all just chance, which is what makes the title screen a different planet
 * every time it opens.
 *
 * The expert plays it because it is the one that builds empires with a shape
 * to them; the weaker strategies leave a board that still looks like the deal.
 */
function playMidGame({ players, lead, rounds }) {
  const playerIds = playerIdsFor({ players });
  const world = generatePlanetWorld({
    subdivisions: subdivisionsFor(DEFAULT_SETTINGS),
    playerIds,
  });

  const strategy = createExpertStrategy();
  const deps = { rollDie: () => 1 + Math.floor(Math.random() * 6), rng: Math.random };

  let state = createInitialState({ ...world, turnOrder: playerIds });
  for (let round = 0; round < rounds; round++) {
    if (state.phase === 'gameover' || largestShare(state) >= lead) break;
    state = runAiTurn(state, strategy, deps).state;
  }

  return { world, playerIds, nodes: state.nodes };
}

/**
 * Builds the backdrop and puts it in the viewer's scene. `dispose` hands the
 * scene and the camera back, which is what starting a game does with it.
 *
 * `reducedMotion` is an override for the previews, which pin the flag rather
 * than asking the browser so a page shows what it says it is showing.
 */
export function createMenuBackdrop({
  viewer,
  pipMaterials,
  framing = BACKDROP,
  reducedMotion = null,
}) {
  const { world, playerIds, nodes } = playMidGame(framing);

  const surface = createPlanetSurface(world, assignPlayerColors(playerIds));
  const dice = createDiceLayer(world, pipMaterials);
  surface.refresh({ nodes });
  dice.update({ nodes });

  // One group, so the spin turns the land and the dice standing on it as one
  // thing. No pole markers: those are something to read the planet's turn
  // against, and nothing here is taking a turn.
  const group = new THREE.Group();
  group.add(surface.group, dice.group);
  viewer.scene.add(group);

  const reduced = () => (reducedMotion === null ? prefersReducedMotion() : reducedMotion);

  // Tracked in CSS pixels for the reason `createViewer` tracks them: the
  // drawing buffer is `pixelRatio` times larger and never compares equal.
  let width = 0;
  let height = 0;
  let aimed = false;

  function place() {
    const canvas = viewer.renderer.domElement;
    if (canvas.clientWidth === width && canvas.clientHeight === height) return;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    if (!width || !height) return;

    const view = backdropView({ width, height, fov: viewer.camera.fov, framing });
    const box = view.offset;
    viewer.camera.position.set(0, 0, view.distance);
    viewer.camera.setViewOffset(box.fullWidth, box.fullHeight, box.x, box.y, box.width, box.height);
    viewer.controls.update();

    // Aimed once, against the first window there was one to aim at, and left
    // alone after that: a resize is not a reason to spin the planet round
    // under somebody who is looking at it, and the spin has taken it off that
    // aim by then anyway.
    if (!aimed) {
      aimed = true;
      group.rotation.y = aimSpin(
        world.nodeIds.map((id) => ({
          normal: dice.standFor(id).normal,
          owner: nodes.get(id).owner,
        })),
        view,
        framing.aims
      );
    }
  }

  place();

  return {
    world,

    tick(dt) {
      place();
      if (!reduced()) group.rotation.y += framing.spin * dt;
    },

    dispose() {
      viewer.scene.remove(group);
      surface.dispose();
      dice.dispose();
      // Back to a frame with the planet in the middle of it, which is what
      // every framing decision the game makes assumes.
      viewer.camera.clearViewOffset();
    },
  };
}
