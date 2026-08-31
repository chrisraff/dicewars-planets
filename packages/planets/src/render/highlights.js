import { SELECTION_COLOR, WHITE } from './palette.js';

// How each called-out territory is tinted: a colour to blend toward, and how
// far. A territory you have picked up goes dark, which reads unambiguously
// against every player colour and makes the pale dice on top of it pop; the
// enemies it could hit get a light lift, so the two never read as the same
// kind of mark.
//
// A fight in progress reuses that pair rather than a second vocabulary: the
// attacker is held dark exactly as a picked-up territory is — it *is* one,
// whoever picked it up — and the defender takes the lift, pulsed. That keeps
// the player's own attack continuous, and gives an AI attack the same read, so
// somebody watching a computer's turn can see which territory the dice in the
// air belong to.
const HELD = { color: SELECTION_COLOR, amount: 0.72 };

export const HIGHLIGHT = {
  selected: HELD,
  attacker: HELD,
  target: { color: WHITE, amount: 0.18 },
  defender: { color: WHITE, amount: 0.5 },
  // The territory a finger is on *right now*, still down. Not "what could you
  // do here" but "this is the one you are touching, let go and it happens", so
  // it has to be told apart from the pale lift a legal target wears — the mark
  // it will most often be sitting on top of. Hence three times that lift
  // rather than a slightly brighter version, and hence outranking every other
  // mark. `preview/touch.html` is where "distinct enough" is judged by eye.
  pressed: { color: WHITE, amount: 0.55 },
};

/**
 * The current tint for every territory that has one, as a
 * `territoryId -> { color, amount }` map. Pure, so the rules for what lights
 * up when are readable in one place instead of scattered through the render
 * loop.
 *
 * `pressed` is the territory a finger or a mouse button is down on, which is
 * a fact about the pointer rather than about the game — see
 * `pointerArbiter.js` for why the board can now say that at all.
 *
 * `pulse` (0..1) throbs the *defender* of a fight so it's obvious which pair
 * the dice on screen belong to. The attacker doesn't throb: its ground is
 * where its dice are being thrown, and a mark that exists partly to make pale
 * dice legible has no business fading out from under them.
 */
export function highlightsFor({
  selection = null,
  targets = [],
  attack = null,
  pressed = null,
  pulse = 1,
} = {}) {
  const marks = new Map();

  for (const id of targets) marks.set(id, HIGHLIGHT.target);
  if (selection !== null) marks.set(selection, HIGHLIGHT.selected);

  if (attack) {
    marks.set(attack.from, HIGHLIGHT.attacker);
    marks.set(attack.to, { ...HIGHLIGHT.defender, amount: HIGHLIGHT.defender.amount * pulse });
  }
  // Last, so it wins: a press is the most immediate thing on the board, and
  // the one mark the player is actively holding in place.
  if (pressed !== null) marks.set(pressed, HIGHLIGHT.pressed);
  return marks;
}

// A 0..1 throb, one beat per `period` seconds — never quite reaching 0, so a
// highlighted territory never blinks all the way back to its plain color.
export function pulseAt(elapsed, period = 0.6) {
  return 0.65 + 0.35 * Math.sin((elapsed / period) * 2 * Math.PI);
}
