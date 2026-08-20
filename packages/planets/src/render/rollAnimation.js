import * as THREE from 'three';
import { dieTumble } from './diceLayer.js';
import { sampleAttack, attackDuration, DEFAULT_TIMING } from './rollTimeline.js';

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
// tumble stops.
function prepareStack(meshes, rolls, dieSize, rng) {
  return meshes.map((mesh, i) => ({
    mesh,
    restPosition: mesh.position.clone(),
    restQuaternion: mesh.quaternion.clone(),
    target: dieTumble(rolls[i] ?? 1, Math.floor(rng() * 4)),
    axis: randomAxis(rng),
    hop: dieSize * HOP_HEIGHT * (0.7 + rng() * 0.6), // dice don't all bounce equally
  }));
}

/**
 * Plays one attack: both stacks hop, tumble, and come down showing exactly
 * the faces the reducer rolled. Purely visual — it never touches game state.
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
    ...prepareStack(attackerStand.meshes, event.attackRolls, dieSize, rng),
    ...prepareStack(defenderStand.meshes, event.defendRolls, dieSize, rng),
  ];

  const tumbling = new THREE.Quaternion();
  const spinning = new THREE.Quaternion();

  return {
    duration: attackDuration(timing),

    // returns the sampled beat, so the caller can react to 'read' and 'done'
    apply(elapsed) {
      const beat = sampleAttack(elapsed, timing);

      for (const die of dice) {
        spinning.setFromAxisAngle(die.axis, beat.spin);
        tumbling.multiplyQuaternions(spinning, die.restQuaternion);
        die.mesh.quaternion.slerpQuaternions(tumbling, die.target, beat.settle);
        die.mesh.position.copy(die.restPosition);
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
