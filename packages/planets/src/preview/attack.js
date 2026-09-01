import { createInitialState, seededRng } from '@dicewars/core';
import { createViewer } from '../render/createViewer.js';
import { createDiePipMaterials } from '../render/diceTextures.js';
import { createPlanetSurface } from '../render/planetSurface.js';
import { createDiceLayer } from '../render/diceLayer.js';
import { createRollAnimation } from '../render/rollAnimation.js';
import { createSelectHandler } from '../render/selectPress.js';
import { createTerritoryPicker } from '../render/pickTerritory.js';
import { highlightsFor, pulseAt } from '../render/highlights.js';
import { assignPlayerColors } from '../render/palette.js';
import { CANCELLED_TOAST, createHud } from '../render/hud.js';
import {
  attackDuration,
  cancelWindow,
  firstLandingAt,
  groundedAt,
  DEFAULT_TIMING,
} from '../render/rollTimeline.js';
import { createGame } from '../game/createGame.js';
import { createBattleLog, battleEntry } from '../game/battleLog.js';
import { playerStatsFor } from '../game/playerStats.js';
import { generatePlanetWorld } from '../world/generateWorld.js';
// The names live with the session because a player's name *is* their colour,
// in palette order — one list, wherever it is read.
import { PLAYER_NAMES } from '../game/session.js';

/**
 * A planet to throw dice at, for as long as you like.
 *
 * The throw is the hardest thing in the game to judge from a description and
 * the hardest to catch in a match: it lasts two seconds, it needs a fight to
 * happen at all, and the interesting half of it — the cancel — is over in
 * under a second. So this is a board that refills itself, with the numbers
 * that shape the throw on sliders next to it.
 *
 * Everything under test is the real thing: `createGame` decides what a press
 * means and when a cancel is still allowed, `createRollAnimation` throws the
 * dice, `createHud` draws the readout with its × and its bar. What is *not*
 * real is the session around them — no camera, no saving, no AI, no turns —
 * because none of that is what a throw is made of, and a board that keeps
 * playing is a board that stops being a fixture to test against.
 *
 * The board is rebuilt rather than edited: topping the dice up means a fresh
 * `createGame` over the same world, which is why the game object is held in a
 * `let` and every handler is attached in one place.
 */

const scenarios = document.getElementById('scenarios');
const pipMaterials = createDiePipMaterials();

const PLAYER_IDS = ['p1', 'p2'];
const HUMAN = 'p1';
const SEED = 90210;

const playerColors = assignPlayerColors(PLAYER_IDS);
const playerNames = new Map(PLAYER_IDS.map((id, i) => [id, PLAYER_NAMES[i]]));

const world = generatePlanetWorld({
  subdivisions: 3,
  playerIds: PLAYER_IDS,
  rng: seededRng(SEED),
});

// Mutated in place by the sliders. `createGame` hands this same object to the
// roll animation for every attack, so a change lands on the next throw — which
// is the only throw it could sensibly land on, since a die already in the air
// is being animated against the clock it was thrown under.
const timing = { ...DEFAULT_TIMING, bounce: { ...DEFAULT_TIMING.bounce } };

// How many dice every territory is topped up to. Eight against eight is the
// worst case for the scatter and the most to read, so it is where this starts.
let fill = 8;
let autoRefill = true;

// --- the stage -------------------------------------------------------------

const section = document.createElement('section');
section.className = 'scenario';
section.innerHTML = `
  <h2>A board that refills itself</h2>
  <p></p>
  <div class="stage is-planet"></div>
`;
section.querySelector('p').textContent =
  'Tap one of your territories, then a neighbour, exactly as in the game. While the × is up '
  + 'a tap anywhere calls the attack off; once it has gone, a tap on a territory you are '
  + 'about to own skips the rest of the throw and picks it up. Drag to turn the planet — that '
  + 'never cancels. A refill keeps whatever you had selected.';
scenarios.append(section);

const stage = section.querySelector('.stage');
const canvas = document.createElement('canvas');
const hudHost = document.createElement('div');
hudHost.className = 'hud-host';
stage.append(canvas, hudHost);

const viewer = createViewer(canvas);
const surface = createPlanetSurface(world, playerColors);
const dice = createDiceLayer(world, pipMaterials);
viewer.scene.add(surface.group, dice.group);
viewer.camera.position.set(0, 0, 3.2);
viewer.controls.update();

const hud = createHud(hudHost, { playerColors, playerNames, humanPlayerId: HUMAN });
const battles = createBattleLog();

// --- the match, such as it is ---------------------------------------------

let game = null;
let roll = null;
// Which territory a finger is on right now. It belongs with the press
// handling further down and is declared up here for one reason: `refresh`
// reads it, and `refresh` runs before that section does — a `let` is in its
// temporal dead zone until its own line is reached, so leaving it there threw
// on the very first paint.
let pressed = null;
// Set from `resolved`, acted on in the frame loop. Refilling replaces the game
// object, and `resolved` is emitted part way through the old game's own
// sequence — its `change` comes after, and would repaint the board the refill
// had just replaced. So the rebuild waits for the frame.
let refillWanted = false;

/** Every territory back to `fill` dice, on the board as it stands. */
function toppedUp(state) {
  const nodes = new Map(
    [...state.nodes].map(([id, node]) => [id, { ...node, dice: fill }])
  );
  return { ...state, nodes };
}

function refresh(pulse = 1) {
  const marks = highlightsFor({
    selection: game.selection,
    targets: game.legalTargets(),
    attack: roll?.event ?? null,
    pressed,
    pulse,
  });
  surface.refresh(game.state, (territoryId) => marks.get(territoryId) ?? null);
  hud.showPlayers(playerStatsFor(game.state, PLAYER_IDS));
  hud.showTurn({
    currentPlayerId: game.currentPlayer(),
    humanPlayerId: HUMAN,
    winner: null,
    isOver: false,
    humanEliminated: false,
    canAct: !game.isBusy(),
  });
}

/**
 * A game over the given board, with the handlers this page needs.
 *
 * The same four events the session listens to, and nothing else: what is being
 * looked at here is the throw, so the camera, the save and the banners are all
 * somebody else's problem.
 */
function startGame(state, { select = null } = {}) {
  game = createGame({
    world,
    savedState: state,
    humanPlayerId: HUMAN,
    timing,
    // Nobody is playing the other side. A turn never ends here, so it never
    // comes round to them.
    strategy: () => null,
  });

  game.on('attack', ({ event, timing: beats }) => {
    hud.showBattle(battleEntry(event), { revealed: false });
    roll = {
      event,
      elapsed: 0,
      animation: createRollAnimation({
        attackerStand: dice.standFor(event.from),
        defenderStand: dice.standFor(event.to),
        event,
        dieSize: dice.dieSize,
        timing: beats,
      }),
    };
  });

  game.on('resolved', (state_) => {
    const { event } = roll;
    roll = null;
    hud.showBattle(battles.record(event));
    hud.setHistory(battles.entries);
    dice.reroll(event.from, state_);
    dice.reroll(event.to, state_);
    refillWanted = autoRefill;
  });

  game.on('cancelled', ({ event }) => {
    roll = null;
    hud.hideCancel();
    dice.reroll(event.from, game.state);
    dice.reroll(event.to, game.state);
    hud.showBattle(battles.entries.at(-1) ?? null);
    hud.showToast(CANCELLED_TOAST);
    refresh();
  });

  game.on('change', (next) => {
    dice.update(next);
    refresh();
  });

  game.start();
  dice.update(game.state);
  // A refill must not take the player's place with it. Put back through
  // `clickTerritory` rather than by assignment, so a territory that is no
  // longer worth picking up — a fill of one die — is simply not picked up.
  if (select !== null) game.clickTerritory(select);
  refresh();
}

/**
 * Top every territory back up.
 *
 * A fresh game over an edited board rather than an edit to the game's own,
 * because the board belongs to `createGame` and reaching into it would make
 * this page a worse copy of the real one. Rebuilding costs nothing — there is
 * no geometry in a game, only a graph and some numbers.
 */
function refill() {
  refillWanted = false;
  startGame(toppedUp(game.state), { select: game.selection });
}

startGame(toppedUp(createInitialState({ ...world, turnOrder: PLAYER_IDS })));

// --- pressing on the planet ------------------------------------------------

const pickAt = createTerritoryPicker({
  planetMesh: surface.mesh,
  camera: viewer.camera,
  faceCellIds: surface.faceCellIds,
  cellTerritory: world.cellTerritory,
});

// Exactly the shape `createSelectHandler` asks a session for, so the press
// rules on this page are the game's own — including that a drag turns the
// planet and never cancels.
const pressTarget = {
  pressAt(ndc) {
    const territoryId = pickAt(ndc);
    const action = game.pressActionOn(territoryId);
    pressed = action === 'attack' || action === 'select' || territoryId === game.selection
      ? territoryId
      : null;
    if (action !== null) refresh();
    return action;
  },
  releasePress() {
    const territoryId = pressed;
    pressed = null;
    game.clickTerritory(territoryId);
    refresh();
  },
  cancelPress() {
    pressed = null;
    refresh();
  },
  canCancelAttack: () => game.cancelOffer !== null,
  cancelAttack: () => game.cancelAttack(),
};

viewer.pointers.register('select', createSelectHandler(canvas, () => pressTarget));
viewer.pointers.register('orbit', viewer.orbitHandler);

hud.onCancel(() => game.cancelAttack());

// Wired so the button is not furniture, and because ending a turn is the one
// wait on this page that deliberately *cannot* be pressed through — the payout
// is the turn ending and there is nothing to do into it. The payout is not
// animated here; this page is about throws.
hud.onEndTurn(() => {
  game.endTurn();
  refresh();
});

// --- the knobs -------------------------------------------------------------

const controls = document.createElement('div');
controls.className = 'controls';
section.append(controls);

const readout = document.createElement('pre');
readout.className = 'menu-readout';
section.append(readout);

function report() {
  const t = timing;
  const line = (name, value) => `${name.padEnd(22)}${value}`;
  readout.textContent = [
    line('aim / roll / read', `${t.aim}s / ${t.roll}s / ${t.read}s`),
    line('stagger', `${t.stagger.toFixed(2)}s — the defender's dice run this far behind`),
    line('bounce height', `${t.bounce.height.toFixed(2)} of the throw it came off`),
    '',
    line('whole throw', `${attackDuration(t).toFixed(2)}s`),
    line('cancel closes at', `${cancelWindow(t).toFixed(2)}s`),
    line('first landing at', `${(t.aim + firstLandingAt(t) * t.roll).toFixed(2)}s`),
    line('dice down at', `${(t.aim + groundedAt(t) * t.roll).toFixed(2)}s`),
    '',
    'The cancel closes a hair before the dice start showing their faces, and',
    'the stagger cannot move it: it is measured off the attacker, who is',
    'unaffected. See rollTimeline.js.',
  ].join('\n');
}

function slider(label, { min, max, step, value, format = (v) => v.toFixed(2) }, onInput) {
  const wrap = document.createElement('label');
  wrap.className = 'count';
  const input = document.createElement('input');
  input.type = 'range';
  Object.assign(input, { min, max, step, value });
  const text = document.createTextNode(`${label} ${format(value)} `);
  input.addEventListener('input', () => {
    const next = Number(input.value);
    text.textContent = `${label} ${format(next)} `;
    onInput(next);
    report();
  });
  wrap.append(text, input);
  controls.append(wrap);
}

slider('stagger', { min: 0, max: 1, step: 0.05, value: timing.stagger }, (v) => {
  timing.stagger = v;
});

slider('bounce height', { min: 0, max: 0.8, step: 0.05, value: timing.bounce.height }, (v) => {
  timing.bounce.height = v;
});

slider(
  'fill to',
  { min: 1, max: 8, step: 1, value: fill, format: (v) => `${v} dice` },
  (v) => { fill = v; }
);

const refillButton = document.createElement('button');
refillButton.type = 'button';
refillButton.textContent = 'Refill now';
refillButton.addEventListener('click', refill);
controls.append(refillButton);

const autoLabel = document.createElement('label');
autoLabel.className = 'count';
const autoInput = document.createElement('input');
autoInput.type = 'checkbox';
autoInput.checked = autoRefill;
autoInput.addEventListener('change', () => { autoRefill = autoInput.checked; });
autoLabel.append(autoInput, ' refill after every attack');
controls.append(autoLabel);

report();

// --- the loop --------------------------------------------------------------

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (roll) {
    roll.elapsed += dt;
    roll.animation.apply(roll.elapsed);
    refresh(pulseAt(roll.elapsed));
  }
  const offer = game.cancelOffer;
  if (offer) hud.showCancel(offer.left / offer.total);
  else hud.hideCancel();

  game.tick(dt);
  // After the tick, so the attack that asked for it has finished emitting
  // everything it was going to.
  if (refillWanted && roll === null) refill();

  viewer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
