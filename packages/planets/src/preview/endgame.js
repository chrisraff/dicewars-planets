import { createHud, turnIndicatorView } from '../render/hud.js';
import { playerStatsFor } from '../game/playerStats.js';
import { assignPlayerColors } from '../render/palette.js';

const NAMES = ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'Orange', 'Cyan', 'White'];
const scenarios = document.getElementById('scenarios');

// A board shaped like core's, built straight from who holds how much — so the
// stats row behind each banner is in the state it would really be in.
function stateFrom({ holdings, currentIndex = 0, phase = 'attack', winnerIndex = null }) {
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
      currentTurnIndex: currentIndex,
      phase,
      winner: winnerIndex === null ? null : playerIds[winnerIndex],
    },
  };
}

function addScenario({ title, note, stageClass = '', outcome, status, ...board }) {
  const { state, playerIds } = stateFrom(board);
  const playerColors = assignPlayerColors(playerIds);
  const playerNames = new Map(playerIds.map((id, i) => [id, NAMES[i]]));

  const section = document.createElement('section');
  section.className = 'scenario';
  section.innerHTML = '<h2></h2><p></p><div class="stage is-hud"></div>';
  section.querySelector('h2').textContent = title;
  section.querySelector('p').textContent = note;
  scenarios.append(section);

  const stage = section.querySelector('.stage');
  stage.className = `stage is-hud ${stageClass}`.trim();

  // its own host, laid out like #hud is in the game
  const host = document.createElement('div');
  host.className = 'hud-host';
  stage.append(host);

  const hud = createHud(host, { playerColors, playerNames });
  hud.showPlayers(playerStatsFor(state, playerIds));
  hud.showTurn(status);

  // what the turn indicator resolved to, spelled out — it is the part that
  // used to go stale, and it is easy to miss in a strip of chrome
  const readout = document.createElement('pre');
  readout.className = 'menu-readout';
  const view = turnIndicatorView(status, (id) => playerNames.get(id) ?? id);
  readout.textContent = `turn indicator: "${view.text}"   ·   end turn: ${view.endTurn}`;
  section.append(readout);

  if (outcome) {
    hud.showOutcome(outcome);
    hud.onOutcomeAction((action) => {
      readout.textContent = `action fired: ${action}`;
      if (action !== 'newGame') {
        hud.hideOutcome();
        readout.textContent += '  ·  banner dismissed — the board is yours to look at';
      }
    });
  }
}

const status = (over = {}) => ({
  currentPlayerId: 'p1',
  humanPlayerId: 'p1',
  winner: null,
  isOver: false,
  humanEliminated: false,
  canAct: true,
  ...over,
});

// --- the ordinary states, for comparison ----------------------------------

addScenario({
  title: 'Playing — your turn',
  note: 'The normal state, here so the endings below have something to be different from.',
  holdings: [9, 8, 8, 8, 8, 8],
  status: status(),
});

addScenario({
  title: 'Playing — someone else’s turn',
  note: 'The end-turn button hides rather than greying out, so it is never a target while an '
    + 'opponent is mid-move.',
  holdings: [9, 8, 8, 8, 8, 8],
  currentIndex: 1,
  status: status({ currentPlayerId: 'p2' }),
});

// --- the endings ----------------------------------------------------------

addScenario({
  title: 'You win',
  note: 'The banner has the screen to itself until you dismiss it — the menu no longer opens over '
    + 'the top the instant the game ends. "Look at the board" clears it and leaves the final planet.',
  holdings: [49, 0, 0, 0, 0, 0],
  phase: 'gameover',
  winnerIndex: 0,
  status: status({ isOver: true, winner: 'p1' }),
  outcome: { kind: 'over', winner: 'p1', humanPlayerId: 'p1' },
});

addScenario({
  title: 'Someone else wins',
  note: 'The title takes the winner’s color. Note the indicator behind it reads "Blue wins" — '
    + 'a finished game never moves its turn index off the winner, so asking whose turn it is '
    + 'would otherwise still answer as though play were carrying on.',
  holdings: [0, 49, 0, 0, 0, 0],
  currentIndex: 1,
  phase: 'gameover',
  winnerIndex: 1,
  status: status({ currentPlayerId: 'p2', isOver: true, winner: 'p2' }),
  outcome: { kind: 'over', winner: 'p2', humanPlayerId: 'p1' },
});

addScenario({
  title: 'You are knocked out',
  note: 'The case that used to pass in complete silence: your last territory goes, the AIs play '
    + 'on, and nothing said why the board had stopped answering. "Spectate" leads, because '
    + 'carrying on throws nothing away.',
  holdings: [0, 14, 9, 12, 8, 6],
  currentIndex: 2,
  status: status({ currentPlayerId: 'p3', humanEliminated: true }),
  outcome: { kind: 'eliminated', by: 'p3', humanPlayerId: 'p1' },
});

addScenario({
  title: 'Watching on, after being knocked out',
  note: 'What the banner leaves behind: the indicator says you are out and watching, your tile is '
    + 'greyed in the row, and there is no turn to take. Reachable above by pressing "Spectate".',
  holdings: [0, 14, 9, 12, 8, 6],
  currentIndex: 2,
  status: status({ currentPlayerId: 'p3', humanEliminated: true }),
});

addScenario({
  title: 'Knocked out, then someone wins',
  note: 'The result outranks having been knocked out earlier — you are shown who won, not still '
    + 'told you are watching.',
  holdings: [0, 49, 0, 0, 0, 0],
  currentIndex: 1,
  phase: 'gameover',
  winnerIndex: 1,
  status: status({ currentPlayerId: 'p2', isOver: true, winner: 'p2', humanEliminated: true }),
  outcome: { kind: 'over', winner: 'p2', humanPlayerId: 'p1' },
});

addScenario({
  title: 'Nobody wins',
  note: 'Should not be reachable in play, but the banner must not read "undefined wins" if it '
    + 'ever is.',
  holdings: [0, 0, 0, 0, 0, 0],
  phase: 'gameover',
  winnerIndex: null,
  status: status({ isOver: true, winner: null }),
  outcome: { kind: 'over', winner: null, humanPlayerId: 'p1' },
});

addScenario({
  title: 'You win, at phone width',
  note: 'The actions stack with the primary one nearest the thumb.',
  stageClass: 'is-phone',
  holdings: [49, 0, 0, 0, 0, 0],
  phase: 'gameover',
  winnerIndex: 0,
  status: status({ isOver: true, winner: 'p1' }),
  outcome: { kind: 'over', winner: 'p1', humanPlayerId: 'p1' },
});
