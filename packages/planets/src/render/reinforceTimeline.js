// Timing for the end-of-turn payout: each die's own short fall onto its
// stack, and how much sooner the next one starts than the last needs to land.
// Deliberately overlapping — `stagger` well under `fall` — because a dozen
// dice landing one after another, waited out end to end, would make ending a
// turn feel slower than the turn itself.
export const DEFAULT_REINFORCE_TIMING = {
  fall: 0.22, // one die's own drop, in seconds
  stagger: 0.06, // how much later than the previous die each one starts
};

// However many dice a payout carries, the whole thing is capped here — a
// backlog of banked dice suddenly finding room should still read as quick,
// not as a queue proportional to how long it had been building up.
const MAX_SPAN = 1.0; // seconds, start-to-start across every die but the first

function effectiveStagger(count, timing) {
  if (count <= 1) return timing.stagger;
  return Math.min(timing.stagger, MAX_SPAN / (count - 1));
}

/** When die `index` (0-based) starts, in seconds from the start of the payout. */
export function dieStart(index, count, timing = DEFAULT_REINFORCE_TIMING) {
  return effectiveStagger(count, timing) * index;
}

export function reinforceDuration(count, timing = DEFAULT_REINFORCE_TIMING) {
  if (count <= 0) return 0;
  return dieStart(count - 1, count, timing) + timing.fall;
}

// The longest a payout can ever take, whatever the count — the cap above plus
// one die's own fall. A caller that has to budget for the worst case without
// knowing the count yet reaches for this instead of re-deriving it.
export const MAX_REINFORCE_DURATION = MAX_SPAN + DEFAULT_REINFORCE_TIMING.fall;
