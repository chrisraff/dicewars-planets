import {
  createInitialState,
  reduce,
  attack,
  endTurn as endTurnAction,
  isLegalAttack,
  getCurrentPlayerId,
  createSimpleStrategy,
  surrenderedPlayerIds,
  livingPlayerIds,
  neighbors,
} from '@dicewars/core';
import { attackDuration, cancelWindow, DEFAULT_TIMING } from '../render/rollTimeline.js';
import { reinforceDuration } from '../render/reinforceTimeline.js';

// The AI plays the same animation, just briskly — a computer turn of six
// attacks at human pace is a long time to sit and watch.
export const AI_TIMING = { aim: 0.12, roll: 0.45, read: 0.25, settleFrom: 0.55 };
const AI_THINK_PAUSE = 0.25; // beat between one AI move and the next

/**
 * Nobody in the human seat, so every player is the AI and the match plays
 * itself — how a whole game is exercised in a test and how a demo runs
 * unattended. A value matching no player id says that outright, where a bare
 * `humanPlayerId: null` read like something left unfinished.
 */
export const AUTOPLAY = Symbol('autoplay');

/**
 * Drives the game: whose turn it is, what the human has selected, when an
 * attack is playing out, and when the AI takes its turn. Knows nothing about
 * three.js — it emits events and the renderer listens, which is what lets the
 * whole turn loop be tested without a browser.
 *
 * Time comes in through `tick(dt)` rather than a clock, so a test can run a
 * hundred turns instantly and the renderer can drive it off its own frames.
 *
 * `savedState` resumes a match instead of dealing a new one; the same world
 * still has to be supplied, since it is the planet that board was fought over.
 * `playedOn` and `surrenderOffered` come back with it, so the surrender is
 * still asked once per match across a reload — the session puts that banner
 * back by hand rather than the question being asked again.
 */
export function createGame({
  world,
  savedState = null,
  playedOn: startPlayedOn = false,
  surrenderOffered: startSurrenderOffered = false,
  humanPlayerId = world.playerIds[0],
  // The opponent, for a caller that has no opinion. A real match always has
  // one: the session picks from the difficulty setting (`strategyFor`), and
  // this matches what it picks on Normal.
  strategy = createSimpleStrategy(),
  timing = DEFAULT_TIMING,
  aiTiming = AI_TIMING,
  // How an AI's turn, once fully worked out, gets reordered for *display* —
  // identity by default, so nothing changes unless a renderer opts in with
  // something camera-aware (see game/aiTurnOrder.js).
  orderAiTurn = (moves) => moves,
  rollDie,
  rng,
} = {}) {
  // the two sources of chance in the rules; left out, core falls back to
  // Math.random, which is what a real game wants
  const deps = {};
  if (rollDie) deps.rollDie = rollDie;
  if (rng) deps.rng = rng;

  // a game being resumed carries on from the board it was saved on; a fresh
  // one deals the world it was handed
  let state = savedState ?? createInitialState(world);
  let selection = null;
  let pending = null; // the resolved-but-not-yet-shown result of an attack
  let pendingEvents = []; // everything else that happened in the same action
  let countdown = 0; // seconds left before `pending` is applied
  // The player's own attack, while it can still be cancelled: how long is
  // left to do it in, and what taking it back has to put back. Only ever set
  // for the human — see `performAttack`.
  let cancelable = null; // { left, event, selection, attacked } or null
  let pendingReinforce = null; // the resolved-but-not-yet-applied end of turn
  let pendingReinforceEvents = []; // 'endTurn' and, if it applies, 'gameOver'
  let reinforceCountdown = 0; // seconds left before `pendingReinforce` is applied
  let thinking = 0; // seconds left before the AI's next move
  // The current AI turn, fully worked out and reordered for display, one
  // entry played per takeAiTurn() call — null between turns, built fresh the
  // moment a turn starts. See planAiTurnMoves/orderAiTurn below.
  let aiQueue = null;
  // Whether the current player has attacked since their turn began — not a
  // core rule, just what tells `finishTurn` whether this player passed. Reset
  // the moment the next player's turn actually starts (`finishReinforce`),
  // not when `endTurn` is merely requested, since reinforcement is still this
  // player's own turn finishing up.
  let attackedThisTurn = false;
  // Whether the player has been offered the match, and whether they turned it
  // down. Refusing is final: somebody who said they would rather finish the
  // job should not be asked again every turn while they do it.
  let surrenderOffered = startSurrenderOffered;
  let playedOn = startPlayedOn;

  const listeners = new Map();
  const emit = (name, payload) => {
    for (const fn of listeners.get(name) ?? []) fn(payload);
  };

  const currentPlayer = () => getCurrentPlayerId(state);
  const isHumanTurn = () => currentPlayer() === humanPlayerId;
  const isBusy = () => pending !== null || pendingReinforce !== null;
  // Not `isBusy`: an attack that can still be taken back is exactly the state
  // where a press means something other than "wait".
  const canCancel = () => cancelable !== null && cancelable.left > 0;
  const isOver = () => state.phase === 'gameover';

  function timingFor(playerId) {
    return playerId === humanPlayerId ? timing : aiTiming;
  }

  function setSelection(next) {
    if (selection === next) return;
    selection = next;
    emit('selection', selection);
  }

  /**
   * What tapping `territoryId` would do right now, without doing any of it:
   * `'attack'`, `'select'`, `'drop'` — put the held territory back down — or
   * `null` for a tap that would change nothing.
   *
   * The interface has to answer this *before* the tap: a press is marked on
   * the board while the finger is still down, so a mark promising something
   * the tap then did not do would be worse than no mark. `clickTerritory` is
   * written in terms of this so the two cannot drift apart.
   */
  function pressActionOn(territoryId) {
    if (isOver() || isBusy() || !isHumanTurn()) return null;
    // Anywhere that is not a territory — ocean, or space past the planet's
    // edge — is a place to put a held territory down, and nothing otherwise.
    if (territoryId === null || territoryId === undefined) {
      return selection === null ? null : 'drop';
    }

    if (selection !== null && isLegalAttack(state, selection, territoryId)) return 'attack';

    const node = state.nodes.get(territoryId);
    const mine = node?.owner === humanPlayerId;
    // Somebody else's ground, ground of yours too thin to attack from, or the
    // one already held — none of them can be picked up, so the tap is only
    // ever the same "put it down" as tapping the ocean.
    if (territoryId === selection || !mine || node.dice <= 1) {
      return selection === null ? null : 'drop';
    }
    return 'select';
  }

  // Territories the selected one could attack right now.
  function legalTargets(from = selection) {
    if (from === null || from === undefined) return [];
    return [...neighbors(state.graph, from)].filter((to) => isLegalAttack(state, from, to));
  }

  // `rollDie`, given, overrides the real dice for this one attack — how a
  // queued AI move (already rolled once, during planning) gets redisplayed
  // without rolling twice. `upcoming` is this move plus whatever's still
  // queued behind it, for a renderer building a camera cluster rather than
  // swinging to just this one spot.
  function performAttack(from, to, rollDie, upcoming = [{ from, to }]) {
    const localDeps = rollDie ? { ...deps, rollDie } : deps;
    const result = reduce(state, attack(from, to), localDeps);
    const event = result.events.find((e) => e.type === 'attack');
    const beats = timingFor(currentPlayer());

    pending = result.state;
    // held back until the dice land — a player being knocked out is news that
    // belongs after the roll that did it, not before
    pendingEvents = result.events.filter((e) => e.type !== 'attack');
    countdown = attackDuration(beats);
    // Everything a cancel would have to put back, captured before any of it
    // is disturbed. Only the player's own throw: an attack nobody declared
    // cannot be regretted, and a stray tap during an AI's turn cancelling
    // *its* move would be absurd.
    const window = cancelWindow(beats);
    cancelable = currentPlayer() === humanPlayerId
      ? { left: window, total: window, event, selection, attacked: attackedThisTurn }
      : null;
    attackedThisTurn = true;
    setSelection(null);
    // `eliminated` travels with the declaration as well as being emitted
    // later, and only for the one listener that must not wait: a knockout is
    // part of what this attack *did*, so anything writing the outcome down
    // now (see `settledState`) has to be able to write that down with it.
    // Everything that merely shows it still reads it off the event below.
    const eliminated = pendingEvents.find((e) => e.type === 'eliminated') ?? null;
    emit('attack', { event, eliminated, timing: beats, upcoming });
  }

  // A one-shot rollDie that replays exactly the faces a planned move already
  // rolled during planAiTurnMoves. Redisplaying a queued move can be against
  // a different board than the true simulation left it on — see
  // aiTurnOrder.js — so the win/lose outcome has to be pinned to what was
  // actually rolled, while reduce() itself is left to freshly (and
  // correctly) decide elimination/game-over off the board as it stands now.
  function replayRoll(values) {
    let i = 0;
    return () => values[i++];
  }

  // Works out the rest of this AI's turn ahead of the display, using the
  // real dice/rng exactly once and in true order — reordering only ever
  // changes what gets *shown* first, never what happens or how much
  // randomness the match consumes. Stops the moment a move ends the game
  // outright: nothing can legally follow that one, live or planned, so it's
  // tagged `terminal` rather than left for orderAiTurn to (mis)place.
  function planAiTurnMoves(fromState, playerId) {
    const moves = [];
    let current = fromState;
    for (;;) {
      const move = strategy(current, playerId);
      if (!move) break;
      const result = reduce(current, attack(move.from, move.to), deps);
      const event = result.events.find((e) => e.type === 'attack');
      moves.push({ from: move.from, to: move.to, event });
      current = result.state;
      if (current.phase === 'gameover') {
        moves[moves.length - 1].terminal = true;
        break;
      }
    }
    return moves;
  }

  /**
   * Takes back an attack that has been declared but whose dice have not come
   * up yet — see `cancelWindow`, which is the whole of what makes this safe.
   *
   * There is nothing in the rules to unwind. `reduce` has already run, but its
   * result was parked in `pending` and the live board has not moved, so a
   * cancel is dropping that result and putting back the three things the
   * declaration disturbed on the way past: the selection, whether this player
   * has attacked yet, and — through the `cancelled` event — the entry the
   * replay wrote down.
   *
   * `attacked` is *restored* rather than cleared: a cancelled attack is not an
   * attack, but the player may well have made a real one earlier in the same
   * turn, and clearing it would report that turn as a pass.
   */
  function cancelAttack() {
    if (!canCancel()) return false;

    const { event, selection: held, attacked } = cancelable;
    pending = null;
    pendingEvents = [];
    countdown = 0;
    cancelable = null;
    attackedThisTurn = attacked;

    // The attacker goes back in the player's hand *before* the cancel is
    // announced, and the order is load-bearing: a listener that treats picking
    // a territory as having moved on from the cancel would otherwise be told
    // about this restore and undo its own announcement. Putting the board back
    // is part of cancelling, not a consequence of it.
    setSelection(held);
    emit('cancelled', { event });
    // The board never changed, so this says "nothing happened after all"
    // rather than "here is what happened" — which is exactly what anything
    // writing a save down off the back of it needs to hear.
    emit('change', state);
    return true;
  }

  function finishAttack() {
    state = pending;
    pending = null;
    cancelable = null;

    emit('resolved', state);
    for (const event of pendingEvents) emit(event.type, event);
    pendingEvents = [];
    emit('change', state);

    // The winning attack can decide the match on the spot — taking the last
    // opponent's last territory — and the player who just won shouldn't have
    // to end their turn to be told that. See `finishReinforce` below for the
    // same check at the other place a game can end.
    if (isOver()) emit('over', state.winner);
    else if (!isHumanTurn()) thinking = AI_THINK_PAUSE;
  }

  // Held back exactly the way an attack is: the board should not show
  // reinforcement dice — and a save should not record them — before they have
  // visibly landed. `event` still goes out immediately, so the renderer can
  // start the drop the moment the payout is known rather than waiting for it.
  function finishTurn() {
    const result = reduce(state, endTurnAction(), deps);
    const event = result.events.find((e) => e.type === 'endTurn');

    pendingReinforce = result.state;
    pendingReinforceEvents = result.events;
    reinforceCountdown = reinforceDuration(event.landed.length);
    setSelection(null);
    emit('reinforce', { ...event, passed: !attackedThisTurn });
  }

  function finishReinforce() {
    // whose turn this was — read before the queue is cleared, since the
    // surrender below is only ever judged at the end of the player's own
    const endedTurnOf = pendingReinforceEvents.find((e) => e.type === 'endTurn')?.playerId ?? null;

    state = pendingReinforce;
    pendingReinforce = null;
    attackedThisTurn = false; // this player's turn is over; the next one starts clean

    for (const event of pendingReinforceEvents) emit(event.type, event);
    pendingReinforceEvents = [];
    emit('change', state);

    if (isOver()) return emit('over', state.winner);

    if (endedTurnOf === humanPlayerId) offerSurrender();
    if (!isHumanTurn()) thinking = AI_THINK_PAUSE;
  }

  /**
   * Every opponent left has given the game up, so the player is told they have
   * won it — while the game carries on underneath, untouched. `phase` is still
   * `attack`, the AIs play on exactly as they were, and "play on" does no more
   * than stop the banner being offered again.
   *
   * That is deliberate: a surrender is an opinion about the position rather
   * than an outcome of it, and one the player has to be able to disagree with,
   * which they cannot do if the match has been ended underneath them.
   *
   * Judged at the end of the player's own turn, the one moment the board is
   * settled and they are looking at it.
   */
  function offerSurrender() {
    if (playedOn || surrenderOffered || humanPlayerId === AUTOPLAY) return;

    const living = livingPlayerIds(state);
    if (!living.includes(humanPlayerId)) return;

    const rivals = living.filter((id) => id !== humanPlayerId);
    if (rivals.length === 0) return; // the game is about to be won outright anyway

    const surrendered = surrenderedPlayerIds(state);
    if (!rivals.every((id) => surrendered.has(id))) return;

    surrenderOffered = true;
    emit('surrendered', { playerId: humanPlayerId, surrendered: rivals });
  }

  function takeAiTurn() {
    if (aiQueue === null) {
      const moves = planAiTurnMoves(state, currentPlayer());
      // the terminal move (if any) can never be reordered — the whole game
      // is over the instant it lands, so it has to stay last
      const terminal = moves.length > 0 && moves[moves.length - 1].terminal ? moves.pop() : null;
      aiQueue = orderAiTurn(moves, currentPlayer());
      if (terminal) aiQueue.push(terminal);
    }

    if (aiQueue.length === 0) {
      aiQueue = null;
      finishTurn();
      return;
    }

    const next = aiQueue.shift();
    const rollDie = replayRoll([...next.event.attackRolls, ...next.event.defendRolls]);
    performAttack(next.from, next.to, rollDie, [
      { from: next.from, to: next.to },
      ...aiQueue.map(({ from, to }) => ({ from, to })),
    ]);
  }

  return {
    get state() {
      return state;
    },
    get selection() {
      return selection;
    },
    humanPlayerId,
    isHumanTurn,
    isBusy,
    isOver,

    /**
     * The board once whatever is in mid-air has landed — the identical object
     * as `state` when nothing is.
     *
     * An attack is decided the instant it is declared: the `attack` event
     * already carries the faces that will come up, and `state` waits only so
     * the dice have somewhere to land. Nothing drawn on screen may read this —
     * waiting is what the animation is for — but a **save** must, or the
     * player can refuse it: read the total off the faces, reload before they
     * land, and fight the same battle again. A payout is the same against
     * `rng`.
     *
     * Only one move is ever outstanding — a turn cannot end on top of a
     * pending attack — so there is never more than one thing to settle.
     */
    get settledState() {
      return pending ?? pendingReinforce ?? state;
    },

    /**
     * The offer to take the attack back, while there is one: how long is left
     * and how long there was, which is a bar. `null` the rest of the time,
     * including the stretch of the same attack after the window has shut.
     */
    get cancelOffer() {
      return canCancel() ? { left: cancelable.left, total: cancelable.total } : null;
    },

    /**
     * Takes back the attack in the air, if it is still early enough. Answers
     * whether it did, so a press that arrives a frame late falls through to
     * meaning whatever it would otherwise have meant.
     */
    cancelAttack,

    /** Whether the player has already refused a surrender this match. */
    get playedOn() {
      return playedOn;
    },

    /**
     * Whether the offer has been made — asked once per *match*, so this has to
     * be saved alongside `playedOn` rather than reset with the page. It is
     * what tells a restoring session there is a banner owed.
     */
    get surrenderOffered() {
      return surrenderOffered;
    },

    /** Refuses one: the match runs to a real finish and is never offered again. */
    playOn() {
      playedOn = true;
    },

    legalTargets,
    currentPlayer,

    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
      return () => {
        listeners.set(name, listeners.get(name).filter((f) => f !== fn));
      };
    },

    pressActionOn,

    /**
     * The one entry point for clicking the planet. Click your own territory
     * to pick it up, click an enemy neighbor to attack it, click anywhere
     * else to put it back down.
     *
     * Which of those it is has already been decided by `pressActionOn`, and
     * is asked rather than worked out again: the board may have been showing
     * that answer under the player's finger for a second before they let go.
     */
    clickTerritory(territoryId) {
      switch (pressActionOn(territoryId)) {
        case 'attack':
          return performAttack(selection, territoryId);
        case 'select':
          return setSelection(territoryId);
        case 'drop':
          return setSelection(null);
        default:
          return undefined;
      }
    },

    endTurn() {
      if (isOver() || isBusy() || !isHumanTurn()) return;
      finishTurn();
    },

    // Advances animations and lets the AI play. `dt` is seconds.
    tick(dt) {
      if (isOver()) return;

      if (pending !== null) {
        countdown -= dt;
        // Runs out first, and on its own clock: the offer has to close well
        // before the dice do. Left at zero rather than nulled, so the
        // renderer can tell "the window has shut" from "there was never one".
        if (cancelable !== null) cancelable.left = Math.max(0, cancelable.left - dt);
        if (countdown <= 0) finishAttack();
        return;
      }

      if (pendingReinforce !== null) {
        reinforceCountdown -= dt;
        if (reinforceCountdown <= 0) finishReinforce();
        return;
      }

      if (isHumanTurn()) return;

      thinking -= dt;
      if (thinking <= 0) takeAiTurn();
    },

    start() {
      emit('change', state);
      if (!isHumanTurn()) thinking = AI_THINK_PAUSE;
    },
  };
}
