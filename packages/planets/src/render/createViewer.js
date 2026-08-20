import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

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
  camera.position.set(0, 0, 3.2);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enablePan = false;
  controls.enableZoom = true;
  controls.enableRotate = true;
  controls.minDistance = 1.5;
  controls.maxDistance = 8;
  controls.update();

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width === width && canvas.height === height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function render() {
    resize();
    controls.update();
    renderer.render(scene, camera);
  }

  return { scene, camera, renderer, controls, render };
}
