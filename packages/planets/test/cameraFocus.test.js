import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCameraFocus } from '../src/render/cameraFocus.js';

// OrbitControls needs a DOM element, and nothing here needs its input
// handling — only the three things `cameraFocus` actually touches: a target to
// orbit, the `start` it fires the moment a gesture begins, and the `change` it
// fires whenever the camera has moved.
//
// Every gesture below moves the camera and *then* announces it, because that
// is the order the real controls do it in and the order the rule reads: what
// separates a drag from a zoom here is what happened to the camera, not which
// gesture the controls think they are in.
class FakeControls extends THREE.EventDispatcher {
  constructor(camera) {
    super();
    this.camera = camera;
    this.target = new THREE.Vector3();
    this.updates = 0;
  }
  moved() {
    this.dispatchEvent({ type: 'change' });
  }
  // The planet turning under a hand that is already down.
  turn(radians = 0.2) {
    this.camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), radians);
    this.moved();
  }
  // A drag: a hand going down, and the planet turning under it.
  drag(radians = 0.2) {
    this.dispatchEvent({ type: 'start' });
    this.turn(radians);
  }
  // The wheel, which fires the same events from a standing start and only ever
  // changes how far out the camera is.
  wheel(distance = 2) {
    this.dispatchEvent({ type: 'start' });
    this.camera.position.setLength(distance);
    this.moved();
  }
  // A pinch. OrbitControls sees a one-finger rotate for the moment before the
  // second finger lands, so it announces two gestures for one — and neither of
  // them turns the planet.
  pinch(distance = 2) {
    this.dispatchEvent({ type: 'start' });
    this.dispatchEvent({ type: 'start' });
    this.camera.position.setLength(distance);
    this.moved();
  }
  update() {
    this.updates++;
  }
}

function setup() {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 3.2);
  const controls = new FakeControls(camera);
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

// A zoom of any kind is not a disagreement about where to look, so the camera
// finishes its turn — at the distance the player just chose. The pinch is the
// case this was got wrong for: it says exactly what the wheel says, through
// the one gesture OrbitControls briefly calls a rotate.
for (const gesture of ['wheel', 'pinch']) {
  test(`zooming with the ${gesture} during a swing sticks, and does not call it off`, () => {
    const { camera, controls, focus } = setup();
    focus.lookAt(BACK);
    play(focus, 0.2);

    controls[gesture](2);
    assert.equal(focus.isSwinging, true);
    play(focus);

    assert.ok(Math.abs(camera.position.length() - 2) < 1e-9, 'the swing did not undo the zoom');
    assert.ok(direction(camera).angleTo(BACK) < 1e-6);
  });
}

test('turning the planet ends the swing on the spot', () => {
  const { camera, controls, focus } = setup();
  focus.lookAt(BACK);
  play(focus, 0.2);

  controls.drag(); // the player takes hold of the planet and turns it
  const grabbed = camera.position.clone();

  assert.equal(focus.isSwinging, false);
  play(focus);
  assert.deepEqual(camera.position.toArray(), grabbed.toArray(), 'the camera stopped fighting back');
});

// `onDrag` is what tells the session the player has taken the camera. It has
// to fire on the same thing that ends a swing and nothing else: a zoom says
// where you want to be, not where you want to look, and the swing already
// carries on through one.
test('turning the planet is reported to the session; zooming is not', () => {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 3.2);
  const controls = new FakeControls(camera);
  let drags = 0;
  const focus = createCameraFocus({ camera, controls, onDrag: () => drags++ });

  controls.wheel(2);
  assert.equal(drags, 0);

  // The one this was wrong for. A pinch announces a rotate it never performs,
  // so a camera reading the gesture rather than the movement was handed to a
  // player who had asked to see the planet closer and nothing more.
  controls.pinch(2.5);
  assert.equal(drags, 0, 'a pinch is a zoom, whatever OrbitControls calls it');

  controls.drag();
  assert.equal(drags, 1);

  controls.turn(); // the same hand, still turning
  assert.equal(drags, 1, 'reported once for the hand, not once a frame');

  focus.dispose();
  controls.drag();
  assert.equal(drags, 1, 'a disposed focus reports nothing to a match that is over');
});

// The camera moving itself is not a hand on the planet, and the controls
// announce the two the same way — a swing is a `change` a frame.
test('the camera swinging of its own accord is not reported as a drag', () => {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 3.2);
  const controls = new FakeControls(camera);
  let drags = 0;
  const focus = createCameraFocus({ camera, controls, onDrag: () => drags++ });

  focus.lookAt(BACK);
  play(focus);

  assert.ok(direction(camera).angleTo(BACK) < 1e-6, 'it turned the whole way round');
  assert.equal(drags, 0);
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
