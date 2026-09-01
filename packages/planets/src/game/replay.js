import { MAX_RESERVE } from '@dicewars/core';
import { battleEntry } from './battleLog.js';

/**
 * How many moves a replay keeps. Nothing currently playable comes close — an
 * eight-player match runs about 750 — so the cap is for the planet sizes not
 * offered yet, where a match runs to tens of thousands of moves.
 *
 * Past the cap the *oldest* moves go, not the newest, and the anchor advances
 * over them (see `createReplay`), so a trimmed replay still rebuilds an exact
 * board for every step still standing.
 */
export const REPLAY_LIMIT = 1000;

/**
 * Everything that changed the board this match — attacks and end-of-turn
 * reinforcement alike — in the order it happened, plus the board it all
 * started from.
 *
 * That starting board is the **anchor**, and it is what makes a replay
 * self-contained: a step is rebuilt by walking the moves forward from it
 * rather than by remembering a board per step. A fresh game anchors on the
 * planet as dealt; a resumed one anchors where the replay it was restored from
 * anchored, since the whole thing travels in the save.
 *
 * It is the *only* record. The battle log the history panel reads is derived
 * from it (`historyThroughStep`), because storing both meant writing every
 * fight down twice and the duplicate was 87% of a save.
 *
 * An elimination gets no entry of its own: it is never anything but the direct
 * consequence of the attack before it, so it is folded onto that attack
 * (`elimination: { playerId, by }`), which is what lets `historyThroughStep`
 * rebuild an exact history-so-far from the moves alone.
 *
 * `nodes` and `reserves` are copied rather than held — `nodes` comes straight
 * off live game state, and writing into it would be rewriting the match.
 */
export function createReplay({
  nodes = new Map(),
  reserves = new Map(),
  moves = [],
  limit = REPLAY_LIMIT,
} = {}) {
  // the board and the banked dice as they stood before the first move held
  const anchorNodes = new Map(nodes);
  const anchorReserves = new Map(reserves);
  const log = [...moves];

  // Past the cap the oldest move is dropped and the anchor takes its place —
  // applying it to the anchor is exactly what makes dropping it lossless for
  // every step that remains. Writing into the anchor is safe because both
  // maps were copied on the way in, and `applyMove` never writes into a node
  // object it did not just create.
  function trim() {
    while (log.length > limit) applyMove(log.shift(), anchorNodes, anchorReserves);
  }

  trim(); // a restored replay can arrive over the cap if the cap has since moved

  return {
    get attacks() {
      return log.filter((move) => move.kind === 'battle');
    },

    get moves() {
      return log;
    },

    /** The board and the banked dice the moves build forward from. */
    get anchor() {
      return { nodes: anchorNodes, reserves: anchorReserves };
    },

    /** Records a game event, or ignores it — only an attack is replayed. */
    record(event) {
      if (event.type !== 'attack') return;
      log.push(battleEntry(event));
      trim();
    },

    /**
     * Tags the eliminated player onto the attack that just eliminated them.
     * Always called, if at all, immediately after the `record` for that same
     * attack — core never emits `eliminated` except as part of the same
     * attack's own event batch, so nothing else can have been recorded in
     * between.
     */
    recordElimination(event) {
      const last = log.at(-1);
      if (last?.kind === 'battle') last.elimination = { playerId: event.playerId, by: event.by };
    },

    /**
     * Unwrites the last move — the one case being an attack the player took
     * back before its dice came up. A cancelled attack is the undoing of an
     * attack rather than a move in its own right: it never happened, so the
     * history and the graph must not show it happening.
     *
     * Safe because a cancel can only ever be the very last thing recorded: the
     * board is held behind a pending attack, so nothing else can have been
     * written since (the same argument `recordElimination` makes, and it takes
     * the elimination back with it, since that was tagged onto this entry).
     *
     * At the cap there is one loss and it is not a correctness one. If this
     * entry's own `record` pushed the log over `limit`, the oldest move was
     * folded into the anchor and popping does not unfold it — so the replay
     * still rebuilds exactly the right board, one move shorter of history than
     * it could have been.
     */
    dropLast() {
      log.pop();
    },

    /**
     * Records where an end-of-turn payout landed, one die per entry, plus what
     * the player earned — `landed` alone says how many dice found room, not
     * how many were banked before the cap trimmed them, which is what
     * `reservesAfterAttacks` needs to replay the banked count truthfully.
     *
     * `passed` is stored rather than inferred from "no attack since the last
     * payout", because trimming removes exactly the attacks that would
     * disprove one.
     */
    recordReinforcement(event) {
      log.push({
        kind: 'reinforce',
        playerId: event.playerId,
        earned: event.earned,
        landed: [...event.landed],
        passed: Boolean(event.passed),
      });
      trim();
    },

    /** The board, the banked dice and the history as they stood at `step`. */
    boardAt(step) {
      return boardAfterAttacks(anchorNodes, log, step);
    },

    playersAt(step) {
      return reservesAfterAttacks(anchorReserves, log, step);
    },

    historyAt(step) {
      return historyThroughStep(log, step);
    },

    standings(playerIds) {
      return standingsOverReplay(anchorNodes, log, playerIds);
    },
  };
}

/**
 * One move applied to a board, to banked dice, or to both — whichever was
 * handed in. Written into rather than returned, since every caller here is
 * walking a working copy it owns; node objects are always replaced rather
 * than edited, so a board copied from live game state never writes back.
 *
 * Neither combat nor reinforcement needs re-simulating, only replaying. An
 * attack entry already carries the one fact that matters — how many dice the
 * attacker had *at that moment*, in `attacker.rolls.length`, which already
 * accounts for whatever reinforcement that territory had received by then.
 * And `landed` already says exactly which territory each die went to, in
 * order, so replaying a payout is adding one die per entry rather than
 * re-deciding where they go.
 */
function applyMove(move, nodes, reserves) {
  if (move.kind === 'reinforce') {
    // dice bank up to MAX_RESERVE before any of them land, so the count that
    // mattered at the time — `earned` — has to go through the same cap core
    // applies rather than being read off `landed`, which only says how many
    // found room
    if (reserves) {
      const before = reserves.get(move.playerId) ?? 0;
      reserves.set(move.playerId, Math.min(before + move.earned, MAX_RESERVE) - move.landed.length);
    }
    if (nodes) {
      for (const territoryId of move.landed) {
        const node = nodes.get(territoryId);
        nodes.set(territoryId, { ...node, dice: node.dice + 1 });
      }
    }
    return;
  }

  if (!nodes) return;
  const attacker = nodes.get(move.from);
  nodes.set(move.from, { ...attacker, dice: 1 });
  if (move.attackerWins) {
    nodes.set(move.to, { owner: move.attacker.playerId, dice: move.attacker.rolls.length - 1 });
  }
}

/**
 * Walks `moves`, applying each one, and stops the instant it would apply an
 * attack past `count`.
 *
 * `count` is a count of *attacks*, not of moves — reinforcement is never
 * something to stop partway into, it either happened before this step's
 * attack or it did not. So whatever comes after that in `moves` is left
 * alone, including a payout that `count` attacks' worth of history has not
 * reached yet.
 */
function walk(moves, count, nodes, reserves) {
  let attacksApplied = 0;

  for (const move of moves) {
    if (attacksApplied >= count) break;
    applyMove(move, nodes, reserves);
    if (move.kind !== 'reinforce') attacksApplied++;
  }
}

/**
 * The battle log as it would read if the match had stopped after the first
 * `count` attacks — the shape `battleLog.js` builds, so `historyRowView`
 * renders it. This is what stops a scrub back being a lie: the history opened
 * from there shows what had happened by then, not the whole match.
 *
 * It is also how a resumed game gets its history back, which is why `count`
 * defaults to everything. `moves` is the full interleaved log, since a turn
 * that passed without a fight is a row of its own.
 */
export function historyThroughStep(moves, count = Infinity) {
  const entries = [];
  let attacksApplied = 0;

  for (const move of moves) {
    if (attacksApplied >= count) break;

    if (move.kind === 'reinforce') {
      if (move.passed) entries.push({ kind: 'passed', playerId: move.playerId });
      continue;
    }

    entries.push(move);
    if (move.elimination) entries.push({ kind: 'elimination', ...move.elimination });
    attacksApplied++;
  }

  return entries;
}

/**
 * The board exactly as it stood after the first `count` attacks, rebuilt from
 * `initialNodes` — the replay's anchor, which is the board the match opened
 * on, or the one a trimmed replay now begins at. `moves` is the full
 * interleaved log, because a step is only an accurate board if every
 * reinforcement that landed before it is applied too, not just the combat.
 */
export function boardAfterAttacks(initialNodes, moves, count) {
  const nodes = new Map(initialNodes);
  walk(moves, count, nodes, null);
  return nodes;
}

/**
 * Each player's banked reserve exactly as it stood after the first `count`
 * attacks, rebuilt from `initialReserves` the same way `boardAfterAttacks`
 * rebuilds the board.
 *
 * Returned as `Map<playerId, { reserve }>` — the shape `playerStatsFor`
 * already reads `state.players` as — so a replay step can hand this straight
 * to it in place of the live match's players.
 */
export function reservesAfterAttacks(initialReserves, moves, count) {
  const reserves = new Map(initialReserves);
  walk(moves, count, null, reserves);
  return new Map([...reserves].map(([playerId, reserve]) => [playerId, { reserve }]));
}

/**
 * How much every player held at every step — territories owned and dice
 * standing on them, one number per player per step, in the order `boardAt`
 * walks.
 *
 * The third view of the one record, alongside the board and the history, and
 * derived on demand rather than tallied as the match is played: a match's
 * shape is nothing the moves do not already say, and a step is one pass over
 * the board with `REPLAY_LIMIT` bounding the steps.
 *
 * Sampled immediately after each attack and nowhere else, which is exactly
 * where `boardAfterAttacks` stops for the same step — so the chart and the
 * planet under it cannot disagree about where the track is standing.
 *
 * `dice` is the dice on the planet rather than those plus the banked reserve:
 * what the chart is read against is the board, and banked dice are a promise
 * rather than an army, already called out as the "+n" on a tile.
 *
 * Players are named rather than discovered, so a knocked-out one keeps its
 * line at zero instead of vanishing — as `playerStatsFor` never drops a row.
 */
export function standingsOverReplay(
  initialNodes,
  moves,
  playerIds = [...new Set([...initialNodes.values()].map((node) => node.owner))]
) {
  const nodes = new Map(initialNodes);
  const series = playerIds.map((playerId) => ({ playerId, territories: [], dice: [] }));
  const byId = new Map(series.map((entry) => [entry.playerId, entry]));

  function sample() {
    for (const entry of series) {
      entry.territories.push(0);
      entry.dice.push(0);
    }
    for (const node of nodes.values()) {
      const entry = byId.get(node.owner);
      if (!entry) continue; // a board holding somebody nobody asked about
      entry.territories[entry.territories.length - 1]++;
      entry.dice[entry.dice.length - 1] += node.dice;
    }
  }

  sample(); // step 0 is the board as the replay opens, before any attack
  for (const move of moves) {
    applyMove(move, nodes, null);
    if (move.kind !== 'reinforce') sample();
  }

  return series;
}

// --- a replay, written down -----------------------------------------------

const ATTACK = 0;
const REINFORCE = 1;

const sum = (values) => values.reduce((a, b) => a + b, 0);
const facesOf = (rolls) => rolls.join(''); // faces are 1-6, so one digit each
const rollsOf = (faces) => [...String(faces)].map(Number);

/**
 * A replay as plain JSON, terse enough to live in a save.
 *
 * Everything a walk recovers is left out: who was attacking and defending is
 * whoever owned those territories at that point, the totals are the sum of the
 * faces, and who won is whether one beat the other — all of which fall out of
 * walking forward from the anchor, which `reviveReplay` does anyway. What is
 * left is the two territories and the faces they rolled, and no rule recovers
 * a die that has been thrown.
 *
 * Tuples rather than objects: a whole eight-player match is about 20KB this
 * way against 88KB of the shape these moves have in memory. It stays JSON and
 * stays readable in a console — bit-packing gets it under 5KB, which is not
 * worth a bit reader on a 5MB storage budget.
 *
 * A territory id is written as it stands: a graph is topology, so the ids are
 * whatever built it.
 */
export function serializeReplay(replay) {
  const { nodes, reserves } = replay.anchor;

  return {
    nodes: [...nodes].map(([id, node]) => [id, node.owner, node.dice]),
    reserves: [...reserves],
    moves: replay.moves.map(encodeMove),
  };
}

function encodeMove(move) {
  if (move.kind === 'reinforce') {
    const encoded = [REINFORCE, move.playerId, move.earned, move.landed];
    // a trailing flag rather than a slot of its own: most turns are not passes
    if (move.passed) encoded.push(1);
    return encoded;
  }

  const encoded = [
    ATTACK,
    move.from,
    move.to,
    facesOf(move.attacker.rolls),
    facesOf(move.defender.rolls),
  ];
  if (move.elimination) encoded.push(move.elimination.playerId);
  return encoded;
}

/**
 * The inverse: a live replay, ready to carry on recording.
 *
 * Rebuilt in one forward pass over the anchor, because that is the only way
 * the omitted fields come back — an attack's owners are read off the board as
 * it stood immediately before it, which is what the pass is holding. `by` on
 * an elimination is the attacker for the same reason.
 *
 * Throws on a damaged save rather than salvaging half a match — see
 * `session.js`, which would rather lose a replay than a game.
 */
export function reviveReplay(snapshot, { limit } = {}) {
  const nodes = new Map(snapshot.nodes.map(([id, owner, dice]) => [id, { owner, dice }]));
  const reserves = new Map(snapshot.reserves);

  // the board walks forward as the moves are decoded; the anchor above stays
  // where it is, since that is what the replay itself is built on
  const board = new Map(nodes);
  const moves = snapshot.moves.map((encoded) => {
    const move = decodeMove(encoded, board);
    applyMove(move, board, null);
    return move;
  });

  return createReplay({ nodes, reserves, moves, limit });
}

function decodeMove(encoded, board) {
  const [kind] = encoded;

  if (kind === REINFORCE) {
    const [, playerId, earned, landed, passed] = encoded;
    return { kind: 'reinforce', playerId, earned, landed: [...landed], passed: passed === 1 };
  }

  const [, from, to, attackFaces, defendFaces, eliminated] = encoded;
  const attackRolls = rollsOf(attackFaces);
  const defendRolls = rollsOf(defendFaces);
  const attackRoll = sum(attackRolls);
  const defendRoll = sum(defendRolls);
  const attackerOwner = board.get(from).owner;

  const move = {
    kind: 'battle',
    from,
    to,
    attacker: { playerId: attackerOwner, rolls: attackRolls, total: attackRoll },
    defender: { playerId: board.get(to).owner, rolls: defendRolls, total: defendRoll },
    attackerWins: attackRoll > defendRoll,
  };
  if (eliminated !== undefined) move.elimination = { playerId: eliminated, by: attackerOwner };
  return move;
}
