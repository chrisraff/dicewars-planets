import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

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

  // The planet itself is flat-shaded (MeshBasicMaterial, unaffected by
  // lights) — these exist only so lit objects like the dice show their
  // shape (bevels need light to catch an edge to be visible at all).
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
  keyLight.position.set(3, 5, 4);
  scene.add(keyLight);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, ROOMY_DISTANCE);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  // phones report ratios of 3 and up; past 2 the extra pixels cost real frame
  // time and buy nothing anyone can see
  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio());

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enablePan = false;
  controls.enableZoom = true;
  controls.enableRotate = true;
  controls.minDistance = 1.5;
  controls.maxDistance = 8;
  controls.update();

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
    renderer.render(scene, camera);
  }

  return { scene, camera, renderer, controls, render };
}
