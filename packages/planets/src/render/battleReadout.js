import { readableTextColor } from './palette.js';
import { pipPositions } from './pips.js';
import { stackSlots, MAX_DICE_PER_STACK } from './diceStacks.js';

const rgb = ([r, g, b]) => `rgb(${[r, g, b].map((c) => Math.round(c * 255)).join(', ')})`;

/**
 * One side of a battle, as display data: a die face per die rolled, in that
 * player's color, followed by their total.
 *
 * While the dice are still in the air the values are withheld (`value: null`)
 * — the readout has the numbers from the moment the attack is declared, and
 * printing them there would spoil the roll happening on the planet.
 */
export function battleSideView(side, { revealed = true, winner = false } = {}) {
  return {
    playerId: side.playerId,
    dice: side.rolls.map((value) => ({ value: revealed ? value : null })),
    total: revealed ? side.total : null,
    winner: revealed && winner,
  };
}

export function battleView(entry, { revealed = true } = {}) {
  if (!entry || entry.kind !== 'battle') return null;
  return {
    id: entry.id,
    attacker: battleSideView(entry.attacker, { revealed, winner: entry.attackerWins }),
    defender: battleSideView(entry.defender, { revealed, winner: !entry.attackerWins }),
  };
}

/**
 * A history row. Battles render as the same two-sided readout; eliminations
 * render as a line of text, since there were no dice involved in them —
 * they're the consequence of the battle logged just above.
 */
export function historyRowView(entry, nameOf = (id) => id) {
  if (entry.kind === 'elimination') {
    return {
      id: entry.id,
      kind: 'elimination',
      playerId: entry.playerId,
      text: `${nameOf(entry.playerId)} knocked out by ${nameOf(entry.by)}`,
    };
  }
  return { id: entry.id, kind: 'battle', battle: battleView(entry) };
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const PIP_RADIUS = 10; // per 100 units of face, a touch larger than the 3D die's

// A die face drawn as pips, laid out from the same table the dice on the
// planet use. Scales with the chip because it is a viewBox rather than fixed
// coordinates, so one rule controls the size on phone and desktop alike.
function pipFace(value) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', 'battle-die-face');
  svg.setAttribute('aria-hidden', 'true');

  for (const [x, y] of pipPositions(value)) {
    const pip = document.createElementNS(SVG_NS, 'circle');
    pip.setAttribute('cx', String(x * 100));
    pip.setAttribute('cy', String(y * 100));
    pip.setAttribute('r', String(PIP_RADIUS));
    svg.append(pip);
  }
  return svg;
}

/**
 * Which edges of a scrolling strip have more content beyond them — the right
 * while dice are still waiting off-screen, the left once some have been
 * scrolled past, both at once in the middle, and neither when it all fits.
 *
 * The one-pixel tolerance is not fussiness: scrollLeft is fractional on a
 * zoomed or high-DPI display, so a strip scrolled fully to the end lands a
 * hair short of scrollWidth - clientWidth and would keep claiming there was
 * more to the right forever.
 */
export function scrollFades({ scrollLeft, scrollWidth, clientWidth }) {
  const furthest = scrollWidth - clientWidth;
  if (furthest <= 1) return { left: false, right: false };
  return {
    left: scrollLeft > 1,
    right: scrollLeft < furthest - 1,
  };
}

function dieChip({ value }, color, ink) {
  const chip = document.createElement('span');
  chip.className = value === null ? 'battle-die is-rolling' : 'battle-die';
  chip.style.setProperty('--die-color', rgb(color));
  chip.style.setProperty('--die-ink', rgb(ink));

  if (value !== null) {
    // the pips carry the value visually; the label carries it for a screen
    // reader, which cannot count circles
    chip.setAttribute('role', 'img');
    chip.setAttribute('aria-label', String(value));
    chip.append(pipFace(value));
  }
  return chip;
}

/**
 * The battle readout: the last fight's dice under the player stats, and — when
 * tapped — a scrollable history of every fight and knockout before it.
 */
export function createBattleReadout(root, { playerColors, playerNames = new Map() } = {}) {
  const nameOf = (playerId) => playerNames.get(playerId) ?? playerId;
  const colorOf = (playerId) => playerColors.get(playerId) ?? [0.5, 0.5, 0.5];

  root.innerHTML = `
    <button class="battle-current" type="button" aria-expanded="false"
            aria-label="Last battle — open history"></button>
    <div class="battle-history" hidden>
      <div class="battle-history-head">
        <span>Battle history</span>
        <button class="battle-history-close" type="button" aria-label="Close history">×</button>
      </div>
      <ol class="battle-history-list"></ol>
    </div>
  `;

  const current = root.querySelector('.battle-current');
  const history = root.querySelector('.battle-history');
  const historyList = root.querySelector('.battle-history-list');
  const closeButton = root.querySelector('.battle-history-close');

  // A miniature of the stack that was thrown: one little square per die, in
  // the same two-wide, four-high arrangement the dice use on the planet, so a
  // glance gives the count without having to read the dice themselves.
  function stackMark(side) {
    const mark = document.createElement('span');
    mark.className = 'battle-count';
    mark.style.setProperty('--die-color', rgb(colorOf(side.playerId)));
    mark.setAttribute('aria-hidden', 'true');

    for (const { column, level } of stackSlots(side.dice.length)) {
      const pip = document.createElement('i');
      pip.style.gridColumn = String(column + 1);
      pip.style.gridRow = String(MAX_DICE_PER_STACK - level); // stacks grow upwards
      mark.append(pip);
    }
    return mark;
  }

  // One side's total, as a square in that player's color.
  function outcomeSquare(side, extraClass = '') {
    const box = document.createElement('span');
    box.className = `battle-outcome ${extraClass}`.trim();
    if (side.winner) box.classList.add('is-winner');
    if (side.total === null) box.classList.add('is-rolling');

    const color = colorOf(side.playerId);
    box.style.setProperty('--die-color', rgb(color));
    box.style.setProperty('--die-ink', rgb(readableTextColor(color)));
    box.textContent = side.total === null ? '' : String(side.total);
    return box;
  }

  function arrow(extraClass = '') {
    const mark = document.createElement('span');
    mark.className = `battle-arrow ${extraClass}`.trim();
    mark.textContent = '→';
    return mark;
  }

  function diceGroup(side) {
    const color = colorOf(side.playerId);
    const ink = readableTextColor(color);
    const group = document.createElement('span');
    group.className = 'battle-side';
    for (const die of side.dice) group.append(dieChip(die, color, ink));
    return group;
  }

  /**
   * Builds both readings of a battle into `into`, and lets CSS pick one:
   *
   *   full     every die alongside its own total — what you want whenever
   *            there is room, because it is all legible at once
   *   compact  a stack mark and total per side pinned to the left, with the
   *            dice behind them in a strip that scrolls on its own
   *
   * Both are built because switching between them then costs a class rather
   * than a rebuild, which is what makes re-measuring on every resize cheap.
   * `chooseLayout` below is what actually decides.
   */
  function renderBattle(into, view) {
    into.replaceChildren();

    const summary = document.createElement('span');
    summary.className = 'battle-summary';
    summary.append(
      stackMark(view.attacker),
      outcomeSquare(view.attacker),
      arrow(),
      stackMark(view.defender),
      outcomeSquare(view.defender)
    );

    const strip = document.createElement('span');
    strip.className = 'battle-dice';
    strip.append(
      diceGroup(view.attacker),
      outcomeSquare(view.attacker, 'is-inline'),
      arrow('is-inline'),
      diceGroup(view.defender),
      outcomeSquare(view.defender, 'is-inline')
    );

    into.append(summary, strip);
    into.classList.remove('is-compact');
  }

  /**
   * Picks full or compact for one row by asking whether the full reading
   * actually fits: the row is measured with the compact class off, and only
   * put back on if the contents overrun the space available.
   *
   * Reads and writes are kept in separate passes by the callers below, so
   * laying out a hundred history rows costs one reflow rather than a hundred.
   */
  function chooseLayout(rows) {
    const list = [...rows].filter(Boolean);

    for (const row of list) row.classList.remove('is-compact');
    const overrun = list.map((row) => row.scrollWidth > row.clientWidth + 1);
    list.forEach((row, i) => row.classList.toggle('is-compact', overrun[i]));

    showFades(list.map((row) => row.querySelector('.battle-dice')));
  }

  // Fades a strip out over whichever edges it can still be scrolled towards,
  // so "there are more dice this way" is visible without a scrollbar. Measured
  // for every strip first and written afterwards, so a whole history costs one
  // reflow rather than one per row.
  function showFades(strips) {
    const present = strips.filter(Boolean);
    const states = present.map(scrollFades); // all reads
    present.forEach((strip, i) => {
      strip.classList.toggle('is-faded-left', states[i].left);
      strip.classList.toggle('is-faded-right', states[i].right);
    });
  }

  let openState = false;

  const battleRows = () => historyList.querySelectorAll('.battle-row.is-battle');

  // `scroll` does not bubble, but it can be caught on the way down — so one
  // listener here keeps every dice strip's fades current, however many rows
  // the history is holding.
  root.addEventListener(
    'scroll',
    (event) => {
      if (event.target?.classList?.contains('battle-dice')) showFades([event.target]);
    },
    true
  );

  function setOpen(open) {
    openState = open;
    history.hidden = !open;
    current.setAttribute('aria-expanded', String(open));
    if (open) {
      historyList.scrollTop = 0; // the list is newest-first
      chooseLayout(battleRows()); // rows cannot be measured while hidden
    }
  }

  // Re-measure when the space available changes — a rotated phone, a resized
  // window. Both observers watch a container whose width comes from outside
  // rather than from the row's own contents: watching a content-sized element
  // would see the layout it just chose and flip back and forth forever.
  if (typeof ResizeObserver === 'function') {
    let queued = false;
    const remeasure = (rows) => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        chooseLayout(rows());
      });
    };

    new ResizeObserver(() => remeasure(() => [current])).observe(root);
    new ResizeObserver(() => {
      if (openState) remeasure(battleRows);
    }).observe(historyList);
  }

  // The dice strip inside the readout scrolls, and the readout is a button:
  // a drag to scroll must not also count as a tap that opens the history.
  const DRAG_SLOP = 8; // px
  let pressedAt = null;
  let dragged = false;

  current.addEventListener('pointerdown', (e) => {
    pressedAt = { x: e.clientX, y: e.clientY };
    dragged = false;
  });
  current.addEventListener('pointerup', (e) => {
    dragged = pressedAt !== null
      && Math.hypot(e.clientX - pressedAt.x, e.clientY - pressedAt.y) > DRAG_SLOP;
    pressedAt = null;
  });
  // still `click`, not `pointerup`, so Enter and Space keep working
  current.addEventListener('click', () => {
    if (dragged) {
      dragged = false;
      return;
    }
    setOpen(!openState);
  });
  closeButton.addEventListener('click', () => setOpen(false));

  return {
    /** Shows one battle in the readout. `revealed: false` while dice are rolling. */
    show(entry, { revealed = true } = {}) {
      const view = battleView(entry, { revealed });
      if (!view) {
        current.replaceChildren();
        current.classList.add('is-empty');
        return;
      }
      current.classList.remove('is-empty');
      renderBattle(current, view);
      chooseLayout([current]);
    },

    /** Rebuilds the history list. Only happens when the log changes, not per frame. */
    setHistory(entries) {
      historyList.replaceChildren();
      for (const entry of [...entries].reverse()) {
        const row = historyRowView(entry, nameOf);
        const item = document.createElement('li');
        item.className = `battle-row is-${row.kind}`;

        if (row.kind === 'elimination') {
          const dot = document.createElement('i');
          dot.className = 'battle-row-dot';
          dot.style.background = rgb(colorOf(row.playerId));
          item.append(dot);
          const text = document.createElement('span');
          text.textContent = row.text;
          item.append(text);
        } else {
          renderBattle(item, row.battle);
        }
        historyList.append(item);
      }
      if (openState) chooseLayout(battleRows());
      if (entries.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'battle-row is-empty';
        empty.textContent = 'No battles yet';
        historyList.append(empty);
      }
    },

    isOpen: () => openState,
    open: () => setOpen(true),
    close: () => setOpen(false),
  };
}
