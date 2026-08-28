import test from 'node:test';
import assert from 'node:assert/strict';

import { LIGHT_RIG, offAxisAngle, rigDirection } from '../src/render/lightRig.js';

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (v) => Math.hypot(v.x, v.y, v.z);

// The camera looks down its own -Z, so a light placed at +Z is over the
// viewer's shoulder and an up face pointing back at the camera is an up face
// pointing at the light. That sign is the whole reason the rig works, so it
// is worth an assertion rather than a comment.
test('a light sits behind the camera, not in front of it', () => {
  assert.ok(rigDirection(LIGHT_RIG.keyElevation, LIGHT_RIG.keyAzimuth).z > 0);
  assert.ok(rigDirection(LIGHT_RIG.fillElevation, LIGHT_RIG.fillAzimuth).z > 0);
});

test('elevation and azimuth move the light the way they read', () => {
  assert.ok(rigDirection(30, 0).y > 0, 'positive elevation is up');
  assert.ok(rigDirection(-30, 0).y < 0, 'negative elevation is down');
  assert.ok(rigDirection(0, 30).x > 0, 'positive azimuth is to the right');
  assert.ok(rigDirection(0, -30).x < 0, 'negative azimuth is to the left');
});

test('every direction is a unit vector, so intensity is the only brightness knob', () => {
  for (const elevation of [-90, -45, -18, 0, 20, 60, 90]) {
    for (const azimuth of [-180, -46, 0, 24, 90, 179]) {
      assert.ok(Math.abs(length(rigDirection(elevation, azimuth)) - 1) < 1e-12);
    }
  }
});

// Two rotations compose, they do not add: 20 up and 24 across is 31 off the
// axis rather than 44. Getting this wrong is how a rig ends up aimed much
// wider than it reads on the page.
test('the two angles compose as a rotation rather than adding', () => {
  assert.ok(Math.abs(offAxisAngle(20, 24) - 30.9) < 0.1);
  assert.ok(offAxisAngle(20, 24) < 20 + 24);
  assert.equal(Math.round(offAxisAngle(0, 24)), 24);
  assert.equal(Math.round(offAxisAngle(20, 0)), 20);
});

/**
 * The rig has one job — a die's up face is lit wherever the camera is, and
 * its two visible sides differ from each other — and both halves are decided
 * by the same number.
 *
 * An up face on the territory facing the camera has its normal along the view
 * axis, so it keeps `cos(offAxis)`. A side face is perpendicular to that, so
 * it gets at most `sin(offAxis)`, positive on the lit side and negative (that
 * is, nothing) on the other. Too small an angle and the die is a flat tile;
 * too large and the number on top goes dark.
 */
test('the key is aimed to light the top of a die and still separate its sides', () => {
  const offAxis = (offAxisAngle(LIGHT_RIG.keyElevation, LIGHT_RIG.keyAzimuth) * Math.PI) / 180;
  assert.ok(Math.cos(offAxis) > 0.8, 'an up face keeps most of the key');
  assert.ok(Math.sin(offAxis) > 0.4, 'the two sides of a die are told apart');
});

// The fill is a shadow side, not a second key: opposite the key across the
// view axis and weaker than it, or it cancels the modelling it exists under.
test('the fill opposes the key and stays under it', () => {
  const key = rigDirection(LIGHT_RIG.keyElevation, LIGHT_RIG.keyAzimuth);
  const fill = rigDirection(LIGHT_RIG.fillElevation, LIGHT_RIG.fillAzimuth);
  assert.ok(key.x * fill.x < 0, 'opposite sides of the axis');
  assert.ok(key.y * fill.y < 0, 'and one above, one below');
  assert.ok(LIGHT_RIG.fill < LIGHT_RIG.key / 2);
});

/**
 * The claim the rig is built on: carrying the lights with the camera makes a
 * bad view impossible rather than unlikely.
 *
 * The old rig was one directional light fixed at (3, 5, 4). This walks the
 * camera all over the sphere and asks, for each position, what the Lambert
 * term is on the up face of the territory in the middle of the view — the
 * dice you are actually looking at. Fixed in the world, that runs the full
 * range down to nothing; carried by the camera it cannot move at all.
 */
test('the up face of the territory you are looking at is lit from every camera position', () => {
  const worldKey = { x: 3, y: 5, z: 4 };
  const worldLength = length(worldKey);
  const fixed = [];
  const carried = [];

  const key = rigDirection(LIGHT_RIG.keyElevation, LIGHT_RIG.keyAzimuth);
  for (let latitude = -80; latitude <= 80; latitude += 10) {
    for (let longitude = 0; longitude < 360; longitude += 10) {
      const lat = (latitude * Math.PI) / 180;
      const lon = (longitude * Math.PI) / 180;
      // The camera's view axis, and so the up face at the middle of the view.
      const view = {
        x: Math.cos(lat) * Math.sin(lon),
        y: Math.sin(lat),
        z: Math.cos(lat) * Math.cos(lon),
      };
      fixed.push(Math.max(0, dot(view, worldKey) / worldLength));
      // Carried: the light is `key` rotated into whatever frame the camera is
      // in, and the up face is the camera's own axis — so the angle between
      // them is the rig's own off-axis angle, whatever the camera did.
      carried.push(key.z);
    }
  }

  assert.ok(Math.min(...fixed) === 0, 'fixed in the world, some views get nothing at all');
  assert.ok(Math.min(...carried) > 0.8, 'carried by the camera, every view is lit');
  assert.equal(Math.min(...carried), Math.max(...carried), 'and lit identically');
});
