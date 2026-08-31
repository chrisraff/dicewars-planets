import { playerStatsFor } from './playerStats.js';
import { highlightsFor, pulseAt } from '../render/highlights.js';
import { createRollAnimation } from '../render/rollAnimation.js';
import { REPLAY_TIMING } from '../render/rollTimeline.js';

/**
 * The replay, painted onto the planet.
 *
 * A replay is a second thing that drives the one board: while it is open the
 * surface, the dice, the pole markers, the stats row and the battle readout
 * are all drawn from a *reconstructed* board — the match as it stood at some
 * step — rather than from the live match, which is held still underneath (see
 * `session.js`'s `tick`).
 *
 * Everything about painting a step lives here. What deliberately does not is
 * the *handover*: deciding that the replay should have the planet, and giving
 * it back afterwards, is a question about the match rather than about a step,
 * so `openReplay` and `closeReplay` stay in `session.js`. This module is only
 * ever asked to show step N, to advance whatever it has in the air, and to put
 * everything down again.
 *
 * It draws through the same objects live play draws through, and takes them
 * all as arguments, so nothing here reaches for a renderer of its own. The
 * camera arrives the same way — `focusFights`, `isSwinging` and `cameraFreed`
 * are the three questions a step has to ask it and nothing more.
 */
export function createReplayPlayer({
  replay,
  surface,
  dice,
  poles,
  hud,
  playerIds,
  focusFights,
  isSwinging,
  cameraFreed,
  finalWinner,
}) {
  let step = 0; // where the track is standing, so a step forward can be told from a scrub
  let pendingStep = null; // a board waiting for the camera to arrive before it shows
  let fight = null; // the fight the replay is stopped on, throbbing as a live one does
  let roll = null; // the attack a step is throwing dice for
  let thrownDice = null; // {from, to} of a throw whose stacks are still on the ground

  // Repaints everything — surface, dice, stats, readout, history — as the
  // board stood at `at` rather than as the match finished. The history is
  // truncated to `at` for the same reason: opening the track partway through
  // should not spoil what it has not reached.
  function applyStep(at, entry, nodes, { animate = false } = {}) {
    const atEnd = at >= replay.attacks.length;
    const players = replay.playersAt(at);

    // A step played forward throws its dice first, so it paints the board
    // *before* the attack — stacks still standing where they are thrown from.
    // Everything else belongs to the step being arrived at, and the readout
    // holds its faces back (`revealed: false`) exactly as live play does.
    const rolling = animate && entry;
    const board = rolling ? replay.boardAt(at - 1) : nodes;
    // Marked the way a live fight is, so the readout's pair of territories
    // can be found on a board where nothing else is moving to point at them.
    // It throbs from here on (see tick).
    fight = entry ? { entry, nodes: board, elapsed: 0 } : null;
    paintBoard(board, entry, pulseAt(0));
    settleThrownDice(board);
    dice.update({ nodes: board });
    poles.settle({ nodes: board });

    if (rolling) startRoll(entry, nodes);

    hud.showPlayers(playerStatsFor(
      { nodes, players, phase: 'gameover', winner: atEnd ? finalWinner() : null },
      playerIds
    ));
    hud.showBattle(entry, rolling ? { revealed: false } : undefined);
    hud.setHistory(replay.historyAt(at));
  }

  /**
   * Throws this step's dice the way live play does, and remembers the board to
   * land on when they stop. A replay entry is a battle *log* entry rather than
   * the attack event the animation was written for, so the faces are unpacked
   * by hand — the same numbers under a different pair of names.
   */
  function startRoll(entry, nodes) {
    roll = {
      elapsed: 0,
      entry,
      nodes,
      animation: createRollAnimation({
        attackerStand: dice.standFor(entry.from),
        defenderStand: dice.standFor(entry.to),
        event: { attackRolls: entry.attacker.rolls, defendRolls: entry.defender.rolls },
        dieSize: dice.dieSize,
        timing: REPLAY_TIMING,
      }),
    };
    thrownDice = { from: entry.from, to: entry.to };
  }

  /** The board the throw was for, once the dice have stopped on it. */
  function landRoll({ entry, nodes }) {
    settleThrownDice(nodes);
    dice.update({ nodes });
    poles.settle({ nodes });
    if (fight) fight.nodes = nodes;
    hud.showBattle(entry); // the faces, now that they have actually landed
  }

  /**
   * Stands a thrown pair of stacks back up against whatever board is about to
   * be drawn — the step the throw was for, or another entirely if the track
   * moved on before the dice landed.
   *
   * `dice.update` cannot do it: it rebuilds a stack only when the *count*
   * changes, and a defender taken with exactly as many dice as it held keeps
   * its count while every one of them lies scattered. `reroll` rebuilds
   * regardless, which is why live play calls it by hand too.
   */
  function settleThrownDice(nodes) {
    if (!thrownDice) return;
    const { from, to } = thrownDice;
    thrownDice = null;
    dice.reroll(from, { nodes });
    dice.reroll(to, { nodes });
  }

  // The planet as some step left it, with that step's fight marked. Only the
  // surface — dice, stats and the readout have nothing per-frame in them, so
  // they are drawn once by `applyStep` and left alone.
  function paintBoard(nodes, entry, pulse) {
    const marks = highlightsFor({ attack: entry && { from: entry.from, to: entry.to }, pulse });
    surface.refresh({ nodes }, (territoryId) => marks.get(territoryId) ?? null);
  }

  /**
   * Drops everything in the air without drawing anything.
   *
   * Deliberately leaves `thrownDice` alone: a throw whose stacks are still
   * lying on the ground is not an animation, it is a fact about the board, and
   * `reset` is what puts it right.
   */
  function clear() {
    pendingStep = null;
    fight = null;
    roll = null;
    step = 0;
  }

  return {
    /** Where the track is standing. */
    get step() {
      return step;
    },

    /**
     * Live play paints while the camera is still swinging, because the dice
     * landing *is* the event. A replay has nothing to catch up to — the board
     * changes only because the track moved, so painting before the camera
     * arrives just looks like the planet changed for no reason. Here, and only
     * here, the swing runs first and the board waits for it.
     */
    showStep(at, { moveCamera = true } = {}) {
      const nodes = replay.boardAt(at);
      const entry = at > 0 ? replay.attacks[at - 1] : null;
      // Only a step *forward* throws dice: playing and › move one at a time
      // and are worth watching, where a scrub passes through dozens and
      // stepping back is arriving at a board rather than watching it happen.
      const animate = at === step + 1;

      step = at;
      roll = null; // this seek supersedes whatever was still in the air
      pendingStep = null; // and whatever was still waiting on the camera

      // Looks ahead through every attack still to come, so a run of nearby
      // fights gets one swing. `moveCamera` is off mid-scrub, and the camera
      // is freed for a viewer watching one corner: both suppress only the
      // *swing*, and skipping it skips the wait for it, which is what keeps a
      // scrub up with the hand doing it.
      if (moveCamera && !cameraFreed() && entry && focusFights(replay.attacks.slice(at - 1))) {
        pendingStep = { at, entry, nodes, animate };
        return; // applied once the swing lands, in tick() below
      }

      applyStep(at, entry, nodes, { animate });
    },

    /** One frame of whatever this has in the air. */
    tick(dt) {
      if (pendingStep && !isSwinging()) {
        const { at, entry, nodes, animate } = pendingStep;
        pendingStep = null;
        applyStep(at, entry, nodes, { animate });
      }
      if (roll) {
        roll.elapsed += dt;
        const beat = roll.animation.apply(roll.elapsed);
        if (beat.phase === 'done') {
          const landed = roll;
          roll = null;
          landRoll(landed);
        }
      }
      if (fight) {
        fight.elapsed += dt;
        paintBoard(fight.nodes, fight.entry, pulseAt(fight.elapsed));
      }
    },

    /** For a session being disposed, where the planet is leaving the scene. */
    clear,

    /**
     * ...and giving the planet back. `liveNodes` is the board the real match
     * is standing on, which is what any dice still lying scattered from a
     * replayed throw have to be stood back up against.
     */
    reset(liveNodes) {
      clear();
      settleThrownDice(liveNodes);
    },
  };
}
