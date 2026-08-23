/**
 * What the game has already told this player, so it never tells them twice.
 *
 * A hint is a one-off: it exists for somebody who has never played before, and
 * is worse than useless to everybody else. So "have they seen it" has to
 * outlive the tab, which means storage — but stored as a *set of ids* under one
 * key rather than a flag per hint, so a second hint later is a new constant
 * here and nothing else. A localStorage key is forever; a second one for the
 * same idea would be the awkward part to undo.
 *
 * Like the settings and the saved game, storage is treated as a nicety that may
 * simply refuse: it throws in private browsing on some engines and is missing
 * outside a browser entirely. A player who cannot be remembered sees the hint
 * again, which is a far better failure than a game that will not start.
 */

const STORAGE_KEY = 'dicewars-planets:hints';

/** The first-turn prompt: how you actually attack. */
export const ATTACK_HINT = 'attack';

export function readSeenHints(storage) {
  try {
    const stored = storage?.getItem(STORAGE_KEY);
    const seen = stored ? JSON.parse(stored) : null;
    return new Set(Array.isArray(seen) ? seen : []);
  } catch {
    return new Set();
  }
}

/**
 * Records that `id` has been shown. Reads before it writes rather than being
 * handed the whole set, so a hint dismissed in one tab is not erased by
 * another tab that opened before it and never knew.
 */
export function markHintSeen(storage, id) {
  try {
    const seen = readSeenHints(storage);
    if (seen.has(id)) return true;
    seen.add(id);
    storage?.setItem(STORAGE_KEY, JSON.stringify([...seen]));
    return true;
  } catch {
    return false;
  }
}
