import * as THREE from 'three';
import { dicePosition, dieTumble } from './diceLayer.js';
import { stackColumnCount, MAX_DICE_PER_STACK } from './diceStacks.js';
import { dieStart, DEFAULT_REINFORCE_TIMING } from './reinforceTimeline.js';

const FALL_HEIGHT = 3; // die widths above its landing spot when it starts falling

// Where die number `sequence` (0-based, counting only the dice this payout
// adds to `stand`) comes to rest.
//
// Deliberately the pile as it stands *now* rather than as the payout will
// leave it: a die should land square on the stack it can be seen joining. The
// rare case where a later die starts a second column, and the rebuild then
// shifts the whole pile sideways to centre it, is not worth chasing — it only
// has to hold up for the instant before the rebuild. Which way up the die
// lands is a different question, and that one *is* taken from the final
// layout; see below.
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
 *
 * A die lands the way it will be left standing, rather than being stood up
 * afterwards. The layout the rebuild is going to use is asked for up front
 * (`dice.planFor`) and the falling die takes its own slot out of it.
 *
 * It is the *final* layout, not how the pile looks mid-payout. For the usual
 * case — one die onto a territory — those are the same thing. When several
 * land on one territory, the ones that end up buried take the face they will
 * be left with rather than briefly showing the running count, which is a face
 * nobody sees anyway: the next die of the same payout lands on top of it.
 */
export function createReinforceAnimation({
  landed,
  dice,
  materials,
  timing = DEFAULT_REINFORCE_TIMING,
}) {
  // What each territory will hold once the whole payout is down, so the
  // layout asked for is the one the rebuild will actually be handed.
  const finalCount = new Map();
  for (const territoryId of landed) {
    const stand = dice.standFor(territoryId);
    finalCount.set(territoryId, (finalCount.get(territoryId) ?? stand.dice) + 1);
  }
  const plans = new Map(
    [...finalCount].map(([territoryId, count]) => [territoryId, dice.planFor(territoryId, count)])
  );

  const placedSoFar = new Map(); // territoryId -> how many this payout has already dropped there

  const drops = landed.map((territoryId, index) => {
    const stand = dice.standFor(territoryId);
    const sequence = placedSoFar.get(territoryId) ?? 0;
    placedSoFar.set(territoryId, sequence + 1);

    const end = landingSlot(stand, sequence, dice.dieSize);
    const start = end.clone();
    start.y += dice.dieSize * FALL_HEIGHT;

    // Its own slot in the layout the rebuild will use, so the die that
    // replaces this one a moment later is standing exactly as this one landed.
    const slot = plans.get(territoryId)[stand.dice + sequence];
    const mesh = new THREE.Mesh(dice.geometry, materials);
    if (slot) mesh.quaternion.copy(dieTumble(slot.pipUp, slot.spin));
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
