import { UNOWNED_COLOR, OCEAN_COLOR, mix } from './palette.js';

// Builds a `cellId -> [r, g, b]` lookup for the current game state: land
// cells inherit the color of whichever player owns their territory; cells
// with no territory at all (not in `cellTerritory`) are ocean.
//
// `tintFor(territoryId)` returns `{ color, amount }` for a territory that's
// currently called out — picked up, targetable, or in a fight — or null for
// the usual case of showing its owner's plain color.
export function makeCellColorer(world, state, playerColors, tintFor = () => null) {
  return (cellId) => {
    const territoryId = world.cellTerritory.get(cellId);
    if (territoryId === undefined) return OCEAN_COLOR;
    const node = state.nodes.get(territoryId);
    if (!node) return UNOWNED_COLOR;

    const base = playerColors.get(node.owner) ?? UNOWNED_COLOR;
    const tint = tintFor(territoryId);
    return tint ? mix(base, tint.color, tint.amount) : base;
  };
}
