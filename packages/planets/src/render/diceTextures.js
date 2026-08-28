import * as THREE from 'three';
import { pipPositions } from './pips.js';
import { lighten, readableTextColor } from './palette.js';

// Bone, and the near-black drilled into it. Written the way the palette
// writes colours (channels in 0..1) rather than as CSS, because a coloured
// die takes its face straight from the player palette and the two have to be
// the same kind of thing.
export const DIE_FACE = [0.973, 0.949, 0.894];
export const DIE_INK = [0.11, 0.11, 0.11];

// How far a player-coloured die is pulled toward white before its pips are
// inked on. Judged by eye on preview/dice.html, which is what that page is for.
export const DIE_TINT = 0.45;

const rgb = ([r, g, b]) => `rgb(${[r, g, b].map((c) => Math.round(c * 255)).join(', ')})`;

// A pip's radius as a fraction of the face. The ink and the hollow it sits in
// are the same circle: a real die's pip is drilled and then filled, so the
// paint stops exactly where the dimple does.
const PIP_RADIUS = 0.09;

// How far the dimple wall tilts at its steepest, as the sine of the slope.
// Below 1 by enough that the deepest part of a pip still catches some light.
const PIP_DEPTH = 0.85;

/**
 * The surface normal of a pip's hollow at `(dx, dy)` from its center, in the
 * die face's own frame: x to the right, y *up*, z out of the face.
 *
 * The profile is a bowl whose wall is steepest halfway out and flat at both
 * the bottom and the rim (`sin(pi * t)`). Flat at the rim is what matters —
 * a hemisphere's wall is vertical where it meets the face, which would leave
 * a hard ring of half-lit pixels around every pip. Easing out instead means
 * the hollow blends into the face and the circle antialiases itself.
 *
 * The tilt points back toward the center, which is what makes it read as a
 * hollow rather than a bead: the far wall of a bowl faces the near side.
 */
export function pipDimpleNormal(dx, dy, radius) {
  const distance = Math.hypot(dx, dy);
  if (distance === 0 || distance >= radius) return { x: 0, y: 0, z: 1 };

  const slope = PIP_DEPTH * Math.sin(Math.PI * (distance / radius));
  return {
    x: (-dx / distance) * slope,
    y: (-dy / distance) * slope,
    z: Math.sqrt(1 - slope * slope),
  };
}

function newFaceCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function drawDieFace(pipCount, size, face, ink) {
  const canvas = newFaceCanvas(size);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = rgb(face);
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = rgb(ink);
  const radius = size * PIP_RADIUS;
  for (const [xf, yf] of pipPositions(pipCount)) {
    ctx.beginPath();
    ctx.arc(xf * size, yf * size, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas;
}

// The same face as a tangent-space normal map, so the pips are lit as the
// hollows they are instead of as ink printed on a flat side.
//
// Canvas y runs downward while a normal map's green channel runs up the
// texture — but three.js uploads a canvas flipped, so a row drawn near the
// top of the canvas is a row near the top of the face, and the two cancel.
// What that leaves is one negation, on the way *in*: the offset handed to
// `pipDimpleNormal` is flipped into the face's own upward frame, and the
// normal that comes back is encoded as it stands.
function drawDieFaceNormals(pipCount, size) {
  const canvas = newFaceCanvas(size);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const data = image.data;

  // Flat everywhere the pips aren't: straight out of the face.
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 128;
    data[i + 1] = 128;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }

  const radius = size * PIP_RADIUS;
  for (const [xf, yf] of pipPositions(pipCount)) {
    const cx = xf * size;
    const cy = yf * size;
    const from = Math.max(0, Math.floor(cy - radius));
    const to = Math.min(size - 1, Math.ceil(cy + radius));

    for (let y = from; y <= to; y++) {
      const left = Math.max(0, Math.floor(cx - radius));
      const right = Math.min(size - 1, Math.ceil(cx + radius));
      for (let x = left; x <= right; x++) {
        // Sample the middle of the pixel, and in the face's own frame, where
        // y points up the texture rather than down the canvas.
        const dx = x + 0.5 - cx;
        const dy = -(y + 0.5 - cy);
        const normal = pipDimpleNormal(dx, dy, radius);

        const i = (y * size + x) * 4;
        data[i] = Math.round((normal.x * 0.5 + 0.5) * 255);
        data[i + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
        data[i + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
      }
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

// Generates the six pip-face textures once and returns them as a
// BoxGeometry-ready materials array (face order: +X, -X, +Y, -Y, +Z, -Z),
// laid out so opposite faces sum to 7, matching a standard western die.
//
// `face` and `ink` are the only things a coloured die changes — the normal
// map is geometry written down as colour, and is identical whatever the die
// is painted.
export function createDiePipMaterials(options = {}) {
  const { textureSize = 128, face = DIE_FACE, ink = DIE_INK } = options;
  const facePips = [1, 6, 2, 5, 3, 4];
  return facePips.map((pips) => {
    const texture = new THREE.CanvasTexture(drawDieFace(pips, textureSize, face, ink));
    texture.colorSpace = THREE.SRGBColorSpace;

    // A normal map is geometry written down as color, so it stays linear —
    // pushed through sRGB it would decode to the wrong directions entirely.
    const normalMap = new THREE.CanvasTexture(drawDieFaceNormals(pips, textureSize));
    normalMap.colorSpace = THREE.NoColorSpace;

    return new THREE.MeshStandardMaterial({ map: texture, normalMap, roughness: 0.5 });
  });
}

/**
 * One set of pip materials per player, for dice painted in their owner's
 * colour rather than in bone.
 *
 * The player colour is not used raw. A die has to carry a *number* as well as
 * an identity, and its pips are the only thing on it that says which — so the
 * face is pulled toward white by `tint` until there is somewhere for an ink to
 * stand, and the ink is then chosen by the same measurement the HUD uses
 * (`readableTextColor`, which picks whichever of black or white actually
 * clears AA against that face rather than guessing from a threshold).
 *
 * `tint` at 0 is the player's colour undiluted and 1 is a plain bone die, so
 * the knob is really "how much of a die is left once it is also a flag".
 * Eight sets of six 128px canvases is the whole cost, paid once.
 */
export function createPlayerDiePipMaterials(playerColors, options = {}) {
  const { tint = DIE_TINT, ...rest } = options;
  const sets = new Map();
  for (const [playerId, color] of playerColors) {
    const face = lighten(color, tint);
    sets.set(playerId, createDiePipMaterials({ ...rest, face, ink: readableTextColor(face) }));
  }
  return sets;
}
