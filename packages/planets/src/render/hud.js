import { readableTextColor } from './palette.js';
import { createBattleReadout } from './battleReadout.js';
import { MAX_RESERVE } from '../game/playerStats.js';

// The DOM layer over the canvas: the player stats row, whose turn it is, the
// end-turn button, the battle readout, and the game-over banner. Kept in HTML rather than drawn into the scene because text in WebGL
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

/**
 * What the turn indicator should say. Pure, because the awkward cases are all
 * here: a game that has ended never moves its turn index off the winner, so
 * asking "whose turn is it" after the fact gives a live-looking answer to a
 * dead question — and a player knocked out mid-game is neither taking a turn
 * nor watching a finished one.
 */
export function turnIndicatorView(status, nameOf = (id) => id) {
  const { currentPlayerId, humanPlayerId, winner = null, isOver = false } = status;
  const { humanEliminated = false, canAct = false } = status;

  if (isOver) {
    if (!winner) return { text: 'Nobody wins', playerId: currentPlayerId, endTurn: 'hidden' };
    return {
      text: winner === humanPlayerId ? 'You win' : `${nameOf(winner)} wins`,
      playerId: winner,
      endTurn: 'hidden',
    };
  }

  if (humanEliminated) {
    return { text: 'You are out — watching', playerId: currentPlayerId, endTurn: 'hidden' };
  }

  if (currentPlayerId === humanPlayerId) {
    return { text: 'Your turn', playerId: currentPlayerId, endTurn: canAct ? 'ready' : 'waiting' };
  }
  return { text: `${nameOf(currentPlayerId)} is playing`, playerId: currentPlayerId, endTurn: 'hidden' };
}

/**
 * The banner that interrupts play, and what it offers to do next.
 *
 * Winning is the point of the whole game, so it gets the screen to itself
 * until the player decides to move on — the menu no longer barges in over it.
 * Being knocked out is the other moment worth stopping for: without this the
 * game simply carries on without you and never says why.
 */
export function outcomeView(outcome, nameOf = (id) => id) {
  const { kind, winner = null, humanPlayerId, by = null } = outcome;

  if (kind === 'eliminated') {
    return {
      kind,
      playerId: by,
      title: 'You are out',
      detail: by ? `${nameOf(by)} took your last territory.` : 'Your last territory is gone.',
      actions: [
        { id: 'watch', label: 'Spectate', primary: true },
        { id: 'newGame', label: 'New game', primary: false },
      ],
    };
  }

  const won = winner !== null && winner === humanPlayerId;
  return {
    kind: winner === null ? 'draw' : won ? 'won' : 'lost',
    playerId: winner,
    title: winner === null ? 'Nobody wins' : won ? 'You win' : `${nameOf(winner)} wins`,
    detail: won
      ? 'The whole planet is yours.'
      : winner === null
        ? 'The planet is empty.'
        : `${nameOf(winner)} holds every territory.`,
    actions: [
      { id: 'newGame', label: 'New game', primary: true },
      { id: 'dismiss', label: 'Look at the board', primary: false },
    ],
  };
}

export function createHud(root, { playerColors, playerNames = new Map() } = {}) {
  root.innerHTML = `
    <div class="hud-top">
      <div class="hud-players" role="list" aria-label="Players"></div>
      <div class="hud-battle"></div>
    </div>
    <div class="hud-controls">
      <span class="hud-turn"><i class="hud-dot"></i><span class="hud-turn-text"></span></span>
      <span class="hud-buttons">
        <button class="hud-menu" type="button">Menu</button>
        <button class="hud-end-turn" type="button">End turn</button>
      </span>
    </div>
    <div class="hud-banner" hidden>
      <div class="hud-banner-card">
        <p class="hud-banner-title"></p>
        <p class="hud-banner-detail"></p>
        <div class="hud-banner-actions"></div>
      </div>
    </div>
  `;

  const playersRow = root.querySelector('.hud-players');
  const battle = createBattleReadout(root.querySelector('.hud-battle'), {
    playerColors,
    playerNames,
  });
  const dot = root.querySelector('.hud-dot');
  const turnText = root.querySelector('.hud-turn-text');
  const endTurnButton = root.querySelector('.hud-end-turn');
  const menuButton = root.querySelector('.hud-menu');
  const banner = root.querySelector('.hud-banner');
  const bannerTitle = banner.querySelector('.hud-banner-title');
  const bannerDetail = banner.querySelector('.hud-banner-detail');
  const bannerActions = banner.querySelector('.hud-banner-actions');
  let onAction = null;

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
    /** The last fight's dice. `revealed: false` while they are still in the air. */
    showBattle(entry, options) {
      battle.show(entry, options);
    },

    setHistory(entries) {
      battle.setHistory(entries);
    },

    closeHistory() {
      battle.close();
    },

    onEndTurn(handler) {
      endTurnButton.addEventListener('click', handler);
    },

    onMenu(handler) {
      menuButton.addEventListener('click', handler);
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

    showTurn(status) {
      const view = turnIndicatorView(status, nameOf);
      dot.style.background = rgb(playerColors.get(view.playerId) ?? [1, 1, 1]);
      turnText.textContent = view.text;
      endTurnButton.disabled = view.endTurn !== 'ready';
      endTurnButton.style.visibility = view.endTurn === 'hidden' ? 'hidden' : 'visible';
    },

    /** Puts up the banner for a game ending, or for being knocked out of one. */
    showOutcome(outcome) {
      const view = outcomeView(outcome, nameOf);
      banner.className = `hud-banner is-${view.kind}`;
      bannerTitle.textContent = view.title;
      bannerTitle.style.color = rgb(playerColors.get(view.playerId) ?? [1, 1, 1]);
      bannerDetail.textContent = view.detail;

      bannerActions.replaceChildren();
      for (const action of view.actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = action.primary ? 'hud-banner-action is-primary' : 'hud-banner-action';
        button.textContent = action.label;
        button.addEventListener('click', () => onAction?.(action.id));
        bannerActions.append(button);
      }

      banner.hidden = false;
      bannerActions.querySelector('button')?.focus({ preventScroll: true });
    },

    hideOutcome() {
      banner.hidden = true;
    },

    onOutcomeAction(handler) {
      onAction = handler;
    },
  };
}
