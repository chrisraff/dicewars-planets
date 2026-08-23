import { angleBetween } from '../geometry/vec3.js';
import { DEFAULT_FRAMING, fightCenter, needsRefocus } from '../render/cameraFraming.js';

/**
 * Which earlier moves in this turn each move must follow, so the true rules
 * order is never actually changed — only which of several *independent*
 * moves gets *shown* first. Two moves are chained only if they touch the
 * same territory, as attacker or defender: a failed attack must still show
 * before a later success on the same ground, and a newly claimed territory
 * must show before it's used to attack from. Anything that never shares a
 * territory with an earlier move in this turn is free to be shown whenever
 * is most convenient for the camera.
 *
 * `moves` is `{ from, to }` in true (already-resolved) order. Returns, per
 * move, the indices of the moves it must be shown after.
 */
export function turnDependencies(moves) {
  const lastTouch = new Map(); // territoryId -> move index
  return moves.map((move, i) => {
    const dependsOn = [];
    for (const territory of [move.from, move.to]) {
      const prev = lastTouch.get(territory);
      if (prev !== undefined) dependsOn.push(prev);
      lastTouch.set(territory, i);
    }
    return dependsOn;
  });
}

/**
 * Reorders one AI turn's moves for display: a topological walk over
 * `turnDependencies` that, among the moves currently free to show (every
 * territory they touch has already been shown), prefers one the camera is
 * already looking at, or failing that the nearest one — so whatever swing
 * eventually happens is as small as it can be. `positionOf(territoryId)`
 * returns a unit vec3; `initialView` is `{ direction, distance, halfFov }`,
 * the real camera's state right now, at the moment the turn is planned.
 *
 * Deliberately greedy rather than globally optimal — minimizing the total
 * number of swings over an arbitrary dependency graph is a scheduling
 * problem with no cheap general solution, and a turn is a handful of moves,
 * not thousands. When nothing is chained and only one move is ever ready at
 * a time, this walk reproduces the input order unchanged.
 */
export function orderAiTurnForCamera(moves, positionOf, initialView, framing = DEFAULT_FRAMING) {
  const n = moves.length;
  if (n === 0) return [];

  const dependsOn = turnDependencies(moves);
  const done = new Array(n).fill(false);
  const remaining = new Set(moves.map((_, i) => i));
  const isReady = (i) => dependsOn[i].every((j) => done[j]);
  const point = (i) => fightCenter(positionOf(moves[i].from), positionOf(moves[i].to));

  let aimDirection = initialView.direction;
  const view = { distance: initialView.distance, halfFov: initialView.halfFov };
  const order = [];

  while (remaining.size > 0) {
    const ready = [...remaining].filter(isReady);

    let chosen = ready.find((i) => !needsRefocus(aimDirection, point(i), view, framing));
    if (chosen === undefined) {
      chosen = ready.reduce((best, i) =>
        angleBetween(aimDirection, point(i)) < angleBetween(aimDirection, point(best)) ? i : best
      );
    }

    order.push(moves[chosen]);
    done[chosen] = true;
    remaining.delete(chosen);
    aimDirection = point(chosen);
  }

  return order;
}
