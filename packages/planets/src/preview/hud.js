import { createHud } from '../render/hud.js';
import { createBattleLog } from '../game/battleLog.js';
import { playerStatsFor } from '../game/playerStats.js';
import { assignPlayerColors } from '../render/palette.js';
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

// Replays a list of attacks/knockouts into a real battle log, so the readout
// and history below are built from exactly what a game would feed them.
function logFrom(fights = [], playerIds) {
  const log = createBattleLog();
  for (const fight of fights) {
    if (fight.out !== undefined) {
      log.record({ type: 'eliminated', playerId: playerIds[fight.out], by: playerIds[fight.by] });
      continue;
    }
    const [attackRolls, defendRolls] = [fight.attack, fight.defend];
    const sum = (values) => values.reduce((a, b) => a + b, 0);
    log.record({
      type: 'attack',
      from: 1,
      to: 2,
      attackRolls,
      defendRolls,
      attackRoll: sum(attackRolls),
      defendRoll: sum(defendRolls),
      attackerWins: sum(attackRolls) > sum(defendRolls),
      attackerOwner: playerIds[fight.by],
      defenderOwner: playerIds[fight.against],
    });
  }
  return log;
}

function addScenario({ title, note, stageClass = '', fights, rolling = false, ...scenario }) {
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

  if (fights) {
    const log = logFrom(fights, playerIds);
    hud.showBattle(log.latestBattle, { revealed: !rolling });
    hud.setHistory(log.entries);
  }

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
  title: 'Battle readout — attacker wins',
  note: 'Under the stats row: a die per die rolled in each side’s color, then the total. '
    + 'The winning total is the lit one. Tap it for the history.',
  holdings: [14, 14, 13, 13],
  reserves: [0, 2, 0, 0],
  currentIndex: 0,
  fights: [{ by: 0, against: 1, attack: [5, 6, 3, 6], defend: [2, 4] }],
});

addScenario({
  title: 'Battle readout — attacker loses',
  note: 'A failed attack: the defender’s total is the one lit up.',
  holdings: [11, 17, 13, 13],
  reserves: [0, 0, 0, 0],
  currentIndex: 2,
  fights: [{ by: 2, against: 3, attack: [1, 2, 1], defend: [6, 5] }],
});

addScenario({
  title: 'Battle readout — mid-roll',
  note: 'While the dice are still tumbling on the planet: the right number of dice in the right '
    + 'colors, but no faces and no total yet — the readout must not spoil the roll.',
  holdings: [14, 14, 13, 13],
  reserves: [0, 0, 0, 0],
  currentIndex: 1,
  fights: [{ by: 1, against: 0, attack: [4, 4, 2, 6, 1], defend: [3, 3, 3] }],
  rolling: true,
});

addScenario({
  title: 'Battle readout — widest possible',
  note: 'Eight dice against eight, the most that can ever be shown. On a narrow screen the '
    + 'readout scrolls sideways rather than wrapping.',
  holdings: [20, 20, 7, 7],
  reserves: [0, 0, 0, 0],
  currentIndex: 0,
  fights: [{
    by: 0, against: 1,
    attack: [6, 5, 4, 3, 2, 1, 6, 5],
    defend: [1, 2, 3, 4, 5, 6, 1, 2],
  }],
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
  note: 'A full table, including the longest names. Narrow the window until it overflows: the '
    + 'row has no scrollbar, so it fades out over whichever edge it can still be scrolled '
    + 'towards — the same cue, from the same code, as the dice strip in the readout.',
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
  note: 'Eliminated players keep their place in the row rather than vanishing from it, but fold '
    + 'down to a dot in their own color instead of holding a full-width slot. Open the history: '
    + 'knockouts are logged alongside the fights that caused them.',
  holdings: [31, 0, 0, 9, 0, 4, 0, 0],
  reserves: [17, 0, 0, 2, 0, 0, 0, 0],
  currentIndex: 0,
  fights: [
    { by: 0, against: 1, attack: [3, 4], defend: [5, 6] },
    { by: 5, against: 6, attack: [6, 6, 5], defend: [1, 2] },
    { out: 6, by: 5 },
    { by: 0, against: 4, attack: [6, 6, 6, 4], defend: [2, 3, 1] },
    { out: 4, by: 0 },
    { by: 3, against: 0, attack: [2, 2], defend: [6, 3] },
    { by: 0, against: 2, attack: [5, 5, 6], defend: [1, 1] },
    { out: 2, by: 0 },
  ],
});

// The collapse itself, driven by hand. A transition is the one thing a still
// cannot show, so this scenario has buttons instead of a fixed board.
const dropout = document.createElement('section');
dropout.className = 'scenario';
dropout.innerHTML = `
  <h2>Dropping out — the collapse, animated</h2>
  <p>Knock players out and bring them back to watch a tile fold down to a dot and open again.
     Three things to judge: that the fold moves from the very first frame rather than sitting
     still and then lurching, that the row closes up around the gap smoothly, and that the dot
     keeps that player's own color — it is all that is left saying whose slot it is, so eight
     knockouts must not give eight identical dots. On a narrow window this is also where the
     row's scroll fade earns its keep: folding tiles away changes how much there is left to
     scroll, so the fade has to settle on the right edges once the animation lands.</p>
  <div class="stage"></div>
  <div class="controls"></div>
`;
document.getElementById('scenarios').append(dropout);

const DROPOUT_HOLDINGS = [12, 9, 7, 11, 6, 8, 5, 10];
const dropoutIds = DROPOUT_HOLDINGS.map((_, i) => `p${i + 1}`);
const knockedOut = new Set();

const dropoutHud = createHud(dropout.querySelector('.stage'), {
  playerColors: assignPlayerColors(dropoutIds),
  playerNames: new Map(dropoutIds.map((id, i) => [id, NAMES[i]])),
});
const dropoutControls = dropout.querySelector('.controls');
const dropoutButtons = [];

function paintDropout() {
  const holdings = DROPOUT_HOLDINGS.map((held, i) => (knockedOut.has(i) ? 0 : held));
  const { state } = stateFrom({
    holdings,
    reserves: [0, 3, 0, 0, 0, 12, 0, 0],
    // whoever is left — a player who has been knocked out cannot also be the
    // one whose turn it is, and the row would draw both marks if asked
    currentIndex: Math.max(0, holdings.findIndex((held) => held > 0)),
  });
  dropoutHud.showPlayers(playerStatsFor(state, dropoutIds));
  dropoutButtons.forEach((button, i) => {
    button.textContent = knockedOut.has(i) ? `${NAMES[i]} ↩` : NAMES[i];
  });
}

for (const [i, name] of NAMES.entries()) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = name;
  button.addEventListener('click', () => {
    if (knockedOut.has(i)) knockedOut.delete(i);
    else knockedOut.add(i);
    paintDropout();
  });
  dropoutButtons.push(button);
  dropoutControls.append(button);
}

// The two ends of it: a late game where most of the table has gone, and a
// clean slate to watch them all open at once.
for (const [label, out] of [['Knock out five', [1, 2, 4, 6, 7]], ['Everyone back', []]]) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', () => {
    knockedOut.clear();
    for (const i of out) knockedOut.add(i);
    paintDropout();
  });
  dropoutControls.append(button);
}

paintDropout();

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
  note: 'Eight players in a 360px viewport — the row scrolls sideways rather than shrinking '
    + 'tiles, and fades on the right to say so. Drag it: the fade moves to both edges in the '
    + 'middle and to the left alone at the end.',
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
