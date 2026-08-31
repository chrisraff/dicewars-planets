import { NEUTRAL_OWNER } from '@dicewars/core';
import { UNOWNED_COLOR, OCEAN_COLOR, NEUTRAL_COLOR, mix } from './palette.js';

/**
 * Builds a `cellId -> [r, g, b]` lookup for the current game state: land
 * cells inherit the color of whichever player owns their territory; cells
 * with no territory at all (not in `cellTerritory`) are the world's own empty
 * color — ocean on the planet, channel on the moon.
 *
 * `tintFor(territoryId)` returns `{ color, amount }` for a territory that's
 * currently called out — picked up, targetable, or in a fight — or null for
 * the usual case of showing its owner's plain color.
 *
 * Unclaimed ground gets a color of its own rather than falling through to
 * `UNOWNED_COLOR`, which means something else: that one is for a cell whose
 * territory is not in the state at all, which is a bug rather than a board
 * position. Naming the two apart is what stops a real fault looking like the
 * moon working correctly.
 */
export function makeCellColorer(
  world,
  state,
  playerColors,
  tintFor = () => null,
  { emptyColor = OCEAN_COLOR } = {}
) {
  return (cellId) => {
    const territoryId = world.cellTerritory.get(cellId);
    if (territoryId === undefined) return emptyColor;
    const node = state.nodes.get(territoryId);
    if (!node) return UNOWNED_COLOR;

    const base = node.owner === NEUTRAL_OWNER
      ? NEUTRAL_COLOR
      : playerColors.get(node.owner) ?? UNOWNED_COLOR;
    const tint = tintFor(territoryId);
    return tint ? mix(base, tint.color, tint.amount) : base;
  };
}
