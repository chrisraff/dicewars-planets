import * as THREE from 'three';
import { dicePosition } from './diceLayer.js';
import { stackColumnCount, MAX_DICE_PER_STACK } from './diceStacks.js';
import { dieStart, DEFAULT_REINFORCE_TIMING } from './reinforceTimeline.js';

const FALL_HEIGHT = 3; // die widths above its landing spot when it starts falling

// Where die number `sequence` (0-based, counting only the dice this payout
// adds to `stand`) comes to rest — its approximate final stacked slot. It only
// has to hold up for the instant before the real rebuild replaces it, so the
// rare case where a later die starts a new column and shifts the ones already
// down is not worth chasing.
function landingSlot(stand, sequence, dieSize) {
  const count = stand.dice + sequence + 1;
  const columns = stackColumnCount(count);
  const column = Math.floor((count - 1) / MAX_DICE_PER_STACK);
  const level = (count - 1) % MAX_DICE_PER_STACK;
  return dicePosition(column, level, columns, dieSize);
}

/**
 * Plays the end-of-turn payout: one die per entry in `landed`, dropping onto
 * the top of its territory's stack. Purely visual, like createRollAnimation —
 * the caller applies the real state once every die has landed, and the
 * instant restack that follows (`dice.update`) is what actually leaves the
 * pile tidy; this only covers the moment just before it.
 */
export function createReinforceAnimation({ landed, dice, materials, timing = DEFAULT_REINFORCE_TIMING }) {
  const placedSoFar = new Map(); // territoryId -> how many this payout has already dropped there

  const drops = landed.map((territoryId, index) => {
    const stand = dice.standFor(territoryId);
    const sequence = placedSoFar.get(territoryId) ?? 0;
    placedSoFar.set(territoryId, sequence + 1);

    const end = landingSlot(stand, sequence, dice.dieSize);
    const start = end.clone();
    start.y += dice.dieSize * FALL_HEIGHT;

    const mesh = new THREE.Mesh(dice.geometry, materials);
    mesh.position.copy(start);
    mesh.visible = false;
    stand.object.add(mesh);

    return {
      mesh,
      start,
      end,
      startTime: dieStart(index, landed.length, timing),
    };
  });

  return {
    // Every die but the ones still waiting their turn is hidden until its own
    // start time, so a payout of many dice reads as a quick, staggered
    // sequence rather than the whole pile popping in at once. Returns how
    // many dice have started falling so far — `drops` is already in start
    // order, so that is just how far down the list `elapsed` has reached —
    // which is what lets the caller keep some other cue (the HUD tray) in
    // step with the drops as they happen, rather than re-deriving the timing.
    apply(elapsed) {
      let started = 0;
      for (const drop of drops) {
        const t = elapsed - drop.startTime;
        if (t < 0) {
          drop.mesh.visible = false;
          continue;
        }
        started++;
        drop.mesh.visible = true;
        const p = Math.min(1, t / timing.fall);
        const fall = p * p; // eases in, like gravity
        drop.mesh.position.lerpVectors(drop.start, drop.end, fall);
      }
      return started;
    },
  };
}
