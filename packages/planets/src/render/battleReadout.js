import { readableTextColor } from './palette.js';
import { pipPositions } from './pips.js';
import { stackSlots, MAX_DICE_PER_STACK } from './diceStacks.js';

const rgb = ([r, g, b]) => `rgb(${[r, g, b].map((c) => Math.round(c * 255)).join(', ')})`;

/**
 * Dice on one side, above which the full reading stops being worth showing.
 *
 * Not a width — five dice a side still fits a desktop readout comfortably.
 * Past about four the faces stop being something you take in at a glance and
 * become a row to count, which is the moment the stack mark and the total say
 * more than the faces do. Width is the *other* half of the decision and is
 * checked separately, in `fitReadout` below.
 */
export const FULL_READING_MAX_DICE = 4;

/** Whether a battle is small enough that showing every die is worth doing. */
export function fitsFullReading(view, max = FULL_READING_MAX_DICE) {
  return view.attacker.dice.length <= max && view.defender.dice.length <= max;
}

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
 * and passes render as a line of text, since neither one has dice involved —
 * an elimination is the consequence of the battle logged just above, and a
 * pass never had a battle to begin with.
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
  if (entry.kind === 'passed') {
    return {
      id: entry.id,
      kind: 'passed',
      playerId: entry.playerId,
      text: `${nameOf(entry.playerId)} passed`,
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

// Exported for the reinforcement tray in the HUD, which shows the same flat
// die chip for dice that have not been rolled at all — just earned.
export function dieChip({ value }, color, ink) {
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
            aria-label="Last battle — open history">
      <span class="battle-current-content"></span>
      <span class="battle-chevron" aria-hidden="true">
        <svg viewBox="0 0 16 16">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6"
                stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    </button>
    <div class="battle-history" hidden>
      <div class="battle-history-head">
        <span>Battle history</span>
        <button class="battle-history-close" type="button" aria-label="Close history">×</button>
      </div>
      <ol class="battle-history-list"></ol>
    </div>
  `;

  const current = root.querySelector('.battle-current');
  const currentContent = root.querySelector('.battle-current-content');
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
   * Which one shows is `is-compact` on the row, and belongs to whoever owns
   * that row — `fitReadout` for the readout, `setHistory` for a history row,
   * which is always compact and has nothing to decide.
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
  }

  /**
   * Which of the two readings the readout at the top shows.
   *
   * Two separate things force compact and either one is enough, because they
   * answer different questions. The battle: past `FULL_READING_MAX_DICE` a
   * side the faces are a row to count rather than a glance. The room: a full
   * reading that would be clipped is worse than a compact one that fits,
   * whatever the dice count says — the readout has `overflow: hidden`, so
   * overrunning it does not scroll, it truncates.
   *
   * Width is what actually prevails: the dice rule is only ever consulted for
   * a battle that would fit anyway. It is checked first purely because it is
   * free, and skipping the measurement skips a forced reflow.
   */
  function fitReadout() {
    if (!shownBattle) return;

    const compact = !fitsFullReading(shownBattle) || overrunsFull();
    current.classList.toggle('is-compact', compact);
    showFades([current.querySelector('.battle-dice')]);
  }

  // Whether the full reading would be clipped by the room the readout has.
  // Only answerable with the full reading actually in place, which is why this
  // takes the class off to look — `fitReadout` above is what puts it back.
  function overrunsFull() {
    current.classList.remove('is-compact');
    return current.scrollWidth > current.clientWidth + 1;
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
  // The battle the readout is showing. Kept because a resize has to make the
  // choice in `fitReadout` again without a new battle arriving to prompt it.
  let shownBattle = null;

  const battleRows = () => historyList.querySelectorAll('.battle-row.is-battle');

  // Every history row's dice strip at once — reads first, writes after, so a
  // hundred rows cost one reflow rather than a hundred.
  const showHistoryFades = () =>
    showFades([...battleRows()].map((row) => row.querySelector('.battle-dice')));

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
      showHistoryFades(); // a hidden strip measures as zero, so this waits until now
    }
  }

  // Re-measure when the space available changes — a rotated phone, a resized
  // window. Both observers watch a container whose width comes from outside
  // rather than from the row's own contents: watching a content-sized element
  // would see the layout it just chose and flip back and forth forever.
  //
  // Only the readout can change its reading; the history's rows are compact
  // whatever the width, so all a resize costs there is their fades.
  if (typeof ResizeObserver === 'function') {
    const queued = new Set();
    const onNextFrame = (job) => {
      if (queued.has(job)) return;
      queued.add(job);
      requestAnimationFrame(() => {
        queued.delete(job);
        job();
      });
    };

    new ResizeObserver(() => onNextFrame(fitReadout)).observe(root);
    new ResizeObserver(() => {
      if (openState) onNextFrame(showHistoryFades);
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
      shownBattle = view;
      if (!view) {
        currentContent.replaceChildren();
        current.classList.add('is-empty');
        return;
      }
      current.classList.remove('is-empty');
      renderBattle(currentContent, view);
      fitReadout();
    },

    /** Rebuilds the history list. Only happens when the log changes, not per frame. */
    setHistory(entries) {
      historyList.replaceChildren();
      for (const entry of [...entries].reverse()) {
        const row = historyRowView(entry, nameOf);
        const item = document.createElement('li');
        item.className = `battle-row is-${row.kind}`;

        if (row.kind === 'elimination' || row.kind === 'passed') {
          const dot = document.createElement('i');
          dot.className = 'battle-row-dot';
          dot.style.background = rgb(colorOf(row.playerId));
          item.append(dot);
          const text = document.createElement('span');
          text.textContent = row.text;
          item.append(text);
        } else {
          renderBattle(item, row.battle);
          // Always the compact reading, whatever the row would have room for:
          // a history row is a summary you scan down, and thirty of them read
          // better as thirty identical shapes than as two layouts alternating
          // line to line. It also means a history row is never measured.
          item.classList.add('is-compact');
        }
        historyList.append(item);
      }
      if (openState) showHistoryFades();
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
