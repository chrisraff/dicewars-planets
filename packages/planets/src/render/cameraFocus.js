import * as THREE from 'three';
import {
  DEFAULT_FRAMING,
  clusterAim,
  framingDistance,
  holdingsFocus,
  narrowHalfFov,
  needsRefocus,
  swingDirection,
  swingDuration,
  swingTravel,
  zoomAlong,
  zoomDuration,
} from './cameraFraming.js';
import { angleBetween, normalize } from '../geometry/vec3.js';

/**
 * Turns the planet under the orbit camera to bring something into view.
 *
 * The AI plays where it likes and half of that is round the back, so a fight
 * starting outside the visible cap gets a swing along the shortest arc until
 * it is centred. It also draws the camera back to take the whole planet in
 * (`framePlanet`), which is the view an AI's turn wants for the same reason.
 *
 * Thin on purpose: every decision is in `cameraFraming.js`. All this adds is
 * reading the camera, writing it back, and the dragging rule — a hand that
 * turns the planet ends the swing on the spot, since a camera fighting the
 * hand on it is worse than a missed battle.
 */
export function createCameraFocus({ camera, controls, framing = DEFAULT_FRAMING, onDrag }) {
  let swing = null; // { from, to, elapsed, duration } — where the camera is looking
  let zoom = null; // the same, for how far away it is

  // Distance and direction are read fresh every frame rather than captured:
  // zooming mid-swing is the player's business and shouldn't be undone by it.
  const orbit = () => {
    const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
    return { distance: offset.length(), direction: normalize(offset) };
  };

  const halfFov = () => narrowHalfFov(camera.fov, camera.aspect);

  // Where the camera is looking, as far as this module knows, and whether the
  // move that got it there was one of ours. The controls announce our writes
  // exactly as they announce the player's, so the flag is what tells the two
  // apart — see `onControlsChange`.
  let facing = orbit().direction;
  let selfMoving = false;
  let turnReported = false;

  const aimAt = (direction, distance) => {
    selfMoving = true;
    camera.position
      .copy(controls.target)
      .addScaledVector(new THREE.Vector3(direction.x, direction.y, direction.z), distance);
    controls.update();
    selfMoving = false;
    facing = orbit().direction;
  };

  // Stop moving the camera at all — both what it is looking at and how far
  // away it is.
  const cancel = () => {
    swing = null;
    zoom = null;
  };

  const startSwingTo = (to) => {
    const { direction, distance } = orbit();
    swing = {
      from: direction,
      to,
      elapsed: 0,
      duration: swingDuration(swingTravel(direction, to), framing),
    };
  };

  // A pull-back is *about* distance, so anything the player does outranks it —
  // and `start` fires for every gesture there is, a drag, a pinch and a wheel
  // alike, which is exactly the set that outranks it.
  const onControlsStart = () => {
    zoom = null;
    turnReported = false; // a new gesture: nothing about this hand reported yet
  };

  // A swing is about *direction*, so what calls one off is the planet turning
  // under a hand. `onDrag` is told about the same thing, and says only that:
  // the camera reports the hand on the planet and nothing about what it means,
  // because what it means is a question about the *match* — see `session.js`.
  //
  // Read as movement rather than as a gesture, and that is what makes all
  // three zooms one case instead of three. The wheel, a pinch and a
  // middle-button dolly each say where the player wants to be and nothing
  // about where they want to look, so none of them ends a swing or takes the
  // camera off the match — the swing carries on and keeps whatever distance
  // the player lands on. Asking OrbitControls which gesture it is in gets
  // precisely that wrong: its `state` reads as a one-finger *rotate* for the
  // moment between the two fingers of a pinch landing, and again as one of
  // them lifts, so a pinch took the camera off the match before it had zoomed
  // a single pixel.
  const TURNED = 1e-6; // radians; a hand clears this by orders of magnitude
  const onControlsChange = () => {
    if (selfMoving) return; // our own swing, writing the camera through `aimAt`
    const { direction } = orbit();
    const turned = angleBetween(facing, direction) > TURNED;
    facing = direction;
    if (!turned) return;

    swing = null;
    if (!turnReported) onDrag?.(); // once for the hand, not once per frame of it
    turnReported = true;
  };

  controls.addEventListener('start', onControlsStart);
  controls.addEventListener('change', onControlsChange);

  return {
    get isSwinging() {
      return swing !== null;
    },

    // Everything the camera is doing of its own accord, turning and drawing
    // back alike — what a caller waiting for the camera to settle wants, where
    // `isSwinging` is only about direction.
    get isMoving() {
      return swing !== null || zoom !== null;
    },

    /**
     * Bring `point` (a direction from the planet's center) into view, unless
     * it is comfortably framed already. Returns whether it started a swing,
     * which is the interesting half for a test or a preview.
     */
    lookAt(point) {
      const { direction, distance } = orbit();
      if (!needsRefocus(direction, point, { distance, halfFov: halfFov() }, framing)) return false;

      startSwingTo(normalize(point));
      return true;
    },

    /**
     * Like `lookAt`, but given the upcoming moves in the order they're about
     * to be shown rather than just the next one — see `clusterAim` for how
     * much of that run ends up framed in one swing instead of several.
     *
     * `force` swings even from a view that already frames the run, for the
     * same reason `lookAtHoldings` has it: a press is a request, not a
     * handover, and "close enough already" is not an answer to one.
     */
    lookAtCluster(points, { force = false } = {}) {
      const { direction, distance } = orbit();
      const view = { distance, halfFov: halfFov() };
      const aim = clusterAim(points, direction, view, framing, { force });
      if (aim === null) return false;

      startSwingTo(aim);
      return true;
    },

    /**
     * Turn the planet back to the player's own ground for the moment a turn
     * hands back to them. `points` is a direction per territory they hold.
     *
     * Only fires when *none* of them is in view — `holdingsFocus` holds that
     * rule and the choice of aim. It will draw back as well as turn, but only
     * outwards and only when the wider view strictly shows more.
     *
     * `force` is the same move on request rather than on a handover: somebody
     * who pressed a button does not want to be told they can already see a
     * sliver of their own ground. `instant` is the same move as a board first
     * appears, for `framePlanet`'s reason — there is no previous view to
     * travel from, so animating would only be a lurch.
     */
    lookAtHoldings(points, { force = false, instant = false } = {}) {
      const { direction, distance } = orbit();
      const view = { distance, halfFov: halfFov() };
      const wide = Math.min(controls.maxDistance, framingDistance(halfFov(), framing.shave));

      const focus = holdingsFocus(points, direction, view, wide, framing, { force });
      if (focus === null) return false;

      if (instant) {
        cancel();
        aimAt(focus.aim, focus.distance);
        return true;
      }

      startSwingTo(focus.aim);
      if (focus.distance > distance + 1e-3) {
        zoom = {
          from: distance,
          to: focus.distance,
          elapsed: 0,
          duration: zoomDuration(distance, focus.distance, framing),
        };
      }
      return true;
    },

    /**
     * Draw back until the whole planet is in frame — the view someone else's
     * turn wants, since the AI plays wherever it likes and a fight it picks
     * could be anywhere on the sphere.
     *
     * Outwards only. A player who is already further back than this has a
     * view of their own choosing that already shows everything this would,
     * and hauling them in to a standard distance would be taking it away.
     *
     * `instant` skips the animation, for opening a page: there is no previous
     * view to travel from, so animating would only be the planet lurching the
     * moment it appeared. Returns whether it moved the camera at all.
     */
    framePlanet({ instant = false } = {}) {
      const { direction, distance } = orbit();
      const target = Math.min(controls.maxDistance, framingDistance(halfFov(), framing.shave));
      if (distance >= target - 1e-3) return false;

      if (instant) {
        zoom = null;
        aimAt(direction, target);
        return true;
      }

      zoom = {
        from: distance,
        to: target,
        elapsed: 0,
        duration: zoomDuration(distance, target, framing),
      };
      return true;
    },

    // The camera's own read on itself, for a caller (an AI turn's forward
    // planner) that needs to know where "here" is without duplicating the
    // orbit/fov math above.
    currentView() {
      const { direction, distance } = orbit();
      return { direction, distance, halfFov: halfFov() };
    },

    cancel,

    // A swing and a pull-back can be running at once — one turns the planet
    // for the AI's first attack while the other is still drawing back from the
    // turn that just ended. Both are worked out first and the camera is moved
    // once, so neither writes a position the other is about to overwrite.
    tick(dt) {
      if (!swing && !zoom) return;
      let { direction, distance } = orbit();

      if (zoom) {
        zoom.elapsed += dt;
        const t = Math.min(1, zoom.elapsed / zoom.duration);
        distance = zoomAlong(zoom.from, zoom.to, t);
        if (t >= 1) zoom = null;
      }

      if (swing) {
        swing.elapsed += dt;
        const t = Math.min(1, swing.elapsed / swing.duration);
        direction = swingDirection(swing.from, swing.to, t);
        if (t >= 1) swing = null;
      }

      aimAt(direction, distance);
    },

    dispose() {
      controls.removeEventListener('start', onControlsStart);
      controls.removeEventListener('change', onControlsChange);
      cancel();
    },
  };
}
