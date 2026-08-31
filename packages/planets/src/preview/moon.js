import { randomSeed, seededRng } from '@dicewars/core';
import { createViewer } from '../render/createViewer.js';
import { createPlanetSurface } from '../render/planetSurface.js';
import { createDiceLayer } from '../render/diceLayer.js';
import { createDiePipMaterials } from '../render/diceTextures.js';
import { assignPlayerColors, CHANNEL_COLOR } from '../render/palette.js';
import { highlightsFor } from '../render/highlights.js';
import { createHud } from '../render/hud.js';
import { generateMoonWorld, MOON_TUNING } from '../world/generateMoon.js';
import { gateView, orbitAt, ORBIT_STOPS } from '../game/orbit.js';

const scenarios = document.getElementById('scenarios');
const PLAYERS = ['p1', 'p2', 'p3'];
const pipMaterials = createDiePipMaterials();

// The moon as core would be handed it: every territory unclaimed, holding the
// dice the generator dealt it.
const stateOf = (world) => ({
  nodes: new Map(
    world.assignments.map(([id, { owner, dice }]) => [id, { owner, dice, body: 'moon' }])
  ),
});

/**
 * One live moon, turning on its own spin axis until somebody grabs it.
 *
 * The real surface, the real dice layer and the real palette, because what is
 * being judged is whether a channel reads as a trench and whether unclaimed
 * ground reads as unclaimed — and neither is a question a diagram of the cell
 * graph can answer. It turns about Y rather than about nothing in particular
 * because that *is* the spin axis: what goes past the front of the screen is
 * exactly the band that goes past the planet.
 */
function addMoon(host, { spin = 0.15 } = {}) {
  const canvas = document.createElement('canvas');
  host.append(canvas);

  const viewer = createViewer(canvas);
  const colors = assignPlayerColors(PLAYERS);
  let surface = null;
  let dice = null;
  let held = false;
  viewer.controls.addEventListener('start', () => { held = true; });

  function show(world, { gate = null } = {}) {
    if (surface) {
      viewer.scene.remove(surface.group, dice.group);
      surface.dispose?.();
      dice.dispose?.();
    }
    surface = createPlanetSurface(world, colors, { emptyColor: CHANNEL_COLOR });
    dice = createDiceLayer(world, pipMaterials);
    viewer.scene.add(surface.group, dice.group);

    const state = stateOf(world);
    const marks = highlightsFor({ gate });
    surface.refresh(state, (id) => marks.get(id) ?? null);
    dice.update(state);
  }

  let last = performance.now();
  (function frame(now = performance.now()) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!held && surface) {
      surface.group.rotation.y += spin * dt;
      dice.group.rotation.y += spin * dt;
    }
    viewer.render();
    requestAnimationFrame(frame);
  })();

  return { show };
}

const diceOf = (world) => new Map(world.assignments.map(([id, a]) => [id, a.dice]));

/** The moon at a seed, with what it dealt written out beside it. */
function addCarve() {
  const section = document.createElement('section');
  section.className = 'scenario';
  section.innerHTML = `
    <h2>What the spin presents</h2>
    <p>The band runs round the middle and is the only ground that ever turns to face
       the planet, so it is priced for a player who is losing — a four-stack takes a
       landing, whichever of the six is showing. The caps sit behind a channel at
       either pole, hold five and eight, and are the same distance from every dock:
       wherever you land, the prize is equally far. The pale territory is whichever
       one the gate is on this round.</p>
    <div class="stage is-planet"></div>
    <pre class="menu-readout"></pre>
    <div class="controls"></div>`;
  scenarios.append(section);

  const moon = addMoon(section.querySelector('.stage'));
  const readout = section.querySelector('.menu-readout');

  function deal(seed) {
    const world = generateMoonWorld({ rng: seededRng(seed) });
    const orbit = { ports: ['portA', 'portB'], dockOrder: world.dockOrder, stops: ORBIT_STOPS };
    const gate = gateView(orbit, 0);
    moon.show(world, { gate });

    const dice = diceOf(world);
    const water = (world.channelCellIds.size / world.cells.length) * 100;
    const band = world.bandTerritoryIds.map((id) => dice.get(id));
    const caps = world.capTerritoryIds.map((id) => dice.get(id));
    readout.textContent =
      `seed ${seed}\n`
      + `band  ${band.join(' ')}   (the six the spin shows, in order)\n`
      + `caps  ${caps.join(' ')}       (north pair, then south)\n`
      + `channels ${water.toFixed(0)}% of the moon, `
      + `${world.lakeCellIds.size} lake${world.lakeCellIds.size === 1 ? '' : 's'}\n`
      + `docked at ${gate.dock}`;
  }

  const button = document.createElement('button');
  button.textContent = 'Carve another moon';
  button.addEventListener('click', () => deal(randomSeed()));
  section.querySelector('.controls').append(button);

  deal(4242);
}

/**
 * The dial in every state it has, side by side.
 *
 * It is the one control that has to be readable at a glance mid-turn, and the
 * question it answers — "when is my window" — is about a stop the moon has not
 * reached yet, so the states only mean anything laid out next to each other.
 */
function addDial() {
  const section = document.createElement('section');
  section.className = 'scenario';
  section.innerHTML = `
    <h2>The dial at every stop</h2>
    <p>Where the moon is and the way across to it, in one control. A filled tick is a
       stop that opens a door and a hollow one is a stop over open space; the ring is
       wherever the moon has got to. Reading the next window off it is then a matter of
       looking rather than of being told, which is the whole reason the orbit is a
       published timetable rather than something that moves when it feels like it.</p>
    <div class="controls"></div>
    <pre class="menu-readout"></pre>`;
  scenarios.append(section);

  const world = generateMoonWorld({ rng: seededRng(4242) });
  const orbit = { ports: ['portA', 'portB'], dockOrder: world.dockOrder, stops: ORBIT_STOPS };
  const host = section.querySelector('.controls');
  const lines = [];

  // A whole HUD per state, because the dial is a piece of the real one rather
  // than a drawing of it — a preview that can drift from the game is worse
  // than none, and that is worth the empty readout and the spare buttons that
  // come with it. Which is also why there are four of these and not twelve:
  // four covers every state the dial has, and the twelve-stop cycle is a fact
  // about the *pairing*, which the table below says in words.
  for (let round = 0; round < ORBIT_STOPS; round++) {
    const at = orbitAt(orbit, round);
    const cell = document.createElement('div');
    host.append(cell);
    const hud = createHud(cell, { playerColors: assignPlayerColors(PLAYERS) });
    hud.showOrbit({
      gate: gateView(orbit, round),
      shown: 'planet',
      portName: at.open ? (at.port === 'portA' ? 'Red' : 'Blue') : null,
    });
  }

  // The table runs the whole cycle even though only four dials are drawn: what
  // takes twelve stops to come back round is the *pairing* of a port with a
  // moon territory, and that is a thing to read rather than to look at.
  for (let round = 0; round < ORBIT_STOPS * 3; round++) {
    const at = orbitAt(orbit, round);
    lines.push(
      `round ${String(round).padStart(2)}  stop ${at.stop}  `
      + `${at.open ? `${at.port === 'portA' ? 'Red' : 'Blue'}'s port` : 'open space  '}`
      + `   facing ${at.dock}`
    );
  }

  section.querySelector('.menu-readout').textContent =
    `${lines.join('\n')}\n\n`
    + `Six band territories against ${ORBIT_STOPS} stops, so the pairing takes twelve\n`
    + 'stops to come back round — long enough not to read as a metronome.';
}

/** How often the generator produces a moon worth playing on, over many of them. */
function addDistribution() {
  const section = document.createElement('section');
  section.className = 'scenario';
  section.innerHTML = `
    <h2>Over many moons</h2>
    <p>The three properties the mode rests on, counted rather than argued about: nothing
       a losing player cannot afford ever turns to face the planet, the band is a complete
       ring so the dock can step round it, and no territory is ever cut off from the rest.
       The last of those is repaired rather than rejected — a way through is dug where a
       gap landed badly, which is why it holds every time instead of most of the time.</p>
    <pre class="menu-readout"></pre>`;
  scenarios.append(section);
  const readout = section.querySelector('.menu-readout');
  readout.textContent = 'carving…';

  const stats = { moons: 0, worstDock: 0, ringBroken: 0, adjacency: [], water: [] };

  function batch(from) {
    for (let seed = from; seed < from + 25; seed++) {
      const world = generateMoonWorld({ rng: seededRng(seed * 7919 + 3) });
      const dice = diceOf(world);
      stats.moons++;
      for (const id of world.dockOrder) {
        stats.worstDock = Math.max(stats.worstDock, dice.get(id));
      }

      const adjacency = new Map(world.nodeIds.map((id) => [id, new Set()]));
      for (const [a, b] of world.edges) {
        adjacency.get(a).add(b);
        adjacency.get(b).add(a);
      }
      const ring = world.dockOrder.every(
        (id, i) => adjacency.get(id).has(world.dockOrder[(i + 1) % world.dockOrder.length])
      );
      if (!ring) stats.ringBroken++;
      stats.adjacency.push(world.edges.length * 2 / world.nodeIds.length);
      stats.water.push(world.channelCellIds.size / world.cells.length);
    }

    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    readout.textContent =
      `${stats.moons} moons\n`
      + `worst garrison the spin ever presented: ${stats.worstDock} `
      + `(the band is dealt ${MOON_TUNING.bandDice.join('–')})\n`
      + `band rings broken: ${stats.ringBroken}\n`
      + `mean territory adjacency: ${mean(stats.adjacency).toFixed(2)} `
      + '(a planet is about 4.5 — the moon is chokepoints)\n'
      + `channels: ${(mean(stats.water) * 100).toFixed(0)}% of the cells`;

    if (stats.moons < 300) requestAnimationFrame(() => batch(from + 25));
  }

  batch(1);
}

addCarve();
addDial();
addDistribution();
