import * as THREE from 'three';
import { createViewer } from './render/createViewer.js';
import { createDiePipMaterials } from './render/diceTextures.js';
import { createMenu } from './render/menu.js';
import { createSession } from './game/session.js';
import { pointerToNdc } from './render/pickTerritory.js';
import { resolveSettings, writeStoredSettings, settingsToQuery } from './game/settings.js';

const canvas = document.getElementById('planet-canvas');
const hudRoot = document.getElementById('hud');
const menuRoot = document.getElementById('menu');

// These outlive any one game: the renderer and camera keep the planet where
// the player left it, and the pip textures are generated once at startup.
const viewer = createViewer(canvas);
const pipMaterials = createDiePipMaterials();

let session = null;

function startGame(settings) {
  session?.dispose();
  session = createSession({
    viewer,
    hudRoot,
    pipMaterials,
    settings,
    onMenu: () => menu.show(session.settings, { canResume: true }),
    onNewGame: () => menu.show(session.settings, { canResume: true }),
  });

  writeStoredSettings(window.localStorage, settings);
  // so a reload, or a shared link, opens the same setup
  history.replaceState(null, '', `${location.pathname}${settingsToQuery(settings)}`);

  menu.hide();
}

const menu = createMenu(menuRoot, {
  onStart: startGame,
  onResume: () => menu.hide(),
});

menu.show(resolveSettings({ search: location.search, storage: window.localStorage }));

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
