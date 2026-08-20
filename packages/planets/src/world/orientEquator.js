import { rotationAligning } from '../geometry/rotation.js';
import { chooseEquatorialAxis } from './equatorAxis.js';

// Rotates the whole planet's geometry (never its topology) so the strongest
// ring of mutually-adjacent territories runs left-to-right around the
// equator, in the xz-plane — matching the "flat map" mental model.
export function orientWorldToEquator({ cells, territories, edges }, options) {
  const axis = chooseEquatorialAxis({ territories, cells, edges }, options);
  const rotate = rotationAligning(axis, { x: 0, y: 1, z: 0 });

  return cells.map((cell) => ({
    ...cell,
    center: rotate(cell.center),
    corners: cell.corners.map(rotate),
  }));
}
