import { MAX_RESERVE } from '@dicewars/core';
import { battleEntry } from './battleLog.js';

/**
 * Everything that changed the board this match — attacks and end-of-turn
 * reinforcement alike — in the true order it happened, kept in full for as
 * long as the match runs. "This match" means since this `createReplay()` was
 * built: a fresh game builds one at the true start, so it covers everything;
 * a game resumed from a save builds one at the point it was picked back up,
 * so it covers only what happens from there — nothing before it was ever
 * recorded to resume from (see `session.js`'s `initialNodes`/`initialReserves`,
 * which are seeded the same way, from the board the session actually opened
 * on).
 *
 * This is deliberately not the battle log: that one trims to what the
 * history panel is worth showing, because it exists to be read. A replay has
 * to be able to stand on any attack recorded so far, however long the game
 * ran, so nothing here is ever thrown away.
 *
 * Reinforcement is tracked here for the same reason ownership and dice have
 * to be right at every step — a territory reinforced but never fought over
 * still gained real dice, and a replayed board that never shows that is
 * showing a board that never actually existed. `attacks` filters this down
 * to just the fights, which is the unit the track bar and the battle readout
 * both work in.
 *
 * An elimination is not recorded as an entry of its own the way the battle
 * log does it — it is never anything but the direct consequence of the
 * attack just before it, so it is folded onto that attack's own entry
 * instead (`elimination: { playerId, by }`). That is what lets
 * `historyThroughStep` rebuild an exact history-so-far from `attacks` alone.
 *
 * Not saved, and not restored — a finished game's save is cleared the moment
 * it ends, and a replay only ever plays back the match still open behind it.
 */
export function createReplay() {
  const moves = [];

  return {
    get attacks() {
      return moves.filter((move) => move.kind === 'battle');
    },

    get moves() {
      return moves;
    },

    /** Records a game event, or ignores it — only an attack is replayed. */
    record(event) {
      if (event.type !== 'attack') return;
      moves.push(battleEntry(event));
    },

    /**
     * Tags the eliminated player onto the attack that just eliminated them.
     * Always called, if at all, immediately after the `record` for that same
     * attack — core never emits `eliminated` except as part of the same
     * attack's own event batch, so nothing else can have been recorded in
     * between.
     */
    recordElimination(event) {
      const last = moves.at(-1);
      if (last?.kind === 'battle') last.elimination = { playerId: event.playerId, by: event.by };
    },

    /**
     * Records where an end-of-turn payout landed, one die per entry, plus how
     * much the player earned — `landed` alone says how many dice found room,
     * not how many were banked before the cap trimmed them, and that's what
     * `reservesAfterAttacks` needs to replay the banked count truthfully.
     */
    recordReinforcement(event) {
      moves.push({
        kind: 'reinforce',
        playerId: event.playerId,
        earned: event.earned,
        landed: [...event.landed],
      });
    },
  };
}

/**
 * The battle log exactly as it would read if the match had stopped after the
 * first `count` attacks — same shape `battleLog.js` builds, so the same
 * `historyRowView` renders it. This is what makes scrubbing the track back
 * to some earlier point not a lie: the history panel opened from there shows
 * only what had actually happened by then, not the whole match spoiling
 * what is still ahead of the track.
 */
export function historyThroughStep(attacks, step) {
  const entries = [];
  const steps = Math.max(0, Math.min(step, attacks.length));

  for (let i = 0; i < steps; i++) {
    const attack = attacks[i];
    entries.push(attack);
    if (attack.elimination) {
      entries.push({ kind: 'elimination', ...attack.elimination });
    }
  }

  return entries;
}

/**
 * The board exactly as it stood after the first `count` attacks, rebuilt
 * from `initialNodes` rather than from anything saved along the way —
 * whatever board the replay started recording from, which is the board the
 * match opened on for a fresh game, or the board it was resumed on for one
 * loaded from a save (a replay never reaches further back than the moves it
 * actually has). `moves` is the full interleaved log — `createReplay()`'s
 * `.moves`, not `.attacks` — because a step is only an accurate board if
 * every reinforcement that landed before it is applied too, not just the
 * combat.
 *
 * Combat needs no re-simulation, only replaying: an attack entry already
 * carries the one fact that matters, how many dice the attacker had *at that
 * moment*, in `attacker.rolls.length` — which already accounts for whatever
 * reinforcement that territory had received by then. Reinforcement needs no
 * re-simulation either, for the same reason — `landed` already says exactly
 * which territory each die went to, in order, so replaying it is just adding
 * one die per entry rather than re-deciding where they go.
 *
 * `count` is a count of *attacks*, not of moves — reinforcement is never
 * something to stop partway into, it either happened before this step's
 * attack or it didn't. So the walk below stops the instant it would apply an
 * attack past `count`, whatever comes after that in `moves` — including a
 * reinforcement `count` attacks' worth of history hasn't reached yet.
 */
export function boardAfterAttacks(initialNodes, moves, count) {
  const nodes = new Map(initialNodes);
  let attacksApplied = 0;

  for (const move of moves) {
    if (attacksApplied >= count) break;

    if (move.kind === 'reinforce') {
      for (const territoryId of move.landed) {
        const node = nodes.get(territoryId);
        nodes.set(territoryId, { ...node, dice: node.dice + 1 });
      }
      continue;
    }

    const attacker = nodes.get(move.from);
    if (move.attackerWins) {
      nodes.set(move.from, { ...attacker, dice: 1 });
      nodes.set(move.to, { owner: move.attacker.playerId, dice: move.attacker.rolls.length - 1 });
    } else {
      nodes.set(move.from, { ...attacker, dice: 1 });
    }
    attacksApplied++;
  }

  return nodes;
}

/**
 * Each player's banked reserve exactly as it stood after the first `count`
 * attacks, rebuilt from `initialReserves` the same way `boardAfterAttacks`
 * rebuilds the board — same `moves`, same "count is attacks, not moves"
 * stopping rule, for the same reason.
 *
 * Unlike a die landing (which just says where), a reinforcement's `landed`
 * alone doesn't say what the reserve became: dice bank up to `MAX_RESERVE`
 * before any of them land, so the count that mattered at the time — `earned`
 * — has to be replayed through the same cap core applies, not read off the
 * move directly.
 *
 * Returned as `Map<playerId, { reserve }>` — the shape `playerStatsFor`
 * already reads `state.players` as — so a replay step can hand this straight
 * to it in place of the live match's players.
 */
export function reservesAfterAttacks(initialReserves, moves, count) {
  const reserves = new Map(initialReserves);
  let attacksApplied = 0;

  for (const move of moves) {
    if (attacksApplied >= count) break;

    if (move.kind === 'reinforce') {
      const before = reserves.get(move.playerId) ?? 0;
      reserves.set(move.playerId, Math.min(before + move.earned, MAX_RESERVE) - move.landed.length);
      continue;
    }

    attacksApplied++;
  }

  return new Map([...reserves].map(([playerId, reserve]) => [playerId, { reserve }]));
}
