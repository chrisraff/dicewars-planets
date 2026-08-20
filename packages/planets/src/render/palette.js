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

// What a territory is tinted toward when you pick it up to attack with. Dark
// enough to read as "held" against every player color, and dark enough that
// the pale dice standing on it stand out rather than wash into it.
const SELECTION_COLOR = [0.14, 0.14, 0.16];
const WHITE = [1, 1, 1];

// Blends `color` toward `toward` by `amount` (0 = untouched, 1 = fully
// `toward`). This is how a territory shows that it's selected or under attack
// without needing a second color per player.
export function mix(color, toward, amount) {
  if (!amount) return color;
  const t = Math.min(1, Math.max(0, amount));
  return color.map((channel, i) => channel + (toward[i] - channel) * t);
}

export const lighten = (color, amount) => mix(color, WHITE, amount);

export function assignPlayerColors(playerIds, palette = DEFAULT_PLAYER_COLORS) {
  const colors = new Map();
  playerIds.forEach((id, i) => colors.set(id, palette[i % palette.length]));
  return colors;
}

export { UNOWNED_COLOR, OCEAN_COLOR, SELECTION_COLOR, WHITE };
