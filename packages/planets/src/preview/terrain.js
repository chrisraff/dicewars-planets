import { randomSeed, seededRng } from '@dicewars/core';
import { createViewer } from '../render/createViewer.js';
import { createPlanetSurface } from '../render/planetSurface.js';
import { assignPlayerColors } from '../render/palette.js';
import { generatePlanetWorld } from '../world/generateWorld.js';
import { createGame } from '../game/createGame.js';
import { generateIcosphereCells } from '../geometry/icosphere.js';
import { carveOceans, landClustering, OCEAN_TUNING } from '../world/oceans.js';

const scenarios = document.getElementById('scenarios');
const PLAYERS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const SUBDIVISIONS = 3;

/**
 * The seeding the generator used to do: one to four basins dropped anywhere,
 * with nothing looking at what came out. Spelled out here rather than kept in
 * `OCEAN_TUNING`, because it is the *old* behaviour — something to compare
 * against on this page, not a mode the game has.
 */
const OLD_SEEDING = { minBasins: 1, maxBasins: 4, seedCandidates: 1, attempts: 1, maxLakes: 0 };

// A lake is one cell of water with land the whole way round it, which is also
// exactly how the carver decides where to put one.
function lakesOf(world) {
  return world.cells.filter(
    (cell) =>
      world.oceanCellIds.has(cell.id)
      && cell.neighbors.every((n) => !world.oceanCellIds.has(n))
  );
}

function planetFor(seed, oceanOptions) {
  const world = generatePlanetWorld({
    subdivisions: SUBDIVISIONS,
    playerIds: PLAYERS,
    rng: seededRng(seed),
    oceanOptions,
  });
  const landCellIds = new Set(
    world.cells.filter((cell) => !world.oceanCellIds.has(cell.id)).map((cell) => cell.id)
  );
  return {
    world,
    clustering: landClustering(landCellIds, world.cells),
    lakes: lakesOf(world).length,
  };
}

/**
 * One live planet, turning by itself until somebody grabs it.
 *
 * The real surface and the real viewer, because the thing being judged is
 * whether a planet looks worth playing on, and that is not a question a
 * diagram of the cell graph can answer.
 */
function addPlanet(host, { spin = 0.12 } = {}) {
  const canvas = document.createElement('canvas');
  host.append(canvas);

  const viewer = createViewer(canvas);
  let surface = null;
  let held = false;
  viewer.controls.addEventListener('start', () => { held = true; });

  function show(world) {
    if (surface) {
      viewer.scene.remove(surface.group);
      surface.dispose?.();
    }
    surface = createPlanetSurface(world, assignPlayerColors(PLAYERS));
    viewer.scene.add(surface.group);
    surface.refresh(createGame({ world, humanPlayerId: PLAYERS[0] }).state);
  }

  let last = performance.now();
  (function frame(now = performance.now()) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    // Left to itself the planet turns, so a hemisphere of ocean gives itself
    // away without anybody having to think to drag. Any touch of the controls
    // ends that for good — the same bargain the game makes with its camera.
    if (!held && surface) surface.group.rotation.y += spin * dt;
    viewer.render();
    requestAnimationFrame(frame);
  })();

  return { show };
}

/**
 * The same seed carved both ways, side by side. This is the whole argument on
 * one row: the seeding is the only thing that differs, and the planet on the
 * left is what it produced for half of every game played before this.
 */
function addComparison() {
  const section = document.createElement('section');
  section.className = 'scenario';
  section.innerHTML = `
    <h2>The same seed, carved both ways</h2>
    <p>Ocean seeds dropped anywhere on the left, placed apart on the right. One seed, one
       amount of water, one set of grouping rules — the only thing changed is where the
       water starts from. The pair it opens on is not a picked fight: the left-hand planet
       scores 0.317, which is exactly the median of what the old carver made. Deal a few
       more and watch how seldom that side has anything to sail round.</p>
    <div class="terrain-pair">
      <div><div class="stage is-planet"></div><pre class="menu-readout"></pre></div>
      <div><div class="stage is-planet"></div><pre class="menu-readout"></pre></div>
    </div>
    <div class="controls"></div>`;
  scenarios.append(section);

  const stages = [...section.querySelectorAll('.stage')];
  const readouts = [...section.querySelectorAll('.menu-readout')];
  const planets = stages.map((stage) => addPlanet(stage));

  function deal(seed) {
    [OLD_SEEDING, {}].forEach((options, i) => {
      const { world, clustering, lakes } = planetFor(seed, options);
      planets[i].show(world);
      const verdict = clustering > OCEAN_TUNING.maxClustering ? 'one cap — boring'
        : clustering < 0.2 ? 'wraps the planet' : 'wraps most of the way';
      readouts[i].textContent = `${i === 0 ? 'seeds dropped anywhere' : 'seeds placed apart'}\n`
        + `clustering ${clustering.toFixed(3)}  ${verdict}\n`
        + `${world.territories.length} territories, ${lakes} lake${lakes === 1 ? '' : 's'}`;
    });
  }

  const button = document.createElement('button');
  button.textContent = 'Deal another planet';
  button.addEventListener('click', () => deal(randomSeed()));
  section.querySelector('.controls').append(button);

  // The old carver's median planet — see the caption.
  deal(976936904);
}

/**
 * Lakes, forced on so there is always one to find. Everywhere else they are
 * an occasional thing — a little over half of planets have none.
 */
function addLakes() {
  const section = document.createElement('section');
  section.className = 'scenario';
  section.innerHTML = `
    <h2>Lakes</h2>
    <p>A single cell of water with land the whole way round it. Forced on here so there
       is always one to find; in a real game a little over half of planets have none, most
       of the rest have one. They are spent out of the same water budget the ocean is, so a
       planet with two lakes has exactly as much land as one without — and because punching
       one turns its neighbours into coast, and coast is never a lake site, two can never
       merge into a pond.</p>
    <div class="stage is-planet"></div>
    <pre class="menu-readout"></pre>
    <div class="controls"></div>`;
  scenarios.append(section);

  const planet = addPlanet(section.querySelector('.stage'), { spin: 0.2 });
  const readout = section.querySelector('.menu-readout');

  function deal(seed) {
    const { world, clustering, lakes } = planetFor(seed, { lakeChance: 1 });
    planet.show(world);
    readout.textContent = `seed ${seed}\nclustering ${clustering.toFixed(3)}\n`
      + `${lakes} lake${lakes === 1 ? '' : 's'} — look for a lone blue cell inland`;
  }

  const button = document.createElement('button');
  button.textContent = 'Deal another planet';
  button.addEventListener('click', () => deal(randomSeed()));
  section.querySelector('.controls').append(button);

  deal(4242);
}

/**
 * How often each carver is boring, over enough planets to mean something.
 *
 * Carved on the smaller globe and yielded between batches, because this is a
 * few hundred floods of a cell graph and doing them all in one go would sit on
 * the page for a couple of seconds with nothing on screen.
 */
function addDistribution() {
  const section = document.createElement('section');
  section.className = 'scenario';
  section.innerHTML = `
    <h2>How often, over many planets</h2>
    <p>The question is not whether a good planet is possible but how often one turns up,
       so this carves a few hundred and counts. Clustering runs left to right from a ring
       of land to a cap of it; the bar at 0.28 is where a planet stops being worth playing
       on, and is the bar the carver re-carves to clear.</p>
    <pre class="menu-readout"></pre>`;
  scenarios.append(section);
  const readout = section.querySelector('.menu-readout');
  readout.textContent = 'carving…';

  const cells = generateIcosphereCells(2);
  const runs = [
    { label: 'seeds dropped anywhere (before)', options: OLD_SEEDING, scores: [] },
    { label: 'seeds placed apart (now)', options: {}, scores: [] },
  ];
  const TOTAL = 300;
  const BATCH = 25;
  let done = 0;

  // One generator handing out the whole list, rather than `seededRng(1)`,
  // `seededRng(2)` and so on. An LCG's *first* draw is very nearly a linear
  // function of its seed — across seeds 1..300 it only moves from 0.236 to
  // 0.314 — so a sample built that way would give every planet in it almost
  // the same basin count, and the histogram would be measuring that instead.
  // Whole-range seeds are also what a real game deals itself.
  const picker = seededRng(20260828);

  function histogram(scores) {
    const edges = [0, 0.1, 0.2, 0.28, 0.34, 0.41];
    return edges.slice(0, -1).map((lo, i) => {
      const hi = edges[i + 1];
      const n = scores.filter((s) => s >= lo && s < hi).length;
      const share = n / scores.length;
      return `  ${lo.toFixed(2)}–${hi.toFixed(2)} ${(share * 100).toFixed(0).padStart(3)}% `
        + '█'.repeat(Math.round(share * 40));
    }).join('\n');
  }

  function report() {
    readout.textContent = runs.map(({ label, scores }) => {
      const boring = scores.filter((s) => s > OCEAN_TUNING.maxClustering).length;
      return `${label} — ${((boring / scores.length) * 100).toFixed(0)}% boring, `
        + `over ${scores.length} planets\n${histogram(scores)}`;
    }).join('\n\n') + `\n\n${done < TOTAL ? 'carving…' : 'done'}`;
  }

  (function batch() {
    for (let i = 0; i < BATCH && done < TOTAL; i++, done++) {
      const seed = randomSeed(picker);
      for (const run of runs) {
        const { landCellIds } = carveOceans(cells, 0.4, seededRng(seed), run.options);
        run.scores.push(landClustering(landCellIds, cells));
      }
    }
    report();
    if (done < TOTAL) requestAnimationFrame(batch);
  })();
}

addComparison();
addLakes();
addDistribution();
