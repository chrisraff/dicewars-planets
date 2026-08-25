import { MAX_RESERVE } from '@dicewars/core';
import { battleEntry } from './battleLog.js';

/**
 * How many moves a replay keeps. A whole match is far shorter than this — a
 * six-player game on a default planet runs 300-500 moves and an eight-player
 * one under 750 — so on anything currently playable the cap never bites and a
 * replay covers the match end to end. It is here for the planet sizes that
 * are not offered yet: eight players on a subdivision-4 globe (225
 * territories) run tens of thousands of moves, which is a save nobody wants
 * and a track bar nobody can scrub.
 *
 * Past the cap the *oldest* moves go, not the newest — the end of a match is
 * the part worth watching — and the anchor advances to cover them (see
 * `createReplay`), so a trimmed replay still rebuilds an exact board.
 */
export const REPLAY_LIMIT = 1000;

/**
 * Everything that changed the board this match — attacks and end-of-turn
 * reinforcement alike — in the true order it happened, together with the
 * board it all started from.
 *
 * That starting board is the **anchor**, and it is what makes a replay
 * self-contained: every step is rebuilt by walking the moves forward from it
 * rather than by remembering a board per step. A fresh game anchors on the
 * planet as dealt; a resumed one anchors wherever the replay it was restored
 * from anchored, since the whole thing now travels in the save.
 *
 * This is deliberately not the battle log — it is the other way round now.
 * A replay holds every move outright and the battle log the history panel
 * reads is *derived* from it (`historyThroughStep`), because the two were
 * otherwise stored twice over and the log alone was 87% of a saved game.
 *
 * An elimination is not recorded as an entry of its own the way the battle
 * log shows it — it is never anything but the direct consequence of the
 * attack just before it, so it is folded onto that attack's own entry
 * instead (`elimination: { playerId, by }`). That is what lets
 * `historyThroughStep` rebuild an exact history-so-far from the moves alone.
 *
 * `nodes` and `reserves` are copied rather than held: `nodes` is handed in
 * straight off live game state, and a replay writing into that would be
 * rewriting the match it is recording.
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
     * Records where an end-of-turn payout landed, one die per entry, plus how
     * much the player earned — `landed` alone says how many dice found room,
     * not how many were banked before the cap trimmed them, and that is what
     * `reservesAfterAttacks` needs to replay the banked count truthfully.
     *
     * `passed` is stored rather than worked out from "no attack since the
     * previous payout", because a replay whose head has been trimmed can open
     * partway through somebody's turn, and the attacks that would disprove a
     * pass are exactly the ones no longer there.
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
 * The battle log exactly as it would read if the match had stopped after the
 * first `count` attacks — same shape `battleLog.js` builds, so the same
 * `historyRowView` renders it. This is what makes scrubbing the track back
 * to some earlier point not a lie: the history panel opened from there shows
 * only what had actually happened by then, not the whole match spoiling
 * what is still ahead of the track.
 *
 * It is also how a resumed game gets its history back at all, which is why
 * `count` defaults to everything: the log is not saved alongside the replay
 * any more, it is read back out of it.
 *
 * `moves` is the full interleaved log, since a turn that passed without a
 * fight is a row of its own — and a match with no attacks in it at all still
 * has a history worth showing.
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

// --- a replay, written down -----------------------------------------------

const ATTACK = 0;
const REINFORCE = 1;

const sum = (values) => values.reduce((a, b) => a + b, 0);
const facesOf = (rolls) => rolls.join(''); // faces are 1-6, so one digit each
const rollsOf = (faces) => [...String(faces)].map(Number);

/**
 * A replay as plain JSON, terse enough to live in a save.
 *
 * Everything recoverable is left out rather than written down. Who was
 * attacking and who was defending is whoever owned those two territories at
 * that point in the replay; the totals are the sum of the faces; and who won
 * is whether one total beat the other. All three fall out of walking the
 * moves forward from the anchor, which `reviveReplay` has to do anyway. What
 * is left is the two territories and the faces they rolled, which is the
 * irreducible part — no rule recovers a die that has been thrown.
 *
 * Written as tuples rather than objects for the usual reason a save is: a
 * whole eight-player match is around 15KB this way against 88KB of the shape
 * these moves have in memory. It stays JSON, though, and stays readable in a
 * devtools console — a bit-packed form gets it under 5KB, which is not worth
 * a bit reader on a 5MB storage budget.
 *
 * A territory id is written as it stands. Real planets number them from zero,
 * so they cost a character or two; nothing here assumes that, since a graph
 * is topology and the ids are whatever built it.
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
 * The inverse: a live replay, ready to carry on recording the match it was
 * saved from.
 *
 * The moves are rebuilt in one forward pass over the anchor, because that is
 * the only way the fields left out of the save come back — an attack's owners
 * are read off the board as it stood immediately before that attack, which is
 * precisely what the pass is holding. `by` on an elimination is the attacker
 * for the same reason: nothing else can knock a player out.
 *
 * Throws on a save that has been damaged rather than trying to salvage half a
 * match — see `session.js`, which would rather lose a replay than a game.
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
