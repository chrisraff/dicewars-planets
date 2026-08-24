import * as THREE from 'three';
import { DIE_SIZE, stackHalfWidth } from './diceLayer.js';
import { MAX_DICE_PER_STACK } from './diceStacks.js';

/**
 * A marker at each pole, so there is something fixed to read the planet's
 * orientation against.
 *
 * It is a thin cone standing on the pole, narrow at the surface and tapering
 * to a point out in space — lit like fog in glass rather than drawn as a
 * solid, because a solid spike at the pole is a landmark competing with the
 * board, and this is only ever meant to be a reference.
 *
 * Three things make the look, and none of them costs anything: the whole
 * effect is two draw calls of a 24-sided cone, unlit.
 *
 * - **Additive, and never writing depth.** Additive blending is what reads as
 *   light rather than as paint: it can only brighten what is behind it, so it
 *   has no surface of its own for a highlight to sit on. Not writing depth is
 *   what lets both walls of the same cone contribute, which is where any
 *   sense of volume comes from.
 * - **A rim term.** Alpha rises toward the silhouette and falls away
 *   face-on, which is what makes a thin shell read as glass. On a cone this
 *   already leans the way we want: looking down the axis every wall is
 *   edge-on and the whole thing lights up, while side-on only its outline
 *   does.
 * - **An axis term** on top of that — see `axisFalloff` below, which is the
 *   part with two knobs on it and is worth reading before turning either.
 *
 * ### Standing it on the ground
 *
 * It rests on the surface, because a marker floating above the pole reads as
 * an object rather than as part of the planet. The one thing in its way is a
 * dice tower at the pole: depth testing handles a tower *in front* correctly
 * on its own, but a tower *intersecting* the cone is the ugly case — a hard
 * line cut across a soft volume, the classic artifact — and fixing that
 * properly means sampling the depth buffer to fade the volume out as it nears
 * whatever is behind it, which is a lot of machinery for a small reference.
 *
 * So the cone steps out of the way instead: `settle` lifts its base to the top
 * of a tower that is genuinely in the way, and stands it back on the ground
 * the moment that tower is gone.
 *
 * "Genuinely" is worth being exact about, because the marker belongs on the
 * ground and every lift is a small lie. The test is a footprint overlap and
 * nothing more: a stack collides if its half-width plus the cone's base radius
 * covers the angle between them. Height does not come into it — the cone is
 * widest at its base, so a stack whose footprint overlaps has its *bottom* die
 * inside the widest part whatever the stack's height, and one whose footprint
 * clears it is clear all the way up, where the cone is narrower still. Stack
 * height only decides how far to lift, never whether to.
 *
 * Measured over 800 poles: with the base radius at `radiusInDice` and this
 * test, a pole is lifted about 2% of the time for a short tower and 4% for a
 * full-width one. An earlier version guessed the reach at a couple of dice
 * either side and lifted 17% of the time — one pole in six standing off the
 * ground for no reason anyone could see.
 */
export const POLE_MARKER = {
  // Sized in dice rather than in radii, because what it has to clear is dice.
  heightInDice: 5,
  // The narrow base, also in dice. Deliberately slimmer than a die is wide:
  // a wider base is a wider footprint, and a wider footprint is a marker
  // lifted off the ground more often for no visible reason.
  radiusInDice: 0.8,
  // How far the base sinks into whatever it stands on, so there is never a
  // hairline gap between the cone and the ground or the die under it.
  sinkInDice: 0.5,
  segments: 24,
  color: 0x9fd8ff,
  strength: 0.55,
  /** What is left of it when the pole is exactly edge-on. See `axisFalloff`. */
  sideOn: 0.16,
  /** How the fade between edge-on and head-on is shaped. See `axisFalloff`. */
  axisPower: 1,
  taper: 1.6, // how fast it thins away toward the point
  body: 0.28, // fog inside the glass: 0 is a bare shell, 1 is evenly filled
  foot: 0.18, // fraction of the cone faded in at the bottom, so it has no rim
};

/**
 * How much of its strength the marker keeps, given `align` — the cosine of
 * the angle between the pole's axis and the direction you are looking from.
 * 1 is straight down the pole, 0 is exactly edge-on.
 *
 * The two knobs do genuinely separate jobs, which is worth being clear about
 * because they are easy to confuse when tuning by eye:
 *
 * - **`sideOn` is the floor.** It is the value at exactly edge-on, and
 *   `axisPower` cannot change it. If edge-on is too faint or too loud, this
 *   is the only knob that matters.
 * - **`axisPower` is the shape of the ramp between that floor and full.** It
 *   moves how quickly you leave the floor as the pole swings toward you, and
 *   never where the floor is.
 *
 * At `axisPower: 1` the ramp is linear *in `align`* — but `align` is a
 * cosine, so it is not linear in the angle you are actually turning through.
 * Cosine is flat near zero, so at 1 the marker holds nearly full strength
 * across a wide cap over the pole (30° off is still 0.87) and then falls away
 * quickly toward the limb. Above 1 pushes the whole ramp down, so it stays
 * near the floor over most of the sphere and only comes up in a tight cone
 * right over the pole. Below 1 does the opposite: up quickly, bright over
 * most of the planet.
 *
 * Mirrors the `axis` line of the fragment shader, deliberately kept next to
 * it: one expression, in two languages, so the preview can print the curve as
 * numbers instead of leaving it to be guessed at from a moving picture.
 */
export function axisFalloff(align, { sideOn, axisPower } = POLE_MARKER) {
  const a = Math.min(1, Math.abs(align));
  return sideOn + (1 - sideOn) * a ** axisPower;
}

/**
 * How close a dice tower has to be, in radians from the pole, before it is in
 * the marker's way — its own half-width plus the cone's base radius.
 *
 * The stack's *height* is deliberately absent. The cone is widest at its base,
 * so a stack whose footprint overlaps has its bottom die inside the widest
 * part however tall it is, and one whose footprint clears it stays clear all
 * the way up, where the cone is narrower still. Height only ever decides how
 * far to lift, never whether to. What does change the answer is how many
 * columns the stack is in: five dice start a second column and reach further
 * sideways than four do.
 */
export function blockingAngle(diceCount, { radiusInDice } = POLE_MARKER, dieSize = DIE_SIZE) {
  return dieSize * radiusInDice + stackHalfWidth(diceCount, dieSize);
}

const VERTEX = /* glsl */ `
  uniform float uHeight;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying vec3 vAxisW;
  varying float vH;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    // The mesh is only ever placed and turned, never scaled, so the upper 3x3
    // is a pure rotation and the normals need no inverse transpose.
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vAxisW = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
    vViewW = cameraPosition - world.xyz;
    vH = clamp(position.y / uHeight, 0.0, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  uniform float uSideOn;
  uniform float uAxisPower;
  uniform float uTaper;
  uniform float uBody;
  uniform float uFoot;

  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying vec3 vAxisW;
  varying float vH;

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(vViewW);

    // Bright along the silhouette, clear face-on — glass, not paint. The abs
    // is because the cone draws double-sided and a back wall's normal points
    // away; which side of the shell this is should not change how it reads.
    float rim = pow(1.0 - abs(dot(N, V)), 1.6);
    float shell = mix(uBody, 1.0, rim);

    // Up the spike: in from nothing at the base so it has no rim sitting on
    // the ground, then away to nothing at the point so there is no cap.
    float foot = smoothstep(0.0, uFoot, vH);
    float taper = pow(1.0 - vH, uTaper);

    // And over the whole thing. The JS twin of this line is axisFalloff() --
    // no backticks in here: this is inside a template literal.
    float align = abs(dot(normalize(vAxisW), V));
    float axis = mix(uSideOn, 1.0, pow(align, uAxisPower));

    gl_FragColor = vec4(uColor, uStrength * axis * foot * taper * shell);
  }
`;

/**
 * `stands` is `{ id, normal }` per territory — enough to work out which few
 * territories sit near enough to a pole for their dice to be in the way.
 * Passed in rather than recomputed because the dice layer has already done
 * exactly this work.
 */
export function createPoleMarkers({ dieSize = DIE_SIZE, stands = [], ...overrides } = {}) {
  const options = { ...POLE_MARKER, ...overrides };
  const group = new THREE.Group();

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uHeight: { value: 1 },
      uColor: { value: new THREE.Color(options.color) },
      uStrength: { value: options.strength },
      uSideOn: { value: options.sideOn },
      uAxisPower: { value: options.axisPower },
      uTaper: { value: options.taper },
      uBody: { value: options.body },
      uFoot: { value: options.foot },
    },
    transparent: true,
    // Light rather than paint — it can only brighten what is behind it, which
    // is exactly why it never looks like it has a reflection.
    blending: THREE.AdditiveBlending,
    // Both walls contribute, and nothing drawn later is occluded by it. It is
    // still depth *tested*, so the planet hides the far pole's marker and a
    // dice tower in front of this one hides the part behind it.
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  let geometry = null;
  // One entry per pole: which way it points, its mesh, and the few territories
  // whose dice could stand in its way.
  // `levels` is how many dice high the tower under this pole currently is, so
  // that rebuilding the cone (a slider in the preview) puts it back on top of
  // that tower rather than dropping it into the dice.
  const poles = [1, -1].map((sign) => ({ sign, mesh: null, near: [], levels: 0 }));

  const heightOf = () => dieSize * options.heightInDice;
  const radiusOf = () => dieSize * options.radiusInDice;
  const sinkOf = () => dieSize * options.sinkInDice;

  /**
   * The few territories near enough a pole to be worth testing at all, with
   * the angle from the pole to each — so `settle` only has to compare a
   * number, not walk the planet. Cut at the widest a stack can ever be, so
   * nothing that could collide is missed; the exact test happens per stack,
   * where the dice count is known.
   */
  function nearPole(sign) {
    const widest = blockingAngle(MAX_DICE_PER_STACK * 2, options, dieSize);
    return stands
      .filter((stand) => stand?.normal)
      .map((stand) => ({
        id: stand.id,
        angle: Math.acos(Math.min(1, Math.max(-1, stand.normal.y * sign))),
      }))
      .filter((near) => near.angle < widest);
  }

  // Stands one cone on whatever is under it: the ground, or the top of the
  // tower it last settled onto.
  function place(pole) {
    const top = dieSize * pole.levels;
    pole.mesh.position.set(0, pole.sign * (1 + top - sinkOf()), 0);
  }

  function build() {
    const previous = geometry;
    const height = heightOf();
    // Open-ended: a capped base would put a hard disc flat on the surface,
    // which is the one shape this is trying not to be.
    geometry = new THREE.ConeGeometry(radiusOf(), height, options.segments, 1, true);
    geometry.translate(0, height / 2, 0); // stand it on its base

    for (const pole of poles) {
      if (!pole.mesh) {
        pole.mesh = new THREE.Mesh(geometry, material);
        // orientEquator always puts the poles on ±Y
        if (pole.sign < 0) pole.mesh.rotation.x = Math.PI; // point away, not through
        group.add(pole.mesh);
      } else {
        pole.mesh.geometry = geometry;
      }
      pole.near = nearPole(pole.sign);
      place(pole);
    }
    previous?.dispose();
    material.uniforms.uHeight.value = height;
  }

  build();

  return {
    group,
    options,

    /**
     * Stands each cone on whatever is actually under it: the ground, or the
     * top of the tallest dice tower near that pole. Cheap enough for every
     * board change — a couple of map lookups per pole and one vector write.
     */
    settle(state) {
      for (const pole of poles) {
        pole.levels = 0;
        for (const { id, angle } of pole.near) {
          const dice = state.nodes.get(id)?.dice ?? 0;
          if (dice <= 0 || angle >= blockingAngle(dice, options, dieSize)) continue;
          pole.levels = Math.max(pole.levels, Math.min(MAX_DICE_PER_STACK, dice));
        }
        place(pole);
      }
    },

    /** Retunes the look, rebuilding only if the shape itself changed. */
    set(next) {
      const reshaped = ['heightInDice', 'radiusInDice', 'segments', 'sinkInDice'].some(
        (key) => next[key] !== undefined && next[key] !== options[key]
      );
      Object.assign(options, next);
      if (reshaped) build();

      material.uniforms.uColor.value.set(options.color);
      material.uniforms.uStrength.value = options.strength;
      material.uniforms.uSideOn.value = options.sideOn;
      material.uniforms.uAxisPower.value = options.axisPower;
      material.uniforms.uTaper.value = options.taper;
      material.uniforms.uBody.value = options.body;
      material.uniforms.uFoot.value = options.foot;
    },

    dispose() {
      geometry?.dispose();
      material.dispose();
      group.clear();
      for (const pole of poles) pole.mesh = null;
    },
  };
}
