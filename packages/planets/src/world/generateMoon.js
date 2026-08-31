import { NEUTRAL_OWNER } from '@dicewars/core';
import { generateIcosphereCells } from '../geometry/icosphere.js';
import { estimateCellSpacing } from './territoryCenters.js';

/**
 * The moon is a smaller world, and the thing that makes it a different one is
 * that its territories are cut by **channels** rather than separated by
 * ocean: narrow dark trenches one cell wide, with a gap left in each, so what
 * they make is a chokepoint rather than an island.
 *
 * The shape is not carved and then measured, the way the planet's oceans are.
 * It is constructed, because it has a job to do that a random carve cannot be
 * relied on for. The moon **spins**, so a different territory faces the
 * planet at every orbital stop, and the whole balance of the mode rests on
 * the ground it presents being cheap to land on. A ramp measured from some
 * arbitrary core would sooner or later turn an eight-dice fortress toward the
 * planet, and the entry price would be whatever the dice happened to say that
 * round.
 *
 * So the ramp is defined **by the spin axis**. The moon carries an equatorial
 * *band* of territories, and that is the only ground that ever turns to face
 * the planet — because that is what an equator is. Behind it, past a channel
 * running along a line of latitude, sit the polar *caps*, which never face
 * the planet at all and hold the garrisons worth taking.
 *
 * Which buys a second property worth more than the first: every cap is the
 * same distance from every dock. Wherever a player lands the prize is equally
 * far, so no window is a better window and nobody can camp the one good
 * entrance.
 *
 * Generated with the spin axis at +Y, so latitude is `asin(center.y)` and the
 * renderer spins the whole body about its own Y. There is no orientation pass,
 * for the same reason the planet needs one: the planet's interesting ring is
 * *discovered* and has to be brought to the equator, and the moon's is
 * *decided*, so it is simply built there.
 */
export const MOON_TUNING = {
  // 642 cells, the same mesh the planet is built on, over ten territories
  // rather than fifty-odd.
  //
  // The coarser 162-cell mesh was tried first and is the obvious choice — a
  // smaller world ought to want fewer cells — but it makes the channels
  // unreadable. A channel is one cell wide by construction, so how *narrow* it
  // looks is decided entirely by how big a cell is: at 162 cells a trench came
  // out as broad as the ground either side of it and the moon read as an
  // archipelago rather than as a world with canyons cut into it. Here the
  // water is 18% of the cells against 32%, and it looks like what it is.
  subdivisions: 3,

  // How far from the equator the band reaches. At 38° the band is 62% of the
  // sphere over six sectors and each cap is 19% over two, which is the value
  // that makes all ten territories about the same size; widen it and the caps
  // become slivers, narrow it and they dwarf the band.
  bandHalfAngle: (38 * Math.PI) / 180,
  bandSectors: 6,
  capSectors: 2,

  // Channel width and the gap left in one, both as multiples of the spacing
  // between neighbouring cell centers. Just under half a spacing either side
  // of the line takes out roughly a single row of cells; a gap of a little
  // over one leaves an isthmus one or two cells wide, which is a chokepoint
  // you can see rather than a seam you cannot.
  channelHalfWidth: 0.42,
  gapWidth: 1.3,

  // Ways into each cap from the band. One makes a cap a siege; two makes it a
  // position, which is the better game — a defender has to choose which door
  // to stand at.
  capEntrances: 2,

  // Single cells of water with land all the way round, the same idea as the
  // planet's lakes and punched the same way. Kept rare: the moon already has
  // a great deal of dark on it.
  maxLakes: 2,
  lakeChance: 0.4,

  // The garrisons unclaimed ground holds. The band is what the spin presents,
  // so it is priced for a player who is losing: a four-stack takes a landing.
  // The caps are the moon's own objective, and are priced as a campaign.
  bandDice: [2, 3],
  capDice: [5, 8],

  // How many times to rebuild before giving up. A carve is only ever rejected
  // for leaving a territory with no cells in it at all, which a bad phase can
  // do and a retry fixes; being cut into pieces is repaired rather than
  // rejected — see `openChannels`.
  attempts: 8,
};

const TAU = Math.PI * 2;
const wrap = (angle) => ((angle % TAU) + TAU) % TAU;

/**
 * Angular distance from a point to the great circle through the poles at
 * longitude `lon`, and which of that circle's two branches it is nearer.
 *
 * A meridian *plane* holds both `lon` and `lon + π`, so one great circle is
 * two sector boundaries at once — six band sectors want three of these, not
 * six. Measuring to the circle rather than comparing longitudes is also what
 * makes the channel narrow to nothing at the poles all by itself, which is
 * exactly what a channel between two halves of a polar cap should do.
 */
function meridianDistance(center, lon) {
  const distance = Math.asin(
    Math.min(1, Math.abs(center.x * Math.sin(lon) - center.z * Math.cos(lon)))
  );
  const nearSide = center.x * Math.cos(lon) + center.z * Math.sin(lon) >= 0;
  return { distance, nearSide };
}

// Whether an angle lies within `width` of `from`, going round the circle.
function nearLongitude(lon, from, width) {
  const offset = Math.abs(wrap(lon - from));
  return Math.min(offset, TAU - offset) < width / 2;
}

/**
 * Where every cell belongs, and which of them are water.
 *
 * Zone and sector are worked out for *every* cell, water included, so that a
 * channel cell which later has to be opened back up already knows which
 * territory it joins. That is the whole reason this is not done for the land
 * alone — see `openChannels`.
 */
function classify(cells, rng, tuning) {
  const {
    bandHalfAngle,
    bandSectors,
    capSectors,
    channelHalfWidth,
    gapWidth,
    capEntrances,
  } = tuning;

  const spacing = estimateCellSpacing(new Map(cells.map((c) => [c.id, c])));
  const channelWidth = channelHalfWidth * spacing;
  const gap = gapWidth * spacing;

  const bandPhase = rng() * TAU;
  const capPhase = rng() * TAU;
  const bandCircles = bandSectors / 2;
  const sectorArc = TAU / bandSectors;

  /**
   * The ways through a latitude channel are placed in *sector* space rather
   * than at raw longitudes: each opens at the midpoint of a band sector,
   * which is the point furthest from the meridian channels either side of it.
   * Placed at random instead, an entrance landed on a meridian crossing often
   * enough that three carves in four came out with a cap cut off.
   */
  const entranceSectors = (start) =>
    Array.from(
      { length: capEntrances },
      (_, i) => (start + Math.round((i * bandSectors) / capEntrances)) % bandSectors
    );
  const entrances = [
    entranceSectors(Math.floor(rng() * bandSectors)),
    entranceSectors(Math.floor(rng() * bandSectors)),
  ].map((sectors) => sectors.map((s) => bandPhase + (s + 0.5) * sectorArc));

  /**
   * And the gaps in the meridian channels sit near the equator, which is the
   * same argument from the other direction: it is the latitude furthest from
   * both latitude channels, so a band-to-band isthmus is not swallowed by
   * water that is already there for another purpose.
   */
  const jitter = Math.max(0, bandHalfAngle - channelWidth * 2 - gap / 2);
  const bandGaps = Array.from({ length: bandCircles }, () => [
    (rng() - 0.5) * jitter,
    (rng() - 0.5) * jitter,
  ]);

  const zoneOf = new Map();
  const sectorOf = new Map();
  const channel = new Set();

  for (const cell of cells) {
    const { y, z, x } = cell.center;
    const lat = Math.asin(Math.max(-1, Math.min(1, y)));
    const lon = Math.atan2(z, x);
    const north = lat >= 0;
    const band = Math.abs(lat) < bandHalfAngle;

    const zone = band ? 'band' : north ? 'north' : 'south';
    const zoneSectors = band ? bandSectors : capSectors;
    const phase = band ? bandPhase : capPhase;
    zoneOf.set(cell.id, zone);
    sectorOf.set(cell.id, Math.floor((wrap(lon - phase) / TAU) * zoneSectors) % zoneSectors);

    // --- the latitude channels, which hold the caps behind the band ---
    if (Math.abs(Math.abs(lat) - bandHalfAngle) < channelWidth) {
      const width = gap / Math.cos(bandHalfAngle); // an arc of `gap` at this latitude
      if (!entrances[north ? 0 : 1].some((at) => nearLongitude(lon, at, width))) {
        channel.add(cell.id);
        continue;
      }
    }

    // --- the meridian channels, which cut a zone into sectors ---
    const circles = band ? bandCircles : capSectors / 2;
    for (let k = 0; k < circles; k++) {
      const { distance, nearSide } = meridianDistance(cell.center, phase + (k * Math.PI) / circles);
      if (distance >= channelWidth) continue;
      // A cap's meridian stops short of the pole, and it has to be *told* to.
      // The intuition is that the channel pinches out up there by itself,
      // since every longitude meets at the pole — but that is exactly why it
      // does not: distance to a meridian great circle is zero at the pole for
      // every meridian, so the pole is the one place the cut is unavoidable.
      // Left to itself it severed both halves of every cap, which then hung
      // off the band separately instead of being a place you can walk across.
      if (!band) {
        if (Math.PI / 2 - Math.abs(lat) >= gap) channel.add(cell.id);
        break;
      }
      const from = bandGaps[k][nearSide ? 0 : 1];
      if (lat < from - gap / 2 || lat > from + gap / 2) {
        channel.add(cell.id);
        break;
      }
    }
  }

  return { zoneOf, sectorOf, channel };
}

/**
 * Single-cell lakes, exactly the planet's rule: a site is a land cell with
 * land on every side, which both tells a lake from a bite out of a channel
 * bank and stops two ever merging, since punching one turns its neighbours
 * into bank. Removing such a cell cannot break the land either, because the
 * cells around a cell of a Goldberg polyhedron form a ring, so any path
 * through it can go round it.
 */
function punchLakes(cells, byId, land, count, rng) {
  const isSite = (id) => land.has(id) && byId.get(id).neighbors.every((n) => land.has(n));
  const sites = cells.filter((c) => isSite(c.id)).map((c) => c.id);
  const punched = [];
  while (punched.length < count && sites.length > 0) {
    const id = sites.splice(Math.floor(rng() * sites.length), 1)[0];
    if (!isSite(id)) continue; // an earlier lake put this one on a bank
    land.delete(id);
    punched.push(id);
  }
  return punched;
}

function componentsOf(ids, neighborsOf) {
  const remaining = new Set(ids);
  const found = [];
  while (remaining.size > 0) {
    const start = remaining.values().next().value;
    const group = [];
    const stack = [start];
    remaining.delete(start);
    while (stack.length) {
      const id = stack.pop();
      group.push(id);
      for (const n of neighborsOf(id)) {
        if (remaining.has(n)) {
          remaining.delete(n);
          stack.push(n);
        }
      }
    }
    found.push(group);
  }
  return found;
}

// Which territories touch which, read off the land as it currently stands.
function territoryGraph(land, byId, keyOf) {
  const adjacency = new Map();
  const reach = (a) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    return adjacency.get(a);
  };
  for (const id of land) {
    const a = keyOf(id);
    reach(a);
    for (const n of byId.get(id).neighbors) {
      if (!land.has(n)) continue;
      const b = keyOf(n);
      if (a === b) continue;
      reach(a).add(b);
      reach(b).add(a);
    }
  }
  return adjacency;
}

/**
 * Opens water back up until every territory can be reached from every other.
 *
 * A landing party stranded on ground nothing else touches is the one
 * unplayable thing this generator could produce, and the placements above
 * make it *unlikely* rather than impossible — a gap can still be swallowed by
 * a lake, by the sector repair, or by a meridian crossing that lands badly.
 * Rejecting the carve was the first answer and it threw away three moons in
 * four; digging a way through costs a cell or two and always works.
 *
 * The way through is the shortest run of water joining the pieces, found by
 * walking outward from the largest one, so what it opens reads as a gap in a
 * channel rather than as a hole punched somewhere in the middle of one.
 */
function openChannels(land, channel, byId, keyOf) {
  for (let guard = 0; guard < 32; guard++) {
    const adjacency = territoryGraph(land, byId, keyOf);
    const pieces = componentsOf([...adjacency.keys()], (key) => adjacency.get(key) ?? []);
    if (pieces.length <= 1) return true;

    pieces.sort((a, b) => b.length - a.length);
    const home = new Set(pieces[0]);
    const inHome = (id) => land.has(id) && home.has(keyOf(id));

    // breadth-first through the water, from every shore of the largest piece
    const from = new Map();
    const queue = [];
    for (const id of channel) {
      if (byId.get(id).neighbors.some(inHome)) {
        from.set(id, null);
        queue.push(id);
      }
    }

    let landfall = null;
    for (let i = 0; i < queue.length && landfall === null; i++) {
      const id = queue[i];
      for (const n of byId.get(id).neighbors) {
        if (land.has(n) && !home.has(keyOf(n))) {
          landfall = id;
          break;
        }
        if (channel.has(n) && !from.has(n)) {
          from.set(n, id);
          queue.push(n);
        }
      }
    }
    if (landfall === null) return false;

    for (let id = landfall; id !== null && id !== undefined; id = from.get(id)) {
      channel.delete(id);
      land.add(id);
    }
  }
  return false;
}

function buildAttempt(cells, byId, rng, tuning) {
  const { zoneOf, sectorOf, channel } = classify(cells, rng, tuning);
  const keyOf = (id) => `${zoneOf.get(id)}:${sectorOf.get(id)}`;

  const land = new Set();
  for (const cell of cells) if (!channel.has(cell.id)) land.add(cell.id);

  const lakes = punchLakes(
    cells,
    byId,
    land,
    rng() < tuning.lakeChance ? 1 + Math.floor(rng() * tuning.maxLakes) : 0,
    rng
  );
  for (const id of lakes) channel.add(id);

  // Ten groups, the band first and in longitude order — which is also the
  // order the spin presents them, so the dock rotation is this list and needs
  // no second decision made about it.
  const keys = [
    ...Array.from({ length: tuning.bandSectors }, (_, i) => `band:${i}`),
    ...Array.from({ length: tuning.capSectors }, (_, i) => `north:${i}`),
    ...Array.from({ length: tuning.capSectors }, (_, i) => `south:${i}`),
  ];

  // A sector left in two pieces by an unlucky gap keeps its largest piece and
  // the strays go back to water — a repair rather than a rejection, because
  // it costs a cell or two where starting over costs a whole moon.
  for (const key of keys) {
    const ids = [...land].filter((id) => keyOf(id) === key);
    if (ids.length === 0) return { rejected: `no cells in ${key}` };
    const pieces = componentsOf(ids, (id) =>
      byId.get(id).neighbors.filter((n) => land.has(n) && keyOf(n) === key)
    );
    if (pieces.length === 1) continue;
    pieces.sort((a, b) => b.length - a.length);
    for (const stray of pieces.slice(1)) {
      for (const id of stray) {
        land.delete(id);
        channel.add(id);
      }
    }
  }

  if (!openChannels(land, channel, byId, keyOf)) {
    return { rejected: 'could not dig a way between the pieces' };
  }

  const members = new Map(keys.map((key) => [key, []]));
  for (const id of land) members.get(keyOf(id)).push(id);

  const territories = keys.map((key, index) => ({
    id: `m${index}`,
    key,
    zone: key.split(':')[0],
    cellIds: members.get(key),
  }));

  const cellTerritory = new Map();
  for (const t of territories) for (const id of t.cellIds) cellTerritory.set(id, t.id);

  const edgeKeys = new Set();
  for (const id of land) {
    const a = cellTerritory.get(id);
    for (const n of byId.get(id).neighbors) {
      const b = cellTerritory.get(n);
      if (b === undefined || a === b) continue;
      edgeKeys.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    }
  }

  return {
    territories,
    edges: [...edgeKeys].map((key) => key.split('|')),
    cellTerritory,
    channelCellIds: new Set(cells.map((c) => c.id).filter((id) => !land.has(id))),
    lakeCellIds: new Set(lakes.filter((id) => !land.has(id))),
  };
}

/**
 * The moon as a world: everything `createInitialState` needs for its half of
 * the board, plus the geometry a renderer wants and the two facts the orbit
 * needs — which territories are in the docking band, and in what order the
 * spin presents them.
 *
 * Every territory starts unclaimed. Unclaimed ground holds its dice and does
 * nothing else — it never takes a turn, never earns, never attacks — so it is
 * a bank to be broken into rather than a player to be beaten.
 */
export function generateMoonWorld({ rng = Math.random, tuning = {}, onReject } = {}) {
  const settings = { ...MOON_TUNING, ...tuning };
  const cells = generateIcosphereCells(settings.subdivisions);
  const byId = new Map(cells.map((c) => [c.id, c]));

  let built = null;
  let lastRejection = 'none';
  for (let attempt = 0; attempt < settings.attempts && built === null; attempt++) {
    const candidate = buildAttempt(cells, byId, rng, settings);
    if (candidate.rejected) {
      lastRejection = candidate.rejected;
      onReject?.(candidate.rejected);
    } else {
      built = candidate;
    }
  }
  if (built === null) {
    throw new Error(`could not carve a moon in ${settings.attempts} attempts (${lastRejection})`);
  }

  const { territories, edges, cellTerritory, channelCellIds, lakeCellIds } = built;
  const [bandLow, bandHigh] = settings.bandDice;
  const [capLow, capHigh] = settings.capDice;

  // One of each garrison per cap, so a cap is never two fortresses or two
  // soft touches — which of its halves is which is the only thing left to
  // chance, and it is what stops both poles reading the same way round.
  const capSwap = { north: rng() < 0.5, south: rng() < 0.5 };

  const assignments = territories.map((t) => {
    let dice;
    if (t.zone === 'band') {
      dice = bandLow + Math.floor(rng() * (bandHigh - bandLow + 1));
    } else {
      const soft = (Number(t.key.split(':')[1]) === 0) !== capSwap[t.zone];
      dice = soft ? capLow : capHigh;
    }
    return [t.id, { owner: NEUTRAL_OWNER, dice, body: 'moon' }];
  });

  const band = territories.filter((t) => t.zone === 'band');

  return {
    body: 'moon',
    nodeIds: territories.map((t) => t.id),
    edges,
    assignments,
    cells,
    territories,
    cellTerritory,
    // the renderer paints anything with no territory as channel, the same way
    // it paints anything with no territory on the planet as ocean
    channelCellIds,
    lakeCellIds,
    // the band in longitude order, which is the order the spin presents them
    dockOrder: band.map((t) => t.id),
    bandTerritoryIds: band.map((t) => t.id),
    capTerritoryIds: territories.filter((t) => t.zone !== 'band').map((t) => t.id),
  };
}
