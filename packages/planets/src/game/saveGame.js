import { normalizeSettings } from './settings.js';

/**
 * A game in progress, written down so a reload picks it up where it was left.
 *
 * The planet is stored as the seed it was grown from, not as its geometry: a
 * world is a deterministic function of `(seed, settings)`, so one number
 * rebuilds every cell, every territory and every boundary exactly. What cannot
 * be recomputed — who owns what, how many dice, whose turn, what has been
 * banked, the battles fought so far — is stored outright.
 *
 * That trade has one failure mode, and it is the reason `SAVE_VERSION` and
 * `worldFingerprint` both exist: change the world generator and the same seed
 * grows a different planet, one the saved territories were never fought over.
 * A save is checked against the world it rebuilt before it is trusted, and a
 * mismatch is a discarded save rather than a board laid over land that is not
 * there any more.
 */
export const SAVE_VERSION = 1;

const STORAGE_KEY = 'dicewars-planets:game';

/** The one shape everything below agrees on. */
export function gameSave({ seed, settings, humanPlayerId, world, state, battles, camera }) {
  return {
    version: SAVE_VERSION,
    seed,
    settings,
    humanPlayerId,
    world: worldFingerprint(world),
    state,
    battles,
    camera,
  };
}

/**
 * Where the player left the camera — orbit angle, pitch and zoom are all just
 * `camera.position`, since the controls never pan the target off the
 * planet's center. `camera.up` isn't here for the same reason: nothing in
 * this app ever rotates it away from its default.
 *
 * Older saves have no `camera` field at all, which is why this is read as
 * optional rather than required: a save missing it, or holding numbers a
 * hand edit broke, simply leaves the camera at wherever the viewer starts.
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
 * Territory ids are positions in a list — `0`, `1`, `2` — so two entirely
 * different planets agree on every id as long as they happen to have grown the
 * same number of territories. Comparing ids would be a check that passes
 * exactly when it is least deserved, so this hashes the things that actually
 * differ: which territories touch which, and which patch of the sphere each
 * one is made of.
 *
 * FNV-1a, over a few thousand short strings — it runs once when a game is
 * saved and once when one is picked up, and never in a frame.
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
  // a finished game is not a game in progress — there is nothing to continue
  return save.state.phase !== 'gameover';
}

/**
 * The saved game, or null if there is not a usable one.
 *
 * Settings come back out normalized, because reading a save is one of the
 * edges settings are parsed at: a save written before an option changed its
 * range must not hand a stale value to the rest of the pipeline, which trusts
 * what it is given.
 *
 * localStorage throws in private browsing on some engines and is missing
 * outside a browser entirely, and a half-written or hand-edited entry parses
 * to anything at all — none of which is a reason for the game not to start.
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
