import * as THREE from 'three';
import { buildPlanetGeometry, updateCellColors } from './buildPlanetGeometry.js';
import { buildTerritoryBoundaries } from './buildTerritoryBoundaries.js';
import { makeCellColorer } from './colorByOwner.js';
import { linearRgb } from './palette.js';

/**
 * The planet itself: one flat-shaded mesh plus the black territory outlines.
 *
 * Territory *shapes* never change, only who owns them, so the geometry is
 * built once and `refresh` rewrites colors in place — and only for the cells
 * whose color actually differs from what's on screen, so capturing one
 * territory doesn't touch the rest of the planet.
 *
 * This is also the one place a palette colour becomes a number on the GPU, and
 * so the one place it has to change what it means. Everything upstream — the
 * palette, `mix`, the highlight tints — is in sRGB, the same numbers the HUD
 * writes into a CSS `rgb()`; a vertex colour is read by three.js as *linear*
 * and encoded to sRGB on the way out. Handing it sRGB therefore encodes it
 * twice, and the planet showed the whole palette lightened and flattened:
 * yellow was authored 242,191,38 and displayed 249,225,108, which put it a
 * CIEDE2000 11.4 from orange where the two are 19.4 apart as written. So the
 * colour is linearized here, at the write, and the output encoding puts it
 * back exactly — a territory and its swatch in the HUD are now the same
 * colour, which is the thing that was worth having.
 *
 * Deliberately here rather than in the palette or in the blending. Selection
 * and battle tints were all judged as fractions between two sRGB colours, and
 * blending them in linear instead would move every one of them; keeping the
 * conversion at the very last step leaves every tuned number meaning what it
 * meant.
 */
export function createPlanetSurface(world, playerColors) {
  const { positions, colors, indices, faceCellIds, cellVertexRanges } = buildPlanetGeometry(
    world.cells,
    () => [0, 0, 0]
  );

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true }));

  const { positions: boundaryPositions } = buildTerritoryBoundaries(world.cells, world.cellTerritory);
  const boundaryGeometry = new THREE.BufferGeometry();
  boundaryGeometry.setAttribute('position', new THREE.BufferAttribute(boundaryPositions, 3));
  const boundaries = new THREE.LineSegments(
    boundaryGeometry,
    new THREE.LineBasicMaterial({ color: 0x000000 })
  );

  const group = new THREE.Group();
  group.add(mesh, boundaries);

  const painted = new Map(); // cellId -> the color currently on screen

  return {
    group,
    mesh,
    faceCellIds,

    refresh(state, tintFor = () => null) {
      const colorFor = makeCellColorer(world, state, playerColors, tintFor);
      const stale = [];
      for (const cellId of cellVertexRanges.keys()) {
        const next = colorFor(cellId);
        const current = painted.get(cellId);
        if (current && current[0] === next[0] && current[1] === next[1] && current[2] === next[2]) {
          continue;
        }
        painted.set(cellId, next);
        stale.push(cellId);
      }
      if (stale.length === 0) return 0;

      updateCellColors(geometry.getAttribute('color'), stale, cellVertexRanges, (id) =>
        linearRgb(painted.get(id))
      );
      return stale.length;
    },

    dispose() {
      geometry.dispose();
      boundaryGeometry.dispose();
    },
  };
}
