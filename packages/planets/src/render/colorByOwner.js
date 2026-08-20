import { UNOWNED_COLOR } from './palette.js';

// Builds a `cellId -> [r, g, b]` lookup for the current game state: every
// cell inherits the color of whichever player owns its territory.
export function makeCellColorer(world, state, playerColors) {
  return (cellId) => {
    const territoryId = world.cellTerritory.get(cellId);
    const node = state.nodes.get(territoryId);
    if (!node) return UNOWNED_COLOR;
    return playerColors.get(node.owner) ?? UNOWNED_COLOR;
  };
}
