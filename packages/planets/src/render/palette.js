// RGB triples in 0..1, distinct enough to tell apart at a glance on a
// black background. Order matters only in that it's assigned in order.
export const DEFAULT_PLAYER_COLORS = [
  [0.86, 0.2, 0.2],  // red
  [0.2, 0.45, 0.86],  // blue
  [0.95, 0.75, 0.15],  // yellow
  [0.25, 0.75, 0.35],  // green
  [0.75, 0.3, 0.85],  // purple
  [0.95, 0.55, 0.15],  // orange
  [0.2, 0.8, 0.8],  // cyan
  [0.9, 0.9, 0.9],  // white
];

const UNOWNED_COLOR = [0.25, 0.25, 0.25];
const OCEAN_COLOR = [0.05, 0.22, 0.5];

export function assignPlayerColors(playerIds, palette = DEFAULT_PLAYER_COLORS) {
  const colors = new Map();
  playerIds.forEach((id, i) => colors.set(id, palette[i % palette.length]));
  return colors;
}

export { UNOWNED_COLOR, OCEAN_COLOR };
