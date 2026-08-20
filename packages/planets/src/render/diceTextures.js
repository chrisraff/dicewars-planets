import * as THREE from 'three';
import { pipPositions } from './pips.js';

function drawDieFace(pipCount, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#f8f2e4';
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = '#1c1c1c';
  const radius = size * 0.09;
  for (const [xf, yf] of pipPositions(pipCount)) {
    ctx.beginPath();
    ctx.arc(xf * size, yf * size, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas;
}

// Generates the six pip-face textures once and returns them as a
// BoxGeometry-ready materials array (face order: +X, -X, +Y, -Y, +Z, -Z),
// laid out so opposite faces sum to 7, matching a standard western die.
export function createDiePipMaterials(textureSize = 128) {
  const facePips = [1, 6, 2, 5, 3, 4];
  return facePips.map((pips) => {
    const texture = new THREE.CanvasTexture(drawDieFace(pips, textureSize));
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: texture, roughness: 0.5 });
  });
}
