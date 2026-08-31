import { getCurrentPlayerId, totalReserve, MAX_RESERVE } from '@dicewars/core';

export { MAX_RESERVE };

/**
 * One row per player for the stats bar: how much of the planet they hold, and
 * how many dice they have banked.
 *
 * The banked dice are core's `reserve` — end-of-turn reinforcements that had
 * nowhere to land because every territory the player owns was already full.
 * They stay banked (capped at MAX_RESERVE, per world) and pay out on a later
 * turn once there's room, so a big reserve means a player is about to spill
 * dice across the board the moment they take any ground.
 *
 * Players are never dropped from the list when they're knocked out — the row
 * would reshuffle under the reader's eyes — they're just marked `alive: false`.
 */
export function playerStatsFor(state, playerIds = state.turnOrder) {
  const territories = new Map(playerIds.map((id) => [id, 0]));
  for (const node of state.nodes.values()) {
    territories.set(node.owner, (territories.get(node.owner) ?? 0) + 1);
  }

  const over = state.phase === 'gameover';
  const current = over ? null : getCurrentPlayerId(state);

  return playerIds.map((id) => {
    const held = territories.get(id) ?? 0;
    return {
      id,
      territories: held,
      // every world's bank, since the badge is one number — see `totalReserve`
      reserve: totalReserve(state.players.get(id)),
      alive: held > 0,
      isCurrent: id === current,
      isWinner: over && id === state.winner,
    };
  });
}
