import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createLightRig } from './lightRig.js';
import { createPointerArbiter } from './pointerArbiter.js';

// Where the camera starts before anything has looked at the screen it is on.
// Comfortably outside the planet, and the distance every desktop game has
// always opened at — a narrow screen needs more, and `cameraFocus.framePlanet`
// is what works out how much, once there is a session to ask.
const ROOMY_DISTANCE = 3.2;

// Thin, untested three.js wrapper: black background, planet centered at the
// origin, orbit controls that let you rotate and zoom but never pan away
// from the planet. All the pure/testable logic lives elsewhere.
export function createViewer(canvas) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, ROOMY_DISTANCE);

  // The planet itself is flat-shaded (MeshBasicMaterial, unaffected by
  // lights) and so are the pole markers, so the only thing these reach is the
  // dice — and the dice stand on a sphere, pointing every way there is. Hence
  // a rig aimed relative to the camera rather than to the world: see
  // lightRig.js, which is where the whole argument for that lives.
  const lights = createLightRig(camera);
  scene.add(lights.group);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  // phones report ratios of 3 and up; past 2 the extra pixels cost real frame
  // time and buy nothing anyone can see
  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio());

  // Before the controls, and that order is load-bearing: listeners on one
  // element run in the order they were added, and the arbiter's whole job is
  // to be able to stop a press reaching the controls. Registered empty — who
  // gets first refusal on a press is the game's business, not the viewer's,
  // and `main.js` says it in one place (see `pointerArbiter.js`).
  const pointers = createPointerArbiter(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enablePan = false;
  controls.enableZoom = true;
  controls.enableRotate = true;
  controls.minDistance = 1.5;
  controls.maxDistance = 8;
  controls.update();

  /**
   * Orbiting, as something the arbiter can hand a press to — the handler of
   * last resort, since turning the planet is what a press means when nothing
   * more specific claims it.
   *
   * It does nothing until it is handed one, and then only the one thing the
   * controls cannot do for themselves: they were never told this press began,
   * because the arbiter stopped it, so they are given one where the press has
   * got to. Everything after that is theirs — they put their own listeners on
   * the document at that point and follow the drag to its end.
   *
   * The press is captured here rather than left to them for the sake of the
   * one case that can fail: a pointer that has already gone by the time the
   * hand-off happens. Failing on this line can be caught; failing inside
   * theirs would leave them tracking a drag they never finished starting.
   */
  const orbitHandler = {
    onAdopt(press) {
      try {
        // optional, because not every element that can be dragged on has it —
        // a missing method is not evidence the pointer has gone, a throw is
        renderer.domElement.setPointerCapture?.(press.id);
      } catch {
        return; // the pointer is no longer down — there is nothing to hand over
      }
      renderer.domElement.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: press.id,
          pointerType: press.pointerType,
          isPrimary: true,
          clientX: press.x,
          clientY: press.y,
          button: 0,
          buttons: 1,
          bubbles: true,
          cancelable: true,
          view: window,
        })
      );
    },
  };

  // Tracked in CSS pixels rather than read back off the canvas, because the
  // drawing buffer is pixelRatio times larger — comparing the two never
  // matches on a HiDPI screen and re-sizes the renderer on every single frame.
  let lastWidth = 0;
  let lastHeight = 0;
  let lastRatio = 0;

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const ratio = pixelRatio();
    if (width === lastWidth && height === lastHeight && ratio === lastRatio) return;
    if (width === 0 || height === 0) return;

    lastWidth = width;
    lastHeight = height;
    lastRatio = ratio;

    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  // Measured once here rather than waiting for the first frame: `camera.aspect`
  // is 1 until `resize` has run, and framing the planet is decided from the
  // aspect — on a phone that is the very number the answer turns on.
  resize();

  function render() {
    resize();
    controls.update();
    // after the controls, never before: they are what may just have moved the
    // camera, and the lights are aimed off the camera's own frame.
    lights.update();
    renderer.render(scene, camera);
  }

  return { scene, camera, renderer, controls, lights, pointers, orbitHandler, render };
}
