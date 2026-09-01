import { createExplainer, EXPLAINER_CAPTURES, explainerCaptureNames } from '../render/explainer.js';

/**
 * "How the game works", laid out flat.
 *
 * In the game this is a full-screen overlay opened from the menu (`#explainer`
 * in hud.css); here it sits inline in a stage, so only the placement differs
 * and every rule that draws the document itself is the game's own.
 *
 * The second scenario is the one worth having: the pictures are committed
 * files rather than anything the page can produce, so "before anybody has
 * taken them" is a real state — a fresh clone is in it — and it has to read as
 * a document with its pictures pending rather than as a broken page.
 */
const scenarios = document.getElementById('scenarios');

function addScenario({ title, note, stageClass = '', captureBase }) {
  const section = document.createElement('section');
  section.className = 'scenario';
  section.innerHTML = '<h2></h2><p></p><div class="stage"></div>';
  section.querySelector('h2').textContent = title;
  section.querySelector('p').textContent = note;
  scenarios.append(section);

  const stage = section.querySelector('.stage');
  stage.className = `stage is-explainer ${stageClass}`.trim();

  const host = document.createElement('div');
  host.className = 'explainer-host';
  stage.append(host);

  const explainer = createExplainer(host, { captureBase });
  explainer.show();
}

addScenario({
  title: 'The document',
  note: 'Every section, with the pictures as they will be once they are committed. '
    + 'The odds are read out of core’s own winProbability, so the numbers here are the '
    + 'numbers the game deals.',
  captureBase: '/explainer',
});

addScenario({
  title: 'Before the pictures have been taken',
  note: 'What a clone without the capture files sees: each missing picture names the shot '
    + 'it is standing in for, rather than a broken-image icon that reads as a broken page. '
    + 'Take them on the figures preview.',
  captureBase: '/no-such-directory',
});

addScenario({
  title: 'At phone width',
  note: 'Where the before-and-after pairs stop sitting side by side — at this width each '
    + 'half would be too small to read the dice on.',
  stageClass: 'is-phone',
  captureBase: '/explainer',
});

// The contract between this document and the harness that shoots for it, said
// out loud: a capture is only useful if something asks for it, and a section
// can only ask for one that exists.
const readout = document.createElement('pre');
readout.className = 'menu-readout';
readout.textContent = [
  `captures declared: ${Object.keys(EXPLAINER_CAPTURES).join(', ')}`,
  `captures used:     ${explainerCaptureNames().join(', ')}`,
].join('\n');
document.querySelector('main').append(readout);
