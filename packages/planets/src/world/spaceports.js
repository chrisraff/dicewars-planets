import { add, dot, normalize } from '../geometry/vec3.js';

/**
 * Which planet territories the moon can dock at.
 *
 * They are picked on opposite sides of the planet and marked from the first
 * turn, and that placement is most of what makes the moon a contest rather
 * than a farm: two ports means two players usually have a window in the same
 * cycle, and antipodal means holding both is holding two ends of the planet
 * rather than one corner of it.
 *
 * Off the **equator**, because the generator has already turned the planet so
 * that its strongest ring of territories runs along there (`orientEquator`) —
 * so the equator is where the ground worth fighting over already is, and a
 * port put anywhere else would more often than not be a port in a backwater.
 * The longitude is drawn at random so it is not the same two territories
 * every game, and only the longitude: what matters is that the pair are
 * opposed, not where the axis lies.
 *
 * A territory rather than a point, so a port is an ordinary piece of ground
 * with an ordinary owner, which can be taken and lost like any other. That is
 * the point of putting the moon's access *on the planet*: it gives everybody
 * something to fight over for it, in a place they can all see.
 */
export function chooseSpaceports(territories, cellsById, rng = Math.random, count = 2) {
  const centers = new Map(
    territories.map((t) => [
      t.id,
      normalize(t.cellIds.map((id) => cellsById.get(id).center).reduce(add)),
    ])
  );

  const longitude = rng() * Math.PI * 2;
  const taken = new Set();
  const ports = [];

  for (let i = 0; i < count; i++) {
    const angle = longitude + (i * Math.PI * 2) / count;
    const aim = { x: Math.cos(angle), y: 0, z: Math.sin(angle) };

    // nearest territory to the aim that is not already a port — dot product
    // rather than an angle, since it orders the same way and costs less
    let best = null;
    let bestDot = -Infinity;
    for (const [id, center] of centers) {
      if (taken.has(id)) continue;
      const d = dot(center, aim);
      if (d > bestDot) {
        bestDot = d;
        best = id;
      }
    }
    if (best === null) break; // fewer territories than ports asked for
    taken.add(best);
    ports.push(best);
  }

  return ports;
}
