import * as THREE from 'three';
import { createViewer } from '../render/createViewer.js';
import { createDiePipMaterials } from '../render/diceTextures.js';
import { createSession } from '../game/session.js';
import { normalizeSettings } from '../game/settings.js';

const scenarios = document.getElementById('scenarios');

// Shared across every scenario below, the same way `main.js` shares one set
// for the whole page rather than one per match.
const pipMaterials = createDiePipMaterials();

/**
 * Plays a real match to the end without anyone clicking through it: the
 * "human" seat always just ends its turn, so the AI opposite it keeps
 * attacking until one side is wiped out. It is still a real `createSession`
 * doing exactly what a played-out game does — this is how the preview gets
 * something to replay without a person playing one.
 */
function playToGameOver(session, maxTicks = 60000) {
  let ticks = 0;
  while (!session.game.isOver() && ticks < maxTicks) {
    if (session.game.isHumanTurn() && !session.game.isBusy()) session.game.endTurn();
    session.tick(1 / 30);
    ticks++;
  }
  return session.game.isOver();
}

/**
 * A real planet, played out and dropped straight into its own replay — the
 * whole point of this page: seeing the surface, the dice and the camera
 * actually do their thing, without playing a game by hand to get there.
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
    settings: normalizeSettings({ players: 2, ...settings }),
    onNewGame: () => {},
    onMenu: () => {},
    onSave: () => {},
  });

  const finished = playToGameOver(session);
  readout.textContent = finished
    ? 'match played out — opening the replay'
    : 'did not finish in time — reload to try a different planet';

  if (finished) {
    const replayButton = [...hudHost.querySelectorAll('.hud-banner-action')]
      .find((button) => button.textContent === 'Watch replay');
    replayButton?.click();
  }

  // Its own render loop — this is a live scene the visitor can orbit and
  // scrub, not a screenshot, so it has to keep drawing on its own.
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);
    session.tick(dt);
    viewer.render();
  }
  animate();
}

addScenario({
  title: 'A replay, watched on the planet',
  note: 'A real match — no two loads of this page play out quite the same. Drag the track, step '
    + 'with ‹ ›, or press ▶: the camera swings to each attack and only then does the surface and '
    + 'the dice show what happened there, exactly what "Watch replay" opens onto after a real '
    + 'game. Drag anywhere off the transport bar to orbit, the way you would mid-match. Note the '
    + 'menu button is gone while this is open — the × is the way back to the outcome screen.',
});

addScenario({
  title: 'Phone width',
  note: 'The same thing at 360px — the transport bar has to hold together without growing tall '
    + 'enough to eat into the planet behind it.',
  stageClass: 'is-phone',
});
