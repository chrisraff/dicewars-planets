import { readableTextColor } from './palette.js';
import { createBattleReadout, dieChip } from './battleReadout.js';
import { createReplayChart } from './replayChart.js';
import { createFireworks } from './fireworks.js';
import { showScrollFades } from './scrollFades.js';
import { MAX_RESERVE } from '../game/playerStats.js';

// The DOM layer over the canvas: the player stats row, whose turn it is, the
// end-turn button, the battle readout, and the game-over banner. HTML rather
// than drawn into the scene, because text in WebGL is a lot of work for no
// gain when it is always facing the camera anyway.

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
    // Which tile is *you*, marked for the whole match. A caret rather than a
    // word or a colour because every other affordance is spoken for: the
    // border says whose turn it is, the lower-right corner is the banked-dice
    // badge, the middle is the dot a knocked-out tile folds to — and every
    // tile is already its player's colour.
    'is-you': Boolean(player.isYou),
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
 * What the indicator in the corner says. Pure, because the awkward cases are
 * all here: a finished game never moves its turn index off the winner, so
 * "whose turn is it" gives a live-looking answer to a dead question, and a
 * player knocked out mid-game is neither taking a turn nor watching a
 * finished one.
 *
 * Anchored on **you** rather than on whoever is playing. `resolveStartSeat`
 * defaults to any seat, so a six-player game can open with five AI turns
 * before you get a move — which leaves you needing to know *which of these
 * colors am I*, for a while.
 *
 * So it says one of two things, one sentence at two moments: between your
 * turns it names your color as a chip; on your own turn it is a *dot* in that
 * same color beside the words, the sentence continued rather than a new one.
 *
 * **The dot means "yours, now", and nothing else does.** Every other line
 * marks its subject as a chip, which leaves the dot appearing on exactly one
 * line in the game — so its arrival is part of what says the planet is yours
 * again rather than a decoration that changes color.
 *
 * `color` has to be set in a player's color, so it cannot be part of the
 * string — hence the three pieces, the same shape `attackHintView` returns.
 * The word is whatever the line is *about*, which for a win or a knockout is
 * the person rather than the hue.
 */
export function turnIndicatorView(status, nameOf = (id) => id) {
  const { currentPlayerId, humanPlayerId, winner = null, isOver = false } = status;
  const { humanEliminated = false, canAct = false } = status;

  const line = (over) => ({
    before: '',
    color: null,
    after: '',
    dot: false,
    playerId: currentPlayerId,
    endTurn: 'hidden',
    show: true,
    isYours: false,
    ...over,
  });

  if (isOver) {
    if (!winner) return line({ before: 'Nobody wins' });
    if (winner === humanPlayerId) {
      return line({ color: 'You', after: ' win', playerId: humanPlayerId });
    }
    return line({ color: nameOf(winner), after: ' wins', playerId: winner });
  }

  // Nobody at the keyboard. Checked after the result — worth reading whoever
  // was playing — and before everything below, which is all about a "you" that
  // does not exist. `humanEliminated` is derived from whether the human seat
  // holds ground, so an empty seat reads as eliminated and would otherwise
  // claim somebody was knocked out of a game they were never in.
  if (!humanPlayerId || typeof humanPlayerId === 'symbol') return line({ show: false });

  if (humanEliminated) {
    return line({ color: 'You', after: ' are out — watching', playerId: humanPlayerId });
  }

  if (currentPlayerId === humanPlayerId) {
    return line({
      before: 'Your turn',
      dot: true,
      playerId: humanPlayerId,
      endTurn: canAct ? 'ready' : 'waiting',
      isYours: true,
    });
  }

  return line({
    before: 'You are ',
    color: String(nameOf(humanPlayerId)).toLowerCase(),
    playerId: humanPlayerId,
  });
}

/** The whole line as one string — for tests, and for anything reading it. */
export function turnIndicatorText(view) {
  return `${view.before}${view.color ?? ''}${view.after}`;
}

/**
 * Whether the controls row carries a way back into the replay. An offer once
 * made is never withdrawn: the moment a match has an ending to look back at —
 * it is over, the player is out of it, or they have been offered the win and
 * waved it away — the button appears beside the menu and stays.
 *
 * All three are asked of the match rather than latched when a banner went up,
 * which is what makes the button survive a reload: the board says who won and
 * who is out, and `playedOn` travels in the save.
 *
 * Mid-play there is nothing here — a door out is not worth a permanent seat on
 * a row that has to stay readable on a phone.
 */
export function replayButtonView(status) {
  const { hasReplay = false, isOver = false, humanEliminated = false, playedOn = false } = status;
  if (!hasReplay) return 'hidden'; // a match nobody attacked in has nothing to show
  return isOver || humanEliminated || playedOn ? 'shown' : 'hidden';
}

/**
 * Whether to offer to hand the camera back, and *where* to seat the offer.
 *
 * A hand on the planet takes the camera off the match, because a player
 * turning the planet is nearly always studying it. The following then has to
 * be offered back, or it is gone for the rest of the match with nothing on
 * screen to say so — the recenter button a map gives you once you have
 * scrolled away from where you are driving.
 *
 * **It outlives the turn it was raised on**, which is why this never asks
 * whose turn it is. A drag during an AI's turn suppresses the pan home, so the
 * player's turn opens on the view they chose; taking the offer down at the
 * handover would leave them holding a board they cannot see. (A drag during
 * their *own* turn is never recorded at all — `session.js` says why.)
 *
 * **A replay follows too**, and the replay card is docked over exactly the
 * band `'controls'` uses, so `'replay'` seats it in the card's own head
 * beside Graph. One rule, one handler, two seats.
 *
 * Note the ordering: `isOver` is read *after* `replayOpen`. A finished match
 * is silent because nothing moves the camera again — but a replay of one moves
 * it constantly, and almost every replay watched is of a finished match, so
 * the obvious ordering would hide the button where it is most useful.
 *
 * A player who is out is still offered it, and so is an unattended match: the
 * camera goes on following the fights for whoever is watching.
 */
export function autoFollowButtonView(status) {
  const { freed = false, isOver = false, replayOpen = false } = status;
  if (!freed) return 'hidden';
  if (replayOpen) return 'replay';
  return isOver ? 'hidden' : 'controls';
}

/**
 * The prompt a first-time player gets on their turn, or `null` when there is
 * nothing worth saying.
 *
 * The planet looks like something to rotate, so a player who has never seen
 * the game turns it over and never learns that a territory is the button. One
 * sentence fixes it, once — `seen` is answered by `hints.js` from storage.
 *
 * It is advice about the turn you are taking, so every state without one is
 * silence rather than an instruction you cannot follow. `coarsePointer` is the
 * one thing this cannot work out for itself.
 *
 * Three pieces because the color name has to be set in that color, and a
 * first-timer needs it most: "one of your territories" is only actionable once
 * you know which of the eight colors is yours. `playerName` is already a color
 * name (`PLAYER_NAMES` is the palette in order), so naming it and coloring it
 * are the same word; without one the sentence closes over the gap.
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
 * What a won-by-surrender banner says under the title. A constant because it
 * is the one line that has to be honest about an ending the board has not
 * reached: the planet is *not* all yours when this goes up.
 */
export const SURRENDER_DETAIL = 'Your rivals have surrendered.';

/**
 * The banner that interrupts play, and what it offers to do next. Winning is
 * the point of the whole game, so it gets the screen to itself until the
 * player moves on; being knocked out is the other moment worth stopping for,
 * since otherwise the game carries on without you and never says why.
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
      // The replay belongs here as much as on a win — being knocked out is
      // when there is most to look back at.
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

/**
 * The camera on the auto-follow button, in both of the seats that button
 * takes. One copy rather than one per seat, since the two are the same offer
 * and a glyph that differed between them would read as a different control.
 *
 * Sized in `em` by the stylesheet rather than in `rem`, so the smaller pill in
 * the replay card's head gets a smaller camera without a second rule. Stroked
 * in `currentColor` for the same reason the chevron is: the button already
 * brightens on hover, and the icon has to come with it.
 */
const CAMERA_ICON = `
  <span class="hud-auto-follow-icon" aria-hidden="true">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"
         stroke-linecap="round" stroke-linejoin="round">
      <path d="M1.9 5.4h2.4l1.1-1.8h5.2l1.1 1.8h2.4v7.1H1.9z"/>
      <circle cx="8" cy="8.9" r="2.3"/>
    </svg>
  </span>
`;

/**
 * `humanPlayerId` is which seat the person at the keyboard has. Told to the
 * HUD once rather than also threaded through `playerStatsFor`: it is a fact
 * about this interface rather than about the board, and one source is what
 * stops the caret and the rail ever disagreeing about who you are.
 */
export function createHud(
  root,
  { playerColors, playerNames = new Map(), humanPlayerId = null, reducedMotion = null } = {}
) {
  root.innerHTML = `
    <div class="hud-top">
      <div class="hud-players" role="list" aria-label="Players"></div>
      <div class="hud-battle"></div>
    </div>
    <div class="hud-controls">
      <div class="hud-auto-follow" hidden>
        <button class="hud-auto-follow-button" type="button">${CAMERA_ICON}Auto-follow</button>
      </div>
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
          <span class="hud-replay-head-buttons">
            <button class="hud-auto-follow-button hud-replay-follow" type="button" hidden>
              ${CAMERA_ICON}Auto-follow
            </button>
            <button class="hud-replay-graph" type="button" aria-pressed="false">Graph</button>
            <button class="hud-replay-close" type="button" aria-label="Close replay">×</button>
          </span>
        </div>
        <div class="hud-chart" hidden></div>
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
  const controlsRow = root.querySelector('.hud-controls-row');
  const turnIndicator = root.querySelector('.hud-turn');
  const dot = root.querySelector('.hud-dot');
  const turnText = root.querySelector('.hud-turn-text');
  const autoFollow = root.querySelector('.hud-auto-follow');
  const autoFollowButton = root.querySelector('.hud-auto-follow-button');
  const replayFollowButton = root.querySelector('.hud-replay-follow');
  let autoFollowShown = null; // so a repaint doesn't rewrite `hidden` every frame
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
  // Behind the card — see `.hud-banner-card`'s `position`. `reducedMotion` is
  // null in the game, meaning ask the browser at play time; a preview pins it
  // false so the page shows what it says on a machine that has it switched on.
  const fireworks = createFireworks(banner, {
    before: banner.querySelector('.hud-banner-card'),
    reducedMotion,
  });
  let onAction = null;

  const replayOverlay = root.querySelector('.hud-replay');
  const replayTrack = root.querySelector('.hud-replay-track');
  const replayPlay = root.querySelector('.hud-replay-play');
  let replayTimer = null;
  let replaySeekHandler = null;
  let replayCloseHandler = null;

  const replayOpenButton = root.querySelector('.hud-replay-open');
  let replayOffered = false; // what the match last said; the overlay outranks it

  // Two lines per player — territories held and dice standing — over every
  // step the track can reach. The one thing the replay cannot say by playing:
  // a run of moments watched in order is still not the shape of the game.
  const chartPanel = root.querySelector('.hud-chart');
  const chartButton = root.querySelector('.hud-replay-graph');
  const chart = createReplayChart(chartPanel, { playerColors, playerNames });

  // Shut every time the replay opens: what was asked for is the match on the
  // planet, and the chart costs it the bottom of the screen while it is up.
  function showChart(open) {
    chartPanel.hidden = !open;
    chartButton.setAttribute('aria-pressed', String(open));
    chartButton.classList.toggle('is-selected', open);
  }

  chartButton.addEventListener('click', () => showChart(chartPanel.hidden));

  // Two questions answered in different places, so both go through here:
  // whether the match has an ending to look back at, and whether the replay is
  // already open — while it is, the × is the way back and a second door beside
  // it is one too many, exactly as for the menu button.
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

  // Moves the track to `step` (clamped) and repaints the board there — the one
  // path every control goes through, so the track's value is never out of step
  // with what is on screen.
  //
  // `settled` is whether the player has actually stopped here. A scrub passes
  // through dozens of steps, and the board waits for a swing to land (see
  // `replayPlayer.showStep`), so chasing them makes the one thing a scrub is
  // for lag behind the hand doing it. A drag therefore repaints without moving
  // the camera, and the release is the seek the camera answers.
  function paintReplayStep(step, settled = true) {
    const max = Number(replayTrack.max);
    const clamped = Math.max(0, Math.min(max, step));
    replayTrack.value = String(clamped);
    chart.setStep(clamped);
    replaySeekHandler?.(clamped, { settled });
    return clamped;
  }

  function seekReplay(step, settled = true) {
    stopReplaying();
    paintReplayStep(step, settled);
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
  // `input` fires the whole way through a drag, `change` once it is let go.
  replayTrack.addEventListener('input', () => seekReplay(Number(replayTrack.value), false));
  replayTrack.addEventListener('change', () => seekReplay(Number(replayTrack.value)));
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
   * The stats row scrolls sideways at a full table with no scrollbar to say
   * so, so it wears the same fade as the dice strip below it.
   *
   * Coalesced to a frame because a knocked-out tile folding down fires
   * `transitionend` per property per tile, and every one of them changes how
   * much there is left to scroll.
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
    // Name and count are wrapped so the tile can close over them as one,
    // leaving the dot — outside the wrapper — behind.
    element.innerHTML = `
      <span class="hud-player-dot" aria-hidden="true"></span>
      <span class="hud-player-body">
        <span class="hud-player-name"></span>
        <span class="hud-player-territories"></span>
      </span>
      <span class="hud-player-reserve"></span>
    `;
    element.querySelector('.hud-player-name').textContent = nameOf(playerId);
    // The caret says "you" to anyone looking at the row; this says it to
    // anyone who is not. The color name stays in both, since the rest of the
    // interface still talks about colors.
    if (playerId === humanPlayerId) {
      element.setAttribute('aria-label', `${nameOf(playerId)}, you`);
    }

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
        const view = playerPanelView({ ...player, isYou: player.id === humanPlayerId });

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

    /**
     * The corner line, and the rail under the controls — both of them about
     * *you* rather than about whoever happens to be playing. See
     * `turnIndicatorView` for why that is the useful question.
     *
     * The rail is a state where the pan and the flash are announcements: those
     * two mark the moment a turn arrives and are no help at all to somebody
     * who looked away and back, which is exactly what a color that is simply
     * present for the length of a turn is for.
     */
    showTurn(status) {
      const view = turnIndicatorView(status, nameOf);
      const color = playerColors.get(view.playerId) ?? [1, 1, 1];

      dot.style.background = rgb(color);
      dot.hidden = !view.dot;

      const parts = [view.before];
      if (view.color) {
        const chip = document.createElement('b');
        chip.className = 'hud-color-chip';
        chip.textContent = view.color;
        chip.style.setProperty('--player-color', rgb(color));
        chip.style.setProperty('--player-ink', rgb(readableTextColor(color)));
        parts.push(chip);
      }
      parts.push(view.after);
      turnText.replaceChildren(...parts);

      turnIndicator.hidden = !view.show;
      endTurnButton.disabled = view.endTurn !== 'ready';
      endTurnButton.style.visibility = view.endTurn === 'hidden' ? 'hidden' : 'visible';

      // The rail divides the controls from everything transient above them, so
      // it belongs to the row rather than to the line inside it.
      controlsRow.classList.toggle('is-your-turn', view.isYours);
      if (view.isYours) controlsRow.style.setProperty('--turn-color', rgb(color));
    },

    /**
     * The first-timer's prompt, or nothing — `attackHintView` decides, from
     * the same kind of status object `showTurn` takes. The pointer and the
     * player's name are filled in here because they are facts about the
     * browser and about this HUD rather than about the game, and both are left
     * overridable so a preview can show every wording and every color without
     * a device or a match for each.
     *
     * The color name is a chip rather than tinted text: a player color used as
     * ink on this panel lands around 4:1, which is under AA for a sentence this
     * size, while the same color as a background under `readableTextColor` is
     * the pairing the stats row already proves legible across the whole
     * palette.
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
        chip.className = 'hud-color-chip';
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
     * The offer to hand the camera back — see `autoFollowButtonView`. Guarded
     * on the answer it last gave, because `refreshBoard` runs this every frame
     * while dice are in the air and `hidden` is a reflected attribute: writing
     * the same value sixty times a second is sixty attribute mutations.
     */
    showAutoFollow(status) {
      const view = autoFollowButtonView(status);
      if (view === autoFollowShown) return;
      autoFollowShown = view;
      autoFollow.hidden = view !== 'controls';
      replayFollowButton.hidden = view !== 'replay';
    },

    onAutoFollow(handler) {
      autoFollowButton.addEventListener('click', handler);
      replayFollowButton.addEventListener('click', handler);
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

      // Won, however it was won: `outcomeView` folds a surrender into the same
      // `'won'` as running the board out, which is the right seam to hang this
      // on — the two are one thing to the player, and the difference between
      // them is a sentence under the title rather than a different ending.
      //
      // After `hidden = false`, and that is load-bearing rather than tidy: the
      // show is measured against the layer, and a layer inside a `display:
      // none` banner measures zero.
      if (view.kind === 'won') fireworks.play();
      else fireworks.cancel();
    },

    hideOutcome() {
      banner.hidden = true;
      fireworks.cancel();
    },

    onOutcomeAction(handler) {
      onAction = handler;
    },

    /**
     * Everything here that outlives its markup. The replay's timer is stopped
     * by `session.js` closing the replay; the fireworks' is not reachable that
     * way, and a disposed match should not leave a timer running for four
     * seconds even if it would only empty a layer already thrown away.
     */
    dispose() {
      fireworks.dispose();
    },

    /**
     * Opens the replay over the banner, for `count` recorded attacks, and
     * starts it playing — somebody who has just pressed "Watch replay" has
     * said what they want, and leaving them on a still board to find the play
     * button asks the question twice.
     *
     * It opens on step 0, the board before the first attack, painted the same
     * way as every later step, so nothing here is unreachable by scrubbing
     * back to the start. Any touch of the transport pauses it: `seekReplay`
     * stops the timer before it paints.
     *
     * `standings` is the whole match as `standingsOverReplay` gives it. It
     * arrives here rather than on the Graph button because it is a fact about
     * a match already finished being recorded — nothing to wait for, and
     * nothing that can change while the replay is open.
     */
    showReplay(count, { standings = [] } = {}) {
      stopReplaying();
      chart.setSeries(standings);
      showChart(false);
      replayTrack.max = String(count);
      replayOverlay.hidden = false;
      menuButton.style.visibility = 'hidden';
      applyReplayButton();
      paintReplayStep(0);
      startReplaying();
    },

    hideReplay() {
      stopReplaying();
      showChart(false);
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
