import * as THREE from 'three';
import { dieTumble } from './diceLayer.js';
import { scatterDice } from './diceScatter.js';
import { sampleAttack, attackDuration, firstLandingAt, DEFAULT_TIMING } from './rollTimeline.js';

const HOP_HEIGHT = 1.4; // in die widths

function randomAxis(rng) {
  // uniform-ish on the sphere; the exact distribution doesn't matter, only
  // that dice don't all tumble about the same axis
  const z = rng() * 2 - 1;
  const phi = rng() * 2 * Math.PI;
  const r = Math.sqrt(1 - z * z);
  return new THREE.Vector3(r * Math.cos(phi), r * Math.sin(phi), z);
}

// One stack's worth of dice, remembered where they were and told where they
// have to end up: `rolls[i]` is the face die `i` must be showing when the
// tumble stops, and `landing` is the patch of ground it comes down on. The
// dice leave the stack for the throw, so the whole roll is readable at once
// instead of being hidden inside a pile.
function prepareStack(stand, rolls, dieSize, rng) {
  const landings = scatterDice(stand.meshes.length, {
    dieSize,
    radius: stand.groundRadius,
    rng,
  });
  return stand.meshes.map((mesh, i) => ({
    mesh,
    restPosition: mesh.position.clone(),
    restQuaternion: mesh.quaternion.clone(),
    landing: new THREE.Vector3(landings[i].x, landings[i].y, landings[i].z),
    target: dieTumble(rolls[i] ?? 1, Math.floor(rng() * 4)),
    axis: randomAxis(rng),
    // What it tumbles about after it hits the ground. A die that struck a
    // surface and carried on turning about the very same axis would read as
    // having passed through it — the impact is the one moment the axis has
    // any reason to change, and changing it there is what makes the bounce
    // look like a bounce rather than a hover.
    bouncedAxis: randomAxis(rng),
    hop: dieSize * HOP_HEIGHT * (0.7 + rng() * 0.6), // dice don't all bounce equally
  }));
}

/**
 * Plays one attack: both stacks scatter across their own territory, tumble,
 * and come down showing exactly the faces the reducer rolled. Purely visual —
 * it never touches game state.
 * The caller ticks it with the seconds elapsed and applies the outcome when
 * `phase` reaches 'done'.
 */
export function createRollAnimation({
  attackerStand,
  defenderStand,
  event,
  dieSize,
  timing = DEFAULT_TIMING,
  rng = Math.random,
}) {
  const dice = [
    ...prepareStack(attackerStand, event.attackRolls, dieSize, rng),
    ...prepareStack(defenderStand, event.defendRolls, dieSize, rng),
  ];

  const tumbling = new THREE.Quaternion();
  const spinning = new THREE.Quaternion();
  const afterBounce = new THREE.Quaternion();

  /**
   * How far through the tumble a die is when it first hits the ground, in the
   * same radians `beat.spin` is in — fixed for the whole throw, so it is asked
   * for once rather than per die per frame.
   *
   * `null` when this throw has no bounce in it (the AI's, a replay's), which
   * is also the whole of what turns the axis change below off for them.
   */
  const bounceSpin = timing.bounce
    ? sampleAttack(timing.aim + firstLandingAt(timing) * timing.roll, timing).spin
    : null;

  return {
    duration: attackDuration(timing),

    // returns the sampled beat, so the caller can react to 'read' and 'done'
    apply(elapsed) {
      const beat = sampleAttack(elapsed, timing);

      const bounced = bounceSpin !== null && beat.spin > bounceSpin;

      for (const die of dice) {
        if (bounced) {
          // Everything turned before the impact, then the rest of it about the
          // new axis on top. Composed rather than switched, so the die's
          // *orientation* carries straight through the landing and only the
          // direction it is turning changes — the speed never breaks.
          spinning.setFromAxisAngle(die.axis, bounceSpin);
          afterBounce.setFromAxisAngle(die.bouncedAxis, beat.spin - bounceSpin);
          spinning.premultiply(afterBounce);
        } else {
          spinning.setFromAxisAngle(die.axis, beat.spin);
        }
        tumbling.multiplyQuaternions(spinning, die.restQuaternion);
        die.mesh.quaternion.slerpQuaternions(tumbling, die.target, beat.settle);
        die.mesh.position.lerpVectors(die.restPosition, die.landing, beat.travel);
        die.mesh.position.y += beat.lift * die.hop;
      }
      return beat;
    },

    // Puts every die back exactly where it started — used when an attack is
    // cut short (a restart, say) so no die is left hanging in mid-air.
    cancel() {
      for (const die of dice) {
        die.mesh.position.copy(die.restPosition);
        die.mesh.quaternion.copy(die.restQuaternion);
      }
    },
  };
}
