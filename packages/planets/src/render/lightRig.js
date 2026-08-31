import * as THREE from 'three';

/**
 * The lights, aimed relative to the camera rather than to the world.
 *
 * The planet is unlit (`MeshBasicMaterial`) and so are the pole markers, so
 * the only thing in the scene these reach is the dice — which means the whole
 * job of this module is "can you read the number on top of that stack", and
 * nothing here is a decision about the planet's colour.
 *
 * ### Why the camera and not the world
 *
 * Dice stand on a sphere, so their up faces point every way there is, while
 * the camera orbits freely. A key light fixed in the world lights *some*
 * hemisphere of dice and leaves the rest on ambient alone — and ambient does
 * not shade a normal map, so on the far side the pip dimples `diceTextures`
 * goes to such trouble over stop existing altogether.
 *
 * Carried by the camera, the angle between an up face and the light no longer
 * depends on where the camera went, so every view reads the same. The claim is
 * not that the numbers are better; it is that **there is no view left to tune
 * for**. `preview/dice.html` carries both rigs on a toggle, and CLAUDE.md the
 * measurement.
 *
 * ### What the three lights are for
 *
 * A die is a cube with a number on top, and the two readings want opposite
 * things: the up face wants the light down the view axis and keeps `cos`, the
 * two visible sides want it off to one side and get `±sin`, and nothing can
 * have both. So the key sits a little up and across — at the defaults 31° off,
 * which is 0.86 on an up face and ±0.51 on the sides, and that is the whole of
 * the modelling.
 *
 * The fill is opposite in azimuth and weak: a shadow side, not a second key.
 * Ambient is the floor and is deliberately low, since a large ambient term is
 * every surface arriving as the one term that cannot describe a shape.
 */
export const LIGHT_RIG = {
  // Flat floor, in every direction at once. Enough that an unlit face is not
  // black; not so much that it flattens what the other two are doing.
  ambient: 0.28,

  // The one that models. Angles are degrees off the view axis: elevation up,
  // azimuth to the right.
  key: 1.25,
  keyElevation: 20,
  keyAzimuth: 24,

  // Opposite side, slightly below, and weak — a die's shadow side, not a
  // second key.
  fill: 0.4,
  fillElevation: -18,
  fillAzimuth: -46,
};

const RADIANS = Math.PI / 180;

/**
 * A unit vector in the camera's own frame — +X right, +Y up, +Z *toward the
 * viewer* — at `elevation` degrees above the view axis and `azimuth` degrees
 * to the right of it.
 *
 * +Z rather than -Z because this is where a light is put, not where it
 * shines: a lamp over the viewer's shoulder sits behind them. Elevation is
 * applied first, so azimuth swings the already-raised light around the
 * camera's up axis and the two knobs stay independent of each other.
 */
export function rigDirection(elevation, azimuth) {
  const up = Math.sin(elevation * RADIANS);
  const along = Math.cos(elevation * RADIANS);
  return {
    x: along * Math.sin(azimuth * RADIANS),
    y: up,
    z: along * Math.cos(azimuth * RADIANS),
  };
}

/**
 * How far off the view axis that direction ends up, in degrees — which is the
 * number the rig is really tuned by, since it is the cosine of this that an
 * up face keeps and the sine of it that the sides get.
 *
 * Not the sum of the two angles, and not their hypotenuse either: they
 * compose as a rotation, so 20 up and 24 across is 31 off rather than 44.
 */
export function offAxisAngle(elevation, azimuth) {
  return Math.acos(rigDirection(elevation, azimuth).z) / RADIANS;
}

/**
 * The rig as three.js lights, plus the `update()` that carries them around
 * with the camera.
 *
 * A directional light's direction is `position - target`, and both targets
 * stay at the world origin, so each light's position *is* its direction.
 * Parenting the lights to the camera would look tidier and be wrong: the
 * offset would then be measured against the camera's *distance*, so the rig
 * would swing wider every time the player zoomed in.
 *
 * `set()` takes any subset of the options, so a preview can put a slider on
 * each without knowing which are angles.
 */
export function createLightRig(camera, overrides = {}) {
  const options = { ...LIGHT_RIG, ...overrides };

  const ambient = new THREE.AmbientLight(0xffffff, options.ambient);
  const key = new THREE.DirectionalLight(0xffffff, options.key);
  const fill = new THREE.DirectionalLight(0xffffff, options.fill);

  const group = new THREE.Group();
  group.add(ambient, key, fill);

  // Whether the key is carried by the camera at all. Off is the rig this
  // replaced, kept only so the preview can put the two side by side — the
  // difference is easy to describe and much easier to see.
  let cameraRelative = true;
  const WORLD_KEY = new THREE.Vector3(3, 5, 4);

  function aim(light, elevation, azimuth) {
    const { x, y, z } = rigDirection(elevation, azimuth);
    light.position.set(x, y, z).applyQuaternion(camera.quaternion).multiplyScalar(10);
  }

  function update() {
    if (!cameraRelative) {
      key.position.copy(WORLD_KEY);
      fill.position.copy(WORLD_KEY).negate();
      return;
    }
    aim(key, options.keyElevation, options.keyAzimuth);
    aim(fill, options.fillElevation, options.fillAzimuth);
  }

  update();

  return {
    group,
    options,
    get cameraRelative() {
      return cameraRelative;
    },
    set(changes) {
      Object.assign(options, changes);
      ambient.intensity = options.ambient;
      key.intensity = options.key;
      fill.intensity = options.fill;
      update();
    },
    carryWithCamera(on) {
      cameraRelative = on;
      update();
    },
    update,
  };
}
