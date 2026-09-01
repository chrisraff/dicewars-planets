import * as THREE from 'three';
import { createViewer } from './render/createViewer.js';
import { createDiePipMaterials } from './render/diceTextures.js';
import { createMenu } from './render/menu.js';
import { createExplainer } from './render/explainer.js';
import { createSession } from './game/session.js';
import { createSelectHandler } from './render/selectPress.js';
import { resolveSettings, writeStoredSettings, settingsToQuery } from './game/settings.js';
import { readSavedGame, writeSavedGame } from './game/saveGame.js';
import { ATTACK_HINT, markHintSeen, readSeenHints } from './game/hints.js';

const canvas = document.getElementById('planet-canvas');
const hudRoot = document.getElementById('hud');
const menuRoot = document.getElementById('menu');
const explainerRoot = document.getElementById('explainer');

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

// Over the menu rather than instead of it, so backing out of the explainer
// lands on the menu the player opened it from — and the match, if there is
// one, is still sitting behind that. Nothing else needs saying about the
// pause: the loop already stops the game while the menu is open, and the menu
// is still open underneath this.
const explainer = createExplainer(explainerRoot, { onClose: () => explainer.hide() });

const menu = createMenu(menuRoot, {
  onStart: (settings) => startGame(settings),
  onResume: () => menu.hide(),
  // a saved game brings its own setup with it — the settings on the menu are
  // for the new game the player did not ask for
  onContinue: () => startGame(savedGame.settings, savedGame),
  onExplain: () => explainer.show(),
});

// Skip the menu if there is a game to pick back up — one in progress, or one
// already won, which opens back onto the ending it finished on.
if (savedGame) {
  startGame(savedGame.settings, savedGame);
} else {
  menu.show(resolveSettings({ search: location.search, storage: window.localStorage }));
}

// --- input ----------------------------------------------------------------

// Every press on the planet goes to one of these two, and this is the whole
// of the order: tapping a territory gets first refusal, and turning the
// planet takes whatever it hands on. See `pointerArbiter.js` — the half worth
// knowing is that a press is *owned* while it is still down, so the board can
// show what letting go would do while there is still time to drag away
// instead.
//
// Calling off an attack is not a third entry here. It is another thing a tap
// can mean, so `select` asks it first — see `selectPress.js`, which explains
// why a handler in front of it would stop selection working entirely.
viewer.pointers.register('select', createSelectHandler(canvas, () => session, {
  blocked: () => menu.isOpen(),
}));
viewer.pointers.register('orbit', viewer.orbitHandler);

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
