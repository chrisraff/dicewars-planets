// Where the dice of one stack come to rest once they have been thrown.
//
// A die that has finished tumbling is always yawed by a whole number of
// quarter turns (see `dieTumble`), so its footprint on the ground is an
// axis-aligned square. Two of those clear each other the moment they are a
// full die apart in x *or* in z — a good deal more forgiving than holding
// their circumscribed circles apart, and the reason eight dice fit on a
// territory at all. Every rule below is stated in that Chebyshev distance.
//
// Positions come back in the stand's local frame, the same one `dicePosition`
// uses: +Y is the sky, and the ground is the plane the stack sits on.

// Slot spacing, in die widths. Dice loosely thrown when the territory has
// room to spare; shoulder to shoulder when it does not.
const MAX_PITCH = 1.7;
const MIN_PITCH = 1.02;

// Times the pile is re-picked around its own middle. Taking the slots nearest
// the origin and stopping there leaves a lopsided pile whenever the count
// doesn't fill a ring — four dice come out as a T rather than a square.
const ROUNDING_PASSES = 3;

// Half a die's diagonal, which is how far a corner can reach from its center
// whichever quarter turn the die landed on.
const CORNER_REACH = Math.SQRT1_2;

/**
 * `count` slots on a brick-laid lattice, in pitch units, taken nearest-first
 * from the middle and then recentered on their own middle — so the pile sits
 * over the point it was thrown at rather than beside it.
 *
 * Rows are offset half a step from each other because a plain square grid
 * reads as a grid; offsetting costs nothing, since two dice in neighbouring
 * rows are still a whole pitch apart in z.
 */
export function scatterSlots(count) {
  if (count <= 0) return [];
  const reach = Math.ceil(Math.sqrt(count)) + 1;

  const lattice = [];
  for (let row = -reach; row <= reach; row++) {
    const offset = row % 2 === 0 ? 0 : 0.5;
    for (let column = -reach; column <= reach; column++) {
      lattice.push({ x: column + offset, z: row });
    }
  }

  let middle = { x: 0, z: 0 };
  let chosen = [];
  for (let pass = 0; pass < ROUNDING_PASSES; pass++) {
    const from = (slot) => (slot.x - middle.x) ** 2 + (slot.z - middle.z) ** 2;
    chosen = lattice
      .slice()
      .sort((a, b) => from(a) - from(b) || a.z - b.z || a.x - b.x)
      .slice(0, count);
    middle = chosen.reduce(
      (sum, slot) => ({ x: sum.x + slot.x / count, z: sum.z + slot.z / count }),
      { x: 0, z: 0 }
    );
  }
  return chosen.map((slot) => ({ x: slot.x - middle.x, z: slot.z - middle.z }));
}

/**
 * Landing spots for `count` dice thrown onto a disc of `radius` around the
 * stand's origin.
 *
 * No two dice ever overlap: the lattice keeps them a pitch apart and the
 * jitter is capped at exactly the slack that pitch leaves, so the worst any
 * pair can do is touch. `radius` is honored where it can be — the pitch
 * shrinks until the pile fits — but a cramped territory with eight dice on it
 * runs out of ground before it runs out of dice, and at that point the pile
 * overhangs the border rather than the dice landing inside one another.
 */
export function scatterDice(count, { dieSize, radius = Infinity, rng = Math.random }) {
  const slots = scatterSlots(count);

  // The furthest a die can end up from the middle is its slot, plus the
  // jitter, plus the corner it reaches out with — and jitter is itself a
  // fraction of the pitch, so all three scale together. Written out, the die
  // widths cancel and what is left is the pitch at which the outermost corner
  // lands exactly on the rim.
  const spread = Math.max(...slots.map((s) => Math.hypot(s.x, s.z)), 0);
  const pitch = Math.max(
    MIN_PITCH * dieSize,
    Math.min(MAX_PITCH * dieSize, radius / (spread + CORNER_REACH))
  );
  const jitter = (pitch - dieSize) / 2;

  const landings = slots.map((slot) => ({
    x: slot.x * pitch + (rng() * 2 - 1) * jitter,
    y: dieSize / 2,
    z: slot.z * pitch + (rng() * 2 - 1) * jitter,
  }));

  // Deal the slots out in a different order each throw, so the same stack of
  // five doesn't drop into the same five places every time it attacks.
  for (let i = landings.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [landings[i], landings[j]] = [landings[j], landings[i]];
  }
  return landings;
}
