import * as THREE from 'three';
import { seededRng } from '@dicewars/core';
import { createViewer } from '../render/createViewer.js';
import { createCameraFocus } from '../render/cameraFocus.js';
import { createPlanetSurface } from '../render/planetSurface.js';
import { createDiePipMaterials } from '../render/diceTextures.js';
import { createDiceLayer } from '../render/diceLayer.js';
import { assignPlayerColors } from '../render/palette.js';
import { generatePlanetWorld } from '../world/generateWorld.js';
import { createGame } from '../game/createGame.js';
import { createHud } from '../render/hud.js';
import { DEFAULT_FRAMING, fightCenter, framingOf } from '../render/cameraFraming.js';
import { angleBetween, centroid, normalize, scale } from '../geometry/vec3.js';
import { playerStatsFor } from '../game/playerStats.js';
import {
  createTurnFlash,
  flashDuration,
  REDUCED_TURN_FLASH,
  TURN_FLASH,
} from '../render/turnFlash.js';

const NAMES = ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'Orange'];
const PLAYERS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const scenarios = document.getElementById('scenarios');
const pipMaterials = createDiePipMaterials();

const world = generatePlanetWorld({
  subdivisions: 3,
  playerIds: PLAYERS,
  rng: seededRng(976936904),
});
const playerColors = assignPlayerColors(PLAYERS);
const playerNames = new Map(PLAYERS.map((id, i) => [id, NAMES[i]]));

/**
 * A real planet with real dice on it, and the flash laid over it.
 *
 * Dice as well as the surface deliberately: they are the only lit thing in the
 * scene and the only thing with a specular highlight, so they are where a grey
 * veil is most likely to look wrong. Judging the flash over a bare surface
 * would be judging it over the easy half of the picture.
 */
function addStage(host, { withHud = false, stageClass = '', onFrame = () => {}, onDrag }) {
  const stage = document.createElement('div');
  stage.className = `stage is-planet ${stageClass}`.trim();
  host.append(stage);

  const canvas = document.createElement('canvas');
  stage.append(canvas);

  const viewer = createViewer(canvas);
  const surface = createPlanetSurface(world, playerColors);
  const dice = createDiceLayer(world, pipMaterials);
  viewer.scene.add(surface.group, dice.group);

  const game = createGame({ world, humanPlayerId: PLAYERS[0] });
  surface.refresh(game.state);
  dice.update(game.state);

  // The flash goes in before the HUD host, so the HUD sits on top of it —
  // which is the order it wants in the game, for the reason in turnFlash.js.
  // Pinned rather than read off the browser, so this page shows what it says
  // it is showing on a machine that has reduced motion switched on — the
  // `Ramped` button is what exercises that path here.
  const flash = createTurnFlash(stage, { reducedMotion: false });
  const focus = createCameraFocus({ camera: viewer.camera, controls: viewer.controls, onDrag });

  let hud = null;
  if (withHud) {
    const hudHost = document.createElement('div');
    hudHost.className = 'hud-host';
    stage.append(hudHost);
    hud = createHud(hudHost, { playerColors, playerNames, humanPlayerId: PLAYERS[0] });
    hud.showPlayers(playerStatsFor(game.state, PLAYERS));
    hud.showTurn({
      currentPlayerId: 'p1',
      humanPlayerId: 'p1',
      winner: null,
      isOver: false,
      humanEliminated: false,
      canAct: true,
      seen: true,
      isHumanTurn: true,
    });
  }

  // The one variant that cannot be a DOM overlay, kept so the comparison is a
  // thing you can look at rather than a claim in a comment: lerping
  // `scene.background` lights only the empty space around the planet, and how
  // much of the frame that is depends entirely on how far back the camera sat.
  const black = new THREE.Color(0x000000);
  const lit = new THREE.Color();

  let last = performance.now();
  (function frame(now = performance.now()) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    flash.tick(dt);
    focus.tick(dt);
    onFrame();
    if (flash.options.shape === 'scene') {
      const [r, g, b] = flash.options.color;
      lit.setRGB(r, g, b, THREE.SRGBColorSpace);
      const amount = Number(flash.element.style.opacity || 0);
      viewer.scene.background = black.clone().lerp(lit, amount);
    } else if (viewer.scene.background !== black) {
      viewer.scene.background = black;
    }
    viewer.render();
    requestAnimationFrame(frame);
  })();

  return { flash, focus, dice, game, viewer, hud };
}

function addScenario({ title, note }) {
  const section = document.createElement('section');
  section.className = 'scenario';
  section.innerHTML = '<h2></h2><p></p>';
  section.querySelector('h2').textContent = title;
  section.querySelector('p').textContent = note;
  scenarios.append(section);
  return section;
}

// --- the stages -----------------------------------------------------------

const main = addScenario({
  title: 'The flash, on a board',
  note: 'Desktop framing with the HUD over it, and phone framing beside it. Both matter and they '
    + 'are not the same picture: a portrait phone frames the planet at about 4.9 radii against a '
    + 'desktop’s 3.2, so there is far more empty space around it — which is most of what the '
    + 'vignette lands on, and all of what a scene-background flash lands on.',
});
const row = document.createElement('div');
row.className = 'payout-row';
main.append(row);

const wide = document.createElement('div');
wide.className = 'handover-wide';
const narrow = document.createElement('div');
for (const [host, label] of [[wide, 'desktop framing, HUD over it'], [narrow, 'phone framing']]) {
  const caption = document.createElement('p');
  caption.className = 'payout-label';
  caption.textContent = label;
  host.append(caption);
  row.append(host);
}

const flashes = [
  addStage(wide, { withHud: true }).flash,
  addStage(narrow, { stageClass: 'is-phone' }).flash,
];

// --- the knobs ------------------------------------------------------------

const controls = document.createElement('div');
controls.className = 'controls';
main.append(controls);

const readout = document.createElement('pre');
readout.className = 'menu-readout';
main.append(readout);

const setAll = (next) => {
  for (const flash of flashes) flash.set(next);
  report();
};
const playAll = () => {
  for (const flash of flashes) flash.play();
};

function button(label, onClick) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', onClick);
  controls.append(element);
  return element;
}

button('Trigger', playAll);
button('Full veil', () => setAll({ shape: 'full' }));
button('Vignette', () => setAll({ shape: 'vignette' }));
button('Scene background', () => setAll({ shape: 'scene' }));
button('Two flashes, 0.3s', () => {
  setAll({ ...TURN_FLASH, shape: flashes[0].options.shape });
  playAll();
});
button('Ramped (reduced motion)', () => {
  setAll({ ...REDUCED_TURN_FLASH, shape: flashes[0].options.shape });
  playAll();
});

// Every number worth turning by eye rather than arguing about. `grey` is not
// one of the settings: it drives all three channels of `color` at once, which
// is the only way this is ever likely to be tuned.
const SLIDERS = [
  ['flashes', 1, 4, 1],
  ['spacing', 0, 0.8, 0.02],
  ['rise', 0, 0.6, 0.01],
  ['hold', 0, 0.4, 0.01],
  ['fall', 0, 0.8, 0.01],
  ['peak', 0, 1, 0.02],
  ['inner', 0, 1, 0.02],
  ['outer', 0, 1.5, 0.02],
];

const sliderRow = document.createElement('div');
sliderRow.className = 'controls';
main.append(sliderRow);

for (const [key, min, max, step] of SLIDERS) {
  const label = document.createElement('label');
  label.className = 'count';
  const input = document.createElement('input');
  input.type = 'range';
  Object.assign(input, { min, max, step, value: flashes[0].options[key] });
  input.addEventListener('input', () => {
    label.firstChild.textContent = `${key} ${Number(input.value).toFixed(2)} `;
    setAll({ [key]: Number(input.value) });
  });
  label.append(`${key} ${Number(flashes[0].options[key]).toFixed(2)} `, input);
  sliderRow.append(label);
}

const greyLabel = document.createElement('label');
greyLabel.className = 'count';
const greyInput = document.createElement('input');
greyInput.type = 'range';
Object.assign(greyInput, { min: 0, max: 1, step: 0.01, value: TURN_FLASH.color[0] });
greyInput.addEventListener('input', () => {
  const value = Number(greyInput.value);
  greyLabel.firstChild.textContent = `grey ${value.toFixed(2)} `;
  setAll({ color: [value, value, value] });
});
greyLabel.append(`grey ${TURN_FLASH.color[0].toFixed(2)} `, greyInput);
sliderRow.append(greyLabel);

function report() {
  const { color, ...rest } = flashes[0].options;
  readout.textContent = `${JSON.stringify({ ...rest, color: color.map((c) => Number(c.toFixed(2))) }, null, 0)}\n\n`
    + `burst lasts ${flashDuration(flashes[0].options).toFixed(2)}s\n\n`
    + 'Paste into TURN_FLASH. `shape` is the one that is a judgement rather than a '
    + 'number — vignette announces without hiding the board, full veil is the '
    + 'stronger signal, scene is the version that only lights the space around the '
    + 'planet and stops working the day that space has stars in it.';
}
report();


// --- the pan --------------------------------------------------------------

const panning = addScenario({
  title: 'Turning the planet back to your own ground',
  note: 'The AI plays where it likes and the camera has been following it round the back, so the '
    + 'board handed back to you is often somebody else’s half of the planet. Drag the planet away '
    + 'from the red territories — or press Look away — and then hand over. It only moves when none '
    + 'of your ground is on screen at all, and it draws back only when turning alone cannot show '
    + 'more, so a view you chose is never taken off you. Hand over flashes as it pans, the way the '
    + 'game does: the two are one event, and the vignette is clear over the middle, so the planet '
    + 'turning underneath it is the part you can still see.',
});

const panStage = addStage(panning, {
  onFrame: () => reportPan(),
});

const panControls = document.createElement('div');
panControls.className = 'controls';
panning.append(panControls);
const panReadout = document.createElement('pre');
panReadout.className = 'menu-readout';
panning.append(panReadout);

const mine = () => {
  const points = [];
  for (const [id, node] of panStage.game.state.nodes) {
    if (node.owner === PLAYERS[0]) points.push(panStage.dice.standFor(id).normal);
  }
  return points;
};

function reportPan() {
  const points = mine();
  const view = panStage.focus.currentView();
  const seen = points.filter(
    (p) => framingOf(view.direction, p, { distance: view.distance, halfFov: view.halfFov })
      >= DEFAULT_FRAMING.margin
  ).length;
  panReadout.textContent = `${seen} of your ${points.length} territories in view`
    + `  ·  camera ${view.distance.toFixed(2)} radii out
`
    + (seen > 0
      ? 'Some of your ground is on screen, so handing over would leave the camera alone.'
      : 'None of your ground is on screen — handing over would turn the planet.');
}

for (const [label, onClick] of [
  // Both halves of the handover at once, exactly as `focusOwnGround` does it:
  // the flash runs *with* the pan rather than waiting for it to settle, which
  // is the timing this button exists to show.
  ['Hand over', () => {
    panStage.focus.lookAtHoldings(mine());
    panStage.flash.play();
  }],
  // The condition is fiddly to reach by dragging, so here is a shortcut to it:
  // aim at the point furthest from everything the player holds.
  ['Look away', () => {
    const points = mine();
    const away = normalize(scale(centroid(points.map(normalize)), -1));
    panStage.focus.lookAt(away);
  }],
  ['Zoom in close', () => {
    panStage.viewer.camera.position.setLength(1.7);
    panStage.viewer.controls.update();
  }],
]) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  panControls.append(button);
}
reportPan();


// --- handing the camera back ----------------------------------------------

const offer = addScenario({
  title: 'Taking the camera, and being offered it back',
  note: 'The other half of the pan: a player who drags the planet is nearly always studying it, '
    + 'and a camera that swings off to somebody else’s fight mid-look is the game arguing with '
    + 'them. So a drag takes the camera off the match entirely — no pan home, no swing to a '
    + 'fight, no pull-back — and the offer to hand it back goes up and stays up until it is '
    + 'answered. Drag this planet: the button appears in the middle of the column above the '
    + 'controls, which is the one band nothing else sits in. Press it and the camera goes exactly '
    + 'where it would have been standing had it never been taken — forced, because "you can '
    + 'already see a corner of it" is not an answer to somebody who asked. That target is not the '
    + 'same all match: on your own turn it is the aim with most of your red ground in frame, and '
    + 'on somebody else’s it is the run of attacks being shown, since taking you home mid-AI-turn '
    + 'would be showing you the one part of the planet nothing is happening on. The Fight button '
    + 'below stands in for an AI turn in flight. In the game two other things put it down: '
    + 'attacking, silently — the studying is over and the territory you picked is the one thing '
    + 'that must not be panned away from — and ending your turn, which hands the camera back '
    + 'along with the board. A drag during your own turn raises nothing, because during your own '
    + 'turn there is nothing for it to suppress — but a drag during an AI’s turn keeps the offer '
    + 'standing once the turn comes back to you, which is exactly the case where the pan home was '
    + 'suppressed and your turn opens on somebody else’s half of the planet.',
});

const offerStage = addStage(offer, {
  withHud: true,
  onDrag: () => setOffer(true),
  onFrame: () => reportOffer(),
});
const offerReadout = document.createElement('pre');
offerReadout.className = 'menu-readout';
offer.append(offerReadout);

const offerMine = () => {
  const points = [];
  for (const [id, node] of offerStage.game.state.nodes) {
    if (node.owner === PLAYERS[0]) points.push(offerStage.dice.standFor(id).normal);
  }
  return points;
};

let cameraFreed = false;
function setOffer(freed) {
  cameraFreed = freed;
  offerStage.hud.showAutoFollow({ freed, isOver: false, replayOpen: false });
}

function reportOffer() {
  offerReadout.textContent = cameraFreed
    ? 'The camera is yours. Nothing in the match will move it until you press Auto-follow '
      + '— or, in a real game, attack.'
    : 'The camera is following the match: it pans home on a handover, swings to the AI’s '
      + 'fights, and pulls back at the end of your turn.';
}

// The stage has no turns in it, so the button itself takes the ordinary case:
// your own turn, and home. The two buttons below are the pair side by side.
offerStage.hud.onAutoFollow(() => {
  offerStage.focus.lookAtHoldings(offerMine(), { force: true });
  setOffer(false);
});

const offerControls = document.createElement('div');
offerControls.className = 'controls';
offer.append(offerControls);
// A pair of neighbouring territories on the far side, standing in for the run
// of attacks an AI turn would have queued up — enough to show that a press
// lands on the fight rather than on your own ground.
const fight = (() => {
  const home = normalize(centroid(offerMine().map(normalize)));
  const far = [...offerStage.game.state.nodes.keys()]
    .map((id) => ({ id, normal: offerStage.dice.standFor(id).normal }))
    .sort((a, b) => angleBetween(b.normal, home) - angleBetween(a.normal, home));
  return [{ from: far[0].id, to: far[1].id }];
})();

for (const [label, onClick] of [
  // The states without needing a mouse gesture to reach them, so the button
  // can be looked at beside the rest of the column rather than only during a
  // drag — and so the two things a press can aim at can be told apart.
  ['Take the camera', () => setOffer(true)],
  ['Give it back', () => setOffer(false)],
  ['Press it (your turn — go home)', () => {
    offerStage.focus.lookAtHoldings(offerMine(), { force: true });
    setOffer(false);
  }],
  ['Press it (AI attacking — go to the fight)', () => {
    const points = fight.map(({ from, to }) =>
      fightCenter(offerStage.dice.standFor(from).normal, offerStage.dice.standFor(to).normal)
    );
    offerStage.focus.lookAtCluster(points, { force: true });
    setOffer(false);
  }],
]) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', onClick);
  offerControls.append(element);
}
setOffer(false);
reportOffer();
