import { createHud } from './render/hud.js';
import { playerStatsFor } from './game/playerStats.js';
import { assignPlayerColors } from './render/palette.js';
import { MAX_RESERVE } from '@dicewars/core';

const NAMES = ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'Orange', 'Cyan', 'White'];

// A game state shaped exactly like core's, built straight from the numbers a
// scenario wants to show — so the preview runs the real playerStatsFor rather
// than a hand-rolled stand-in that could quietly disagree with it.
function stateFrom({ holdings, reserves, currentIndex = 0, phase = 'attack', winner = null }) {
  const playerIds = holdings.map((_, i) => `p${i + 1}`);
  const nodes = new Map();
  let territory = 0;

  playerIds.forEach((id, i) => {
    for (let n = 0; n < holdings[i]; n++) nodes.set(`t${territory++}`, { owner: id, dice: 1 });
  });

  return {
    state: {
      nodes,
      players: new Map(playerIds.map((id, i) => [id, { id, reserve: reserves[i] ?? 0 }])),
      turnOrder: playerIds,
      currentTurnIndex: currentIndex,
      phase,
      winner: winner === null ? null : playerIds[winner],
    },
    playerIds,
  };
}

function addScenario({ title, note, stageClass = '', ...scenario }) {
  const { state, playerIds } = stateFrom(scenario);

  const section = document.createElement('section');
  section.className = 'scenario';
  section.innerHTML = `<h2></h2><p></p><div class="stage ${stageClass}"></div>`;
  section.querySelector('h2').textContent = title;
  section.querySelector('p').textContent = note;

  const hud = createHud(section.querySelector('.stage'), {
    playerColors: assignPlayerColors(playerIds),
    playerNames: new Map(playerIds.map((id, i) => [id, NAMES[i]])),
  });
  hud.showPlayers(playerStatsFor(state, playerIds));

  document.getElementById('scenarios').append(section);
}

addScenario({
  title: 'Fresh game — four players',
  note: 'Nothing banked yet, so no badges at all. This is what most of a game looks like.',
  holdings: [14, 14, 13, 13],
  reserves: [0, 0, 0, 0],
  currentIndex: 0,
});

addScenario({
  title: 'Mixed reserves',
  note: 'Some players banking, some not — the tiles must all still be the same size.',
  holdings: [9, 21, 4, 17],
  reserves: [0, 3, 0, 12],
  currentIndex: 1,
});

addScenario({
  title: 'Eight players',
  note: 'A full table, including the longest names. Scroll it sideways if it overflows.',
  holdings: [8, 12, 3, 7, 15, 2, 9, 6],
  reserves: [0, 5, 1, 0, 24, 0, 8, 2],
  currentIndex: 4,
});

addScenario({
  title: 'Worst case for the badge',
  note: `Everyone at the ${MAX_RESERVE}-dice cap with two-digit holdings — the tightest the `
    + 'badge and the big number ever get. The reserve is underlined at the cap.',
  holdings: [12, 34, 56, 78, 90, 21, 43, 65],
  reserves: Array(8).fill(MAX_RESERVE),
  currentIndex: 2,
});

addScenario({
  title: 'Late game — players knocked out',
  note: 'Eliminated players keep their slot, grayed out, rather than vanishing from the row.',
  holdings: [31, 0, 0, 9, 0, 4, 0, 0],
  reserves: [17, 0, 0, 2, 0, 0, 0, 0],
  currentIndex: 0,
});

addScenario({
  title: 'Game over',
  note: 'Nobody is "current" once it is decided; the winner keeps a border and a stronger glow.',
  holdings: [54, 0, 0, 0],
  reserves: [MAX_RESERVE, 0, 0, 0],
  phase: 'gameover',
  winner: 0,
});

addScenario({
  title: 'Phone width (360px)',
  note: 'Eight players in a 360px viewport — the row scrolls sideways rather than shrinking tiles.',
  stageClass: 'is-phone',
  holdings: [8, 12, 3, 7, 15, 2, 9, 6],
  reserves: [0, 5, 1, 0, 24, 0, 8, 2],
  currentIndex: 6,
});

addScenario({
  title: 'Very narrow (240px)',
  note: 'The smallest width worth supporting, to check nothing collapses or overlaps.',
  stageClass: 'is-narrow',
  holdings: [23, 41, 7, 12],
  reserves: [MAX_RESERVE, 6, 0, 1],
  currentIndex: 1,
});

// Last: the same tiles at 2.5x, since the badge is the whole point and it is
// only a few pixels tall at life size.
const zoom = document.createElement('section');
zoom.className = 'scenario';
zoom.innerHTML = `
  <h2>Close up (2.5×)</h2>
  <p>The badge magnified — clearance between it and the territory count is what to judge here.</p>
  <div class="zoom-frame"><div class="zoomed"><div class="stage" style="width: 300px"></div></div></div>
`;
document.getElementById('scenarios').append(zoom);

const zoomIds = ['p1', 'p2', 'p3', 'p4'];
const zoomHud = createHud(zoom.querySelector('.stage'), {
  playerColors: assignPlayerColors(zoomIds),
  playerNames: new Map(zoomIds.map((id, i) => [id, NAMES[i]])),
});
zoomHud.showPlayers(
  playerStatsFor(stateFrom({ holdings: [7, 12, 34, 5], reserves: [0, 3, MAX_RESERVE, 9] }).state, zoomIds)
);
