import { MAX_RESERVE } from '@dicewars/core';
import { createHud } from '../render/hud.js';
import { playerStatsFor } from '../game/playerStats.js';
import { assignPlayerColors } from '../render/palette.js';
import { dieStart, reinforceDuration } from '../render/reinforceTimeline.js';

const NAMES = ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'Orange', 'Cyan', 'White'];
const scenarios = document.getElementById('scenarios');

// A board shaped like core's, so the stats row above each tray is in a state a
// real game could be in — a payout this size belongs to a player who has run
// away with the planet, and the row should say so.
function boardFor(holdings) {
  const playerIds = holdings.map((_, i) => `p${i + 1}`);
  const nodes = new Map();
  let territory = 0;
  playerIds.forEach((id, i) => {
    for (let n = 0; n < holdings[i]; n++) nodes.set(`t${territory++}`, { owner: id, dice: 1 });
  });
  return {
    playerIds,
    state: {
      nodes,
      players: new Map(playerIds.map((id) => [id, { id, reserve: 0 }])),
      turnOrder: playerIds,
      currentTurnIndex: 0,
      phase: 'attack',
      winner: null,
    },
  };
}

const HOLDINGS = [34, 8, 7, 6];
const { playerIds, state } = boardFor(HOLDINGS);
const playerColors = assignPlayerColors(playerIds);
const playerNames = new Map(playerIds.map((id, i) => [id, NAMES[i]]));
const TURN = {
  currentPlayerId: 'p1',
  humanPlayerId: 'p1',
  winner: null,
  isOver: false,
  humanEliminated: false,
  canAct: true,
  seen: true,
  isHumanTurn: true,
};

/**
 * One real HUD with a full tray in it, ready to be drained.
 *
 * `wrap` is an escape hatch for one exhibit only: setting it inline overrides
 * the stylesheet so the tray can be shown wrapping the way it used to. It is
 * deliberately an inline style set from here rather than a rule in
 * preview.css — a preview's stylesheet styles the caption, never the exhibit,
 * and a `.hud-reinforce` rule living in preview furniture would reach into
 * every other page that shows a tray.
 */
function addTray(container, { count, wrap = null, stageClass = '' }) {
  const stage = document.createElement('div');
  stage.className = `stage is-hud ${stageClass}`.trim();
  container.append(stage);

  // its own host, laid out like #hud is in the game
  const host = document.createElement('div');
  host.className = 'hud-host';
  stage.append(host);

  const hud = createHud(host, { playerColors, playerNames });
  hud.showPlayers(playerStatsFor(state, playerIds));
  hud.showTurn(TURN);

  const tray = host.querySelector('.hud-reinforce');
  if (wrap) tray.style.flexWrap = wrap;

  const entry = { hud, count, dropped: 0 };
  entry.refill = () => {
    hud.showReinforce({ playerId: 'p1', count });
    entry.dropped = 0;
  };
  entry.dropTo = (started) => {
    while (entry.dropped < Math.min(started, count)) {
      hud.reinforceDropped();
      entry.dropped++;
    }
  };
  entry.refill();
  return entry;
}

/**
 * Drains every tray in `trays` off one clock, so two of them side by side stay
 * in step and the only thing that differs is the layout being compared.
 *
 * How far along a tray should be is asked of `dieStart` rather than counted
 * off a timer of the page's own — the same question `createReinforceAnimation`
 * answers for the dice falling onto the planet, so the tray here empties on
 * exactly the cadence it does in a game.
 */
function driveDrain(trays, { speed = 1 } = {}) {
  for (const tray of trays) tray.refill();
  const longest = Math.max(...trays.map((t) => reinforceDuration(t.count)));

  let elapsed = 0;
  let last = performance.now();
  (function frame(now = performance.now()) {
    elapsed += ((now - last) / 1000) * speed;
    last = now;
    for (const tray of trays) {
      let started = 0;
      while (started < tray.count && dieStart(started, tray.count) <= elapsed) started++;
      tray.dropTo(started);
    }
    if (elapsed < longest) requestAnimationFrame(frame);
  })();
}

function addControls(section, trays) {
  const controls = document.createElement('div');
  controls.className = 'controls';
  section.append(controls);

  const add = (label, onClick) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    controls.append(button);
  };

  add('Play', () => driveDrain(trays));
  // A whole payout is capped at a second however many dice are in it, so at
  // real speed 64 chips are gone before the direction registers. This is the
  // same animation with the clock turned down, not a different one.
  add('Play slowly', () => driveDrain(trays, { speed: 0.12 }));
  add('Step one die', () => {
    for (const tray of trays) tray.dropTo(tray.dropped + 1);
  });
  add('Refill', () => {
    for (const tray of trays) tray.refill();
  });
  return controls;
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

// --- the exhibit this page exists for -------------------------------------

const comparison = addScenario({
  title: 'Which line goes first',
  note: 'The same payout at the same width, wrapping both ways, draining off one clock. On the '
    + 'left the short line is at the bottom and empties first — right to left, bottom to top. On '
    + 'the right it is on top, which is what ships. Step through it a die at a time: what moves '
    + 'is only ever which line the last slot is on, because the chips are identical and the ones '
    + 'still standing always fill the first slots.',
});
const pair = document.createElement('div');
pair.className = 'payout-row';
comparison.append(pair);

const before = document.createElement('div');
const after = document.createElement('div');
for (const [host, label] of [[before, 'plain wrap — bottom line first'], [after, 'wrap-reverse — top line first (ships)']]) {
  const caption = document.createElement('p');
  caption.className = 'payout-label';
  caption.textContent = label;
  host.append(caption);
  pair.append(host);
}
const comparisonTrays = [
  addTray(before, { count: 23, wrap: 'wrap', stageClass: 'is-phone' }),
  addTray(after, { count: 23, stageClass: 'is-phone' }),
];
addControls(comparison, comparisonTrays);

// --- the sizes it actually reaches ----------------------------------------

const phone = addScenario({
  title: 'On a phone, where it wraps for real',
  note: 'A phone fits about fifteen chips to a line, so a payout wraps from roughly sixteen dice '
    + 'up — which is an ordinary late-game turn, not an edge case. Eight, sixteen and the full '
    + 'sixty-four a reserve can hold, so the one-line case and the five-line case can be watched '
    + 'draining together.',
});
const phoneRow = document.createElement('div');
phoneRow.className = 'payout-row';
phone.append(phoneRow);
const phoneTrays = [8, 16, MAX_RESERVE].map((count) => {
  const host = document.createElement('div');
  const caption = document.createElement('p');
  caption.className = 'payout-label';
  caption.textContent = `${count} dice`;
  host.append(caption);
  phoneRow.append(host);
  return addTray(host, { count, stageClass: 'is-phone' });
});
addControls(phone, phoneTrays);

// --- and on a desktop, where it takes a rout to wrap at all ----------------

const desktop = addScenario({
  title: 'At full width',
  note: 'A wide screen fits a payout of about forty on one line, so wrapping here means a player '
    + 'who has already taken most of the planet — the largest connected region is what a payout '
    + 'is paid on. Worth having anyway: it is the width the last line is shortest at, which is '
    + 'where a drain that started at the wrong end looks most wrong.',
});
const desktopTrays = [addTray(desktop, { count: MAX_RESERVE })];
addControls(desktop, desktopTrays);
