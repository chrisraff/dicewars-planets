import { SELECTION_COLOR, WHITE } from './palette.js';

// How each called-out territory is tinted: a color to blend toward, and how
// far. The territory you've picked up goes dark, which reads unambiguously
// against every player color and makes the pale dice on top of it pop; the
// enemies it could hit get a light lift, so the two never read as the same
// kind of mark.
export const HIGHLIGHT = {
  selected: { color: SELECTION_COLOR, amount: 0.72 },
  target: { color: WHITE, amount: 0.18 },
  attacker: { color: WHITE, amount: 0.5 },
  defender: { color: WHITE, amount: 0.5 },
};

/**
 * The current tint for every territory that has one, as a
 * `territoryId -> { color, amount }` map. Pure, so the rules for what lights
 * up when are readable in one place instead of scattered through the render
 * loop.
 *
 * `pulse` (0..1) throbs the two territories in a fight so it's obvious which
 * pair the dice on screen belong to.
 */
export function highlightsFor({ selection = null, targets = [], attack = null, pulse = 1 } = {}) {
  const marks = new Map();

  for (const id of targets) marks.set(id, HIGHLIGHT.target);
  if (selection !== null) marks.set(selection, HIGHLIGHT.selected);

  if (attack) {
    marks.set(attack.from, { ...HIGHLIGHT.attacker, amount: HIGHLIGHT.attacker.amount * pulse });
    marks.set(attack.to, { ...HIGHLIGHT.defender, amount: HIGHLIGHT.defender.amount * pulse });
  }
  return marks;
}

// A 0..1 throb, one beat per `period` seconds — never quite reaching 0, so a
// highlighted territory never blinks all the way back to its plain color.
export function pulseAt(elapsed, period = 0.6) {
  return 0.65 + 0.35 * Math.sin((elapsed / period) * 2 * Math.PI);
}
