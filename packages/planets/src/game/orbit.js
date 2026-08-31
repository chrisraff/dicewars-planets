/**
 * Where the moon is, and what that joins to what.
 *
 * The orbit is a **schedule** rather than a simulation: a whole number of
 * stops, advanced by one at the end of every round. That is deliberate, and
 * it is the difference between the moon being a mechanic and being weather.
 * A player has to be able to answer "when is my window" three rounds ahead,
 * out loud, without watching anything move — so the position is a function of
 * the round number and nothing else, and the dial in the HUD can therefore
 * show the future as confidently as the present.
 *
 * Two things move at once, and they move at different rates:
 *
 * - **Which spaceport is under it.** Two ports on opposite sides of the
 *   planet, and stops in between where the moon is over open space and there
 *   is no way up or down at all. So the gate is open half the rounds and
 *   never at the same end twice running: whoever holds port A gets the odd
 *   windows and whoever holds port B gets the even ones, which is what makes
 *   the moon contested rather than farmed.
 * - **Which moon territory is facing.** The moon spins as well as orbiting,
 *   so the dock steps along the band every stop. Nobody holds one permanent
 *   door and chokes the moon behind it.
 *
 * Six band territories against four stops means the pairing repeats every
 * twelfth stop rather than every fourth — long enough not to feel like a
 * metronome, and still perfectly predictable.
 */
export const ORBIT_STOPS = 4;

/**
 * The moon's position at a given round, and what it connects.
 *
 * `port` is null at a stop over open space, which is also what `open` says
 * more directly. `dock` is a band territory whatever the stop, because the
 * moon is always facing *something* — it is only whether there is anything
 * beneath it that changes.
 */
export function orbitAt(orbit, round) {
  const { ports, dockOrder, stops = ORBIT_STOPS } = orbit;
  const at = (value, length) => ((value % length) + length) % length;

  const stop = at(round, stops);
  // even stops sit over a port, odd ones over space — so `stops` has to be
  // twice `ports.length` for every port to get a turn
  const port = stop % 2 === 0 ? ports[at(stop / 2, ports.length)] : null;

  return {
    round,
    stop,
    port: port ?? null,
    dock: dockOrder[at(round, dockOrder.length)],
    open: port !== undefined && port !== null,
  };
}

/**
 * The next `count` positions, this round first — what the dial draws.
 *
 * A player reading it is asking one question ("when do I get up there, and
 * where from"), so this hands back whole positions rather than a bare list of
 * ports: the answer involves which territory of theirs is the door.
 */
export function orbitSchedule(orbit, round, count = ORBIT_STOPS) {
  return Array.from({ length: count }, (_, i) => orbitAt(orbit, round + i));
}

/**
 * The adjacency change that moves the gate from where it was to where it is
 * now, as core's `UPDATE_ADJACENCY` patch.
 *
 * Only the moon end is ever restated, and that is worth understanding rather
 * than working around: `setNeighbors` keeps the reverse edges in step by
 * itself, so writing the dock's neighbours puts the edge on the port too, and
 * writing them without the port takes it off again. Restating the *port*
 * as well would mean this function had to know the port's own planetary
 * neighbours, which it has no business knowing.
 *
 * `moonNeighbors` is each moon territory's own neighbours on the moon — the
 * board as it was carved, before any bridge. It is the thing being restored,
 * so it has to come from the world rather than from the live graph, which by
 * definition has a bridge in it.
 */
export function bridgePatch(orbit, round, moonNeighbors) {
  const now = orbitAt(orbit, round);
  const before = orbitAt(orbit, round - 1);

  const patch = [];
  for (const id of new Set([before.dock, now.dock])) {
    const base = moonNeighbors.get(id) ?? [];
    patch.push([id, id === now.dock && now.open ? [...base, now.port] : [...base]]);
  }
  return patch;
}

/**
 * Both ends of the gate as it stands, for anything that has to draw it — the
 * beam between the two boards, the marks on the docked pair, and the dimmer
 * pair showing where it goes next.
 */
export function gateView(orbit, round) {
  const now = orbitAt(orbit, round);
  const next = orbitAt(orbit, round + 1);

  // How far away the moon really is right now. Scanned rather than assumed:
  // the shipped schedule never shuts the gate for more than a round, but that
  // is a property of `ORBIT_STOPS` being twice the port count rather than
  // anything guaranteed, and this is the number an AI would discount by.
  const stops = orbit.stops ?? ORBIT_STOPS;
  let roundsToOpen = 0;
  while (roundsToOpen < stops && !orbitAt(orbit, round + roundsToOpen).open) roundsToOpen++;

  return {
    round,
    stop: now.stop,
    stops,
    open: now.open,
    port: now.port,
    dock: now.dock,
    nextOpen: next.open,
    nextPort: next.port,
    nextDock: next.dock,
    roundsToOpen,
  };
}
