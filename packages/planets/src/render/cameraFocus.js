import * as THREE from 'three';
import {
  DEFAULT_FRAMING,
  needsRefocus,
  swingDirection,
  swingDuration,
  swingTravel,
} from './cameraFraming.js';
import { normalize } from '../geometry/vec3.js';

/**
 * Turns the planet under the orbit camera to bring something into view.
 *
 * The AI plays where it likes, and half of that is round the back — a battle
 * nobody can see is a battle that may as well not have happened. So when one
 * starts outside the visible cap (see `cameraFraming.js` for where that edge
 * is and the margin that decides "too close to it"), the camera swings along
 * the shortest arc until the fight is centered.
 *
 * Thin on purpose: every decision is in `cameraFraming.js`, and all this adds
 * is reading the camera, writing it back, and the dragging rule — the player
 * turning the planet ends the swing on the spot, because a camera fighting
 * the hand on it is worse than a missed battle.
 */
export function createCameraFocus({ camera, controls, framing = DEFAULT_FRAMING }) {
  let swing = null; // { from, to, elapsed, duration }

  // Distance and direction are read fresh every frame rather than captured:
  // zooming mid-swing is the player's business and shouldn't be undone by it.
  const orbit = () => {
    const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
    return { distance: offset.length(), direction: normalize(offset) };
  };

  // The narrower half-angle of the frustum, so "on screen" means on screen in
  // both directions — on a phone held upright that is the horizontal one.
  const halfFov = () => {
    const vertical = THREE.MathUtils.degToRad(camera.fov) / 2;
    return Math.min(vertical, Math.atan(Math.tan(vertical) * camera.aspect));
  };

  const aimAt = (direction, distance) => {
    camera.position
      .copy(controls.target)
      .addScaledVector(new THREE.Vector3(direction.x, direction.y, direction.z), distance);
    controls.update();
  };

  const cancel = () => {
    swing = null;
  };

  // OrbitControls fires `start` for the wheel as well as for a drag, and a
  // zoom is not a disagreement about where to look — the swing carries on and
  // simply keeps whatever distance the player lands on. Anything else means a
  // hand on the planet, and the hand wins. (`state` is OrbitControls' own; if
  // it ever stops being there, every `start` cancels, which is the safe way
  // round to be wrong.)
  const NOT_DRAGGING = -1; // OrbitControls' internal STATE.NONE
  const onControlsStart = () => {
    if (controls.state !== NOT_DRAGGING) cancel();
  };
  controls.addEventListener('start', onControlsStart);

  return {
    get isSwinging() {
      return swing !== null;
    },

    /**
     * Bring `point` (a direction from the planet's center) into view, unless
     * it is comfortably framed already. Returns whether it started a swing,
     * which is the interesting half for a test or a preview.
     */
    lookAt(point) {
      const { direction, distance } = orbit();
      if (!needsRefocus(direction, point, { distance, halfFov: halfFov() }, framing)) return false;

      const to = normalize(point);
      swing = {
        from: direction,
        to,
        elapsed: 0,
        duration: swingDuration(swingTravel(direction, to), framing),
      };
      return true;
    },

    cancel,

    tick(dt) {
      if (!swing) return;
      swing.elapsed += dt;
      const t = Math.min(1, swing.elapsed / swing.duration);
      aimAt(swingDirection(swing.from, swing.to, t), orbit().distance);
      if (t >= 1) swing = null;
    },

    dispose() {
      controls.removeEventListener('start', onControlsStart);
      swing = null;
    },
  };
}
