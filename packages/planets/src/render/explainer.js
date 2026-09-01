import { winProbability, MAX_DICE_PER_NODE, MAX_RESERVE } from '@dicewars/core';
import { dieChip } from './battleReadout.js';
import { createPlayerTile, paintPlayerTile, playerPanelView } from './hud.js';
import { DEFAULT_PLAYER_COLORS, readableTextColor } from './palette.js';

/**
 * "How the game works" — the rules a player can lose a match without ever
 * working out.
 *
 * Everything in here is something the board *does* without saying so. The
 * territory you attack from is emptied whether you win or lose; the defender
 * takes ties; two big stacks are a worse fight than two small ones; income is
 * your largest *connected* region and it scatters where it likes. None of that
 * is discoverable by looking, and all of it decides games.
 *
 * It is deliberately not a tutorial. There is nothing here about which button
 * to press — `attackHintView` says that once, on the first turn, which is when
 * it is worth saying. This is for somebody who has played a few games and
 * wants to know why they keep losing.
 *
 * The content is data rather than markup so the whole document can be checked
 * without a browser: that every figure a section asks for is one the capture
 * harness knows how to shoot, and that the odds quoted are the odds core
 * actually deals.
 */

/**
 * The pictures of the planet, and the whole of what the harness shoots.
 *
 * `/preview/figures.html` renders one figure per entry here and saves it as
 * `<name>.png`, so this list is the contract between the two: a section can
 * only ask for a capture that exists here, and the harness fails loudly on the
 * page for an entry it has no recipe for.
 *
 * `shot` is what the picture has to show. It is the brief for the harness, and
 * it is also what the reader gets in place of a picture that has not been
 * taken yet — a capture is a file somebody has to commit, and an explainer
 * with a broken image in it is worse than one that says what is missing.
 */
export const EXPLAINER_CAPTURES = {
  'fight-before': {
    alt: 'Five dice stacked on a red territory, next to a blue one holding three.',
    shot: 'A red stack of 5 beside a blue stack of 3, about to be attacked.',
  },
  'fight-after': {
    alt: 'The same two territories, both now red: one holding four dice, the other one.',
    shot: 'The same pair after red wins: 4 dice moved across, 1 left behind.',
  },
  'income-region': {
    alt: 'A red empire on the planet, four territories joined up and two cut off beyond a gap.',
    shot: 'One player holding 6 territories, 4 of them joined and 2 stranded a territory away.',
  },
  'interior-stacks': {
    alt: 'A purple empire ten rounds into a match, its inner territories carrying eight dice '
      + 'each while the border it is fighting on carries one or two.',
    shot: 'A real match played out ten rounds: one player’s interior full at eight dice a '
      + 'territory, against a border running down to one.',
  },
};

/** Every capture a section actually asks for, in the order they are shown. */
export function explainerCaptureNames(sections = EXPLAINER_SECTIONS) {
  return sections.flatMap((section) =>
    section.figures.filter((figure) => figure.kind === 'captures').flatMap((figure) => figure.names)
  );
}

// The matchups worth drawing. Both run the whole range the rules allow,
// because in both cases the *shape* across the range is the point — a single
// pair either side would be two facts rather than a trend.
export const EVEN_FIGHT = Array.from({ length: MAX_DICE_PER_NODE }, (_, i) => [i + 1, i + 1]);
export const ONE_DIE_UP = Array.from({ length: MAX_DICE_PER_NODE - 1 }, (_, i) => [i + 2, i + 1]);

/**
 * A list of matchups as rows to draw, each with the exact chance core would
 * give it. Read out of `winProbability` rather than written down here: these
 * are the odds the game deals, and a table typed into a document is a table
 * that can quietly stop being true.
 */
export function oddsRowsView(matchups) {
  return matchups.map(([attack, defend]) => {
    const chance = winProbability(attack, defend);
    return {
      attack,
      defend,
      label: `${attack} v ${defend}`,
      chance,
      percent: Math.round(chance * 100),
    };
  });
}

/**
 * The document itself.
 *
 * Ordered as a game is played rather than as the rules are written: what a
 * fight does, then what it is worth, then what a turn pays. Income comes after
 * combat because "your largest connected region" only means something once you
 * know that taking ground empties the stack that took it.
 */
export const EXPLAINER_SECTIONS = [
  {
    id: 'attacking',
    title: 'Attacking',
    body: [
      'Pick one of your territories, then a neighbouring enemy. Both sides roll every die they are '
        + 'holding and add them up.',
      'Win, and all but one of your dice move onto the ground you just took. If you lose, all but '
        + 'one of your dice are removed from the attacking territory. Either way, the '
        + 'territory you attacked from ends the fight holding a single die.',
    ],
    figures: [
      {
        kind: 'captures',
        names: ['fight-before', 'fight-after'],
        captions: ['Before: five against three.', 'After: four moved across, one left behind.'],
      },
    ],
  },
  {
    id: 'ties',
    title: 'Ties go to the defender',
    body: [
      'If the totals are equal, the defender has successfully held off the attack.',
    ],
    figures: [
      {
        kind: 'dice',
        attack: [4, 3],
        defend: [5, 2],
        note: 'Seven against seven - the defender holds.',
      },
    ],
  },
  {
    id: 'odds',
    title: 'The odds on big stacks',
    body: [
      'The bigger the fight, the closer it is to a coin flip. An extra die is an extra die whether '
        + 'you are holding two or eight - but the more dice are thrown, the further the total can '
        + 'swing. For big stacks, a small advantage gets lost in a big swing.',
      'The two charts below show that from opposite sides. An even fight is at its worst on small '
        + 'stacks, where a tie - which the defender wins - is far more likely. With more dice, '
        + 'both scenarios approach a 50-50.',
    ],
    figures: [
      {
        kind: 'odds',
        matchups: ONE_DIE_UP,
        title: 'One die up',
        caption: 'The attacker’s chance, one die ahead. The same lead, worth less every step.',
      },
      {
        kind: 'odds',
        matchups: EVEN_FIGHT,
        title: 'Even stacks',
        caption: 'The attacker’s chance, evenly matched. The line is half.',
        marker: 50,
      },
    ],
  },
  {
    id: 'income',
    title: 'Receiving new dice',
    body: [
      'At the end of your turn, you earn one die for every territory in your biggest connected '
        + 'group. In the example below, you can see the red player has six territories, but only '
        + 'four of them are joined up. This means they would only receive four dice at the end of '
        + 'their turn.',
    ],
    figures: [
      {
        kind: 'captures',
        names: ['income-region'],
        captions: ['Six territories held, four of them joined: four dice a turn, not six.'],
      },
    ],
  },
  {
    id: 'payout',
    title: 'Dice scatter across your empire',
    body: [
      'The dice you earn are scattered at random across everything you own, one at a time. This '
        + 'includes the cut-off territories too. You cannot direct dice to your front line. Dice '
        + 'will naturally accumulate in your inner territories over the course of many turns.',
    ],
    figures: [
      {
        kind: 'captures',
        names: ['interior-stacks'],
        captions: [
          'Ten rounds in. Purple’s inner territories have filled to eight dice, while the '
            + 'border it is actually fighting on runs down to one.',
        ],
      },
    ],
  },
  {
    id: 'banked',
    title: 'Too many dice',
    body: [
      `A territory holds at most ${MAX_DICE_PER_NODE} dice. If all your territories have filled `
        + `up, any extra dice you earn are banked (displayed in the bottom right of your player `
        + `tile). They will be included in your income for the next turn and can accumulate up to `
        + `a total of ${MAX_RESERVE} dice. If you earn more than that, the excess is lost.`,
    ],
    figures: [
      { kind: 'banked', territories: 9, reserve: 12, landed: 5, earned: 17 },
    ],
  },
];

// --- drawing it ------------------------------------------------------------

const rgb = ([r, g, b]) => `rgb(${[r, g, b].map((c) => Math.round(c * 255)).join(', ')})`;

/**
 * A picture of the planet, or — until somebody has taken it — a box saying
 * what the picture is of.
 *
 * The captures are committed files rather than anything this page can produce,
 * so the interesting state is the one where they are absent: a fresh clone, or
 * a shot that has not been re-taken since the renderer moved. `onerror` is the
 * only way to catch that, since a missing image is not a load failure the
 * document can see any other way.
 */
function buildCapture(name, caption, base) {
  const capture = EXPLAINER_CAPTURES[name];
  const figure = document.createElement('figure');
  figure.className = 'explainer-capture';

  const image = document.createElement('img');
  image.src = `${base}/${name}.png`;
  image.alt = capture.alt;
  image.loading = 'lazy';
  image.addEventListener('error', () => {
    const missing = document.createElement('div');
    missing.className = 'explainer-missing';
    missing.textContent = capture.shot;
    image.replaceWith(missing);
  });

  const label = document.createElement('figcaption');
  label.textContent = caption;
  figure.append(image, label);
  return figure;
}

function buildCaptures({ names, captions }, { captureBase }) {
  const row = document.createElement('div');
  row.className = 'explainer-captures';
  names.forEach((name, i) => row.append(buildCapture(name, captions[i] ?? '', captureBase)));
  return row;
}

/**
 * The real dice from the battle readout, showing a fight rather than
 * describing one. `dieChip` is the same chip the readout and the payout tray
 * draw, so a face here cannot drift from a face in the game.
 */
function buildDice({ attack, defend, note }) {
  const [attacker, defender] = [DEFAULT_PLAYER_COLORS[0], DEFAULT_PLAYER_COLORS[1]];
  const sum = (values) => values.reduce((a, b) => a + b, 0);

  const figure = document.createElement('figure');
  figure.className = 'explainer-dice';

  const build = (values, color, lost) => {
    const side = document.createElement('div');
    side.className = lost ? 'explainer-side is-loser' : 'explainer-side';
    const strip = document.createElement('div');
    strip.className = 'explainer-die-strip';
    // The ink the readout would pick for this color — white pips on yellow are
    // the reason that is a function rather than a constant.
    const ink = readableTextColor(color);
    for (const value of values) strip.append(dieChip({ value }, color, ink));

    const total = document.createElement('b');
    total.className = 'explainer-total';
    total.textContent = String(sum(values));
    side.append(strip, total);
    return side;
  };

  const versus = document.createElement('span');
  versus.className = 'explainer-versus';
  versus.textContent = 'v';

  const row = document.createElement('div');
  row.className = 'explainer-dice-row';
  row.append(build(attack, attacker, true), versus, build(defend, defender, false));

  const label = document.createElement('figcaption');
  label.textContent = note;
  figure.append(row, label);
  return figure;
}

/**
 * The odds, as a labelled table with the bar as the magnitude cue rather than
 * as a chart with an axis. Every value is printed, which a chart should not do
 * — but this is a thing to look a number up in as much as a shape to read, and
 * there is no axis or hover here to carry the values instead.
 *
 * The bars are neutral on purpose. Every saturated colour in this game names a
 * player, so a coloured bar in a figure about nobody in particular would be
 * read as somebody's. The scale is the full 0–100%, since a percentage on a
 * cropped axis is a lie about how big it is.
 */
function buildOdds({ matchups, title, caption, marker = null }) {
  const figure = document.createElement('figure');
  figure.className = 'explainer-odds';

  const heading = document.createElement('b');
  heading.className = 'explainer-odds-title';
  heading.textContent = title;

  const rows = document.createElement('div');
  rows.className = 'explainer-odds-rows';

  for (const row of oddsRowsView(matchups)) {
    const line = document.createElement('div');
    line.className = 'explainer-odds-row';

    const label = document.createElement('span');
    label.className = 'explainer-odds-label';
    label.textContent = row.label;

    const track = document.createElement('span');
    track.className = 'explainer-odds-track';
    const fill = document.createElement('span');
    fill.className = 'explainer-odds-fill';
    fill.style.width = `${row.chance * 100}%`;
    track.append(fill);

    if (marker !== null) {
      const line50 = document.createElement('span');
      line50.className = 'explainer-odds-marker';
      line50.style.left = `${marker}%`;
      track.append(line50);
    }

    const value = document.createElement('span');
    value.className = 'explainer-odds-value';
    value.textContent = `${row.percent}%`;

    line.append(label, track, value);
    rows.append(line);
  }

  const label = document.createElement('figcaption');
  label.textContent = caption;
  figure.append(heading, rows, label);
  return figure;
}

/**
 * The payout that did not fit, in the two places the game shows it: the tray
 * of chips a turn pays out, and the +n left on the tile afterwards. Both are
 * the real components — `dieChip` and `createPlayerTile` — so the badge here
 * is the badge in the corner of the screen.
 */
function buildBanked({ territories, reserve, landed, earned }) {
  const color = DEFAULT_PLAYER_COLORS[0];
  const figure = document.createElement('figure');
  figure.className = 'explainer-banked';

  const tray = document.createElement('div');
  tray.className = 'explainer-tray';
  for (let i = 0; i < earned; i++) {
    const chip = dieChip({ value: null }, color, readableTextColor(color));
    if (i >= landed) chip.classList.add('is-banked');
    tray.append(chip);
  }

  const tile = createPlayerTile({ name: 'Red', color, isYou: true });
  paintPlayerTile(tile, playerPanelView({
    id: 'p1',
    territories,
    reserve,
    isCurrent: true,
    isYou: true,
    alive: true,
    isWinner: false,
  }));

  const holder = document.createElement('div');
  holder.className = 'explainer-tile-holder';
  holder.append(tile.element);

  const label = document.createElement('figcaption');
  label.textContent = `${earned} dice earned, ${landed} with somewhere to land. `
    + `The other ${reserve} wait on the tile.`;

  const row = document.createElement('div');
  row.className = 'explainer-banked-row';
  row.append(tray, holder);
  figure.append(row, label);
  return figure;
}

const BUILDERS = {
  captures: buildCaptures,
  dice: buildDice,
  odds: buildOdds,
  banked: buildBanked,
};

/**
 * The explainer as an overlay over everything else.
 *
 * A panel in the same page rather than a page of its own, for two reasons that
 * point the same way: the deployed site is one page (`assert-deployable`), and
 * a player reading this in the middle of a match should come back to the match
 * rather than to a fresh one. It opens from the menu, over the menu, and the
 * planet keeps turning behind both.
 */
export function createExplainer(
  root,
  // `captureBase` is where the pictures live, and it is an argument only so
  // the preview can point it at nothing and show what a clone without them
  // looks like. That state is the one worth being able to see: the pictures
  // are committed files, and the document has to hold up before they arrive.
  { onClose, sections = EXPLAINER_SECTIONS, captureBase = '/explainer' } = {}
) {
  root.innerHTML = `
    <div class="explainer-panel" role="dialog" aria-modal="true" aria-label="How the game works">
      <div class="explainer-head">
        <button class="explainer-back" type="button">← Back</button>
        <h1 class="explainer-title">How the game works</h1>
      </div>
      <div class="explainer-body"></div>
    </div>
  `;

  const body = root.querySelector('.explainer-body');
  const backButton = root.querySelector('.explainer-back');
  const panel = root.querySelector('.explainer-panel');

  for (const section of sections) {
    const element = document.createElement('section');
    element.className = 'explainer-section';
    element.id = `explainer-${section.id}`;

    const title = document.createElement('h2');
    title.textContent = section.title;
    element.append(title);

    // Paragraphs before the figures: the picture is the evidence for the
    // claim, and a reader who has not been told what to look at is being asked
    // to guess.
    for (const paragraph of section.body) {
      const p = document.createElement('p');
      p.textContent = paragraph;
      element.append(p);
    }

    for (const figure of section.figures) {
      element.append(BUILDERS[figure.kind](figure, { captureBase }));
    }
    body.append(element);
  }

  backButton.addEventListener('click', () => onClose?.());
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') onClose?.();
  });

  // Whatever was focused when this opened — the menu row that opened it —
  // so closing hands the keyboard back where it came from rather than to the
  // top of a menu the player was already partway down.
  let opener = null;

  return {
    show() {
      opener = document.activeElement;
      root.hidden = false;
      // Always from the top: this is a document rather than a place, so
      // reopening it is starting to read rather than coming back to where you
      // were. The panel is what scrolls, not the overlay.
      panel.scrollTop = 0;
      backButton.focus({ preventScroll: true });
    },

    hide() {
      root.hidden = true;
      opener?.focus?.({ preventScroll: true });
      opener = null;
    },

    isOpen: () => !root.hidden,
  };
}
