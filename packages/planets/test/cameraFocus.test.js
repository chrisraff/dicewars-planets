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

// `onDrag` is what tells the session the player has taken the camera. It has
// to fire on the same thing that ends a swing and nothing else: a wheel says
// where you want to be, not where you want to look, and the swing already
// carries on through one.
test('a drag is reported to the session; a wheel is not', () => {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 3.2);
  const controls = new FakeControls();
  let drags = 0;
  const focus = createCameraFocus({ camera, controls, onDrag: () => drags++ });

  controls.wheel();
  assert.equal(drags, 0);

  controls.drag();
  assert.equal(drags, 1);

  focus.dispose();
  controls.drag();
  assert.equal(drags, 1, 'a disposed focus reports nothing to a match that is over');
});

// The button's press is this call, and it has to move a camera that is
// *nearly* right — which is exactly the case the handover declines.
test('a forced lookAtHoldings swings even from a view that already shows some', () => {
  const { camera, focus } = setup();
  const here = direction(camera);
  // A lone territory dead ahead and the empire itself round the side: exactly
  // the board this is for. The straggler is enough to make a handover decline.
  const away = (degrees) =>
    FRONT.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (degrees * Math.PI) / 180);
  const points = [here, away(80), away(90), away(100)].map(({ x, y, z }) => ({ x, y, z }));

  assert.equal(focus.lookAtHoldings(points), false, 'a handover leaves this view alone');
  assert.equal(focus.lookAtHoldings(points, { force: true }), true);
  play(focus);

  const landed = direction(camera);
  assert.ok(landed.angleTo(here) > 0.5, 'it went to the ground, not to the straggler');
  assert.ok(landed.angleTo(away(90)) < 0.3);
});

// Opening a saved game on the player's own turn: the camera comes back where
// it was saved, which is very often the last attack an AI made. It has to be
// corrected without a swing — there is no previous view to travel from, so an
// animation would be the planet lurching the instant it appeared.
test('an instant lookAtHoldings arrives without a swing to watch', () => {
  const { camera, focus } = setup();
  const points = [{ x: 0, y: 0, z: -1 }];

  assert.equal(focus.lookAtHoldings(points, { instant: true }), true);
  assert.equal(focus.isMoving, false, 'nothing left running to watch');
  assert.ok(direction(camera).angleTo(BACK) < 1e-9);
  assert.ok(Math.abs(camera.position.length() - 3.2) < 1e-9, 'and it kept its distance');
});

// Same rule as the handover it stands in for: a camera the player deliberately
// left on their own ground is left exactly where they left it.
test('an instant lookAtHoldings still leaves a view that already shows some alone', () => {
  const { camera, focus } = setup();
  const before = camera.position.clone();

  assert.equal(focus.lookAtHoldings([{ x: 0, y: 0, z: 1 }], { instant: true }), false);
  assert.deepEqual(camera.position.toArray(), before.toArray());
});

test('lookAtCluster leaves an already-framed run alone, same as lookAt', () => {
  const { camera, focus } = setup();
  const before = camera.position.clone();

  assert.equal(focus.lookAtCluster([FRONT]), false);
  play(focus);
  assert.deepEqual(camera.position.toArray(), before.toArray());
});

test('lookAtCluster swings to cover more than just the very next point', () => {
  const { camera, focus } = setup();
  const near = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.3).normalize();

  assert.equal(focus.lookAtCluster([BACK, near]), true);
  play(focus);

  // Landing exactly on BACK would mean `near` was ignored; landing exactly
  // on `near` would mean BACK was ignored. The cluster aim sits somewhere
  // between the two, framing both from one swing.
  const landed = direction(camera);
  assert.ok(landed.angleTo(BACK) > 1e-6);
  assert.ok(landed.angleTo(near) > 1e-6);
});

test('currentView reports where the camera is actually looking', () => {
  const { camera, focus } = setup();
  const view = focus.currentView();

  assert.ok(Math.abs(view.distance - 3.2) < 1e-9);
  assert.ok(direction(camera).angleTo(new THREE.Vector3(view.direction.x, view.direction.y, view.direction.z)) < 1e-9);
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
