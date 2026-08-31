import {
  isPlayerAlive,
  randomSeed,
  totalReserve,
  MAX_RESERVE,
  reviveState,
  seededRng,
  serializeState,
} from '@dicewars/core';
import { generateSystem, bodyOfTerritory } from '../world/generateSystem.js';
import { createGame } from './createGame.js';
import { orderAiTurnForCamera } from './aiTurnOrder.js';
import { createBattleLog, battleEntry } from './battleLog.js';
import { createReplay, reviveReplay, serializeReplay } from './replay.js';
import { playerStatsFor } from './playerStats.js';
import { playerIdsFor, resolveStartSeat, strategyFor, subdivisionsFor } from './settings.js';
import { cameraSnapshot, gameSave, isUsableCamera, saveMatchesWorld } from './saveGame.js';
import { createPlanetSurface } from '../render/planetSurface.js';
import { createDiceLayer } from '../render/diceLayer.js';
import { createPoleMarkers } from '../render/poleMarkers.js';
import { createRollAnimation } from '../render/rollAnimation.js';
import { REPLAY_TIMING } from '../render/rollTimeline.js';
import { createReinforceAnimation } from '../render/reinforceAnimation.js';
import { createCameraFocus } from '../render/cameraFocus.js';
import { fightCenter } from '../render/cameraFraming.js';
import { createTerritoryPicker } from '../render/pickTerritory.js';
import { createHud } from '../render/hud.js';
import { createTurnFlash } from '../render/turnFlash.js';
import { assignPlayerColors, CHANNEL_COLOR } from '../render/palette.js';
import { highlightsFor, pulseAt } from '../render/highlights.js';

// One tick long enough to run any countdown in the game out in a single step.
// Used to settle a move that is still mid-air when the replay takes the planet
// over — see `settleLiveBoard`.
const SETTLE_STEP = 1e6;

// Named in palette order, so a player's name matches the color of their land.
export const PLAYER_NAMES = ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'Orange', 'Cyan', 'White'];

/**
 * One match: a planet, the game being played on it, and everything drawn for
 * it. Created fresh from a set of settings and thrown away whole — which is
 * what makes "new game" a matter of disposing one of these and building the
 * next, rather than trying to reset a dozen things back to how they started.
 *
 * The viewer and the dice materials outlive a match and are passed in;
 * everything else here belongs to this one game.
 *
 * `settings` has already been normalized by the time it gets here — the menu
 * and `resolveSettings` are the two places raw values are parsed.
 *
 * `attackHintSeen` says whether this player has already been told how to
 * attack, and `onAttackHintSeen` is called the once when they have been —
 * same division as `onSave`: the session decides when a hint has done its job,
 * the page decides where that fact is written down.
 *
 * `saved` resumes a match rather than dealing a new one, and `onSave` is
 * handed the state to write after every move — including the move that ends
 * the game, since a finished match still has its replay to come back to.
 * Storage itself stays outside: the session says what is worth keeping, the
 * page decides where it goes, and nothing here has to know that localStorage
 * exists.
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

  // which seat in the turn order the player asked for — a range picks one of
  // its seats now, so the rest of the match has a settled answer. A resumed
  // game already has its answer and keeps it.
  const humanPlayerId = restored ? restored.humanPlayerId : playerIds[resolveStartSeat(settings)];

  const game = createGame({
    world,
    humanPlayerId,
    savedState: restored ? reviveState(restored.state) : null,
    // a player who already waved a surrender away is not asked again, and one
    // who was asked but never answered is not asked twice — the banner goes
    // back up below instead
    playedOn: restored?.playedOn ?? false,
    surrenderOffered: restored?.surrenderOffered ?? false,
    // and the moon carries on from where it had got to
    round: restored?.round ?? 0,
    // A resumed game brings its own settings with it, so the difficulty a
    // match was started on is the one it is finished on.
    strategy: strategyFor(settings),
    // Reorders an AI's turn for display so nearby attacks show back to back
    // instead of swinging the camera once per attack — `dice` isn't built
    // yet at this point in construction, but this is only ever *called*
    // later, once it is (see createGame.js's takeAiTurn).
    orderAiTurn: (moves) => {
      // Grouped by world before it is clustered by camera. Within a world
      // this is exactly the reordering it always was; across two, leaving
      // them mixed would flip the board back and forth between the planet and
      // the moon several times in one turn, which is a worse way to watch a
      // turn than any ordering could make up for.
      const groups = new Map();
      for (const move of moves) {
        const body = bodyOf(move.to);
        if (!groups.has(body)) groups.set(body, []);
        groups.get(body).push(move);
      }
      return [...groups.values()].flatMap((group) =>
        orderAiTurnForCamera(group, (id) => standFor(id).normal, cameraFocus.currentView()));
    },
  });
  // Every attack and every payout, in the order they happened, anchored on
  // the board they build forward from — the whole match, and it travels in
  // the save, so a resumed game's replay still reaches back to where the
  // recording began rather than only to the reload.
  const replay = restoreReplay(restored, game.state, MAX_RESERVE * (world.moon ? 2 : 1));
  // The history panel is the replay read back, rather than a second record of
  // the same fights kept alongside it.
  const battles = createBattleLog({ entries: replay.historyAt() });

  // A resumed game puts the camera back where it was left; a fresh one
  // leaves it wherever the viewer already starts.
  if (isUsableCamera(restored?.camera)) {
    viewer.camera.position.set(restored.camera.x, restored.camera.y, restored.camera.z);
    viewer.controls.update();
  }

  /**
   * One board per world, and **only one of them in the scene at a time**.
   *
   * That is the whole architecture of moon mode's renderer, and it is what
   * makes the rest of it cost almost nothing. Every piece of geometry here
   * assumes a unit sphere centred on the origin — `diceGroundRadius` works in
   * radians, `framingDistance` is `asin(1 / d)`, the orbit controls target
   * (0, 0, 0) — so rather than standing the moon off to one side and teaching
   * all of that about a second centre and a second radius, each body takes its
   * turn standing in the same hole. Both are then the unit sphere they were
   * written for, and neither knows the other exists.
   *
   * The rule that makes it work as an *interface* rather than as a trick is
   * that the moon is never picked in 3D. It is reached by the orbit dial, so
   * there is nothing on screen whose being hidden could cost anybody a move.
   */
  const bodies = bodyOfTerritory(world);
  const boards = new Map();
  for (const [body, bodyWorld] of [['planet', world], ...(world.moon ? [['moon', world.moon]] : [])]) {
    const bodySurface = createPlanetSurface(bodyWorld, playerColors, {
      // the moon paints its channels where the planet paints ocean; the two
      // are the same "this cell has no territory" case, in two worlds
      emptyColor: body === 'moon' ? CHANNEL_COLOR : undefined,
    });
    const bodyDice = createDiceLayer(bodyWorld, pipMaterials);
    // Something fixed to read the world's turn against. It stands on the
    // ground, and steps up onto a dice tower at the pole rather than being cut
    // by one — which is what it needs the die size and the stands for.
    const bodyPoles = createPoleMarkers({
      dieSize: bodyDice.dieSize,
      stands: bodyWorld.nodeIds.map((id) => bodyDice.standFor(id)),
    });
    bodyPoles.settle(game.state);
    boards.set(body, { body, world: bodyWorld, surface: bodySurface, dice: bodyDice, poles: bodyPoles });
  }

  let shownBody = 'planet';
  const shown = () => boards.get(shownBody);
  const bodyOf = (territoryId) => bodies.get(territoryId) ?? 'planet';
  const boardOf = (territoryId) => boards.get(bodyOf(territoryId)) ?? boards.get('planet');
  const standFor = (territoryId) => boardOf(territoryId).dice.standFor(territoryId);
  const eachBoard = (fn) => { for (const board of boards.values()) fn(board); };
  // Where the camera was left on each world. Switching restores it rather than
  // reframing, for the same reason a save restores one: a view somebody chose
  // is a view they should get back.
  const cameraByBody = new Map();

  viewer.scene.add(shown().surface.group, shown().dice.group, shown().poles.group);

  /**
   * A dice layer's worth of interface spanning both boards, for the payout
   * animation — which is the one thing that has to touch several territories
   * at once and cannot be told which world they are on. Every lookup is by
   * territory, so each one lands on the right board; `dieSize` and `geometry`
   * are the same object-for-object on both, so either will do.
   */
  const diceAcrossBodies = {
    get dieSize() { return boards.get('planet').dice.dieSize; },
    get geometry() { return boards.get('planet').dice.geometry; },
    standFor: (id) => boardOf(id).dice.standFor(id),
    planFor: (id, count) => boardOf(id).dice.planFor(id, count),
    materialsAt: (id) => boardOf(id).dice.materialsAt(id),
  };

  const hud = createHud(hudRoot, { playerColors, playerNames, humanPlayerId });
  // Under the HUD and over the canvas — see `turnFlash.js` for why that order,
  // and why this is an overlay rather than the scene's background.
  const turnFlash = createTurnFlash(hudRoot.parentNode ?? hudRoot, { before: hudRoot });
  hud.setHistory(battles.entries);
  // A resumed game brings its history with it, so the readout should show the
  // last fight already fought rather than sitting empty until the next one.
  if (battles.latestBattle) hud.showBattle(battles.latestBattle);

  const cameraFocus = createCameraFocus({
    camera: viewer.camera,
    controls: viewer.controls,
    // A hand on the planet is the player taking the camera off the match — see
    // `cameraFreed` below.
    onDrag: () => freeCamera(),
  });

  // Whatever camera this match opened with — the viewer's default, or the one
  // a save just put back — the planet has to actually fit the screen it is
  // being played on. Outwards only, exactly as at the end of a turn, so a
  // player who left themselves zoomed out keeps that; but a distance saved on
  // a wider screen, or before this rule existed, is corrected rather than
  // restored faithfully into an unplayable view.
  cameraFocus.framePlanet({ instant: true });

  // ...and if the board being opened is one the player is about to move on, it
  // opens on *their* ground.
  //
  // A handover pans home (`focusOwnGround`), but a save reopened is a handover
  // that already happened, in a tab that no longer exists — `endTurn` will not
  // fire again, so without this a game reloaded on the player's own turn comes
  // back pointing wherever the camera was saved, which is very often the last
  // attack an AI made before handing over. The turn then opens on somebody
  // else's half of the planet, and nothing is going to move it until the turn
  // is over.
  //
  // Same rule as the handover, so a camera the player deliberately left on
  // their own ground is left exactly where they left it: it only fires when
  // none of that ground is on screen. Instant, for `framePlanet`'s reason —
  // there is no previous view to travel from, and a swing would be the planet
  // lurching the moment it appeared.
  if (game.isHumanTurn() && !game.isOver() && isPlayerAlive(game.state, humanPlayerId)) {
    cameraFocus.lookAtHoldings(ownGround(), { instant: true });
  }

  // Swings the camera to cover as many of the *upcoming* fights as will
  // comfortably fit in one frame, rather than swinging to just the next one
  // — `pairs` is `{from, to}` in the order they're about to be shown,
  // starting with whichever one is about to trigger the swing. Returns
  // whatever `cameraFocus.lookAtCluster` returns — whether it actually
  // started a swing — since a caller may need to wait for it to land.
  function focusFights(pairs, { force = false } = {}) {
    if (pairs.length === 0) return false;

    // A fight is watched on the **defender's** world, because that is where
    // the ground changes hands. It matters for exactly one kind of attack —
    // one across the gate — and there the alternative is watching a stack
    // leave and never seeing where it landed.
    showBody(bodyOf(pairs[0].to));

    const points = [];
    for (const { from, to } of pairs) {
      if (bodyOf(to) !== shownBody) continue;
      // An attacker on the other world has a normal in the other world's
      // frame, where it means nothing at all — so a fight across the gate is
      // framed on its defender alone rather than on the pair.
      points.push(
        bodyOf(from) === shownBody
          ? fightCenter(standFor(from).normal, standFor(to).normal)
          : standFor(to).normal
      );
    }
    if (points.length === 0) return false;
    return cameraFocus.lookAtCluster(points, { force });
  }

  /**
   * Puts a world on screen: the one in the scene comes out, the other goes in,
   * and the camera picks up wherever it was left on the world being arrived at.
   *
   * `framePlanet` runs afterwards because the two bodies are drawn at the same
   * size but are not the same *board* — a camera distance that framed a
   * fifty-territory planet is not necessarily one that frames ten territories
   * of moon on this screen, and the rule is outwards-only either way, so a
   * player who was zoomed out keeps it.
   */
  function showBody(next, { instant = true } = {}) {
    if (next === shownBody || !boards.has(next)) return false;

    cameraByBody.set(shownBody, viewer.camera.position.clone());
    const from = boards.get(shownBody);
    const to = boards.get(next);
    viewer.scene.remove(from.surface.group, from.dice.group, from.poles.group);
    viewer.scene.add(to.surface.group, to.dice.group, to.poles.group);
    shownBody = next;

    // Whatever swing was in flight was aimed at a world that is no longer on
    // screen, so it can only land somewhere meaningless.
    cameraFocus.cancel();
    const kept = cameraByBody.get(next);
    if (kept) viewer.camera.position.copy(kept);
    viewer.controls.update();
    cameraFocus.framePlanet({ instant });

    refreshBoard();
    return true;
  }

  /**
   * The player has *asked* for a world, which is a different thing from the
   * match putting one in front of them.
   *
   * Pressing the dial frees the camera, exactly as turning the planet by hand
   * does, and for the same reason: it is a view chosen deliberately, and
   * nothing automatic has any business undoing it. Without this the very next
   * AI attack on the other world switched straight back — press "Moon", watch
   * it for a second, and find yourself on the planet again — which reads as
   * the button being broken rather than as the camera being overridden.
   *
   * Unconditional, unlike `freeCamera`, which ignores a drag taken on the
   * player's own turn because there is nothing to suppress then. Here there
   * is: a body switch is undone by the *next* turn's fights whoever's turn it
   * is now, so the choice has to outlive the turn it was made in.
   */
  function chooseBody(next) {
    if (!cameraFreed) {
      cameraFreed = true;
      refreshAutoFollow();
    }
    showBody(next);
  }

  /**
   * The world "home" means right now.
   *
   * A camera handed back on a world the player holds nothing on has been
   * handed back to nothing, so the pan home has to be able to change which
   * board is on screen as well as where it is pointing. Staying put wins
   * whenever there is any of their ground here at all: switching worlds to
   * show somebody one more territory takes away more than it gives.
   */
  function homeBody() {
    if (boards.size === 1) return 'planet';
    const held = new Map();
    for (const [id, node] of game.state.nodes) {
      if (node.owner !== humanPlayerId) continue;
      held.set(bodyOf(id), (held.get(bodyOf(id)) ?? 0) + 1);
    }
    if ((held.get(shownBody) ?? 0) > 0) return shownBody;
    let best = 'planet';
    for (const [body, count] of held) if (count > (held.get(best) ?? 0)) best = body;
    return best;
  }

  /**
   * A turn has just handed back to the player, so put their own ground in
   * front of them.
   *
   * The AI plays where it likes and the camera has been following it round the
   * back for a minute, so the board the player is handed is quite often
   * somebody else's half of the planet. `lookAtHoldings` turns it back — but
   * only when *none* of their territories is on screen, since seeing some of
   * their own ground is enough to know where they are, and moving the camera
   * then would be taking a view away from somebody who has one.
   *
   * Held back for the four states where an announcement is wrong rather than
   * merely unhelpful: a player who is out has no turn to be handed, a finished
   * match has no next move, and both the replay and a banner are things the
   * player is looking at instead of the board — turning the planet underneath
   * either would move a board they cannot see and land them somewhere they
   * never watched happen.
   */
  function focusOwnGround() {
    if (humanEliminated || game.isOver() || replayOpen || bannerHolding) return false;

    // The camera is the player's until they hand it back, so the pan is the
    // half of this that a drag suppresses. The flash is not: it is a fact
    // about the match rather than a movement of the camera, and somebody
    // studying the board is exactly who most needs telling that their turn has
    // come round while they were looking at it.
    if (!cameraFreed) showBody(homeBody());
    const moved = cameraFreed ? false : cameraFocus.lookAtHoldings(ownGround());
    // The flash runs *with* the pan rather than after it. They are two halves
    // of one handover — the planet coming back to you and being told so — and
    // the flash is what marks the moment it happens: held until the camera
    // settled, it announced up to half a second after the thing it was
    // announcing, which reads as a second event rather than as the same one.
    // Overlapping them is safe because of the shape the flash already has: a
    // vignette is clear over the middle, so the planet turning underneath it
    // is never the part that gets covered.
    //
    // The suppression rules above are the whole of the guard now. They were
    // re-checked when the flash finally fired, because a knockout or a replay
    // could arrive in the second the camera was moving; firing here, there is
    // no gap for anything to arrive in.
    turnFlash.play();
    return moved;
  }

  /** A direction per territory the player holds — what a pan home aims at. */
  function ownGround() {
    const mine = [];
    for (const [id, node] of game.state.nodes) {
      // only what is on screen: a direction on the world you are not looking
      // at is a direction in somebody else's frame
      if (node.owner === humanPlayerId && bodyOf(id) === shownBody) {
        mine.push(standFor(id).normal);
      }
    }
    return mine;
  }

  /**
   * The player has turned the planet, so the camera is theirs until they give
   * it back.
   *
   * The camera follows the match on its own, and that is right nearly all of
   * the time — but not while somebody is *reading* the board. A player who
   * drags round to count an opponent's stacks was, before this, allowed about
   * one AI attack's worth of looking before the camera swung off to a fight
   * somewhere else, and there was no way to ask it not to. Now the drag says
   * so, and every automatic move is off until they say otherwise.
   *
   * The one thing that must not follow from that is the following being lost
   * for the rest of the match with nothing on screen to say so — hence the
   * button, which is up for exactly as long as this is true. It stays up
   * *into* the player's own turn when the drag happened before it, because
   * that is the case where the pan home was suppressed and the turn opens on
   * somebody else's half of the planet.
   *
   * A drag taken during the player's own turn is not recorded at all, and the
   * reason is that there would be nothing to record: every automatic move
   * belongs either to a turn that is not theirs or to the handover at one end
   * of it, so during their own turn `cameraFreed` suppresses precisely
   * nothing. Raising an offer to hand back a camera nobody was going to take
   * would be a button up through the one part of the match they are playing.
   *
   * That exemption is about the *live* match, hence the replay check in front
   * of it: a replay swings to every step it plays whoever's turn the paused
   * board happens to be sitting on, so a drag during one always has something
   * to suppress.
   *
   * Not saved. It is a fact about the hand on the planet in this sitting,
   * like the pressed territory and unlike anything about the position, and a
   * reload is somebody arriving at the board fresh.
   */
  function freeCamera() {
    if (cameraFreed) return;
    if (!replayOpen && game.isHumanTurn()) return;
    cameraFreed = true;
    refreshAutoFollow();
  }

  /**
   * ...and giving it back. Either by pressing the button, which pans home in
   * the same breath, or by attacking on your own turn, which does not.
   *
   * `pan` is that difference and it is the whole of the design. A press is a
   * request to be shown something, and answering it by only *promising* to
   * move the camera the next time the match happens to want to would be no
   * answer at all — so it goes wherever the camera would have been had it
   * never been taken (`autoFollowAim`). An attack is somebody who has finished
   * studying and started playing, at a territory they have found for
   * themselves and are looking straight at; moving the planet under that is
   * the very thing this whole mechanism exists to stop.
   */
  function resumeAutoFollow({ pan = false } = {}) {
    if (!cameraFreed) return;
    cameraFreed = false;
    if (pan) autoFollowAim();
    refreshAutoFollow();
  }

  /**
   * Where the camera would be standing right now if it had never been taken —
   * which is the only honest answer to a press, and is *not* the same place
   * all match long.
   *
   * On somebody else's turn the camera's job is the fight: the run of attacks
   * being shown is the thing the player pressed the button to catch up with,
   * and taking them home to their own ground instead would be showing them the
   * one part of the planet nothing is happening on. On their own turn, and in
   * the gaps where an AI has nothing in flight, home is the answer.
   *
   * Both are `force`d, because "you can already see a corner of it" is not an
   * answer to somebody who pressed a button asking to be taken there.
   */
  function autoFollowAim() {
    // A replay is following something of its own — the step the track is
    // standing on — and the live board underneath it is not what is being
    // watched. Same aim `showReplayStep` would have taken, so a press catches
    // up with the replay rather than landing somewhere it never went.
    if (replayOpen) {
      return replayStep > 0
        && focusFights(replay.attacks.slice(replayStep - 1), { force: true });
    }
    if (game.currentPlayer() !== humanPlayerId && aiFights.length > 0) {
      if (focusFights(aiFights, { force: true })) return true;
    }
    showBody(homeBody());
    return cameraFocus.lookAtHoldings(ownGround(), { force: true });
  }

  function refreshAutoFollow() {
    hud.showAutoFollow({ freed: cameraFreed, isOver: game.isOver(), replayOpen });
  }

  // One per world, and the press goes to whichever is on screen. Nothing else
  // could be right: only one mesh is in the scene, so only one of them can
  // ever be hit by a ray.
  const pickers = new Map(
    [...boards].map(([body, board]) => [
      body,
      createTerritoryPicker({
        planetMesh: board.surface.mesh,
        camera: viewer.camera,
        faceCellIds: board.surface.faceCellIds,
        cellTerritory: board.world.cellTerritory,
      }),
    ])
  );
  const pickTerritoryAt = (ndc) => pickers.get(shownBody)(ndc);

  let roll = null; // the attack being animated
  let reinforceAnim = null; // the end-of-turn payout being animated
  // not stored in a save: the board itself says whether you still hold ground
  let humanEliminated = !isPlayerAlive(game.state, humanPlayerId);
  let lastOutcome = null; // so closing the replay can bring the banner back
  // The one-off prompt for somebody who has never played. It has done its job
  // the moment either happens: they dismiss it, or they attack — having just
  // done the thing it describes, being told again next game would be noise.
  let hintSeen = attackHintSeen;
  let pendingReplayStep = null; // a board waiting for the camera to arrive before it shows
  let replayFight = null; // the fight the replay is stopped on, throbbing as a live one does
  let replayRoll = null; // the attack a replay step is throwing dice for
  let thrownDice = null; // {from, to} of a throw whose stacks are still on the ground
  let pressed = null; // the territory a finger is down on, marked while it is
  // Whether the player has taken the camera off the match by turning the
  // planet themselves — see `freeCamera`. Nothing automatic moves it while
  // this is true, and the offer to hand it back is up for exactly that long.
  let cameraFreed = false;
  // The run of attacks the turn being shown is working through — kept only so
  // a press mid-AI-turn has the fight to aim at rather than the player's own
  // ground. Emptied when the turn ends.
  let aiFights = [];
  let replayStep = 0; // where the track is standing, so a step forward can be told from a scrub
  // The two things that take the match out of the player's hands. Nothing in
  // it moves while either is true — see tick() at the bottom.
  let replayOpen = false;
  let bannerHolding = false;

  // Repaints the planet as the replay's own board at `step` — surface, dice,
  // the stats row, the battle readout and its history all drawn from the
  // reconstructed board and the attacks that got it there, exactly as they
  // stood at that point in the match rather than as the match eventually
  // finished. `entry` is that step's own attack, so the readout shows it the
  // same way it shows the last fight during live play; the history behind it
  // is truncated to `step` for the same reason — opening it from partway
  // through the track should not spoil what the track hasn't reached yet.
  function applyReplayStep(step, entry, nodes, { animate = false } = {}) {
    const atEnd = step >= replay.attacks.length;
    const players = replay.playersAt(step);

    // A step reached by playing forward throws its dice before showing what
    // they did, so the board this paints is the one *before* the attack —
    // the stacks are still standing where they are about to be thrown from.
    // Everything else about the step is drawn now either way: the readout
    // holds its faces back (`revealed: false`) exactly as live play does, and
    // the stats and history belong to the step being arrived at, not the one
    // being left.
    const rolling = animate && entry;
    const board = rolling ? replay.boardAt(step - 1) : nodes;
    // The board a replay draws is a board mid-match, so the fight it stopped
    // on is marked the way a live one is — attacker held dark, defender
    // glowing. Without it the readout names a pair of territories that the
    // planet gives no way of finding, on a board where nothing is moving to
    // point at them. It throbs from here on out (see tick), so a step that
    // took a camera swing to reach isn't a still frame when it lands.
    replayFight = entry ? { entry, nodes: board, elapsed: 0 } : null;
    paintReplayBoard(board, entry, pulseAt(0));
    settleThrownDice(board);
    eachBoard((b) => {
      b.dice.update({ nodes: board });
      b.poles.settle({ nodes: board });
    });

    if (rolling) startReplayRoll(entry, nodes);

    hud.showPlayers(playerStatsFor(
      { nodes, players, phase: 'gameover', winner: atEnd ? game.state.winner : null },
      playerIds
    ));
    hud.showBattle(entry, rolling ? { revealed: false } : undefined);
    hud.setHistory(replay.historyAt(step));
  }

  /**
   * Throws this step's dice across the two territories, the way live play
   * does, and remembers the board to land on when they stop.
   *
   * A replay entry is a battle *log* entry rather than the attack event the
   * animation was written for, so the faces come out of it by hand — they are
   * the same numbers under a different pair of names.
   */
  function startReplayRoll(entry, nodes) {
    replayRoll = {
      elapsed: 0,
      entry,
      nodes,
      animation: createRollAnimation({
        attackerStand: standFor(entry.from),
        defenderStand: standFor(entry.to),
        event: { attackRolls: entry.attacker.rolls, defendRolls: entry.defender.rolls },
        dieSize: boardOf(entry.to).dice.dieSize,
        timing: REPLAY_TIMING,
      }),
    };
    thrownDice = { from: entry.from, to: entry.to };
  }

  /** The board the throw was for, once the dice have stopped on it. */
  function landReplayRoll({ entry, nodes }) {
    settleThrownDice(nodes);
    eachBoard((b) => {
      b.dice.update({ nodes });
      b.poles.settle({ nodes });
    });
    if (replayFight) replayFight.nodes = nodes;
    hud.showBattle(entry); // the faces, now that they have actually landed
  }

  /**
   * Stands a thrown pair of stacks back up against whatever board is about to
   * be drawn — on the step the throw was for, or on some other step entirely
   * if the track moved on before the dice landed.
   *
   * `dice.update` cannot do this on its own: it rebuilds a stack only when
   * its *count* changes, and a defender that is taken with exactly as many
   * dice as it was holding keeps its count while every one of its dice is
   * lying scattered on the ground. `reroll` rebuilds regardless, which is why
   * live play calls it by hand for both sides of an attack too.
   */
  function settleThrownDice(nodes) {
    if (!thrownDice) return;
    const { from, to } = thrownDice;
    thrownDice = null;
    boardOf(from).dice.reroll(from, { nodes });
    boardOf(to).dice.reroll(to, { nodes });
  }

  // The planet as some replay step left it, with that step's fight marked.
  // Only the surface — dice, stats and the readout have nothing per-frame in
  // them, so they are drawn once by `applyReplayStep` and left alone.
  function paintReplayBoard(nodes, entry, pulse) {
    const marks = highlightsFor({
      attack: entry && { from: entry.from, to: entry.to },
      pulse,
      ports: world.spaceports ?? [],
    });
    eachBoard((b) => b.surface.refresh({ nodes }, (id) => marks.get(id) ?? null));
  }

  // Live play shows an attack's result while the camera is still swinging to
  // it, because the dice landing *is* the event — arriving late to a roll
  // already in progress is the whole point of the swing existing at all. A
  // replay has no such event to catch up to: the board only ever changes
  // because the track moved, so revealing it before the camera has actually
  // arrived just looks like the planet changed for no reason. So here, and
  // only here, the swing runs first and the board waits for it.
  function showReplayStep(step, { moveCamera = true } = {}) {
    const nodes = replay.boardAt(step);
    const entry = step > 0 ? replay.attacks[step - 1] : null;
    // Only a step *forward* throws dice. Playing and the › button both move
    // one at a time and are worth watching; dragging the track is a scrub
    // through dozens of steps and animating each one would be a mess, and
    // stepping back is arriving at a board rather than watching it happen.
    const animate = step === replayStep + 1;

    replayStep = step;
    replayRoll = null; // this seek supersedes whatever was still in the air
    pendingReplayStep = null; // and whatever was still waiting on the camera

    // Looks ahead through every attack still to come, not just this one, so
    // a run of nearby fights gets one swing instead of several — the replay
    // order is never reordered (unlike a live AI turn), only clustered.
    //
    // `moveCamera` is off for a step passed through mid-scrub, and `cameraFreed`
    // for a viewer who has dragged the planet to watch one corner of it while
    // the track runs. Both leave the board to repaint on the spot: it is only
    // the *swing* that is suppressed, and skipping it skips the wait for it
    // too, which is what makes a scrub keep up with the hand doing it.
    if (moveCamera && !cameraFreed && entry && focusFights(replay.attacks.slice(step - 1))) {
      pendingReplayStep = { step, entry, nodes, animate };
      return; // applied once the swing lands, in tick() below
    }

    applyReplayStep(step, entry, nodes, { animate });
  }

  /**
   * Brings the live board to a settled moment: a throw still in the air, or a
   * payout still dropping, is finished on the spot.
   *
   * Nothing is skipped — a long enough tick runs the countdown out and the
   * game emits exactly what it was about to emit anyway, so the handlers clear
   * `roll` and `reinforceAnim` themselves, the dice are stood back up, and the
   * save that follows is of a whole move rather than half of one. Only one of
   * the two can ever be outstanding — a turn cannot end while an attack is
   * pending — so a single tick is the whole of it.
   *
   * None of it is seen: the replay paints its own opening board over the top
   * in the same breath. It is about what there is to come back to.
   */
  function settleLiveBoard() {
    if (game.isBusy()) game.tick(SETTLE_STEP);
  }

  function openReplay() {
    // Now reachable mid-match, not only from a banner over a finished one, so
    // there may still be a move in flight to put down first.
    settleLiveBoard();
    replayOpen = true;
    // Opening or closing a replay is arriving at a view rather than keeping
    // one: there is one planet and two things that drive it, and whichever has
    // just been handed it starts out driving. The offer is about the camera
    // you are looking through now, not the one you were looking through a
    // moment ago.
    cameraFreed = false;
    refreshAutoFollow(); // and in here it sits in the card, not the controls
    hud.hideOutcome();
    hud.showReplay(replay.attacks.length, { standings: replay.standings(playerIds) });
  }

  function closeReplay() {
    replayOpen = false;
    cameraFreed = false; // see openReplay
    hud.hideReplay();
    pendingReplayStep = null;
    replayFight = null;
    replayRoll = null;
    replayStep = 0;
    settleThrownDice(game.state.nodes);
    cameraFocus.cancel();
    // the replay has been drawing straight into the surface, dice, stats and
    // the battle readout; put the real, finished match back before the
    // banner returns
    eachBoard((b) => {
      b.dice.update(game.state);
      b.poles.settle(game.state);
    });
    refreshBoard();
    hud.showBattle(battles.latestBattle);
    hud.setHistory(battles.entries);
    // Only a match that actually ended has a banner to go back to. Opened from
    // the controls row instead — knocked out, or playing on past a surrender —
    // there is nothing to restore, and the game simply picks up where it was
    // paused.
    if (lastOutcome) hud.showOutcome(lastOutcome);
  }

  // What it would take to rebuild this match: the planet as the number it grew
  // from, and everything about the game that no amount of regrowing recovers.
  function snapshot() {
    return gameSave({
      seed,
      settings,
      humanPlayerId,
      world,
      state: serializeState(game.state),
      replay: serializeReplay(replay),
      round: game.round,
      playedOn: game.playedOn,
      surrenderOffered: game.surrenderOffered,
      camera: cameraSnapshot(viewer.camera),
    });
  }

  function hintDone() {
    if (hintSeen) return;
    hintSeen = true;
    onAttackHintSeen?.();
  }

  /**
   * A banner over a match that is **still running** — knocked out, or handed
   * the win because everyone else gave up — and the match held behind it until
   * it is answered.
   *
   * Holding is the whole point. Without it the AIs went on taking turns behind
   * the banner: you were told you were out while the planet carried on being
   * carved up underneath, and dismissing it dropped you into a board several
   * turns past the one the banner went up over. Both of these are questions,
   * and a question that goes stale while it is being asked is worse than not
   * asking it.
   *
   * Both moments are already settled ones — a knockout is emitted after the
   * attack has been applied, a surrender is judged at the end of a turn — so
   * unlike the replay there is never a move in mid-air to put down first.
   *
   * The banner covers the whole HUD, so answering it is the only way out and
   * the hold cannot be stranded: every action releases it.
   */
  function interrupt(outcome) {
    bannerHolding = true;
    hud.showOutcome(outcome);
  }

  // The banner a finished match ends on. In one place because it goes up
  // twice: when the game is won, and when a save of a game already won is
  // opened again. No hold: there is nothing left to play.
  function showEnding(winner) {
    lastOutcome = { kind: 'over', winner, humanPlayerId, canReplay: replay.attacks.length > 0 };
    hud.showOutcome(lastOutcome);
  }

  function refreshBoard(pulse = 1) {
    const marks = highlightsFor({
      selection: game.selection,
      targets: game.legalTargets(),
      attack: roll?.event ?? null,
      pressed,
      pulse,
      // Where the moon's door is: on the ports all match long, and brighter on
      // the pair the gate is joining right now. Both boards are painted, so
      // the link is marked at whichever end is being looked at.
      ports: world.spaceports ?? [],
      gate: game.gate,
    });
    eachBoard((b) => b.surface.refresh(game.state, (id) => marks.get(id) ?? null));
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
    hud.showOrbit({
      gate: game.gate,
      shown: shownBody,
      // whose port the moon is over, so the dial can say whether the window
      // that is open is anybody's to use
      portName: game.gate?.open
        ? playerNames.get(game.state.nodes.get(game.gate.port)?.owner) ?? null
        : null,
      replayOpen,
    });
    hud.showHint({
      seen: hintSeen,
      humanPlayerId, // the panel names the color you are, so it has to know
      isHumanTurn: game.isHumanTurn(),
      isOver: game.isOver(),
      humanEliminated,
    });
  }

  game.on('attack', ({ event, timing, upcoming }) => {
    // the dice are known already, but they belong on the planet first — show
    // the readout with blank faces so it fills in as the roll lands
    hud.showBattle(battleEntry(event), { revealed: false });

    // The AI attacks wherever it likes, including round the back of the
    // planet. Its own fights are the ones worth turning for — the player's
    // are on screen by definition, since they just clicked them. `upcoming`
    // is this attack plus whatever's already queued behind it this turn, so
    // a run of nearby attacks gets one swing instead of one each.
    // ...unless the player has taken the camera. Somebody who dragged round to
    // study the board asked for the planet to stay where they put it, and the
    // fights they are missing are the price of that until they say otherwise.
    if (game.currentPlayer() !== humanPlayerId) {
      aiFights = upcoming; // and where a press would take them, if the camera is theirs
      if (!cameraFreed) focusFights(upcoming);
    } else {
      hintDone(); // they have just done the thing the prompt describes
      // The player's own fights are on screen by definition — except one. An
      // attack across the gate lands on the world they are *not* looking at,
      // and watching a stack leave without ever seeing where it went is the
      // one case where following their own attack is worth doing.
      if (bodyOf(event.to) !== shownBody) showBody(bodyOf(event.to));
    }

    roll = {
      event,
      elapsed: 0,
      animation: createRollAnimation({
        attackerStand: standFor(event.from),
        defenderStand: standFor(event.to),
        event,
        dieSize: boardOf(event.to).dice.dieSize,
        timing,
      }),
    };
  });

  game.on('resolved', (state) => {
    const { event } = roll;
    roll = null;
    hud.showBattle(battles.record(event));
    hud.setHistory(battles.entries);
    replay.record(event);
    // both stacks are still lying on the faces they rolled; stand them back up
    boardOf(event.from).dice.reroll(event.from, state);
    boardOf(event.to).dice.reroll(event.to, state);
  });

  game.on('reinforce', (event) => {
    replay.recordReinforcement(event);
    if (event.passed) {
      battles.record({ type: 'passed', playerId: event.playerId });
      hud.setHistory(battles.entries);
    }
    // Deliberately no cameraFocus.lookAt here: reinforcement dice land on
    // whichever territories they land on, all over the planet, and the drop
    // is fast enough that swinging the camera to chase it would take longer
    // than the animation it's chasing. It reads fine off-screen.
    hud.showReinforce({ playerId: event.playerId, count: event.landed.length });
    reinforceAnim = {
      elapsed: 0,
      dropped: 0, // how many of the HUD's chips have been told their die has landed
      animation: createReinforceAnimation({ landed: event.landed, dice: diceAcrossBodies }),
    };
  });

  game.on('endTurn', (event) => {
    aiFights = []; // the run this turn was showing is over
    // The payout has landed — `change` is about to rebuild every stack it
    // touched, so the dice animated here have nothing left to do.
    reinforceAnim = null;
    hud.hideReinforce();

    // Handing the planet over: the AI attacks wherever it likes, so the view
    // that suits its turn is the one with the whole planet in it. Only when
    // the player's own turn is the one ending, and only ever outwards — see
    // `framePlanet`. It has the AI's think pause plus its first aim to land
    // in, so it is over before there are dice to read.
    // Ending a turn hands the camera back. Whatever the player was studying,
    // they were studying it to decide the move they have just finished making,
    // and what comes next is a run of turns they are only watching — which is
    // the whole of what following is for. So the pull-back is unconditional
    // here.
    //
    // It is also the backstop for an offer the player simply ignored: a turn
    // played out without pressing it and without picking a territory still
    // ends with the camera back on the match.
    if (event.playerId === humanPlayerId) {
      resumeAutoFollow();
      cameraFocus.framePlanet();
    }
    // And the other side of the same handover. `endTurn` is emitted from
    // `finishReinforce`, so by here the previous player's payout has finished
    // landing and `state` has already moved on to whoever is next — which is
    // both the moment the player is actually being handed the board and the
    // first moment the camera is free to move without cutting an animation
    // short.
    else if (game.currentPlayer() === humanPlayerId) focusOwnGround();
  });

  game.on('eliminated', (event) => {
    battles.record(event);
    hud.setHistory(battles.entries);
    replay.recordElimination(event);

    // Losing your last territory used to pass without a word: the AIs simply
    // played on and nothing said why the board had stopped answering.
    if (event.playerId === humanPlayerId) {
      humanEliminated = true;
      if (!game.isOver()) {
        // Deliberately not kept as `lastOutcome`: a match that carries on
        // without you has no ending screen to be returned to, so closing a
        // replay opened from here puts you back on the board rather than
        // re-imposing a banner you have already answered.
        interrupt({
          kind: 'eliminated',
          by: event.by,
          humanPlayerId,
          canReplay: replay.attacks.length > 0,
        });
      }
    }
  });

  game.on('change', (state) => {
    eachBoard((b) => {
      b.dice.update(state);
      b.poles.settle(state); // a tower may have grown or gone at a pole
    });
    refreshBoard();
    // Every change, rather than on a timer or on the way out of the page:
    // `change` is the only moment the board moves, a pagehide handler is not
    // reliable on mobile, and the alternative is losing whatever happened
    // since the last tick. An attack still being animated is deliberately not
    // saved — the state it will land on has not been applied yet, so a reload
    // mid-roll simply un-throws those dice rather than saving half a battle.
    // A finished game is saved too rather than cleared: there is no turn left
    // to take, but the replay is in there, and reopening onto the ending is
    // how a player gets back to it.
    onSave?.(snapshot());
  });

  // Every opponent left has given up. The match is not over — the board says
  // so, and the AIs play on — but there is nothing left in it to decide, so
  // the player is offered the win now rather than the twenty turns of mopping
  // up that would otherwise stand between them and it.
  game.on('surrendered', () => {
    lastOutcome = { kind: 'surrendered', humanPlayerId, canReplay: replay.attacks.length > 0 };
    interrupt(lastOutcome);
    // Straight away rather than at the next `change`, for the same reason
    // `playOn` writes immediately: the match is now held behind the banner, so
    // there may not *be* another change until the question is answered — and
    // one of the answers is "watch the replay", which leaves the board exactly
    // where it is.
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
    bannerHolding = false;
    if (action === 'newGame') return onNewGame?.();
    if (action === 'replay') return openReplay();

    if (action === 'playOn') {
      // Refused for good, and written down straight away rather than left for
      // the next `change`: a reload in between would otherwise open on the
      // banner the player has just declined.
      game.playOn();
      lastOutcome = null;
      onSave?.(snapshot());
    }

    hud.hideOutcome(); // 'watch', 'dismiss' and 'playOn' all just get out of the way
    refreshBoard();
  });

  // A step passed through mid-drag repaints the board and leaves the camera
  // alone; the release that follows is the one the camera answers.
  hud.onReplaySeek((step, { settled = true } = {}) =>
    showReplayStep(step, { moveCamera: settled }));
  hud.onReplayClose(closeReplay);
  hud.onReplayOpen(openReplay);

  hud.onHintDismiss(() => {
    hintDone();
    refreshBoard();
  });

  // Pressed rather than played out of: the camera comes back *and* goes home,
  // so the press answers itself instead of promising something for later.
  hud.onAutoFollow(() => resumeAutoFollow({ pan: true }));

  // The dial is the only way between the two worlds, which is what lets the
  // moon in the sky be pure decoration: nothing anyone has to hit with a ray.
  hud.onOrbit(() => chooseBody(shownBody === 'planet' ? 'moon' : 'planet'));

  hud.onEndTurn(() => {
    game.endTurn();
    refreshBoard();
  });

  hud.onMenu(() => onMenu?.());

  // A game restored after it had already been won gets no `over` event —
  // nothing happens in it any more — so the ending it finished on goes back up
  // by hand, which is what makes "Watch replay" reachable after a reload.
  //
  // A surrender that was offered and never answered is the same problem one
  // step earlier, and it needs the same hand. `surrendered` is emitted at the
  // end of a turn and will not fire again — it is asked once per match — so
  // without this the player came back to an ordinary game in progress: no
  // banner, and no Replay button either, since that reads off `playedOn`. The
  // way out of the banner that made this easy to miss is "Watch replay", which
  // answers nothing and leaves the question owed.
  if (game.isOver()) showEnding(game.state.winner);
  else if (game.surrenderOffered && !game.playedOn) {
    lastOutcome = { kind: 'surrendered', humanPlayerId, canReplay: replay.attacks.length > 0 };
    interrupt(lastOutcome);
  }

  game.start();

  return {
    game,
    settings,

    /**
     * A press has landed on the planet. Answers with what letting go there
     * would do — `pressActionOn`'s `'attack'`, `'select'` or `'drop'` — or
     * `null` for a press with nothing to act on, which hands it straight to
     * the camera, so a drag that started on the ocean turns the planet from
     * its first pixel rather than after a dead zone (see `pointerArbiter.js`).
     *
     * A press worth taking is *shown*: the territory it would act on is
     * marked while the finger is still down, so releasing is a confirmation
     * rather than a guess. The one press with nothing to mark is a tap on the
     * ocean while holding a territory — it still has to be taken, since
     * letting go there is how you put that territory back down, and there is
     * nowhere to put a mark for it.
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
      // Picking a territory to attack from answers the offer: the studying is
      // over and the move is being made. Silently, and that is the whole
      // difference from the button — they are looking straight at ground they
      // just found for themselves, and moving the planet under it is the very
      // thing this exists to prevent.
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

      if (pendingReplayStep && !cameraFocus.isSwinging) {
        const { step, entry, nodes, animate } = pendingReplayStep;
        pendingReplayStep = null;
        applyReplayStep(step, entry, nodes, { animate });
      }
      if (replayRoll) {
        replayRoll.elapsed += dt;
        const beat = replayRoll.animation.apply(replayRoll.elapsed);
        if (beat.phase === 'done') {
          const landed = replayRoll;
          replayRoll = null;
          landReplayRoll(landed);
        }
      }
      if (replayFight) {
        replayFight.elapsed += dt;
        paintReplayBoard(replayFight.nodes, replayFight.entry, pulseAt(replayFight.elapsed));
      }
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
      // Held while the replay has the planet, and while a banner is up over a
      // match that is still running. Both are the same problem: letting the AI
      // take three turns behind something the player is looking at means
      // closing it drops them somewhere they never saw happen. `game.tick` is
      // the only clock in the match, so not calling it is the whole of it.
      if (!replayOpen && !bannerHolding) game.tick(dt);
    },

    dispose() {
      roll = null;
      reinforceAnim = null;
      replayFight = null;
      replayRoll = null;
      // The replay drives itself on a timer now, and that timer outlives the
      // markup `replaceChildren` is about to throw away — it would go on
      // asking this session to paint steps onto a planet that has been taken
      // out of the scene. Closing the replay is what stops it.
      hud.hideReplay();
      hud.dispose();
      cameraFocus.dispose();
      turnFlash.dispose();
      viewer.scene.remove(shown().surface.group, shown().dice.group, shown().poles.group);
      eachBoard((b) => {
        b.surface.dispose();
        b.dice.dispose();
        b.poles.dispose();
      });
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
function restoreReplay(restored, state, reserveCap) {
  if (restored?.replay) {
    try {
      return reviveReplay(restored.replay, { reserveCap });
    } catch {
      // a hand-edited or half-written save; carry on recording from here
    }
  }

  return createReplay({
    nodes: state.nodes,
    // The bank as one number per player, the same way the badge shows it —
    // see `totalReserve`. A replay tracks the total rather than the split
    // because nothing it draws has anywhere to put the split.
    reserves: new Map([...state.players].map(([id, player]) => [id, totalReserve(player)])),
    reserveCap,
  });
}

/**
 * The planet this match is played on, and the seed that grows it.
 *
 * A saved game names its seed, so the same planet comes back cell for cell —
 * but only as long as the generator itself has not changed. When the world it
 * rebuilds no longer fits the board that was saved on it, the save is dropped
 * and a fresh planet is grown: a new game is a far better outcome than a
 * board laid over territories that are not there any more.
 */
function buildWorld(settings, playerIds, saved) {
  const subdivisions = subdivisionsFor(settings);
  const grow = (seed) =>
    generateSystem({ subdivisions, playerIds, moon: settings.moon, rng: seededRng(seed) });

  if (saved) {
    const world = grow(saved.seed);
    if (saveMatchesWorld(saved, world)) return { world, seed: saved.seed, restored: saved };
  }

  const seed = randomSeed();
  return { world: grow(seed), seed, restored: null };
}
