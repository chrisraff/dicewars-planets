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
import { attackDuration, DEFAULT_TIMING } from '../render/rollTimeline.js';
import { reinforceDuration } from '../render/reinforceTimeline.js';

// The AI plays the same animation, just briskly — a computer turn of six
// attacks at human pace is a long time to sit and watch.
export const AI_TIMING = { aim: 0.12, roll: 0.45, read: 0.25 };
const AI_THINK_PAUSE = 0.25; // beat between one AI move and the next

/**
 * Nobody in the human seat, so every player is the AI and the match plays
 * itself. This is how a whole game is exercised in a test, and how a demo
 * runs unattended — a value that matches no player id says that outright,
 * where a bare `humanPlayerId: null` read like something left unfinished.
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
 * `savedState` resumes a match instead of dealing a new one. Nothing else
 * changes: the same world still has to be supplied, because it is the planet
 * that board was fought over. `playedOn` and `surrenderOffered` come back with
 * it — a player who has already waved the surrender away is not asked again
 * after a reload, and one who was asked but never answered is not asked twice.
 * The session restores that banner instead, which is the only way the question
 * survives a reload as the question it was.
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
   * `null` for a tap that would change nothing at all.
   *
   * This exists because the interface now has to answer that question
   * *before* the tap happens rather than after it. A press is shown on the
   * board while a finger is still down, so the player can see what releasing
   * would do while there is still time to drag away instead — and a mark that
   * promised something the tap then did not do would be worse than no mark.
   * `clickTerritory` is written in terms of this for exactly that reason:
   * there is one set of rules, so the two cannot drift apart.
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
    attackedThisTurn = true;
    setSelection(null);
    emit('attack', { event, timing: beats, upcoming });
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

  function finishAttack() {
    state = pending;
    pending = null;

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
   * Every opponent left has given the game up, so the player is told they
   * have won it — while the game itself carries on underneath, untouched.
   *
   * Nothing here changes a rule or a piece of state: `phase` is still
   * `attack`, the AIs go on playing exactly as they were, and "play on" is
   * only a matter of not putting the banner up again. That is deliberate. A
   * surrender is an opinion about the position rather than an outcome of it,
   * and one the player is entitled to disagree with — which they cannot do if
   * the match has already been ended underneath them.
   *
   * Judged once a turn, at the end of the player's own, because that is the
   * one moment the board is settled and the player is looking at it: mid-way
   * through an AI's run of attacks is neither.
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
