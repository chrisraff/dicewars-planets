import { readableTextColor } from './palette.js';
import { createBattleReadout, dieChip } from './battleReadout.js';
import { showScrollFades } from './scrollFades.js';
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
 * Whether the controls row carries a way back into the replay.
 *
 * The rule is that an offer once made is never withdrawn. The banner used to
 * be the only door: "Look at the board" closed it for good, and a replay that
 * had just been offered became unreachable without reloading the page. So the
 * moment a match has an ending to look back at — it is over, the player has
 * been knocked out of it, or they have been offered the win and waved it away
 * — the button appears beside the menu and stays.
 *
 * Those three are asked of the match rather than remembered as a flag, which
 * is what makes the button survive a reload: the board itself says who won and
 * who is out, and `playedOn` travels in the save. A latch set when the banner
 * went up would not — a played-on game reopens with no banner to set it.
 *
 * Mid-play, before any of that, there is nothing here. The match in progress
 * is the thing to look at, and a door out of it is not worth a permanent seat
 * on a row that has to stay readable on a phone.
 */
export function replayButtonView(status) {
  const { hasReplay = false, isOver = false, humanEliminated = false, playedOn = false } = status;
  if (!hasReplay) return 'hidden'; // a match nobody attacked in has nothing to show
  return isOver || humanEliminated || playedOn ? 'shown' : 'hidden';
}

/**
 * The prompt a first-time player gets on their turn, or `null` when there is
 * nothing worth saying.
 *
 * Dice Wars has exactly one move in it and no way to discover it: the planet
 * looks like something to rotate, so a player who has never seen the game
 * turns it over, finds nothing to press, and never learns that a territory is
 * the button. One sentence fixes that, and only ever needs saying once —
 * `seen` is answered by `hints.js` from storage, so the second game says
 * nothing.
 *
 * It is only ever advice about the turn you are taking, so every state where
 * there is no such turn — an opponent playing, a game already decided, a
 * player knocked out of one — is silence rather than an instruction you cannot
 * follow. `coarsePointer` is the one thing this cannot work out for itself:
 * telling somebody on a phone to click is the sort of small wrongness that
 * makes the rest of the sentence less believable.
 *
 * The sentence comes back in three pieces because one word of it — the color
 * the player is — has to be set in that color, and a first-timer needs it
 * more than anything else here: "one of your territories" is only actionable
 * once you know which of the eight colors on the planet is yours. `playerName`
 * is already a color name (`PLAYER_NAMES` is the palette in order), so naming
 * it and coloring it are the same word. Without one, the sentence closes over
 * the gap rather than being left with a hole in it.
 */
export function attackHintView(status) {
  const { seen = false, isHumanTurn = false, coarsePointer = false, playerName = null } = status;
  const { isOver = false, humanEliminated = false } = status;

  if (seen || isOver || humanEliminated || !isHumanTurn) return null;

  const press = coarsePointer ? 'Tap' : 'Click';
  const then = `, then ${press.toLowerCase()} a neighboring enemy to attack.`;

  if (!playerName) return { color: null, before: `${press} one of your territories`, after: then };
  return {
    color: playerName.toLowerCase(),
    before: `${press} one of your `,
    after: ` territories${then}`,
  };
}

/** The whole sentence as one string — for tests, and for anything reading it. */
export function attackHintText(view) {
  return `${view.before}${view.color ?? ''}${view.after}`;
}

/**
 * What a won-by-surrender banner says under the title. Kept up here as a
 * constant because it is the one line in the game that has to be honest about
 * an ending the board has not actually reached: the planet is *not* all yours
 * when this goes up — a quarter of it is typically still in play.
 */
export const SURRENDER_DETAIL = 'Your rivals have surrendered.';

/**
 * The banner that interrupts play, and what it offers to do next.
 *
 * Winning is the point of the whole game, so it gets the screen to itself
 * until the player decides to move on — the menu no longer barges in over it.
 * Being knocked out is the other moment worth stopping for: without this the
 * game simply carries on without you and never says why.
 */
export function outcomeView(outcome, nameOf = (id) => id) {
  const { kind, winner = null, humanPlayerId, by = null, canReplay = false } = outcome;

  if (kind === 'eliminated') {
    return {
      kind,
      playerId: by,
      title: 'You are out',
      detail: by ? `${nameOf(by)} took your last territory.` : 'Your last territory is gone.',
      // Gentlest first: stay and watch, look back at how it went, start again.
      // The replay belongs here as much as on a win — being knocked out is the
      // moment there is most to look back at, and the match you were in is
      // over whatever the board goes on doing without you.
      actions: [
        { id: 'watch', label: 'Spectate', primary: true },
        ...(canReplay ? [{ id: 'replay', label: 'Watch replay', primary: false }] : []),
        { id: 'newGame', label: 'New game', primary: false },
      ],
    };
  }

  // Won because everyone else gave up rather than because the board ran out.
  // It reads as a win — it is one — but the way out of the banner is "play
  // on" rather than "look at the board": the match is still there to be
  // finished, and dismissing this is the same act as carrying on with it.
  if (kind === 'surrendered') {
    return {
      kind: 'won',
      playerId: humanPlayerId,
      title: 'You win',
      detail: SURRENDER_DETAIL,
      actions: [
        { id: 'newGame', label: 'New game', primary: true },
        ...(canReplay ? [{ id: 'replay', label: 'Watch replay', primary: false }] : []),
        { id: 'playOn', label: 'Play on', primary: false },
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
      // only once there is a fight worth watching again — a match nobody ever
      // attacked in has nothing for a replay to show
      ...(canReplay ? [{ id: 'replay', label: 'Watch replay', primary: false }] : []),
      { id: 'dismiss', label: 'Look at the board', primary: false },
    ],
  };
}

/**
 * How long the replay holds each step while playing itself. Exported because
 * it is a budget as much as a pace: the dice thrown for a step have to have
 * landed before the next one arrives, which is what `REPLAY_TIMING` is sized
 * against.
 */
export const REPLAY_STEP_MS = 900;

export function createHud(root, { playerColors, playerNames = new Map() } = {}) {
  root.innerHTML = `
    <div class="hud-top">
      <div class="hud-players" role="list" aria-label="Players"></div>
      <div class="hud-battle"></div>
    </div>
    <div class="hud-controls">
      <div class="hud-hint" role="status" hidden>
        <p class="hud-hint-text"></p>
        <button class="hud-hint-close" type="button" aria-label="Dismiss">×</button>
      </div>
      <div class="hud-reinforce" hidden aria-hidden="true"></div>
      <div class="hud-controls-row">
        <span class="hud-turn"><i class="hud-dot"></i><span class="hud-turn-text"></span></span>
        <span class="hud-buttons">
          <button class="hud-replay-open" type="button" hidden>Replay</button>
          <button class="hud-menu" type="button">Menu</button>
          <button class="hud-end-turn" type="button">End turn</button>
        </span>
      </div>
    </div>
    <div class="hud-banner" hidden>
      <div class="hud-banner-card">
        <p class="hud-banner-title"></p>
        <p class="hud-banner-detail"></p>
        <div class="hud-banner-actions"></div>
      </div>
    </div>
    <div class="hud-replay" hidden>
      <div class="hud-replay-card">
        <div class="hud-replay-head">
          <span class="hud-replay-title">Replay</span>
          <button class="hud-replay-close" type="button" aria-label="Close replay">×</button>
        </div>
        <div class="hud-replay-transport">
          <button class="hud-replay-prev" type="button" aria-label="Previous attack">‹</button>
          <button class="hud-replay-play" type="button" aria-label="Play">▶</button>
          <button class="hud-replay-next" type="button" aria-label="Next attack">›</button>
          <input class="hud-replay-track" type="range" min="0" max="0" value="0" step="1"
                 aria-label="Replay position" />
        </div>
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
  const hint = root.querySelector('.hud-hint');
  const hintText = root.querySelector('.hud-hint-text');
  const hintClose = root.querySelector('.hud-hint-close');
  let hintShown = null; // so a repaint doesn't rebuild the sentence, or re-announce it
  const reinforceTray = root.querySelector('.hud-reinforce');
  let reinforceChips = []; // one per die, left to right — popped from the right
  const endTurnButton = root.querySelector('.hud-end-turn');
  const menuButton = root.querySelector('.hud-menu');
  const banner = root.querySelector('.hud-banner');
  const bannerTitle = banner.querySelector('.hud-banner-title');
  const bannerDetail = banner.querySelector('.hud-banner-detail');
  const bannerActions = banner.querySelector('.hud-banner-actions');
  let onAction = null;

  const replayOverlay = root.querySelector('.hud-replay');
  const replayTrack = root.querySelector('.hud-replay-track');
  const replayPlay = root.querySelector('.hud-replay-play');
  let replayTimer = null;
  let replaySeekHandler = null;
  let replayCloseHandler = null;

  const replayOpenButton = root.querySelector('.hud-replay-open');
  let replayOffered = false; // what the match last said; the overlay outranks it

  // Two questions decide whether the button is there and they are answered in
  // different places, so both go through here: whether the match has an ending
  // to look back at, and whether the replay is already open — while it is, the
  // × is the way back and a second door beside it is one too many, exactly as
  // for the menu button. It takes no room when it is not there, rather than
  // holding a gap open all match for something that mostly isn't offered.
  function applyReplayButton() {
    replayOpenButton.hidden = !replayOffered || !replayOverlay.hidden;
  }

  function stopReplaying() {
    if (!replayTimer) return;
    clearInterval(replayTimer);
    replayTimer = null;
    replayPlay.textContent = '▶';
    replayPlay.setAttribute('aria-label', 'Play');
  }

  // Moves the track to `step` (clamped) and tells the session to repaint the
  // board there — the one path every control (drag, the buttons, the timer)
  // goes through, so the track's value is never out of step with what is on
  // screen.
  function paintReplayStep(step) {
    const max = Number(replayTrack.max);
    const clamped = Math.max(0, Math.min(max, step));
    replayTrack.value = String(clamped);
    replaySeekHandler?.(clamped);
    return clamped;
  }

  function seekReplay(step) {
    stopReplaying();
    paintReplayStep(step);
  }

  function startReplaying() {
    if (Number(replayTrack.value) >= Number(replayTrack.max)) paintReplayStep(0);
    replayPlay.textContent = '⏸';
    replayPlay.setAttribute('aria-label', 'Pause');
    replayTimer = setInterval(() => {
      const next = paintReplayStep(Number(replayTrack.value) + 1);
      if (next >= Number(replayTrack.max)) stopReplaying();
    }, REPLAY_STEP_MS);
  }

  root.querySelector('.hud-replay-prev').addEventListener('click', () => {
    seekReplay(Number(replayTrack.value) - 1);
  });
  root.querySelector('.hud-replay-next').addEventListener('click', () => {
    seekReplay(Number(replayTrack.value) + 1);
  });
  replayTrack.addEventListener('input', () => seekReplay(Number(replayTrack.value)));
  replayPlay.addEventListener('click', () => (replayTimer ? stopReplaying() : startReplaying()));
  root.querySelector('.hud-replay-close').addEventListener('click', () => {
    stopReplaying();
    replayCloseHandler?.();
  });

  const nameOf = (playerId) => playerNames.get(playerId) ?? playerId;
  const panels = new Map();

  const prefersReducedMotion = () =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  /**
   * The stats row scrolls sideways at a full table and has no scrollbar to
   * say so, exactly like the dice strip in the readout below it — so it wears
   * the same fade over whichever edge it can still be scrolled towards.
   *
   * Coalesced to a frame because three things ask for it and one of them
   * arrives in a flood: a knocked-out tile folding down fires `transitionend`
   * per property per tile, and every one of them changes how much there is
   * left to scroll.
   */
  let fadesQueued = false;
  function refreshRowFades() {
    if (fadesQueued) return;
    fadesQueued = true;
    requestAnimationFrame(() => {
      fadesQueued = false;
      showScrollFades([playersRow]);
    });
  }

  playersRow.addEventListener('scroll', refreshRowFades);
  playersRow.addEventListener('transitionend', refreshRowFades);
  // the row's own box, which changes with the window rather than with what is
  // in it — the contents changing is covered by `showPlayers` below
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(refreshRowFades).observe(playersRow);
  }
  const coarsePointer = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;

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
    // The name and count are wrapped rather than sitting directly in the tile
    // so that the tile can close over them as one, leaving the dot — which is
    // outside the wrapper, and so survives the collapse — behind.
    element.innerHTML = `
      <span class="hud-player-dot" aria-hidden="true"></span>
      <span class="hud-player-body">
        <span class="hud-player-name"></span>
        <span class="hud-player-territories"></span>
      </span>
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
     * Whether the controls row offers a way back into the replay —
     * `replayButtonView` decides, from the same kind of status object
     * `showTurn` takes.
     */
    showReplayButton(status) {
      replayOffered = replayButtonView(status) === 'shown';
      applyReplayButton();
    },

    onReplayOpen(handler) {
      replayOpenButton.addEventListener('click', handler);
    },

    /**
     * Repaints the stats row from `playerStatsFor(...)`. Called every frame
     * while dice are rolling, so each panel only touches the DOM for the
     * values that actually moved.
     */
    showPlayers(stats) {
      // this runs every frame while dice are rolling, so the row is only
      // re-measured when a panel actually wrote something
      let changed = false;

      for (const player of stats) {
        const panel = panelFor(player.id);
        const view = playerPanelView(player);

        // only on the turn passing to them — not every time their numbers move,
        // which would drag the row back mid-scroll while someone is reading it
        if (player.isCurrent && !panel.wasCurrent) revealPanel(panel.element);
        panel.wasCurrent = player.isCurrent;

        if (panel.shown === view.key) continue;
        panel.shown = view.key;
        changed = true;

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

      if (changed) refreshRowFades();
    },

    showTurn(status) {
      const view = turnIndicatorView(status, nameOf);
      dot.style.background = rgb(playerColors.get(view.playerId) ?? [1, 1, 1]);
      turnText.textContent = view.text;
      endTurnButton.disabled = view.endTurn !== 'ready';
      endTurnButton.style.visibility = view.endTurn === 'hidden' ? 'hidden' : 'visible';
    },

    /**
     * The first-timer's prompt, or nothing — `attackHintView` decides, from
     * the same kind of status object `showTurn` takes. The pointer and the
     * player's name are filled in here because they are facts about the
     * browser and about this HUD rather than about the game, and both are left
     * overridable so a preview can show every wording and every color without
     * a device or a match for each.
     *
     * The color name is a chip rather than tinted text: a player color *as
     * ink* on this panel lands around 4:1, which is under AA for a sentence
     * this size, while the same color as a background under
     * `readableTextColor` is the pairing the stats row already proves legible
     * across the whole palette.
     */
    showHint(status) {
      const view = attackHintView({
        coarsePointer: coarsePointer(),
        playerName: playerNames.get(status.humanPlayerId) ?? null,
        ...status,
      });

      const key = view ? `${status.humanPlayerId}/${attackHintText(view)}` : null;
      if (key === hintShown) return;
      hintShown = key;

      hint.hidden = view === null;
      if (!view) {
        hintText.replaceChildren();
        return;
      }

      const parts = [view.before];
      if (view.color) {
        const color = playerColors.get(status.humanPlayerId) ?? [0.5, 0.5, 0.5];
        const chip = document.createElement('b');
        chip.className = 'hud-hint-color';
        chip.textContent = view.color;
        chip.style.setProperty('--player-color', rgb(color));
        chip.style.setProperty('--player-ink', rgb(readableTextColor(color)));
        parts.push(chip);
      }
      parts.push(view.after);
      hintText.replaceChildren(...parts);
    },

    onHintDismiss(handler) {
      hintClose.addEventListener('click', handler);
    },

    /**
     * A die chip per die a player just earned, in their color, wrapping onto
     * as many lines as it takes — sitting above the turn/menu/end-turn row
     * rather than squeezed inside it means a big payout never runs out of
     * room. Purely a cue that a payout is landing; it says nothing about
     * where, since that is what the dice falling onto the planet are for.
     */
    showReinforce({ playerId, count }) {
      if (count <= 0) return;
      const color = playerColors.get(playerId) ?? [0.5, 0.5, 0.5];
      const ink = readableTextColor(color);

      reinforceTray.replaceChildren();
      reinforceChips = [];
      for (let i = 0; i < count; i++) {
        const chip = dieChip({ value: 1 }, color, ink);
        reinforceChips.push(chip);
        reinforceTray.append(chip);
      }
      reinforceTray.hidden = false;
    },

    /**
     * One die has just landed on the planet — peels the tray back by one, so
     * it empties in step with the drops rather than vanishing all at once.
     *
     * Which chip this takes is not what decides the direction it empties in,
     * and anyone here to change that should go to `.hud-reinforce` in hud.css
     * instead. The chips are identical and the row is left-aligned, so the
     * ones still standing always fill the first slots however this picks —
     * popping the last and shifting the first draw the same picture. The
     * stylesheet's `wrap-reverse` is what puts the partial line on top, and so
     * what makes the tray empty right to left, top to bottom.
     */
    reinforceDropped() {
      reinforceChips.pop()?.remove();
    },

    hideReinforce() {
      reinforceTray.hidden = true;
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

    /**
     * Opens the replay over the banner, for `count` recorded attacks, and
     * starts it playing. Someone who has just pressed "Watch replay" has said
     * what they want; leaving them on a still board to go and find the play
     * button is asking the question twice.
     *
     * It opens on step 0 — the board before the first attack — and asks the
     * session to paint it, same as every later step, so there is no state
     * here that isn't also reachable by scrubbing the track back to the
     * start. The first beat is spent on that opening board, which is the one
     * view of the match nothing else shows.
     *
     * Any touch of the transport stops it: `seekReplay` pauses before it
     * paints, so dragging the track or stepping with the arrows takes it back
     * off the player's hands the moment they reach for it.
     *
     * The controls row stands down while this is open — both the menu and the
     * button that may have opened it: the × is the way back, and a second way
     * out sitting right next to it is one too many.
     */
    showReplay(count) {
      stopReplaying();
      replayTrack.max = String(count);
      replayOverlay.hidden = false;
      menuButton.style.visibility = 'hidden';
      applyReplayButton();
      paintReplayStep(0);
      startReplaying();
    },

    hideReplay() {
      stopReplaying();
      replayOverlay.hidden = true;
      menuButton.style.visibility = 'visible';
      // back to whatever the match last said, rather than unconditionally on:
      // the replay is not the only reason this button may be away
      applyReplayButton();
    },

    onReplaySeek(handler) {
      replaySeekHandler = handler;
    },

    onReplayClose(handler) {
      replayCloseHandler = handler;
    },
  };
}
