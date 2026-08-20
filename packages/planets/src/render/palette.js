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

const DARK_INK = [0.06, 0.06, 0.09];
const LIGHT_INK = [1, 1, 1];

// WCAG relative luminance: sRGB channels linearized before weighting. The
// linearization matters — judging by the raw channel values instead puts
// purple's luminance below the midpoint and picks white ink for it, which is
// the one combination in this palette that falls below AA contrast.
export function luminance([r, g, b]) {
  return [r, g, b]
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
}

export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Whichever of black or white reads better on this color, measured rather
// than guessed from a threshold — the palette runs from dark red to
// near-white and neither ink alone is legible across all eight.
export function readableTextColor(color) {
  return contrastRatio(color, DARK_INK) > contrastRatio(color, LIGHT_INK) ? DARK_INK : LIGHT_INK;
}

export function assignPlayerColors(playerIds, palette = DEFAULT_PLAYER_COLORS) {
  const colors = new Map();
  playerIds.forEach((id, i) => colors.set(id, palette[i % palette.length]));
  return colors;
}

export { UNOWNED_COLOR, OCEAN_COLOR, SELECTION_COLOR, WHITE };
