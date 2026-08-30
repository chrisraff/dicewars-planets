import * as THREE from 'three';
import { createViewer } from '../render/createViewer.js';
import { createDiePipMaterials } from '../render/diceTextures.js';
import { createSelectHandler } from '../render/selectPress.js';
import { slopFor, YIELD } from '../render/pointerArbiter.js';
import { HIGHLIGHT } from '../render/highlights.js';
import { DEFAULT_PLAYER_COLORS, mix, readableTextColor } from '../render/palette.js';
import { createSession } from '../game/session.js';
import { normalizeSettings } from '../game/settings.js';

const scenarios = document.getElementById('scenarios');
const pipMaterials = createDiePipMaterials();

const rgb = (color) => `rgb(${color.map((c) => Math.round(c * 255)).join(', ')})`;

/**
 * A real match on a real planet, with the real arbiter deciding who owns each
 * press — the same two handlers `main.js` registers, in the same order.
 *
 * The readout under it is the point of the page: it names who owns the press
 * as it happens, so the hand-off can be watched rather than inferred from
 * whether the planet moved.
 */
function addScenario({ title, note, stageClass = '', settings = {} }) {
  const section = document.createElement('section');
  section.className = 'scenario';
  section.innerHTML = '<h2></h2><p></p><div class="stage is-hud is-planet"></div>';
  section.querySelector('h2').textContent = title;
  section.querySelector('p').textContent = note;
  scenarios.append(section);

  const stage = section.querySelector('.stage');
  stage.className = `stage is-hud is-planet ${stageClass}`.trim();

  const canvas = document.createElement('canvas');
  const hudHost = document.createElement('div');
  hudHost.className = 'hud-host';
  stage.append(canvas, hudHost);

  const readout = document.createElement('pre');
  readout.className = 'menu-readout';
  section.append(readout);

  const viewer = createViewer(canvas);
  const session = createSession({
    viewer,
    hudRoot: hudHost,
    pipMaterials,
    settings: normalizeSettings({ players: 4, ...settings }),
    onNewGame: () => {},
    onMenu: () => {},
    onSave: () => {},
  });

  // The real handler, wrapped only to say out loud what it was asked and what
  // it answered. Every decision below is still the game's own.
  const select = createSelectHandler(canvas, () => session);
  const state = { owner: 'nobody', taken: null, travelled: 0, slop: 0, history: [] };

  const say = (line) => {
    state.history.unshift(line);
    state.history.length = Math.min(state.history.length, 6);
  };

  const report = () => {
    readout.textContent = [
      `owner       ${state.owner}`,
      `the press   ${state.taken ?? '—'}`,
      `travelled   ${state.travelled.toFixed(0)}px of ${state.slop}px before it becomes a drag`,
      '',
      ...state.history,
    ].join('\n');
  };

  viewer.pointers.register('select', {
    onDown(press, event) {
      state.owner = 'select';
      state.travelled = 0;
      state.slop = slopFor(press.pointerType);
      const answer = select.onDown(press, event);
      state.taken = answer === YIELD ? 'nothing here to act on' : 'taken — the mark is the promise';
      report();
      return answer;
    },
    onMove(press, event) {
      state.travelled = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
      const answer = select.onMove(press, event);
      report();
      return answer;
    },
    onUp(press, event) {
      say(`tap accepted after ${state.travelled.toFixed(0)}px`);
      state.owner = 'nobody';
      state.taken = null;
      const answer = select.onUp(press, event);
      report();
      return answer;
    },
    onCancel(press, event) {
      say('press cancelled by the system');
      state.owner = 'nobody';
      report();
      return select.onCancel(press, event);
    },
    onYield(press, event) {
      say(`handed to orbit at ${state.travelled.toFixed(0)}px`);
      state.owner = 'orbit';
      state.taken = null;
      report();
      return select.onYield(press, event);
    },
  });
  viewer.pointers.register('orbit', viewer.orbitHandler);

  report();

  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    session.tick(Math.min(clock.getDelta(), 0.1));
    viewer.render();
  }
  animate();
}

addScenario({
  title: 'Press, and then choose',
  note: 'A real four-player match. Press and hold a territory of yours: it lights up while your '
    + 'finger is down, which is the whole point — release and it is picked up, drag away and '
    + 'nothing happens. The readout says who owns the press as it changes hands. Press the ocean '
    + 'or empty space instead and the planet turns from the very first pixel, because there was '
    + 'never anything there to tap.',
});

addScenario({
  title: 'Phone width',
  note: 'The same thing at 360px, which is where the slop matters: a finger is allowed to wander '
    + `${slopFor('touch')}px before the press becomes a drag, against ${slopFor('mouse')}px for a `
    + 'mouse, because it lands on a soft contact patch several millimetres across and the '
    + 'reported point drifts inside it.',
  stageClass: 'is-phone',
});

// --- the marks, side by side ----------------------------------------------

/**
 * Every mark a territory can wear, on every player colour.
 *
 * The press is the newest of them and the one with the most to prove: it will
 * most often be sitting on top of a legal target, which already wears a pale
 * lift, and the two have to be tellable apart at a glance and on a planet
 * that is moving. Chips of the real `HIGHLIGHT` amounts blended with the real
 * palette, so this cannot drift from what the planet draws.
 */
function markComparison() {
  const section = document.createElement('section');
  section.className = 'scenario';
  section.innerHTML = '<h2>Every mark, on every colour</h2><p></p>';
  section.querySelector('p').textContent =
    'Left to right: the plain territory, the pale lift a legal target wears, the press, the dark '
    + 'a picked-up territory holds, and the defender of a fight in progress. The press has to '
    + 'read as its own thing beside the target lift — that is the pair that appears together, '
    + 'since the press usually lands on a territory that was already a target.';
  scenarios.append(section);

  const marks = [
    ['plain', null],
    ['target', HIGHLIGHT.target],
    ['pressed', HIGHLIGHT.pressed],
    ['selected', HIGHLIGHT.selected],
    ['defender', HIGHLIGHT.defender],
  ];

  const grid = document.createElement('div');
  grid.className = 'faces is-marks';
  grid.innerHTML = '<span class="head"></span>'
    + marks.map(([name]) => `<span class="head">${name}</span>`).join('');

  const names = ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'Orange', 'Cyan', 'White'];
  DEFAULT_PLAYER_COLORS.forEach((color, i) => {
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = names[i];
    grid.append(who);

    for (const [, mark] of marks) {
      const shown = mark ? mix(color, mark.color, mark.amount) : color;
      const chip = document.createElement('span');
      chip.className = 'swatch';
      chip.style.background = rgb(shown);
      chip.style.color = rgb(readableTextColor(shown));
      chip.textContent = mark ? mark.amount.toFixed(2) : '—';
      grid.append(chip);
    }
  });
  section.append(grid);
}

markComparison();
