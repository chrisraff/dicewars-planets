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
 * Drives the game: whose turn it is, what the human has selected, when an
 * attack is playing out, and when the AI takes its turn. Knows nothing about
 * three.js — it emits events and the renderer listens, which is what lets the
 * whole turn loop be tested without a browser.
 *
 * Time comes in through `tick(dt)` rather than a clock, so a test can run a
 * hundred turns instantly and the renderer can drive it off its own frames.
 */
export function createGame({
  world,
  humanPlayerId = world.playerIds[0],
  strategy = createSimpleStrategy(),
  timing = DEFAULT_TIMING,
  aiTiming = AI_TIMING,
  rollDie,
} = {}) {
  let state = createInitialState(world);
  let selection = null;
  let pending = null; // the resolved-but-not-yet-shown result of an attack
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
    const result = reduce(state, attack(from, to), rollDie ? { rollDie } : {});
    const event = result.events.find((e) => e.type === 'attack');
    const beats = timingFor(currentPlayer());

    pending = result.state;
    countdown = attackDuration(beats);
    setSelection(null);
    emit('attack', { event, timing: beats });
  }

  function finishAttack() {
    state = pending;
    pending = null;
    emit('resolved', state);
    emit('change', state);

    if (!isHumanTurn()) thinking = AI_THINK_PAUSE;
  }

  function finishTurn() {
    const { state: next, events } = reduce(state, endTurnAction(), rollDie ? { rollDie } : {});
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
