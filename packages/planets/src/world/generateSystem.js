import { generatePlanetWorld } from './generateWorld.js';
import { generateMoonWorld } from './generateMoon.js';
import { chooseSpaceports } from './spaceports.js';
import { ORBIT_STOPS, orbitAt } from '../game/orbit.js';

/**
 * The whole board a match is played on: a planet, and — in moon mode — a moon
 * beside it, joined by whichever bridge the orbit is currently holding open.
 *
 * **With the moon off this returns the planet and nothing else**, the same
 * object `generatePlanetWorld` has always returned, so a single-world game is
 * not merely equivalent to what it was, it is the identical code path.
 *
 * With the moon on, the planet's own world object is *extended* rather than
 * wrapped. `nodeIds`, `edges` and `assignments` grow to cover both bodies, so
 * `createInitialState` deals one board with two worlds on it; everything else
 * the planet carries — its cells, its territories, its cell-to-territory map —
 * is left exactly where the renderer already looks for it, and the moon
 * carries the same three under `world.moon`. That is what lets one surface,
 * one dice layer and one picker be built twice, once per body, with no
 * argument about which is which.
 */
export function generateSystem({
  subdivisions,
  playerIds,
  rng = Math.random,
  moon = false,
  levelSeats = true,
}) {
  const planet = generatePlanetWorld({ subdivisions, playerIds, rng, levelSeats });
  if (!moon) return planet;

  const moonWorld = generateMoonWorld({ rng });
  const cellsById = new Map(planet.cells.map((c) => [c.id, c]));
  const ports = chooseSpaceports(planet.territories, cellsById, rng);

  const orbit = { ports, dockOrder: moonWorld.dockOrder, stops: ORBIT_STOPS };

  // Each moon territory's neighbours on the moon itself, before any bridge.
  // This is what the gate is added to and taken away from every round, so it
  // has to be the board as carved rather than the graph as it stands — which
  // by definition already has a bridge somewhere in it.
  const moonNeighbors = new Map(moonWorld.nodeIds.map((id) => [id, []]));
  for (const [a, b] of moonWorld.edges) {
    moonNeighbors.get(a).push(b);
    moonNeighbors.get(b).push(a);
  }

  // The board is dealt at round 0, which is a stop over a port, so a match
  // opens with the gate already open. Deliberate: the moon is a thing to be
  // reckoned with from the first turn rather than a surprise on the second.
  const opening = orbitAt(orbit, 0);

  return {
    ...planet,
    nodeIds: [...planet.nodeIds, ...moonWorld.nodeIds],
    edges: [
      ...planet.edges,
      ...moonWorld.edges,
      ...(opening.open ? [[opening.port, opening.dock]] : []),
    ],
    assignments: [...planet.assignments, ...moonWorld.assignments],
    moon: moonWorld,
    orbit,
    moonNeighbors,
    spaceports: ports,
  };
}

/**
 * Every territory on a world, split by which body it is on — the lookup a
 * renderer showing one board at a time needs, and the one an AI weighing a
 * capture needs for the same reason.
 */
export function bodyOfTerritory(world) {
  const bodies = new Map(world.nodeIds.map((id) => [id, 'planet']));
  for (const id of world.moon?.nodeIds ?? []) bodies.set(id, 'moon');
  return bodies;
}
