import { createBattleReadout } from '../render/battleReadout.js';
import { createBattleLog } from '../game/battleLog.js';
import { assignPlayerColors, readableTextColor, DEFAULT_PLAYER_COLORS } from '../render/palette.js';
import { pipPositions } from '../render/pips.js';

const NAMES = ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'Orange', 'Cyan', 'White'];
const ALL_IDS = NAMES.map((_, i) => `p${i + 1}`);
const COLORS = assignPlayerColors(ALL_IDS);
const NAME_BY_ID = new Map(ALL_IDS.map((id, i) => [id, NAMES[i]]));

const SVG_NS = 'http://www.w3.org/2000/svg';
const scenarios = document.getElementById('scenarios');

const css = (color) => `rgb(${color.map((c) => Math.round(c * 255)).join(', ')})`;
const sum = (values) => values.reduce((a, b) => a + b, 0);

function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// An attack event exactly as core's reducer emits one, so the log and the
// readout are exercised through their real inputs rather than through
// hand-built entries that could quietly stop matching.
function attackEvent({ attacker, defender, attack, defend }) {
  return {
    type: 'attack',
    from: 1,
    to: 2,
    attackRolls: attack,
    defendRolls: defend,
    attackRoll: sum(attack),
    defendRoll: sum(defend),
    attackerWins: sum(attack) > sum(defend),
    attackerOwner: attacker,
    defenderOwner: defender,
  };
}

const roll = (count, rng) => Array.from({ length: count }, () => 1 + Math.floor(rng() * 6));

// Plays plausible fights into a log: stack sizes vary, players drop out along
// the way, and every so often somebody just ends their turn — so passes and
// eliminations land among the battles the way they do in a real game, rather
// than every round being a fight or all bunched at the end.
function playInto(log, { rounds, playerIds, rng }) {
  const living = [...playerIds];
  for (let i = 0; i < rounds; i++) {
    if (living.length < 2) break;

    if (rng() < 0.1) {
      const passer = Math.floor(rng() * living.length);
      log.record({ type: 'passed', playerId: living[passer] });
      continue;
    }

    const a = Math.floor(rng() * living.length);
    let d = Math.floor(rng() * living.length);
    if (d === a) d = (d + 1) % living.length;

    log.record(attackEvent({
      attacker: living[a],
      defender: living[d],
      attack: roll(1 + Math.floor(rng() * 8), rng),
      defend: roll(1 + Math.floor(rng() * 8), rng),
    }));

    if (living.length > 2 && rng() < 0.08) {
      const [out] = living.splice(d, 1);
      log.record({ type: 'eliminated', playerId: out, by: living[a % living.length] });
    }
  }
  return log;
}

function addScenario({ title, note, stageClass = '', build }) {
  const section = document.createElement('section');
  section.className = 'scenario';
  section.innerHTML = '<h2></h2><p></p><div class="stage"></div>';
  section.querySelector('h2').textContent = title;
  section.querySelector('p').textContent = note;
  scenarios.append(section);

  const stage = section.querySelector('.stage');
  stage.className = `stage ${stageClass}`.trim();

  const host = document.createElement('div');
  host.className = 'hud-battle';
  stage.append(host);

  build({
    readout: createBattleReadout(host, { playerColors: COLORS, playerNames: NAME_BY_ID }),
    section,
    stage,
  });
}

// --- every face, on every color -------------------------------------------

function dieSwatch(face, color) {
  const chip = document.createElement('span');
  chip.className = 'battle-die';
  chip.style.setProperty('--die-color', css(color));
  chip.style.setProperty('--die-ink', css(readableTextColor(color)));

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', 'battle-die-face');
  for (const [x, y] of pipPositions(face)) {
    const pip = document.createElementNS(SVG_NS, 'circle');
    pip.setAttribute('cx', String(x * 100));
    pip.setAttribute('cy', String(y * 100));
    pip.setAttribute('r', '10');
    svg.append(pip);
  }
  chip.append(svg);
  return chip;
}

function addFaceGrid() {
  const section = document.createElement('section');
  section.className = 'scenario';
  section.innerHTML = `
    <h2>Every face, every player</h2>
    <p>Pips come from the same layout table as the dice on the planet, inked for contrast against
       each player color. Shown larger than life here so the shapes are clear — the readouts below
       are at the size they actually appear.</p>
    <div class="stage"><div class="faces"></div></div>
  `;
  scenarios.append(section);

  const grid = section.querySelector('.faces');
  grid.append(document.createElement('span')); // empty corner above the names
  for (let face = 1; face <= 6; face++) {
    const head = document.createElement('span');
    head.className = 'head';
    head.textContent = String(face);
    grid.append(head);
  }

  DEFAULT_PLAYER_COLORS.forEach((color, i) => {
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = NAMES[i];
    grid.append(who);
    for (let face = 1; face <= 6; face++) grid.append(dieSwatch(face, color));
  });
}

addFaceGrid();

// --- one battle at a time -------------------------------------------------

const entryOf = (attacker, defender, attack, defend) =>
  createBattleLog().record(attackEvent({ attacker, defender, attack, defend }));

const oneBattle = (attacker, defender, attack, defend, options) => ({ readout }) => {
  readout.show(entryOf(attacker, defender, attack, defend), options);
};

/**
 * How long the offer runs on this page. Not `cancelWindow(DEFAULT_TIMING)`:
 * the real one is under a second, which is right in a game and too short to
 * study. Slowed down deliberately, and said so on the page.
 */
const CANCEL_DEMO_MS = 4000;

addScenario({
  title: 'Attacker wins',
  note: 'Four dice against two. The winning total is the lit one; the loser stays dimmed.',
  build: oneBattle('p1', 'p2', [5, 6, 3, 6], [2, 4]),
});

addScenario({
  title: 'Defender holds',
  note: 'The same layout when the attack fails, so the defender is the side that lights up.',
  build: oneBattle('p3', 'p4', [1, 2, 1], [6, 5]),
});

addScenario({
  title: 'Still rolling',
  note: 'What shows while the dice are tumbling on the planet: the right count in the right '
    + 'colors, faces blank, no totals. The readout must not give the result away early.',
  build: oneBattle('p2', 'p1', [4, 4, 2, 6, 1], [3, 3, 3], { revealed: false }),
});

// The state the whole cancel feature is read in, and the one that is hardest
// to catch in the game: it is up for well under a second.
addScenario({
  title: 'Cancelable — the offer draining',
  note: 'The player’s own attack, still callable off. Same blank dice as “Still rolling”, with '
    + 'the × in the chevron’s slot so the readout does not change width for the second it is '
    + 'there. The bar behind the × is the time left, run at four seconds here against the real '
    + 'window of about one — long enough to look at. Any press on the planet does what pressing '
    + 'this does.',
  build: ({ readout, section }) => {
    readout.show(entryOf('p2', 'p1', [4, 4, 2, 6, 1], [3, 3, 3]), { revealed: false });

    let started = null;
    const run = () => {
      started = performance.now();
      const frame = () => {
        const left = 1 - (performance.now() - started) / (CANCEL_DEMO_MS);
        if (left <= 0) {
          readout.hideCancel();
          return;
        }
        readout.showCancel(left);
        requestAnimationFrame(frame);
      };
      frame();
    };

    readout.onCancel(() => {
      readout.hideCancel();
      note.textContent = 'Cancelled — in the game a toast says so and the board goes back.';
    });

    const controls = document.createElement('div');
    controls.className = 'controls';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Run the window again';
    button.addEventListener('click', () => {
      note.textContent = '';
      run();
    });
    const note = document.createElement('span');
    note.className = 'count';
    controls.append(button, note);
    section.append(controls);

    run();
  },
});

addScenario({
  title: 'Smallest — one against one',
  note: 'The narrowest the readout ever gets.',
  build: oneBattle('p6', 'p7', [4], [3]),
});

// The rule's edge, either side of it, so the two are directly comparable —
// this pair is what to look at to judge where the cap belongs.
addScenario({
  title: 'Four a side — the widest full reading',
  note: 'Right on the cap: every die shown, each side next to its own total. Past this the '
    + 'faces stop being something you take in at a glance and become a row to count, which is '
    + 'what the cap is for — it is not about running out of room, and there is room to spare here.',
  build: oneBattle('p1', 'p2', [6, 5, 4, 3], [2, 4, 6, 1]),
});

addScenario({
  title: 'Five against four — one die over',
  note: 'One more die than the one above, and it flips. Compare the two: the question is whether '
    + 'the fight above is still readable at a glance and this one is not.',
  build: oneBattle('p1', 'p2', [6, 5, 4, 3, 2], [2, 4, 6, 1]),
});

addScenario({
  title: 'Four a side, in a very narrow column',
  note: 'The same fight as the cap example, given 240px. Width prevails over the dice rule: the '
    + 'full reading would be clipped here — the readout has overflow: hidden, so overrunning '
    + 'truncates rather than scrolls — so it falls back to compact despite being within the cap.',
  stageClass: 'is-narrow',
  build: oneBattle('p1', 'p2', [6, 5, 4, 3], [2, 4, 6, 1]),
});

addScenario({
  title: 'Widest — eight against eight',
  note: 'The most dice that can ever be fought with, since a territory holds at most eight. Far '
    + 'past four a side, so it is compact however much room it is given — the stack marks and '
    + 'totals pinned left, the dice scrolling on the right.',
  build: oneBattle('p1', 'p5', [6, 5, 4, 3, 2, 1, 6, 5], [1, 2, 3, 4, 5, 6, 1, 2]),
});

addScenario({
  title: 'Eight against eight, at phone width',
  note: 'The same fight in a 360px column — identical to the one above, which is the point: a '
    + 'fight this size reads the same way everywhere, because the dice count settled it before '
    + 'any width was measured.',
  stageClass: 'is-phone',
  build: oneBattle('p1', 'p5', [6, 5, 4, 3, 2, 1, 6, 5], [1, 2, 3, 4, 5, 6, 1, 2]),
});

addScenario({
  title: 'Compact — a very narrow column',
  note: 'The compact reading on its own: the stack mark is two wide and four high, filled from '
    + 'the bottom, exactly how the dice pile up on the planet — so five pips means five dice. '
    + 'The dice strip fades out on whichever side has more dice waiting: right to begin with, '
    + 'both once you drag into the middle, left alone at the end. Drag it to see.',
  stageClass: 'is-narrow',
  build: oneBattle('p1', 'p5', [6, 5, 4, 3, 2], [1, 2, 3, 4, 5, 6, 1, 2]),
});

addScenario({
  title: 'Stack marks, one through eight',
  note: 'Every count the mark has to convey, against a fixed single-die defender.',
  stageClass: 'is-narrow',
  build: ({ stage }) => {
    stage.querySelector('.hud-battle')?.remove();
    for (let n = 1; n <= 8; n++) {
      const host = document.createElement('div');
      host.className = 'hud-battle';
      stage.append(host);
      const readout = createBattleReadout(host, {
        playerColors: COLORS,
        playerNames: NAME_BY_ID,
      });
      readout.show(
        createBattleLog().record(
          attackEvent({
            attacker: 'p1',
            defender: 'p2',
            attack: Array.from({ length: n }, (_, i) => 1 + (i % 6)),
            defend: [3],
          })
        )
      );
    }
  },
});

// --- the history panel ----------------------------------------------------

addScenario({
  title: 'History — nothing yet',
  note: 'Before the first fight: the readout hides itself entirely, and the history says so.',
  stageClass: 'is-open',
  build: ({ readout }) => {
    readout.show(null);
    readout.setHistory([]);
    readout.open();
  },
});

function addHistory({ title, note, rounds, players = 6, seed = 1, stageClass = '', grow = false }) {
  addScenario({
    title,
    note,
    stageClass: `is-open ${stageClass}`.trim(),
    build: ({ readout, section }) => {
      const playerIds = ALL_IDS.slice(0, players);
      const rng = seededRng(seed);
      const log = createBattleLog();
      let counter = null;

      const refresh = () => {
        readout.show(log.latestBattle);
        readout.setHistory(log.entries);
        readout.open();
        if (counter) counter.textContent = `${log.entries.length} entries in the log`;
      };

      playInto(log, { rounds, playerIds, rng });

      if (grow) {
        const controls = document.createElement('div');
        controls.className = 'controls';
        controls.innerHTML = `
          <button type="button" data-add="20">+20 fights</button>
          <button type="button" data-add="200">+200 fights</button>
          <span class="count"></span>
        `;
        section.append(controls);
        counter = controls.querySelector('.count');

        for (const button of controls.querySelectorAll('button')) {
          button.addEventListener('click', () => {
            playInto(log, { rounds: Number(button.dataset.add), playerIds, rng });
            refresh();
          });
        }
      }

      refresh();
    },
  });
}

addHistory({
  title: 'History — a handful',
  note: 'Early in a game, short enough that the panel simply sizes to its contents.',
  rounds: 4,
  players: 4,
  seed: 12,
});

addHistory({
  title: 'History — scrollable',
  note: 'Forty-odd entries, past the panel max height, so the list scrolls inside while the panel '
    + 'itself stays put. Newest is at the top, so the interesting end needs no scrolling.',
  rounds: 40,
  players: 6,
  seed: 7,
});

addHistory({
  title: 'History — at the cap, and growing',
  note: 'The log keeps its most recent 120 entries and drops the rest. Push it past the cap with '
    + 'these buttons: the panel should not grow, slow down, or lose its scroll position.',
  rounds: 130,
  players: 8,
  seed: 3,
  grow: true,
});

addHistory({
  title: 'History — scrollable, at phone width',
  note: 'The same long history in a 360px column, where the panel is at its narrowest. Every row '
    + 'keeps both totals visible; the wider ones scroll their dice independently.',
  rounds: 40,
  players: 6,
  seed: 21,
  stageClass: 'is-phone',
});
