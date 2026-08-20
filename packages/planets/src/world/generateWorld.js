import { generateIcosphereCells } from '../geometry/icosphere.js';
import { groupIntoTerritories } from './continents.js';
import { carveOceans } from './oceans.js';
import { orientWorldToEquator } from './orientEquator.js';

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

  // deal territories round-robin in random order so no player reliably gets first pick
  const dealOrder = shuffled(nodeIds, rng);
  const assignments = dealOrder.map((territoryId, i) => [
    territoryId,
    { owner: playerIds[i % playerIds.length], dice: startingDicePerTerritory(rng) },
  ]);

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
