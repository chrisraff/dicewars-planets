// Local-space normal of each pip face, matching the material order that
// createDiePipMaterials() hands to the box geometry (+X, -X, +Y, -Y, +Z, -Z
// carrying 1, 6, 2, 5, 3, 4).
export const PIP_FACE_NORMALS = {
  1: { x: 1, y: 0, z: 0 },
  2: { x: 0, y: 1, z: 0 },
  3: { x: 0, y: 0, z: 1 },
  4: { x: 0, y: 0, z: -1 },
  5: { x: 0, y: -1, z: 0 },
  6: { x: -1, y: 0, z: 0 },
};

// As in the original Dice Wars: dice pile up four high, then start a new
// column alongside — so eight dice read as two stacks of four.
export const MAX_DICE_PER_STACK = 4;

// Splits `diceCount` dice into stacks and picks each die's resting
// orientation, as plain data: `column` (0-based, left to right), `level`
// (0 at the bottom), `pipUp` (which numbered face points away from the
// planet) and `spin` (quarter turns about that face, 0-3).
//
// Every die tumbles freely except the one on top of each column, which is
// laid so its up face shows how many dice that column holds — so the stack
// tops still add up to the territory's dice count at a glance.
export function planDiceStacks(diceCount, rng = Math.random) {
  const quarterTurn = () => Math.floor(rng() * 4) % 4;
  const anyFace = () => 1 + (Math.floor(rng() * 6) % 6);

  const placements = [];
  for (let placed = 0; placed < diceCount; placed += MAX_DICE_PER_STACK) {
    const height = Math.min(MAX_DICE_PER_STACK, diceCount - placed);
    const column = placed / MAX_DICE_PER_STACK;
    for (let level = 0; level < height; level++) {
      const onTop = level === height - 1;
      placements.push({
        column,
        level,
        pipUp: onTop ? height : anyFace(),
        spin: quarterTurn(),
      });
    }
  }
  return placements;
}

export function stackColumnCount(diceCount) {
  return Math.ceil(diceCount / MAX_DICE_PER_STACK);
}
