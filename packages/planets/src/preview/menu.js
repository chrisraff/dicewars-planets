import { createMenu } from '../render/menu.js';
import {
  DEFAULT_SETTINGS,
  MENU_SETTINGS,
  normalizeSettings,
  settingsToQuery,
  playerIdsFor,
  resolveStartSeat,
} from '../game/settings.js';

const scenarios = document.getElementById('scenarios');

function addScenario({ title, note, stageClass = '', settings, canResume = false, live = false }) {
  const section = document.createElement('section');
  section.className = 'scenario';
  section.innerHTML = '<h2></h2><p></p><div class="stage"></div>';
  section.querySelector('h2').textContent = title;
  section.querySelector('p').textContent = note;
  scenarios.append(section);

  const stage = section.querySelector('.stage');
  stage.className = `stage is-menu ${stageClass}`.trim();

  // the game styles the overlay by id (#menu); on this page the panel sits
  // inline in a stage instead, so it gets a class of its own
  const host = document.createElement('div');
  host.className = 'menu-host';
  stage.append(host);

  let readout = null;
  if (live) {
    readout = document.createElement('pre');
    readout.className = 'menu-readout';
    section.append(readout);
  }

  const menu = createMenu(host, {
    onStart: (chosen) => report(chosen, 'started'),
    onResume: () => report(menu.settings, 'resumed'),
  });

  function report(chosen, action) {
    if (!readout) return;
    const resolved = normalizeSettings(chosen);
    readout.textContent = [
      `${action} with:`,
      ...Object.entries(resolved).map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`),
      `  → ${playerIdsFor(resolved).length} players: ${playerIdsFor(resolved).join(', ')}`,
      `  → you would take seat ${resolveStartSeat(resolved) + 1} of ${resolved.players}`,
      `  → url: ${settingsToQuery(resolved) || '(none — this is the default setup)'}`,
    ].join('\n');
  }

  menu.show(settings ?? DEFAULT_SETTINGS, { canResume });
  if (readout) readout.textContent = 'Pick a setup and press the button.';
}

addScenario({
  title: 'Opening the game',
  note: 'What you get on a first visit: no game to go back to, so the only way on is forward.',
  settings: DEFAULT_SETTINGS,
});

addScenario({
  title: 'Opened mid-game',
  note: 'Reached with the Menu button while playing. Starting over is now a deliberate act with '
    + 'its own wording, and there is a way back to the board. Escape also backs out.',
  settings: { players: 6 },
  canResume: true,
});

addScenario({
  title: 'Live — what the settings pipeline makes of your choices',
  note: 'Change anything and press a button: the readout below shows the normalized settings, the '
    + 'players they produce, and the URL the game would put in the address bar.',
  settings: { players: 3 },
  canResume: true,
  live: true,
});

addScenario({
  title: 'Turn order — a range',
  note: 'The seat row is the table itself, left to right, each seat in the color it plays as. '
    + 'A range lights the part of the row it covers, so "Late" shows you exactly which seats '
    + 'you might land in rather than leaving you to guess.',
  settings: { players: 7, start: 'late' },
});

addScenario({
  title: 'Turn order — one seat, claimed',
  note: 'Tapping a seat claims it outright: the range clears and that one seat is bordered, the '
    + 'same mark the stats row uses for whose turn it is. The color tells you who you will be.',
  settings: { players: 7, start: 3 },
});

addScenario({
  title: 'At phone width',
  note: 'A 360px column: the choice buttons wrap, and the actions stack with the primary one '
    + 'nearest the thumb.',
  stageClass: 'is-phone',
  settings: { players: 8 },
  canResume: true,
});

// --- what the menu knows how to draw --------------------------------------

const summary = document.createElement('section');
summary.className = 'scenario';
summary.innerHTML = `
  <h2>Declared options</h2>
  <p>Everything in <code>MENU_SETTINGS</code>. The menu renders from this list, so adding
     an option here — difficulty, board size — puts it in the menu and in the preview at once,
     with no markup to write.</p>
  <div class="stage"><ul class="option-list"></ul></div>
`;
scenarios.append(summary);

const list = summary.querySelector('.option-list');
for (const setting of MENU_SETTINGS) {
  const item = document.createElement('li');
  const state = setting.available ? 'available' : `unavailable — ${setting.note}`;
  const values =
    setting.kind === 'toggle'
      ? 'on / off'
      : setting.choices.map((choice) => choice.label).join(', ');

  item.innerHTML = '<b></b> <i></i><br><span></span>';
  item.querySelector('b').textContent = setting.label;
  item.querySelector('i').textContent = state;
  item.querySelector('span').textContent = `${setting.kind} · ${values} · default ${setting.default}`;
  list.append(item);
}
