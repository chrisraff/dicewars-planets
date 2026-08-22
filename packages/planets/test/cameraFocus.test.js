import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCameraFocus } from '../src/render/cameraFocus.js';

// OrbitControls needs a DOM element, and nothing here needs its input
// handling — only the two things `cameraFocus` actually touches: a target to
// orbit, and the `start` it fires the moment the player grabs the planet.
class FakeControls extends THREE.EventDispatcher {
  constructor() {
    super();
    this.target = new THREE.Vector3();
    this.updates = 0;
    this.state = -1; // STATE.NONE — nobody has hold of the planet
  }
  // What OrbitControls does on a drag: a state, then the event.
  drag() {
    this.state = 0; // STATE.ROTATE
    this.dispatchEvent({ type: 'start' });
  }
  // ...and on the wheel, which fires the same event from a standing start.
  wheel() {
    this.dispatchEvent({ type: 'start' });
  }
  update() {
    this.updates++;
  }
}

function setup() {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 3.2);
  const controls = new FakeControls();
  return { camera, controls, focus: createCameraFocus({ camera, controls }) };
}

// Runs a swing to its end, a frame at a time.
function play(focus, seconds = 1, dt = 1 / 60) {
  for (let t = 0; t < seconds; t += dt) focus.tick(dt);
}

const direction = (camera) => camera.position.clone().normalize();
const FRONT = new THREE.Vector3(0, 0, 1);
const BACK = new THREE.Vector3(0, 0, -1);

test('a fight already in view is left where it is', () => {
  const { camera, focus } = setup();
  const before = camera.position.clone();

  assert.equal(focus.lookAt(FRONT), false);
  assert.equal(focus.isSwinging, false);
  play(focus);
  assert.deepEqual(camera.position.toArray(), before.toArray());
});

test('a fight round the back brings the camera over to it', () => {
  const { camera, controls, focus } = setup();

  assert.equal(focus.lookAt(BACK), true);
  play(focus);

  assert.ok(direction(camera).angleTo(BACK) < 1e-6, 'ends looking straight at it');
  assert.equal(focus.isSwinging, false);
  assert.ok(controls.updates > 0, 'and tells the controls, so the next drag carries on from here');
});

test('the swing orbits — it never changes how far out the camera is', () => {
  const { camera, focus } = setup();
  focus.lookAt(BACK);

  for (let i = 0; i < 60; i++) {
    focus.tick(1 / 60);
    assert.ok(Math.abs(camera.position.length() - 3.2) < 1e-9, 'still 3.2 out');
  }
});

test('zooming during a swing sticks, and does not call the swing off', () => {
  const { camera, controls, focus } = setup();
  focus.lookAt(BACK);
  play(focus, 0.2);

  // A wheel zoom is not a disagreement about where to look, so the camera
  // finishes its turn — at the distance the player just chose.
  controls.wheel();
  camera.position.setLength(2);
  assert.equal(focus.isSwinging, true);
  play(focus);

  assert.ok(Math.abs(camera.position.length() - 2) < 1e-9, 'the swing did not undo the zoom');
  assert.ok(direction(camera).angleTo(BACK) < 1e-6);
});

test('touching the planet ends the swing on the spot', () => {
  const { camera, controls, focus } = setup();
  focus.lookAt(BACK);
  play(focus, 0.2);

  const grabbed = camera.position.clone();
  controls.drag(); // the player takes hold of the planet

  assert.equal(focus.isSwinging, false);
  play(focus);
  assert.deepEqual(camera.position.toArray(), grabbed.toArray(), 'the camera stopped fighting back');
});

test('a disposed focus stops steering, so an old match cannot drive the next one', () => {
  const { camera, focus } = setup();
  focus.lookAt(BACK);
  play(focus, 0.2);

  const abandoned = camera.position.clone();
  focus.dispose();
  play(focus);

  assert.equal(focus.isSwinging, false);
  assert.deepEqual(camera.position.toArray(), abandoned.toArray());
});
