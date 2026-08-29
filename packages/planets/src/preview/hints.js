import { createHud, attackHintText, attackHintView } from '../render/hud.js';
import { playerStatsFor } from '../game/playerStats.js';
import { assignPlayerColors } from '../render/palette.js';

const NAMES = ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'Orange', 'Cyan', 'White'];
const scenarios = document.getElementById('scenarios');

// A board shaped like core's, so the stats row above each prompt is in a state
// a real game could actually be in.
function stateFrom({ holdings, currentIndex = 0 }) {
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
      phase: 'attack',
      winner: null,
    },
  };
}

/**
 * `status` is the same object the session hands `showHint` — plus the one
 * thing it never sets, `coarsePointer`, which the HUD normally reads off the
 * browser. Overriding it is the whole reason both wordings can be seen from
 * one machine.
 */
function addScenario({ title, note, stageClass = '', status, reinforce = null, ...board }) {
  const { state, playerIds } = stateFrom(board);
  const playerColors = assignPlayerColors(playerIds);
  const playerNames = new Map(playerIds.map((id, i) => [id, NAMES[i]]));

  const section = document.createElement('section');
  section.className = 'scenario';
  section.innerHTML = '<h2></h2><p></p>';
  section.querySelector('h2').textContent = title;
  section.querySelector('p').textContent = note;
  scenarios.append(section);

  const stage = document.createElement('div');
  stage.className = `stage is-hud ${stageClass}`.trim();
  section.append(stage);

  // its own host, laid out like #hud is in the game
  const host = document.createElement('div');
  host.className = 'hud-host';
  stage.append(host);

  const hud = createHud(host, { playerColors, playerNames, humanPlayerId: 'p1' });
  hud.showPlayers(playerStatsFor(state, playerIds));
  hud.showTurn(status);
  if (reinforce) hud.showReinforce(reinforce);

  // what the pure view decided, spelled out — a prompt that is *correctly*
  // absent looks exactly like one that is broken, so say which it is
  const readout = document.createElement('pre');
  readout.className = 'menu-readout';
  const say = (line, shown = status) => {
    // the HUD fills the color name in from its own player list, so the readout
    // has to as well, or it would print a different sentence from the panel
    // right above it
    const view = attackHintView({ ...shown, playerName: playerNames.get(shown.humanPlayerId) });
    readout.textContent = `${line}\nattackHintView: `
      + (view ? `"${attackHintText(view)}"` : 'null — nothing to say');
  };
  say('as the game would show it');
  section.append(readout);

  hud.showHint(status);

  hud.onHintDismiss(() => {
    hud.showHint({ ...status, seen: true });
    say('dismissed — the game would write that down and never show it again');
  });

  const controls = document.createElement('div');
  controls.className = 'controls';
  const again = document.createElement('button');
  again.type = 'button';
  again.textContent = 'Show it again';
  again.addEventListener('click', () => {
    hud.showHint(status);
    say('as the game would show it');
  });
  controls.append(again);
  section.append(controls);

  return { hud, controls, say };
}

const turn = (over = {}) => ({
  currentPlayerId: 'p1',
  humanPlayerId: 'p1',
  winner: null,
  isOver: false,
  humanEliminated: false,
  canAct: true,
  seen: false,
  isHumanTurn: true,
  ...over,
});

// --- when it shows --------------------------------------------------------

addScenario({
  title: 'First turn, with a mouse',
  note: 'The panel sits above the turn row rather than over the planet, so the territories it '
    + 'is telling you to press are never the ones it is covering.',
  holdings: [9, 8, 8, 8],
  status: turn({ coarsePointer: false }),
});

addScenario({
  title: 'First turn, on a touch screen',
  note: 'The same prompt, worded for a finger. Telling somebody on a phone to click is the sort '
    + 'of small wrongness that makes the rest of the sentence less believable.',
  holdings: [9, 8, 8, 8],
  status: turn({ coarsePointer: true }),
});

// The chip is the reason this page exists at second glance: it is the one
// place a player color is asked to carry legible text, and the palette runs
// from dark red to near-white, so the ink flips partway along it. Eight
// scenarios would be eight stages of the same thing — one stage that walks the
// seats shows the same and stays readable.
const walk = addScenario({
  title: 'Every color the chip has to work in',
  note: 'The color name is a chip in the player’s own color, because a player color used as ink '
    + 'on this panel only reaches about 4:1 — under AA at this size — while the color as a '
    + 'background under readableTextColor is the pairing the stats row already proves across the '
    + 'whole palette. Walk the seats: the ink flips from white to near-black somewhere around '
    + 'yellow, and every one has to stay legible.',
  holdings: [8, 7, 7, 7, 7, 7, 7, 7],
  status: turn({ coarsePointer: true }),
});

for (const [i, name] of NAMES.entries()) {
  const seat = `p${i + 1}`;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = name;
  button.addEventListener('click', () => {
    const status = turn({ coarsePointer: true, humanPlayerId: seat, currentPlayerId: seat });
    walk.hud.showTurn(status);
    walk.hud.showHint(status);
    walk.say(`seated as ${name}`, status);
  });
  walk.controls.append(button);
}

addScenario({
  title: 'Phone width (360px)',
  note: 'The sentence is the widest thing in the controls column, so this is where it has to be '
    + 'checked: two or three lines, clear of the end-turn button, and the × still a real target.',
  stageClass: 'is-phone',
  holdings: [9, 8, 8, 8],
  status: turn({ coarsePointer: true }),
});

addScenario({
  title: 'With a payout landing underneath it',
  note: 'The only other thing that lives in this column is the tray of dice a turn just earned. '
    + 'They stack rather than collide — worth checking, because a first-timer sees their first '
    + 'payout with the prompt still up.',
  holdings: [9, 8, 8, 8],
  status: turn({ coarsePointer: true }),
  reinforce: { playerId: 'p1', count: 7 },
});

// --- when it says nothing -------------------------------------------------

addScenario({
  title: 'Already seen it',
  note: 'The ordinary case for everybody who is not on their first game: silence.',
  holdings: [9, 8, 8, 8],
  status: turn({ seen: true }),
});

addScenario({
  title: 'Somebody else’s turn',
  note: 'Advice about a turn you are not taking is an instruction you cannot follow, so there '
    + 'is none — it comes back when the turn does.',
  holdings: [9, 8, 8, 8],
  currentIndex: 1,
  status: turn({ currentPlayerId: 'p2', isHumanTurn: false, canAct: false }),
});

addScenario({
  title: 'Knocked out',
  note: 'Nothing to attack with, so nothing to say about attacking.',
  holdings: [0, 14, 9, 12],
  currentIndex: 1,
  status: turn({ currentPlayerId: 'p2', isHumanTurn: false, humanEliminated: true, canAct: false }),
});

addScenario({
  title: 'Game over',
  note: 'The banner has the screen at this point; a prompt behind it would only be waiting to '
    + 'reappear under an ending.',
  holdings: [33, 0, 0, 0],
  status: turn({ isOver: true, winner: 'p1' }),
});
