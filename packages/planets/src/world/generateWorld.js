import { generateIcosphereCells } from '../geometry/icosphere.js';
import { groupIntoTerritories } from './continents.js';

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
// three.js renderer will want (cells, territories, cellTerritory) —
// core never sees any of that.
export function generatePlanetWorld({
  subdivisions,
  territoryCount,
  playerIds,
  rng = Math.random,
  startingDicePerTerritory = (random) => randomInt(random, 1, 3),
}) {
  const cells = generateIcosphereCells(subdivisions);
  const { territories, edges, cellTerritory } = groupIntoTerritories(cells, territoryCount, rng);
  const nodeIds = territories.map((t) => t.id);

  // deal territories round-robin in random order so no player reliably gets first pick
  const dealOrder = shuffled(nodeIds, rng);
  const assignments = dealOrder.map((territoryId, i) => [
    territoryId,
    { owner: playerIds[i % playerIds.length], dice: startingDicePerTerritory(rng) },
  ]);

  return { nodeIds, edges, assignments, playerIds, cells, territories, cellTerritory };
}
