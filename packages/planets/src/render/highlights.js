import { SELECTION_COLOR, WHITE } from './palette.js';

// The gate's own colour, and deliberately not white. Every other mark on the
// board is a lift toward white or a fall toward black, so a third white lift
// at a fourth strength would be one more thing to tell apart by brightness
// alone. A cold pale blue says "this mark is about the moon" without
// competing with anything that is about the move being made.
const GATE_COLOR = [0.55, 0.85, 1];

// How each called-out territory is tinted: a color to blend toward, and how
// far. The territory you've picked up goes dark, which reads unambiguously
// against every player color and makes the pale dice on top of it pop; the
// enemies it could hit get a light lift, so the two never read as the same
// kind of mark.
//
// A fight in progress is marked with that same pair of meanings rather than a
// second vocabulary: the attacker is held dark exactly as a picked-up
// territory is — it *is* a picked-up territory, whoever picked it up — and the
// defender takes the lift, pulsed. That keeps the player's own attack looking
// continuous (the territory they darkened by selecting it stays dark while its
// dice are thrown), and it gives an AI attack the same read, which is the one
// place the mark was missing: nobody watching a computer's turn saw which
// territory the dice belonged to until they landed.
const HELD = { color: SELECTION_COLOR, amount: 0.72 };

export const HIGHLIGHT = {
  selected: HELD,
  attacker: HELD,
  target: { color: WHITE, amount: 0.18 },
  defender: { color: WHITE, amount: 0.5 },
  // The territory a finger is on *right now*, still down. It answers a
  // different question from every other mark here — not "what could you do"
  // but "this is the one you are touching, let go and it happens" — so it has
  // to be told apart from the pale lift the legal targets wear, which is the
  // mark it will most often be sitting on top of. Hence a lift far past
  // anything else on the board rather than a slightly brighter one: three
  // times the target's, and the only mark that ever appears and disappears
  // with a hand. It outranks every other mark for the same reason.
  pressed: { color: WHITE, amount: 0.55 },

  /**
   * The two standing marks moon mode adds, and both are answers to "where"
   * rather than to "what could you do".
   *
   * `port` is on a spaceport for the whole match, because a port is ground
   * worth fighting over from the first turn whether or not the moon is
   * overhead, and it can change hands like any other territory.
   *
   * `docked` is the pair the gate is joining *now*, one end on each board, so
   * the link is visible from either side. Faint enough that neither ever
   * competes with a mark about the move in hand — they are furniture, and
   * every gameplay mark is written over the top of them.
   *
   * `docked` is judged on the **moon** rather than on the planet, which is
   * where it wants to be weakest. A planet territory is one of fifty-odd and
   * takes a strong tint as "red, marked"; a moon territory is one of ten,
   * covers most of the near side, and starts from a flat grey — so the same
   * amount stopped reading as a mark on unclaimed ground and started reading
   * as a ninth player's colour.
   */
  port: { color: GATE_COLOR, amount: 0.16 },
  docked: { color: GATE_COLOR, amount: 0.3 },
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
  ports = [],
  gate = null,
} = {}) {
  const marks = new Map();

  // First, so everything below writes over them: these say where the moon's
  // door is, which is a standing fact about the board rather than anything
  // about the move being considered on it.
  for (const id of ports) marks.set(id, HIGHLIGHT.port);
  if (gate?.open) {
    marks.set(gate.port, HIGHLIGHT.docked);
    marks.set(gate.dock, HIGHLIGHT.docked);
  }

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
