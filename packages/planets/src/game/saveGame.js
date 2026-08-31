import { normalizeSettings } from './settings.js';

/**
 * A game in progress, written down so a reload picks it up where it was left.
 *
 * The planet is stored as the **seed it grew from**, not as its geometry: a
 * world is a deterministic function of `(seed, settings)`, so one number
 * rebuilds every cell. Everything that cannot be recomputed — owners, dice,
 * whose turn, banked dice, the moves that got there — is stored outright.
 *
 * That trade has one failure mode, and it is why `SAVE_VERSION` and
 * `worldFingerprint` exist: change the generator and the same seed grows a
 * different planet. A save is checked against the world the seed just rebuilt,
 * and a mismatch is discarded rather than laid over land that is not there.
 *
 * The `replay` travels with it, which is what lets a reload pick up a replay
 * rather than only a board — including a game already *finished*, which is
 * worth coming back to watch. The battle log is not stored beside it: the
 * history is read back out of the replay (`historyThroughStep`).
 */
export const SAVE_VERSION = 2;

const STORAGE_KEY = 'dicewars-planets:game';

/** The one shape everything below agrees on. */
export function gameSave({
  seed, settings, humanPlayerId, world, state, replay, camera, playedOn = false,
  surrenderOffered = false,
}) {
  return {
    version: SAVE_VERSION,
    seed,
    settings,
    humanPlayerId,
    world: worldFingerprint(world),
    state,
    replay,
    camera,
    // Whether a surrender has been waved away, and whether it was put to the
    // player at all. Optional rather than required, so a save written before
    // either existed means "not yet asked" instead of being refused as damaged.
    //
    // Two fields rather than one, and the second is the easy one to leave out.
    // `playedOn` is only set by *answering*, and "Watch replay" answers
    // nothing — so without `surrenderOffered` a player who took the replay
    // door and reloaded came back to a match with no record it had happened.
    playedOn,
    surrenderOffered,
  };
}

/**
 * Where the player left the camera. Orbit angle, pitch and zoom are all just
 * `camera.position`, since the controls never pan the target off the planet's
 * centre, and `camera.up` is absent for the same reason.
 *
 * Optional: a save missing it, or holding numbers a hand edit broke, leaves
 * the camera wherever the viewer starts.
 */
export function cameraSnapshot(camera) {
  const { x, y, z } = camera.position;
  return { x, y, z };
}

export function isUsableCamera(camera) {
  return Boolean(camera)
    && Number.isFinite(camera.x)
    && Number.isFinite(camera.y)
    && Number.isFinite(camera.z);
}

/**
 * A number that says which planet this is.
 *
 * Territory ids are list positions (`0`, `1`, `2`), so two entirely different
 * planets agree on every id as long as they grew the same *number* of
 * territories — comparing ids would be a check that passes exactly when it is
 * least deserved. So this hashes shape rather than names: which territories
 * touch which, and which patch of the sphere each is made of.
 *
 * FNV-1a over a few thousand short strings. It runs once on save and once on
 * restore, never in a frame.
 */
export function worldFingerprint({ playerIds, nodeIds, edges, cellTerritory, oceanCellIds }) {
  let hash = 0x811c9dc5;
  const feed = (value) => {
    const text = `${value}|`;
    for (let i = 0; i < text.length; i++) {
      hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
    }
  };

  feed(playerIds.length);
  feed(nodeIds.length);
  feed(oceanCellIds?.size ?? oceanCellIds?.length ?? 0);
  for (const [a, b] of edges) feed(`${a}-${b}`);
  for (const [cellId, territoryId] of cellTerritory) feed(`${cellId}:${territoryId}`);

  return hash >>> 0;
}

function isUsable(save) {
  if (!save || save.version !== SAVE_VERSION) return false;
  if (!Number.isFinite(save.seed) || !Number.isFinite(save.world)) return false;
  if (typeof save.humanPlayerId !== 'string') return false;
  if (!save.settings || !save.state || !Array.isArray(save.state.nodes)) return false;
  // A finished game is kept, unlike every earlier version of this: there is
  // nothing left to play, but the replay of what was played is right here and
  // reopening onto the ending it produced is the way back to it.
  return isUsableReplay(save.replay);
}

/**
 * Shape only — enough that `reviveReplay` is being handed the kind of thing
 * it decodes, not a promise that every move in it makes sense. A save with a
 * broken replay is still a game worth resuming; that call is `session.js`'s,
 * and it makes it by catching rather than by trusting this.
 */
function isUsableReplay(replay) {
  if (!replay) return false;
  return Array.isArray(replay.nodes)
    && Array.isArray(replay.reserves)
    && Array.isArray(replay.moves);
}

/**
 * The saved game, or null if there is not a usable one.
 *
 * Settings come back normalized: reading a save is one of the edges settings
 * are parsed at, and a save written before an option changed its range must
 * not hand a stale value to a pipeline that trusts what it is given.
 *
 * localStorage throws in private browsing on some engines, is missing outside
 * a browser, and a hand-edited entry parses to anything at all — none of which
 * is a reason for the game not to start.
 */
export function readSavedGame(storage) {
  try {
    const stored = storage?.getItem(STORAGE_KEY);
    if (!stored) return null;

    const save = JSON.parse(stored);
    if (!isUsable(save)) return null;
    return { ...save, settings: normalizeSettings(save.settings) };
  } catch {
    return null;
  }
}

export function writeSavedGame(storage, save) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(save));
    return true;
  } catch {
    // out of quota, or a private window that refuses to store anything: the
    // game carries on, it just will not survive being closed
    return false;
  }
}

export function clearSavedGame(storage) {
  try {
    storage?.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether this save's board actually belongs on this world.
 *
 * This is the whole safety net behind storing a seed instead of a planet, and
 * it is checked against the world the seed just rebuilt — not against the one
 * the save remembers, which is exactly the thing in doubt.
 */
export function saveMatchesWorld(save, world) {
  if (save.world !== worldFingerprint(world)) return false;
  if (!world.playerIds.includes(save.humanPlayerId)) return false;

  // the seats too: the fingerprint says which planet, not who is playing on it
  return save.state.turnOrder.length === world.playerIds.length
    && save.state.turnOrder.every((id) => world.playerIds.includes(id));
}
