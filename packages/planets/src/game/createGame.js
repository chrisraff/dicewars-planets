import {
  createInitialState,
  reduce,
  attack,
  endTurn as endTurnAction,
  isLegalAttack,
  getCurrentPlayerId,
  createSimpleStrategy,
  neighbors,
} from '@dicewars/core';
import { attackDuration, DEFAULT_TIMING } from '../render/rollTimeline.js';

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
 * that board was fought over.
 */
export function createGame({
  world,
  savedState = null,
  humanPlayerId = world.playerIds[0],
  strategy = createSimpleStrategy(),
  timing = DEFAULT_TIMING,
  aiTiming = AI_TIMING,
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
  let thinking = 0; // seconds left before the AI's next move

  const listeners = new Map();
  const emit = (name, payload) => {
    for (const fn of listeners.get(name) ?? []) fn(payload);
  };

  const currentPlayer = () => getCurrentPlayerId(state);
  const isHumanTurn = () => currentPlayer() === humanPlayerId;
  const isBusy = () => pending !== null;
  const isOver = () => state.phase === 'gameover';

  function timingFor(playerId) {
    return playerId === humanPlayerId ? timing : aiTiming;
  }

  function setSelection(next) {
    if (selection === next) return;
    selection = next;
    emit('selection', selection);
  }

  // Territories the selected one could attack right now.
  function legalTargets(from = selection) {
    if (from === null || from === undefined) return [];
    return [...neighbors(state.graph, from)].filter((to) => isLegalAttack(state, from, to));
  }

  function beginAttack(from, to) {
    const result = reduce(state, attack(from, to), deps);
    const event = result.events.find((e) => e.type === 'attack');
    const beats = timingFor(currentPlayer());

    pending = result.state;
    // held back until the dice land — a player being knocked out is news that
    // belongs after the roll that did it, not before
    pendingEvents = result.events.filter((e) => e.type !== 'attack');
    countdown = attackDuration(beats);
    setSelection(null);
    emit('attack', { event, timing: beats });
  }

  function finishAttack() {
    state = pending;
    pending = null;

    emit('resolved', state);
    for (const event of pendingEvents) emit(event.type, event);
    pendingEvents = [];
    emit('change', state);

    if (!isHumanTurn()) thinking = AI_THINK_PAUSE;
  }

  function finishTurn() {
    const { state: next, events } = reduce(state, endTurnAction(), deps);
    state = next;
    setSelection(null);

    for (const event of events) emit(event.type, event);
    emit('change', state);

    if (isOver()) emit('over', state.winner);
    else if (!isHumanTurn()) thinking = AI_THINK_PAUSE;
  }

  function takeAiTurn() {
    const move = strategy(state, currentPlayer());
    if (move) beginAttack(move.from, move.to);
    else finishTurn();
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
    legalTargets,
    currentPlayer,

    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
      return () => {
        listeners.set(name, listeners.get(name).filter((f) => f !== fn));
      };
    },

    /**
     * The one entry point for clicking the planet. Click your own territory
     * to pick it up, click an enemy neighbor to attack it, click anywhere
     * else to put it back down.
     */
    clickTerritory(territoryId) {
      if (isOver() || isBusy() || !isHumanTurn()) return;
      if (territoryId === null || territoryId === undefined) return setSelection(null);

      if (selection !== null && isLegalAttack(state, selection, territoryId)) {
        return beginAttack(selection, territoryId);
      }

      const node = state.nodes.get(territoryId);
      const mine = node?.owner === humanPlayerId;
      if (territoryId === selection || !mine || node.dice <= 1) return setSelection(null);
      setSelection(territoryId);
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
