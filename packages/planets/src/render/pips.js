// Where the pips sit on a die face, as fractions of the face, on the usual
// 3x3 grid. Both the 3D dice (drawn into a canvas texture) and the flat dice
// in the battle readout (drawn as SVG) read their layout from here, so a die
// on the planet and the same die in the readout always agree.
//
// Coordinates run left-to-right and top-to-bottom, which is what canvas and
// SVG both want.
export const PIP_LAYOUTS = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
  6: [[0.27, 0.22], [0.27, 0.5], [0.27, 0.78], [0.73, 0.22], [0.73, 0.5], [0.73, 0.78]],
};

export function pipPositions(value) {
  return PIP_LAYOUTS[value] ?? [];
}
