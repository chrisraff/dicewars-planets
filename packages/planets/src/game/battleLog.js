const DEFAULT_LIMIT = 120;

/**
 * An attack event as a log entry. Exported on its own because the readout
 * needs to draw a battle the moment it is declared — with the dice still
 * blank — and only records it once they have landed.
 */
export function battleEntry(event) {
  return {
    kind: 'battle',
    from: event.from,
    to: event.to,
    attacker: {
      playerId: event.attackerOwner,
      rolls: [...event.attackRolls],
      total: event.attackRoll,
    },
    defender: {
      playerId: event.defenderOwner,
      rolls: [...event.defendRolls],
      total: event.defendRoll,
    },
    attackerWins: event.attackerWins,
  };
}

/**
 * The record of what has happened in the fight, newest last, in the shape the
 * readout and the history panel want to draw.
 *
 * Kept as its own thing rather than read back out of game state, because state
 * only says how the board looks *now* — it has no memory of the rolls that got
 * it there, and those are the whole point of a battle readout.
 *
 * Old entries fall off the end past `limit`: a long game is thousands of
 * attacks and nobody scrolls back that far.
 */
export function createBattleLog({ limit = DEFAULT_LIMIT } = {}) {
  const entries = [];
  let nextId = 1;

  function push(entry) {
    const stamped = { id: nextId++, ...entry };
    entries.push(stamped);
    if (entries.length > limit) entries.splice(0, entries.length - limit);
    return stamped;
  }

  return {
    get entries() {
      return entries;
    },

    get latest() {
      return entries.at(-1) ?? null;
    },

    // The most recent actual fight, which is what the readout shows — an
    // elimination is a footnote to the attack before it, not a thing with dice.
    get latestBattle() {
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].kind === 'battle') return entries[i];
      }
      return null;
    },

    /** Records a game event, or ignores it. Returns the new entry, or null. */
    record(event) {
      if (event.type === 'attack') return push(battleEntry(event));

      if (event.type === 'eliminated') {
        return push({ kind: 'elimination', playerId: event.playerId, by: event.by });
      }

      return null;
    },
  };
}
