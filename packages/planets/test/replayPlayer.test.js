import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createReplayPlayer } from '../src/game/replayPlayer.js';
import { createReplay } from '../src/game/replay.js';
import { createDiceLayer } from '../src/render/diceLayer.js';
import { attackDuration, REPLAY_TIMING } from '../src/render/rollTimeline.js';
import { seededRng } from '@dicewars/core/test-support';

// Two territories, one each — the smallest board an attack can happen on.
const world = {
  cells: [
    { id: 0, center: { x: 0, y: 0, z: 1 }, neighbors: [1] },
    { id: 1, center: { x: 1, y: 0, z: 0 }, neighbors: [0] },
  ],
  territories: [
    { id: 'a', cellIds: [0] },
    { id: 'b', cellIds: [1] },
  ],
};

const materials = Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial());

/**
 * The one attack every test here replays: red takes blue's territory with
 * three dice against one, so the board before it and the board after it differ
 * in both owner and dice count.
 */
const ATTACK = {
  kind: 'battle',
  from: 'a',
  to: 'b',
  attacker: { playerId: 'p1', rolls: [6, 6, 6], total: 18 },
  defender: { playerId: 'p2', rolls: [1], total: 1 },
  attackerWins: true,
};

/**
 * A player wired to a real replay and a real dice layer, with the things it
 * only ever writes to — the surface, the poles, the HUD — recorded instead.
 *
 * Real collaborators where the behaviour under test depends on theirs:
 * `createReplay` is what decides what a step's board *is*, and `createDiceLayer`
 * is what `settleThrownDice` exists to work around.
 */
function setup({ moves = [ATTACK], swings = false } = {}) {
  const layer = createDiceLayer(world, materials, { rng: seededRng(1) });
  const anchor = new Map([
    ['a', { owner: 'p1', dice: 4 }],
    ['b', { owner: 'p2', dice: 1 }],
  ]);
  layer.update({ nodes: anchor });

  const replay = createReplay({
    nodes: anchor,
    reserves: new Map([['p1', 0], ['p2', 0]]),
    moves,
  });

  const log = { painted: [], updated: [], rerolled: [], battles: [], histories: [] };
  let swinging = false;

  const player = createReplayPlayer({
    replay,
    playerIds: ['p1', 'p2'],
    surface: { refresh: ({ nodes }) => log.painted.push(nodes) },
    poles: { settle: () => {} },
    dice: {
      get dieSize() { return layer.dieSize; },
      standFor: (id) => layer.standFor(id),
      update: ({ nodes }) => { log.updated.push(nodes); layer.update({ nodes }); },
      reroll: (id, state) => { log.rerolled.push(id); layer.reroll(id, state); },
    },
    hud: {
      showPlayers: () => {},
      showBattle: (entry, options) => log.battles.push({ entry, options }),
      setHistory: (entries) => log.histories.push(entries),
    },
    focusFights: () => {
      if (!swings) return false;
      swinging = true;
      return true;
    },
    isSwinging: () => swinging,
    cameraFreed: () => false,
    finalWinner: () => null,
  });

  return { player, replay, log, land: () => { swinging = false; } };
}

const ownerOf = (nodes, id) => nodes.get(id).owner;
const lastPainted = (log) => log.painted[log.painted.length - 1];
// How many steps have actually been *applied*. `setHistory` runs once per
// application, where painting also runs every frame a fight is throbbing.
const applied = (log) => log.histories.length;

// --- which steps animate ----------------------------------------------------

test('a step forward paints the board from *before* its attack', () => {
  // The stacks have to be standing where they are about to be thrown from, or
  // the dice fly out of a territory that has already changed hands.
  const { player, log } = setup();
  player.showStep(1);

  assert.equal(ownerOf(lastPainted(log), 'b'), 'p2', 'painted before the capture');
  assert.equal(log.battles.at(-1).options?.revealed, false, 'faces held back while in the air');
});

test('and lands on the board after it once the dice stop', () => {
  const { player, log } = setup();
  player.showStep(1);
  player.tick(attackDuration(REPLAY_TIMING) + 0.01);

  assert.equal(ownerOf(log.updated.at(-1), 'b'), 'p1', 'the capture, once the dice landed');
  assert.equal(log.battles.at(-1).options, undefined, 'and the faces revealed');
});

test('stepping back arrives at a board rather than watching it happen', () => {
  // A scrub passes through dozens of steps and stepping back is not something
  // to watch, so only a step *forward* throws dice.
  const { player, log } = setup();
  player.showStep(1);
  const thrown = log.battles.length;

  player.showStep(0);
  assert.equal(log.battles.at(-1).options, undefined, 'no throw, so nothing to hold back');
  assert.equal(ownerOf(lastPainted(log), 'b'), 'p2');
  assert.ok(log.battles.length > thrown);
});

test('a jump of more than one step does not animate either', () => {
  const { player, log } = setup({ moves: [ATTACK, { ...ATTACK, from: 'b', to: 'a' }] });
  player.showStep(2);
  assert.equal(log.battles.at(-1).options, undefined, 'arrived, rather than played');
});

// --- the board waiting for the camera ---------------------------------------

test('a step that starts a swing paints nothing until the camera lands', () => {
  // Live play paints while the camera is still moving because the dice landing
  // *is* the event. A replay has nothing to catch up to, so painting early
  // just looks like the planet changed for no reason.
  //
  // Counted in steps *applied* rather than paints: an applied step repaints
  // itself every frame afterwards, throbbing its fight the way a live one does.
  const { player, log, land } = setup({ swings: true });
  player.showStep(1);
  assert.equal(applied(log), 0, 'held for the swing');
  assert.equal(log.painted.length, 0, 'and nothing drawn at all');

  player.tick(0.016);
  assert.equal(applied(log), 0, 'still swinging');

  land();
  player.tick(0.016);
  assert.equal(applied(log), 1, 'applied once the swing landed');
  assert.equal(ownerOf(lastPainted(log), 'b'), 'p2', 'and the board it paints is that step');
});

test('a scrub paints on the spot, because it is the swing that is skipped', () => {
  // Skipping the swing skips the wait for it, which is what keeps a scrub up
  // with the hand doing it.
  const { player, log } = setup({ swings: true });
  player.showStep(1, { moveCamera: false });
  assert.equal(log.painted.length, 1);
});

test('a seek supersedes a step still waiting on the camera', () => {
  const { player, log, land } = setup({ moves: [ATTACK, { ...ATTACK, from: 'b', to: 'a' }], swings: true });
  player.showStep(1); // held for a swing
  assert.equal(applied(log), 0);

  player.showStep(2, { moveCamera: false });
  assert.equal(applied(log), 1, 'the second seek applies on the spot');

  land();
  player.tick(0.016);
  assert.equal(applied(log), 1, 'and the abandoned step never arrives');
  assert.equal(player.step, 2);
});

// --- the reason settleThrownDice exists -------------------------------------

test('both territories are stood back up by hand when a throw lands', () => {
  // `dice.update` rebuilds a stack only when its *count* changes, and a
  // defender taken with exactly as many dice as it was holding keeps its count
  // while every one of its dice is lying scattered on the ground. `reroll`
  // rebuilds regardless, which is the whole reason it is called by hand.
  const { player, log } = setup();
  player.showStep(1);
  log.rerolled.length = 0;

  player.tick(attackDuration(REPLAY_TIMING) + 0.01);
  assert.deepEqual(log.rerolled.sort(), ['a', 'b'], 'attacker and defender both');
});

test('closing while a throw is still in the air stands it up against the live board', () => {
  // The dice are lying scattered on a board the replay invented; what they
  // have to be stood back up against is the match the player is returning to.
  const { player, log } = setup();
  player.showStep(1);
  log.rerolled.length = 0;

  const live = new Map([['a', { owner: 'p1', dice: 7 }], ['b', { owner: 'p2', dice: 2 }]]);
  player.reset(live);

  assert.deepEqual(log.rerolled.sort(), ['a', 'b']);
  assert.equal(player.step, 0, 'and the track is back at the start');
});

test('a close with nothing in the air touches no dice', () => {
  const { player, log } = setup();
  player.showStep(1, { moveCamera: false });
  player.tick(attackDuration(REPLAY_TIMING) + 0.01); // the throw lands and settles itself
  log.rerolled.length = 0;

  player.reset(new Map());
  assert.deepEqual(log.rerolled, []);
});

// --- what the panels say ----------------------------------------------------

test('the history is truncated to the step, so a scrub back does not spoil', () => {
  const second = { ...ATTACK, from: 'b', to: 'a' };
  const { player, log } = setup({ moves: [ATTACK, second] });

  player.showStep(1, { moveCamera: false });
  assert.equal(log.histories.at(-1).length, 1, 'only what had happened by then');

  player.showStep(2, { moveCamera: false });
  assert.equal(log.histories.at(-1).length, 2);
});

test('the opening board is a step like any other, with no fight to show', () => {
  const { player, log } = setup();
  player.showStep(0, { moveCamera: false });
  assert.equal(log.battles.at(-1).entry, null, 'nothing has happened yet');
  assert.equal(ownerOf(lastPainted(log), 'b'), 'p2');
});

// --- disposal ---------------------------------------------------------------

test('clear drops what is in the air without drawing anything', () => {
  // A session being disposed is about to take the planet out of the scene, so
  // there is nothing left worth painting onto.
  const { player, log } = setup();
  player.showStep(1);
  const painted = log.painted.length;
  const rerolled = log.rerolled.length;

  player.clear();
  player.tick(attackDuration(REPLAY_TIMING) + 0.01);

  assert.equal(log.painted.length, painted, 'nothing painted after clearing');
  assert.equal(log.rerolled.length, rerolled, 'and no dice touched');
});
