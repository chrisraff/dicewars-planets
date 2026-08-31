import {
  isPlayerAlive,
  randomSeed,
  reviveState,
  seededRng,
  serializeState,
} from '@dicewars/core';
import { generatePlanetWorld } from '../world/generateWorld.js';
import { createGame } from './createGame.js';
import { orderAiTurnForCamera } from './aiTurnOrder.js';
import { createBattleLog, battleEntry } from './battleLog.js';
import { createReplay, reviveReplay, serializeReplay } from './replay.js';
import { playerStatsFor } from './playerStats.js';
import { playerIdsFor, resolveStartSeat, strategyFor, subdivisionsFor } from './settings.js';
import { AIM_FIGHTS, AIM_REPLAY, createAutoFollow, panHomeBlocked } from './autoFollow.js';
import { createReplayPlayer } from './replayPlayer.js';
import { createOutcomeBanner } from './outcomeBanner.js';
import { cameraSnapshot, gameSave, isUsableCamera, saveMatchesWorld } from './saveGame.js';
import { createPlanetSurface } from '../render/planetSurface.js';
import { createDiceLayer } from '../render/diceLayer.js';
import { createPoleMarkers } from '../render/poleMarkers.js';
import { createRollAnimation } from '../render/rollAnimation.js';
import { createReinforceAnimation } from '../render/reinforceAnimation.js';
import { createCameraFocus } from '../render/cameraFocus.js';
import { fightCenter } from '../render/cameraFraming.js';
import { createTerritoryPicker } from '../render/pickTerritory.js';
import { createHud } from '../render/hud.js';
import { createTurnFlash } from '../render/turnFlash.js';
import { assignPlayerColors } from '../render/palette.js';
import { highlightsFor, pulseAt } from '../render/highlights.js';

// One tick long enough to run any countdown out in a single step — see
// `settleLiveBoard`.
const SETTLE_STEP = 1e6;

// Named in palette order, so a player's name matches the color of their land.
export const PLAYER_NAMES = ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'Orange', 'Cyan', 'White'];

/**
 * One match: a planet, the game being played on it, and everything drawn for
 * it. Created from settings and disposed whole, so "new game" is throwing one
 * away and building the next rather than resetting a dozen things.
 *
 * The viewer and the dice materials outlive a match and are passed in.
 * `settings` arrives already normalized; `saved` resumes a match rather than
 * dealing a new one.
 *
 * `onSave` and `onAttackHintSeen` report what is worth keeping — where it is
 * written is the page's business, so nothing here knows localStorage exists.
 */
export function createSession({
  viewer,
  hudRoot,
  pipMaterials,
  settings,
  saved = null,
  attackHintSeen = false,
  onNewGame,
  onMenu,
  onSave,
  onAttackHintSeen,
}) {
  const playerIds = playerIdsFor(settings);
  const playerNames = new Map(playerIds.map((id, i) => [id, PLAYER_NAMES[i]]));
  const playerColors = assignPlayerColors(playerIds);

  const { world, seed, restored } = buildWorld(settings, playerIds, saved);

  // A range setting picks one of its seats now, so the match has a settled
  // answer. A resumed game keeps the one it already has.
  const humanPlayerId = restored ? restored.humanPlayerId : playerIds[resolveStartSeat(settings)];

  const game = createGame({
    world,
    humanPlayerId,
    savedState: restored ? reviveState(restored.state) : null,
    // The surrender is asked once per match; a restore puts the banner back
    // by hand below rather than asking again.
    playedOn: restored?.playedOn ?? false,
    surrenderOffered: restored?.surrenderOffered ?? false,
    // A resumed game brings its settings, so a match is finished on the
    // difficulty it was started on.
    strategy: strategyFor(settings),
    // Nearby attacks shown back to back, so the camera swings once per run
    // rather than once per attack. `dice` is not built yet, but this is only
    // ever *called* later — see createGame.js's takeAiTurn.
    orderAiTurn: (moves) =>
      orderAiTurnForCamera(moves, (id) => dice.standFor(id).normal, cameraFocus.currentView()),
  });
  // Every attack and payout in order, anchored on the board they build
  // forward from. It travels in the save, so a resumed match's replay still
  // reaches back to where the recording began rather than to the reload.
  const replay = restoreReplay(restored, game.state);
  // The history panel is the replay read back, not a second record of it.
  const battles = createBattleLog({ entries: replay.historyAt() });

  // A resumed game puts the camera back; a fresh one keeps the viewer's.
  if (isUsableCamera(restored?.camera)) {
    viewer.camera.position.set(restored.camera.x, restored.camera.y, restored.camera.z);
    viewer.controls.update();
  }

  const surface = createPlanetSurface(world, playerColors);
  const dice = createDiceLayer(world, pipMaterials);
  // Something fixed to read the planet's turn against. It steps up onto a
  // dice tower at the pole rather than being cut by one — hence the die size
  // and the stands.
  const poles = createPoleMarkers({
    dieSize: dice.dieSize,
    stands: world.nodeIds.map((id) => dice.standFor(id)),
  });
  poles.settle(game.state);
  viewer.scene.add(surface.group, dice.group, poles.group);

  const hud = createHud(hudRoot, { playerColors, playerNames, humanPlayerId });
  // Under the HUD and over the canvas — see `turnFlash.js` for why that order,
  // and why this is an overlay rather than the scene's background.
  const turnFlash = createTurnFlash(hudRoot.parentNode ?? hudRoot, { before: hudRoot });
  hud.setHistory(battles.entries);
  // A resumed game shows the last fight fought rather than sitting empty.
  if (battles.latestBattle) hud.showBattle(battles.latestBattle);

  // Whether the player has taken the camera off the match by turning the
  // planet themselves, and the run of attacks a press mid-AI-turn would aim
  // at. The rules that read those two live in `autoFollow.js`; what stays here
  // is the half that can actually move a camera.
  const autoFollow = createAutoFollow();

  const cameraFocus = createCameraFocus({
    camera: viewer.camera,
    controls: viewer.controls,
    // A hand on the planet takes the camera off the match — see `freeCamera`.
    onDrag: () => freeCamera(),
  });

  // Whatever camera this match opened with — the viewer's default or one a
  // save put back — the planet has to fit the screen it is played on. Outwards
  // only, so a player who left themselves zoomed out keeps that, while a
  // distance saved on a wider screen is corrected rather than restored.
  cameraFocus.framePlanet({ instant: true });

  // ...and a board the player is about to move on opens on *their* ground.
  //
  // A save reopened is a handover that already happened: `endTurn` will not
  // fire again, so without this a game reloaded on the player's own turn stays
  // pointed wherever the camera was saved — very often the last attack an AI
  // made before handing over. Same rule as the handover, so a camera left
  // deliberately is left alone, and instant for `framePlanet`'s reason.
  if (game.isHumanTurn() && !game.isOver() && isPlayerAlive(game.state, humanPlayerId)) {
    cameraFocus.lookAtHoldings(ownGround(), { instant: true });
  }

  // Covers as many *upcoming* fights as fit in one frame rather than just the
  // next. `pairs` is `{from, to}` in the order they will be shown. Returns
  // whether a swing actually started, since a caller may need to wait for it.
  function focusFights(pairs, { force = false } = {}) {
    const points = pairs.map(({ from, to }) =>
      fightCenter(dice.standFor(from).normal, dice.standFor(to).normal)
    );
    return cameraFocus.lookAtCluster(points, { force });
  }

  // The replay drawn onto the planet. It is handed the same surface, dice and
  // HUD live play draws through, and the three questions a step has to ask the
  // camera; when it has the board is `openReplay`/`closeReplay` below.
  const replayPlayer = createReplayPlayer({
    replay,
    surface,
    dice,
    poles,
    hud,
    playerIds,
    focusFights,
    isSwinging: () => cameraFocus.isSwinging,
    cameraFreed: () => autoFollow.freed,
    finalWinner: () => game.state.winner,
  });

  // The banner that interrupts play, and whether the match is held behind it.
  // Which of the three kinds holds, and which is an ending worth coming back
  // to, is `BANNER_RULES` in `outcomeBanner.js`.
  const banner = createOutcomeBanner({
    show: (outcome) => hud.showOutcome(outcome),
    hide: () => hud.hideOutcome(),
  });

  /**
   * A turn has handed back to the player, so put their own ground in front of
   * them — but only when *none* of it is on screen, since seeing some is
   * enough to know where you are and moving the camera then takes a view away
   * from somebody who has one.
   *
   * Silent in the four states where moving the planet is wrong rather than
   * merely unhelpful: the player is out, the match is over, the replay has the
   * planet, or a banner is holding it.
   */
  function focusOwnGround() {
    if (panHomeBlocked({
      humanEliminated,
      isOver: game.isOver(),
      replayOpen,
      bannerHolding: banner.holding,
    })) {
      return false;
    }

    // A drag suppresses the pan but not the flash: the flash is information
    // about the match rather than a movement of the camera, and somebody
    // studying the board is who most needs telling their turn has come round.
    const moved = autoFollow.freed ? false : cameraFocus.lookAtHoldings(ownGround());
    // With the pan rather than after it — two halves of one handover, and the
    // suppression rules above are the whole of the guard. Safe to overlap
    // because a vignette is clear over the middle, so the planet turning
    // underneath is never the part that gets covered.
    turnFlash.play();
    return moved;
  }

  /** A direction per territory the player holds — what a pan home aims at. */
  function ownGround() {
    const mine = [];
    for (const [id, node] of game.state.nodes) {
      if (node.owner === humanPlayerId) mine.push(dice.standFor(id).normal);
    }
    return mine;
  }

  /**
   * A hand on the planet. Which drags count, and why one taken during the
   * player's own turn does not, is `dragTakesCamera` in `autoFollow.js`.
   */
  function freeCamera() {
    if (autoFollow.takeCamera({ replayOpen, isHumanTurn: game.isHumanTurn() })) {
      refreshAutoFollow();
    }
  }

  /**
   * ...and giving it back, and `pan` is the difference between the two ways.
   * The button is a request to be shown something, so it moves the camera in
   * the same breath (`autoFollowAim`); only promising to move it next time the
   * match wanted to would be no answer at all. An attack is somebody looking
   * straight at a territory they found for themselves, and moving the planet
   * under that is the thing this exists to stop.
   */
  function resumeAutoFollow({ pan = false } = {}) {
    if (!autoFollow.giveBack()) return;
    if (pan) autoFollowAim();
    refreshAutoFollow();
  }

  /**
   * Where the camera would be if it had never been taken. `aimKind` decides
   * which of the three places that is; this is the half that can actually move
   * a camera, which is why it is the half that stays here.
   *
   * Both `force`d: "you can already see a corner of it" is no answer to
   * somebody who pressed a button asking to be taken there. `AIM_FIGHTS` is a
   * preference rather than a verdict — a run that cannot be framed falls
   * through to home rather than leaving the press unanswered.
   */
  function autoFollowAim() {
    const aim = autoFollow.aimKind({
      replayOpen,
      replayStep: replayPlayer.step,
      isAiTurn: game.currentPlayer() !== humanPlayerId,
    });
    // A replay follows the step the track is standing on, not the live board.
    // Same aim `replayPlayer.showStep` would have taken, so a press catches up
    // with the replay rather than landing somewhere it never went.
    if (aim === AIM_REPLAY) {
      return focusFights(replay.attacks.slice(replayPlayer.step - 1), { force: true });
    }
    if (aim === null) return false;
    if (aim === AIM_FIGHTS && focusFights(autoFollow.fights, { force: true })) return true;
    return cameraFocus.lookAtHoldings(ownGround(), { force: true });
  }

  function refreshAutoFollow() {
    hud.showAutoFollow({ freed: autoFollow.freed, isOver: game.isOver(), replayOpen });
  }

  const pickTerritoryAt = createTerritoryPicker({
    planetMesh: surface.mesh,
    camera: viewer.camera,
    faceCellIds: surface.faceCellIds,
    cellTerritory: world.cellTerritory,
  });

  let roll = null; // the attack being animated
  let reinforceAnim = null; // the end-of-turn payout being animated
  // not stored in a save: the board itself says whether you still hold ground
  let humanEliminated = !isPlayerAlive(game.state, humanPlayerId);
  // Done the moment they dismiss it or attack — having just done the thing it
  // describes, being told again next game would be noise.
  let hintSeen = attackHintSeen;
  let pressed = null; // the territory a finger is down on, marked while it is
  // The replay is one of the two things that take the match out of the
  // player's hands; `banner.holding` is the other. Nothing in it moves while
  // either is true — see tick() at the bottom.
  let replayOpen = false;

  /**
   * Finishes whatever move is mid-air, so what the replay covers is a whole
   * move rather than half of one.
   *
   * Nothing is skipped: a long enough tick runs the countdown out and the game
   * emits what it was going to anyway, so the handlers clear `roll` and
   * `reinforceAnim` themselves. Only one move can ever be outstanding — a turn
   * cannot end on a pending attack — so one tick is the whole of it. None of
   * it is seen; it is about what there is to come back to.
   */
  function settleLiveBoard() {
    if (game.isBusy()) game.tick(SETTLE_STEP);
  }

  /**
   * Handing the planet to the replay, and taking it back — the half of this
   * that is about the *match* rather than about a step. What a step looks like
   * is `replayPlayer`; these two decide when it has the board.
   */
  function openReplay() {
    // Reachable mid-match, so there may be a move in flight to put down first.
    settleLiveBoard();
    replayOpen = true;
    // One planet, two things that drive it: whichever has just been handed it
    // starts out driving.
    autoFollow.reset();
    refreshAutoFollow(); // and in here it sits in the card, not the controls
    banner.dismiss();
    hud.showReplay(replay.attacks.length, { standings: replay.standings(playerIds) });
  }

  function closeReplay() {
    replayOpen = false;
    autoFollow.reset(); // see openReplay
    hud.hideReplay();
    replayPlayer.reset(game.state.nodes);
    cameraFocus.cancel();
    // the replay has been drawing straight into the surface, dice, stats and
    // the battle readout; put the real, finished match back before the
    // banner returns
    dice.update(game.state);
    poles.settle(game.state);
    refreshBoard();
    hud.showBattle(battles.latestBattle);
    hud.setHistory(battles.entries);
    // Only a match that actually ended has a banner to go back to; opened from
    // the controls row there is nothing to restore. It comes back with its
    // hold, since "Watch replay" answered the question without settling it —
    // see `restore`.
    banner.restore();
  }

  // What it would take to rebuild this match: the planet as the number it grew
  // from, and everything about the game that no amount of regrowing recovers.
  function snapshot() {
    return gameSave({
      seed,
      settings,
      humanPlayerId,
      world,
      // The board a move has *landed on*, which is not the board on screen
      // while one is still being animated — see `createGame`'s `settledState`
      // and `saveOutcome` below. A save is a record of what has happened, and
      // a rolled die has happened the moment it is rolled.
      state: serializeState(game.settledState),
      replay: serializeReplay(replay),
      playedOn: game.playedOn,
      surrenderOffered: game.surrenderOffered,
      camera: cameraSnapshot(viewer.camera),
    });
  }

  /**
   * A move written down the instant it is *decided*, before any of it is shown.
   *
   * This is the whole of the anti-cheat. An attack resolves in full when it is
   * declared — `attack` already carries every face — so a save deferred until
   * the dice stop is one the player can refuse: read the total, reload before
   * they land, and the fight is back to be fought again for a different
   * answer. A payout is the same trick against `rng`. The replay is recorded
   * here too, since a save a move ahead of its own replay comes back missing
   * the fight that produced it.
   *
   * The `change` that follows lands on exactly this board, so `outcomeSaved`
   * stops it writing twice. Only a camera that moved during the animation is
   * given up, and the camera has always been opportunistic in a save.
   */
  let outcomeSaved = false;
  function saveOutcome() {
    outcomeSaved = true;
    onSave?.(snapshot());
  }

  function hintDone() {
    if (hintSeen) return;
    hintSeen = true;
    onAttackHintSeen?.();
  }

  // The three banners. Whether each holds the match and whether it is an
  // ending to come back to is `BANNER_RULES` in `outcomeBanner.js`; all that
  // is decided here is what they say.
  const canReplay = () => replay.attacks.length > 0;
  const surrendered = () => ({ kind: 'surrendered', humanPlayerId, canReplay: canReplay() });

  // In one place because it goes up twice: when the game is won, and when a
  // save of a game already won is opened again.
  function showEnding(winner) {
    banner.raise({ kind: 'over', winner, humanPlayerId, canReplay: canReplay() });
  }

  function refreshBoard(pulse = 1) {
    const marks = highlightsFor({
      selection: game.selection,
      targets: game.legalTargets(),
      attack: roll?.event ?? null,
      pressed,
      pulse,
    });
    surface.refresh(game.state, (territoryId) => marks.get(territoryId) ?? null);
    hud.showPlayers(playerStatsFor(game.state, playerIds));
    hud.showTurn({
      currentPlayerId: game.currentPlayer(),
      humanPlayerId,
      winner: game.state.winner,
      isOver: game.isOver(),
      humanEliminated,
      canAct: game.isHumanTurn() && !game.isBusy(),
    });
    // All three of these are read back off the match rather than remembered,
    // so a reload lands on the same answer — see `replayButtonView`.
    hud.showReplayButton({
      hasReplay: replay.attacks.length > 0,
      isOver: game.isOver(),
      humanEliminated,
      playedOn: game.playedOn,
    });
    refreshAutoFollow();
    hud.showHint({
      seen: hintSeen,
      humanPlayerId, // the panel names the color you are, so it has to know
      isHumanTurn: game.isHumanTurn(),
      isOver: game.isOver(),
      humanEliminated,
    });
  }

  game.on('attack', ({ event, eliminated, timing, upcoming }) => {
    // Before a single die is drawn — see `saveOutcome`. The elimination
    // travels with the declaration for the same reason: a save carrying the
    // board without it would restore a knockout the history never saw.
    replay.record(event);
    if (eliminated) replay.recordElimination(eliminated);
    saveOutcome();

    // the dice are known already, but they belong on the planet first — show
    // the readout with blank faces so it fills in as the roll lands
    hud.showBattle(battleEntry(event), { revealed: false });

    // Only the AI's fights are worth turning for — the player's are on screen
    // by definition, since they just clicked them. `upcoming` is this attack
    // plus whatever is queued behind it, so a run of nearby attacks gets one
    // swing. Unless the player has taken the camera, in which case the planet
    // stays where they put it and the missed fights are the price.
    if (game.currentPlayer() !== humanPlayerId) {
      autoFollow.showing(upcoming); // where a press would go, if the camera is theirs
      if (!autoFollow.freed) focusFights(upcoming);
    } else {
      hintDone(); // they have just done the thing the prompt describes
    }

    roll = {
      event,
      elapsed: 0,
      animation: createRollAnimation({
        attackerStand: dice.standFor(event.from),
        defenderStand: dice.standFor(event.to),
        event,
        dieSize: dice.dieSize,
        timing,
      }),
    };
  });

  game.on('resolved', (state) => {
    const { event } = roll;
    roll = null;
    // The battle *log* is what the player reads, so it fills in now, with the
    // faces. The replay was written at the declaration — see `saveOutcome`.
    hud.showBattle(battles.record(event));
    hud.setHistory(battles.entries);
    // both stacks are still lying on the faces they rolled; stand them back up
    dice.reroll(event.from, state);
    dice.reroll(event.to, state);
  });

  game.on('reinforce', (event) => {
    // Decided, so written down — where the dice land is `rng`'s answer and it
    // is given once. See `saveOutcome`.
    replay.recordReinforcement(event);
    saveOutcome();
    if (event.passed) {
      battles.record({ type: 'passed', playerId: event.playerId });
      hud.setHistory(battles.entries);
    }
    // No camera move: payout dice land all over the planet, and the drop is
    // faster than a swing chasing it would be. It reads fine off-screen.
    hud.showReinforce({ playerId: event.playerId, count: event.landed.length });
    reinforceAnim = {
      elapsed: 0,
      dropped: 0, // how many of the HUD's chips have been told their die has landed
      animation: createReinforceAnimation({ landed: event.landed, dice }),
    };
  });

  game.on('endTurn', (event) => {
    autoFollow.showing([]); // the run this turn was showing is over
    // The payout has landed — `change` is about to rebuild every stack it
    // touched, so the dice animated here have nothing left to do.
    reinforceAnim = null;
    hud.hideReinforce();

    // Handing the planet over: the AI attacks wherever it likes, so the view
    // that suits its turn is the one with the whole planet in it. Outwards
    // only — see `framePlanet` — and it has the AI's think pause to land in.
    // Ending a turn hands the camera back unconditionally too, which is the
    // backstop for an offer the player simply ignored.
    if (event.playerId === humanPlayerId) {
      resumeAutoFollow();
      cameraFocus.framePlanet();
    }
    // The other side of the same handover. `endTurn` comes from
    // `finishReinforce`, so the payout has landed and `state` has moved on —
    // the first moment the camera is free without cutting an animation short.
    else if (game.currentPlayer() === humanPlayerId) focusOwnGround();
  });

  game.on('eliminated', (event) => {
    battles.record(event);
    hud.setHistory(battles.entries);
    // Not recorded into the replay here: it was tagged onto its own attack at
    // the declaration, since a save written then has to carry it.
    if (event.playerId === humanPlayerId) {
      humanEliminated = true;
      if (!game.isOver()) {
        // Held, and deliberately *not* remembered — a match carrying on
        // without you has no ending screen to return to, so closing a replay
        // opened from here puts you back on the board. Both of those follow
        // from the kind; see `BANNER_RULES`.
        banner.raise({ kind: 'eliminated', by: event.by, humanPlayerId, canReplay: canReplay() });
      }
    }
  });

  game.on('change', (state) => {
    dice.update(state);
    poles.settle(state); // a tower may have grown or gone at a pole
    refreshBoard();
    // Every change rather than on a timer or on `pagehide`, which is not
    // reliable on mobile. A finished game is saved too: no turn left to take,
    // but the replay is in there. Unless `saveOutcome` already wrote this
    // exact board a whole animation ago, in which case re-storing it is a
    // main-thread `setItem` for no new information.
    if (outcomeSaved) outcomeSaved = false;
    else onSave?.(snapshot());
  });

  // Every opponent left has given up. The match is not over — the board says
  // so, and the AIs play on — but there is nothing left in it to decide, so
  // the player is offered the win now rather than the twenty turns of mopping
  // up that would otherwise stand between them and it.
  game.on('surrendered', () => {
    banner.raise(surrendered());
    // Straight away: the match is held behind the banner, so there may not
    // *be* another change until the question is answered.
    onSave?.(snapshot());
  });

  game.on('over', (winner) => {
    // the banner stays until the player dismisses it — winning gets a moment
    // rather than being covered by the menu the instant it happens
    showEnding(winner);
  });

  hud.onOutcomeAction((action) => {
    // Whatever it is, the question has been answered — so the match is no
    // longer held for it. 'replay' hands the hold straight over to the replay
    // itself, which keeps it until the overlay closes.
    banner.answered();
    if (action === 'newGame') return onNewGame?.();
    if (action === 'replay') return openReplay();

    if (action === 'playOn') {
      // Written down straight away: a reload in between would otherwise open
      // on the banner the player has just declined.
      game.playOn();
      banner.playedOn();
      onSave?.(snapshot());
    }

    banner.dismiss(); // 'watch', 'dismiss' and 'playOn' all just get out of the way
    refreshBoard();
  });

  // A step passed through mid-drag repaints the board and leaves the camera
  // alone; the release that follows is the one the camera answers.
  hud.onReplaySeek((step, { settled = true } = {}) =>
    replayPlayer.showStep(step, { moveCamera: settled }));
  hud.onReplayClose(closeReplay);
  hud.onReplayOpen(openReplay);

  hud.onHintDismiss(() => {
    hintDone();
    refreshBoard();
  });

  // Pressed rather than played out of: the camera comes back *and* goes home,
  // so the press answers itself instead of promising something for later.
  hud.onAutoFollow(() => resumeAutoFollow({ pan: true }));

  hud.onEndTurn(() => {
    game.endTurn();
    refreshBoard();
  });

  hud.onMenu(() => onMenu?.());

  // A restored game that was already won gets no `over` event, so the ending
  // it finished on goes back up by hand — which is what keeps "Watch replay"
  // reachable after a reload.
  //
  // A surrender offered and never answered is the same problem one step
  // earlier: `surrendered` is asked once per match and will not fire again, so
  // without this the player comes back to an ordinary game in progress with
  // no banner and no Replay button, the win they were handed simply gone.
  if (game.isOver()) showEnding(game.state.winner);
  else if (game.surrenderOffered && !game.playedOn) banner.raise(surrendered());

  game.start();

  return {
    game,
    settings,

    /**
     * A press has landed. Answers with what letting go there would do —
     * `pressActionOn`'s `'attack'`, `'select'` or `'drop'` — or `null` for
     * nothing to act on, which hands the press straight to the camera so a
     * drag off the ocean turns the planet from its first pixel rather than
     * after a dead zone (see `pointerArbiter.js`).
     *
     * A press worth taking is *shown*, so releasing is a confirmation rather
     * than a guess. The one press with nothing to mark is a tap on the ocean
     * while holding a territory, which is how you put that territory down.
     */
    pressAt(ndc) {
      const territoryId = pickTerritoryAt(ndc);
      const action = game.pressActionOn(territoryId);
      // `drop` is the one that can mean somewhere other than where the finger
      // is: dropping by tapping the held territory marks it, dropping by
      // tapping anywhere else has nothing of its own to say.
      pressed = action === 'attack' || action === 'select' || territoryId === game.selection
        ? territoryId
        : null;
      if (action !== null) refreshBoard();
      return action;
    },

    /**
     * The press came up where it went down, so it meant it. The territory
     * acted on is the one the mark was on rather than whatever is under the
     * pointer now: what was shown is what happens.
     */
    releasePress() {
      const territoryId = pressed;
      pressed = null;
      game.clickTerritory(territoryId);
      // Picking a territory answers the offer, silently — they are looking
      // straight at ground they just found for themselves.
      if (game.selection !== null) resumeAutoFollow();
      refreshBoard();
    },

    /** It turned into a drag, or the system took it away. Nothing happens. */
    cancelPress() {
      if (pressed === null) return;
      pressed = null;
      refreshBoard();
    },

    tick(dt) {
      cameraFocus.tick(dt);
      turnFlash.tick(dt);

      replayPlayer.tick(dt);
      if (roll) {
        roll.elapsed += dt;
        roll.animation.apply(roll.elapsed);
        refreshBoard(pulseAt(roll.elapsed));
      }
      if (reinforceAnim) {
        reinforceAnim.elapsed += dt;
        const started = reinforceAnim.animation.apply(reinforceAnim.elapsed);
        // the tray peels back in step with the drops themselves, not on its
        // own timer — one call per die, the moment that die starts falling
        while (reinforceAnim.dropped < started) {
          hud.reinforceDropped();
          reinforceAnim.dropped++;
        }
      }
      // Held while the replay or a banner has the planet: letting the AI take
      // three turns behind either means closing it drops the player somewhere
      // they never saw happen. `game.tick` is the only clock in the match, so
      // not calling it is the whole of the pause.
      if (!replayOpen && !banner.holding) game.tick(dt);
    },

    dispose() {
      roll = null;
      reinforceAnim = null;
      replayPlayer.clear();
      // The replay's timer outlives the markup `replaceChildren` is about to
      // throw away, and would go on painting steps onto a planet no longer in
      // the scene. Closing the replay is what stops it.
      hud.hideReplay();
      hud.dispose();
      cameraFocus.dispose();
      turnFlash.dispose();
      viewer.scene.remove(surface.group, dice.group, poles.group);
      surface.dispose();
      dice.dispose();
      poles.dispose();
      hudRoot.replaceChildren();
    },
  };
}

/**
 * The replay this session records into: the one saved with the match if there
 * is one, otherwise a fresh one anchored on the board the session opens with.
 *
 * A replay that will not decode is dropped rather than thrown — the game
 * behind it is still perfectly playable, and losing the record of how it got
 * here is a far smaller loss than refusing to open it at all.
 */
function restoreReplay(restored, state) {
  if (restored?.replay) {
    try {
      return reviveReplay(restored.replay);
    } catch {
      // a hand-edited or half-written save; carry on recording from here
    }
  }

  return createReplay({
    nodes: state.nodes,
    reserves: new Map([...state.players].map(([id, player]) => [id, player.reserve])),
  });
}

/**
 * The planet this match is played on, and the seed that grows it.
 *
 * A saved game names its seed, so the same planet comes back cell for cell —
 * as long as the generator has not changed. When the world it rebuilds no
 * longer fits the board saved on it, the save is dropped and a fresh planet
 * grown: a new game beats a board laid over territories that are not there.
 */
function buildWorld(settings, playerIds, saved) {
  const subdivisions = subdivisionsFor(settings);
  const grow = (seed) => generatePlanetWorld({ subdivisions, playerIds, rng: seededRng(seed) });

  if (saved) {
    const world = grow(saved.seed);
    if (saveMatchesWorld(saved, world)) return { world, seed: saved.seed, restored: saved };
  }

  const seed = randomSeed();
  return { world: grow(seed), seed, restored: null };
}
