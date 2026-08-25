import * as THREE from 'three';
import { createViewer } from './render/createViewer.js';
import { createDiePipMaterials } from './render/diceTextures.js';
import { createMenu } from './render/menu.js';
import { createSession } from './game/session.js';
import { pointerToNdc } from './render/pickTerritory.js';
import { resolveSettings, writeStoredSettings, settingsToQuery } from './game/settings.js';
import { readSavedGame, writeSavedGame } from './game/saveGame.js';
import { ATTACK_HINT, markHintSeen, readSeenHints } from './game/hints.js';

const canvas = document.getElementById('planet-canvas');
const hudRoot = document.getElementById('hud');
const menuRoot = document.getElementById('menu');

// These outlive any one game: the renderer and camera keep the planet where
// the player left it, and the pip textures are generated once at startup.
const viewer = createViewer(canvas);
const pipMaterials = createDiePipMaterials();

let session = null;
// Whether this player has already been shown how to attack. Held here rather
// than re-read per game, so dismissing it in one match settles it for the next
// one too — the write is only there to settle it for the next *visit*.
let attackHintSeen = readSeenHints(window.localStorage).has(ATTACK_HINT);

function startGame(settings, saved = null) {
  session?.dispose();
  session = createSession({
    viewer,
    hudRoot,
    pipMaterials,
    settings,
    saved,
    attackHintSeen,
    // the session decides what is worth keeping; this is the only place that
    // knows where it goes. Nothing here clears it: a finished game is kept for
    // its replay, and starting the next one overwrites it on the first move.
    onSave: (save) => writeSavedGame(window.localStorage, save),
    onAttackHintSeen: () => {
      attackHintSeen = true;
      markHintSeen(window.localStorage, ATTACK_HINT);
    },
    onMenu: () => menu.show(session.settings, { canResume: true }),
    onNewGame: () => menu.show(session.settings, { canResume: true }),
  });

  writeStoredSettings(window.localStorage, settings);
  // so a reload, or a shared link, opens the same setup
  history.replaceState(null, '', `${location.pathname}${settingsToQuery(settings)}`);

  menu.hide();
}

// Read once, before anything can overwrite it: the moment a game starts, the
// save becomes that game's. This is the only chance to pick up the last one.
const savedGame = readSavedGame(window.localStorage);

const menu = createMenu(menuRoot, {
  onStart: (settings) => startGame(settings),
  onResume: () => menu.hide(),
  // a saved game brings its own setup with it — the settings on the menu are
  // for the new game the player did not ask for
  onContinue: () => startGame(savedGame.settings, savedGame),
});

// Skip the menu if there is a game to pick back up — one in progress, or one
// already won, which opens back onto the ending it finished on.
if (savedGame) {
  startGame(savedGame.settings, savedGame);
} else {
  menu.show(resolveSettings({ search: location.search, storage: window.localStorage }));
}

// --- input ----------------------------------------------------------------

// A click is a press and release in roughly the same spot — anything further
// than that was someone orbiting the planet, and must not also select a
// territory just because the drag happened to end over one. A finger wanders
// much further than a mouse does while still meaning "tap".
const DRAG_SLOP = { mouse: 5, pen: 6, touch: 14 }; // pixels
let pressedAt = null;

canvas.addEventListener('pointerdown', (e) => {
  pressedAt = { x: e.clientX, y: e.clientY, slop: DRAG_SLOP[e.pointerType] ?? DRAG_SLOP.mouse };
});
canvas.addEventListener('pointercancel', () => {
  pressedAt = null;
});
canvas.addEventListener('pointerup', (e) => {
  if (!pressedAt) return;
  const moved = Math.hypot(e.clientX - pressedAt.x, e.clientY - pressedAt.y);
  const { slop } = pressedAt;
  pressedAt = null;

  if (moved > slop || !session || menu.isOpen()) return;
  session.clickAt(pointerToNdc(e.clientX, e.clientY, canvas.getBoundingClientRect()));
});

// --- the loop -------------------------------------------------------------

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1); // a backgrounded tab shouldn't fast-forward

  // the planet keeps turning behind the menu, but nothing plays out on it
  if (session && !menu.isOpen()) session.tick(dt);
  viewer.render();
}
animate();
