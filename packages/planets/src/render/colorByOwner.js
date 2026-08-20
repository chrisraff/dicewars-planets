import { UNOWNED_COLOR, OCEAN_COLOR } from './palette.js';

// Builds a `cellId -> [r, g, b]` lookup for the current game state: land
// cells inherit the color of whichever player owns their territory; cells
// with no territory at all (not in `cellTerritory`) are ocean.
export function makeCellColorer(world, state, playerColors) {
  return (cellId) => {
    const territoryId = world.cellTerritory.get(cellId);
    if (territoryId === undefined) return OCEAN_COLOR;
    const node = state.nodes.get(territoryId);
    if (!node) return UNOWNED_COLOR;
    return playerColors.get(node.owner) ?? UNOWNED_COLOR;
  };
}
