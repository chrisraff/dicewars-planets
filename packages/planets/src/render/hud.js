import { readableTextColor } from './palette.js';
import { MAX_RESERVE } from '../game/playerStats.js';

// The DOM layer over the canvas: the player stats row, whose turn it is, the
// end-turn button, the roll totals that float over a fight, and the game-over
// banner. Kept in HTML rather than drawn into the scene because text in WebGL
// is a lot of work for no gain when it's always facing the camera anyway.

const rgb = ([r, g, b]) => `rgb(${[r, g, b].map((c) => Math.round(c * 255)).join(', ')})`;
const rgba = ([r, g, b], alpha) =>
  `rgba(${[r, g, b].map((c) => Math.round(c * 255)).join(', ')}, ${alpha})`;

// Breathing room left beside a panel that gets scrolled into view, so it
// doesn't end up flush against the edge of the row looking half cut off.
const REVEAL_MARGIN = 12; // px

/**
 * Where a horizontally scrolling row needs to be scrolled to for one item to
 * be fully visible — or its current position, unchanged, if the item already
 * is. Only ever moves by the minimum needed, so a row someone has scrolled by
 * hand isn't yanked back to the start every turn.
 *
 * All distances are in the row's own scroll coordinates.
 */
export function scrollLeftToReveal({
  scrollLeft,
  viewportWidth,
  contentWidth,
  itemStart,
  itemWidth,
  margin = 0,
}) {
  const furthest = Math.max(0, contentWidth - viewportWidth);
  const clamp = (value) => Math.min(furthest, Math.max(0, value));

  // an item too wide to fit is shown from its start rather than centered on
  // nothing, which at least puts the number you're looking for on screen
  if (itemWidth + margin * 2 >= viewportWidth) return clamp(itemStart - margin);

  if (itemStart - margin < scrollLeft) return clamp(itemStart - margin);

  const itemEnd = itemStart + itemWidth + margin;
  if (itemEnd > scrollLeft + viewportWidth) return clamp(itemEnd - viewportWidth);

  return scrollLeft;
}

/**
 * What one player's panel should be showing, as plain data. The DOM below just
 * applies this — keeping the decisions (what counts as "out", when the banked
 * dice are worth drawing attention to) out here where they can be read and
 * tested without a browser.
 *
 * `key` collapses the whole view into one comparable string, so the render
 * loop can skip a panel that hasn't changed rather than writing to the DOM
 * sixty times a second while dice are rolling.
 */
export function playerPanelView(player) {
  const classes = {
    'is-current': player.isCurrent,
    'is-out': !player.alive,
    'is-winner': Boolean(player.isWinner),
  };
  const reserveClasses = {
    'is-empty': player.reserve === 0, // hidden entirely: a bare "+0" is only noise

    'is-full': player.reserve >= MAX_RESERVE,
  };
  const flags = [...Object.values(classes), ...Object.values(reserveClasses)]
    .map((on) => (on ? 1 : 0))
    .join('');

  return {
    territories: String(player.territories),
    reserve: `+${player.reserve}`,
    reserveTitle: `${player.reserve} dice banked, waiting for room`,
    classes,
    reserveClasses,
    key: `${player.territories}/${player.reserve}/${flags}`,
  };
}

export function createHud(root, { playerColors, playerNames = new Map() } = {}) {
  root.innerHTML = `
    <div class="hud-players" role="list" aria-label="Players"></div>
    <div class="hud-controls">
      <span class="hud-turn"><i class="hud-dot"></i><span class="hud-turn-text"></span></span>
      <button class="hud-end-turn" type="button">End turn</button>
    </div>
    <div class="hud-roll hud-roll-attacker"></div>
    <div class="hud-roll hud-roll-defender"></div>
    <div class="hud-banner"></div>
  `;

  const playersRow = root.querySelector('.hud-players');
  const dot = root.querySelector('.hud-dot');
  const turnText = root.querySelector('.hud-turn-text');
  const endTurnButton = root.querySelector('.hud-end-turn');
  const banner = root.querySelector('.hud-banner');
  const rolls = {
    attacker: root.querySelector('.hud-roll-attacker'),
    defender: root.querySelector('.hud-roll-defender'),
  };

  const nameOf = (playerId) => playerNames.get(playerId) ?? playerId;
  const panels = new Map();

  const prefersReducedMotion = () =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  // Brings a panel into view in the stats row. Measured off bounding rects
  // rather than offsetLeft, which is relative to whichever ancestor happens to
  // be positioned and would quietly measure from the wrong element.
  function revealPanel(element) {
    const row = playersRow.getBoundingClientRect();
    const item = element.getBoundingClientRect();

    const left = scrollLeftToReveal({
      scrollLeft: playersRow.scrollLeft,
      viewportWidth: playersRow.clientWidth,
      contentWidth: playersRow.scrollWidth,
      itemStart: item.left - row.left + playersRow.scrollLeft,
      itemWidth: item.width,
      margin: REVEAL_MARGIN,
    });

    if (left === playersRow.scrollLeft) return;
    playersRow.scrollTo({ left, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  // One panel per player, built once. Only the numbers and the state classes
  // change after that, so a stats update never rebuilds the row — which would
  // interrupt a scroll in progress on a narrow screen.
  function panelFor(playerId) {
    let panel = panels.get(playerId);
    if (panel) return panel;

    const color = playerColors.get(playerId) ?? [0.5, 0.5, 0.5];
    const ink = readableTextColor(color);

    const element = document.createElement('div');
    element.className = 'hud-player';
    element.setAttribute('role', 'listitem');
    element.style.setProperty('--player-color', rgb(color));
    element.style.setProperty('--player-ink', rgb(ink));
    element.style.setProperty('--player-ink-dim', rgba(ink, 0.62));
    element.innerHTML = `
      <span class="hud-player-name"></span>
      <span class="hud-player-territories"></span>
      <span class="hud-player-reserve"></span>
    `;
    element.querySelector('.hud-player-name').textContent = nameOf(playerId);

    panel = {
      element,
      territories: element.querySelector('.hud-player-territories'),
      reserve: element.querySelector('.hud-player-reserve'),
      shown: null,
      wasCurrent: false,
    };
    panels.set(playerId, panel);
    playersRow.append(element);
    return panel;
  }

  return {
    onEndTurn(handler) {
      endTurnButton.addEventListener('click', handler);
    },

    /**
     * Repaints the stats row from `playerStatsFor(...)`. Called every frame
     * while dice are rolling, so each panel only touches the DOM for the
     * values that actually moved.
     */
    showPlayers(stats) {
      for (const player of stats) {
        const panel = panelFor(player.id);
        const view = playerPanelView(player);

        // only on the turn passing to them — not every time their numbers move,
        // which would drag the row back mid-scroll while someone is reading it
        if (player.isCurrent && !panel.wasCurrent) revealPanel(panel.element);
        panel.wasCurrent = player.isCurrent;

        if (panel.shown === view.key) continue;
        panel.shown = view.key;

        panel.territories.textContent = view.territories;
        panel.reserve.textContent = view.reserve;
        panel.reserve.title = view.reserveTitle;
        for (const [name, on] of Object.entries(view.classes)) {
          panel.element.classList.toggle(name, on);
        }
        for (const [name, on] of Object.entries(view.reserveClasses)) {
          panel.reserve.classList.toggle(name, on);
        }
      }
    },

    showTurn({ playerId, isHuman, canAct }) {
      dot.style.background = rgb(playerColors.get(playerId) ?? [1, 1, 1]);
      turnText.textContent = isHuman ? 'Your turn' : `${nameOf(playerId)} is playing`;
      endTurnButton.disabled = !canAct;
      endTurnButton.style.visibility = isHuman ? 'visible' : 'hidden';
    },

    // `side` is 'attacker' or 'defender'; `screen` is a pixel position on the
    // canvas, or null to hide the label.
    showRoll(side, { total, screen, winning } = {}) {
      const element = rolls[side];
      if (!screen || total === undefined) {
        element.style.display = 'none';
        return;
      }
      element.style.display = 'block';
      element.style.left = `${screen.x}px`;
      element.style.top = `${screen.y}px`;
      element.textContent = String(total);
      element.classList.toggle('is-winning', Boolean(winning));
    },

    hideRolls() {
      this.showRoll('attacker');
      this.showRoll('defender');
    },

    showWinner(playerId) {
      banner.textContent = playerId ? `${nameOf(playerId)} wins` : 'Nobody wins';
      banner.style.color = rgb(playerColors.get(playerId) ?? [1, 1, 1]);
      banner.classList.add('is-shown');
    },
  };
}
