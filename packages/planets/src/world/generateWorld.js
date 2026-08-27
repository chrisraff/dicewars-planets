import { generateIcosphereCells } from '../geometry/icosphere.js';
import { groupIntoTerritories } from './continents.js';
import { carveOceans } from './oceans.js';
import { orientWorldToEquator } from './orientEquator.js';
import {
  dealSeats,
  scatterExtraDice,
  seatExtraDice,
  seatTerritoryCounts,
} from './seating.js';

function randomInt(rng, minInclusive, maxInclusive) {
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
}

function shuffled(items, rng) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Produces exactly what @dicewars/core's createInitialState needs
// (nodeIds/edges/assignments/playerIds), plus the extra geometry a
// three.js renderer will want (cells, territories, cellTerritory,
// oceanCellIds) — core never sees any of that.
//
// Generation order: carve ocean out of the full cell sphere first (leaving
// a connected land mass), group only the land into territories (so the
// territory graph is connected for free), then re-orient the whole planet
// so the territories' strongest ring runs along the equator.
export function generatePlanetWorld({
  subdivisions,
  playerIds,
  rng = Math.random,
  oceanFraction = 0.4,
  targetTerritorySize = 7,
  territorySizeSigma = 2,
  minTerritorySize = 3,
  startingDicePerTerritory = (random) => randomInt(random, 1, 3),
  // The turn-order correction — see seating.js for what it is and what it is
  // worth. Off is what the game dealt before it existed, and is how
  // `scripts/seats.js` measures the thing it corrects for.
  levelSeats = true,
}) {
  const cells = generateIcosphereCells(subdivisions);
  const { landCellIds, oceanCellIds } = carveOceans(cells, oceanFraction, rng);
  const landCells = cells.filter((c) => landCellIds.has(c.id));

  const { territories, edges, cellTerritory } = groupIntoTerritories(landCells, {
    targetSize: targetTerritorySize,
    sigma: territorySizeSigma,
    minSize: minTerritorySize,
    rng,
  });
  const orientedCells = orientWorldToEquator({ cells, territories, edges });

  const nodeIds = territories.map((t) => t.id);

  // Deal in random order so no seat reliably gets first pick of the planet,
  // then correct for the turn order: later seats are dealt slightly more
  // ground and a ramp of extra dice, because moving first is worth a great
  // deal and moving last is worth very little. seating.js has the numbers.
  const dealOrder = shuffled(nodeIds, rng);
  const seats = levelSeats
    ? dealSeats(seatTerritoryCounts(dealOrder.length, playerIds.length, rng))
    : dealOrder.map((_, i) => i % playerIds.length);

  const assignments = dealOrder.map((territoryId, i) => [
    territoryId,
    { owner: playerIds[seats[i]], dice: startingDicePerTerritory(rng) },
  ]);

  if (levelSeats) {
    scatterExtraDice(
      assignments,
      playerIds,
      seatExtraDice(dealOrder.length, playerIds.length),
      rng
    );
  }

  return {
    nodeIds,
    edges,
    assignments,
    playerIds,
    cells: orientedCells,
    territories,
    cellTerritory,
    oceanCellIds,
  };
}
