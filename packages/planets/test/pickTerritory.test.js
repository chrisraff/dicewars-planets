import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateIcosphereCells } from '../src/geometry/icosphere.js';
import { buildPlanetGeometry } from '../src/render/buildPlanetGeometry.js';
import { pointerToNdc, createTerritoryPicker } from '../src/render/pickTerritory.js';

const rect = { left: 100, top: 50, width: 800, height: 400 };

test('the canvas center is the origin in device coordinates', () => {
  const ndc = pointerToNdc(500, 250, rect);
  assert.ok(Math.abs(ndc.x) < 1e-12);
  assert.ok(Math.abs(ndc.y) < 1e-12);
});

test('device coordinates run right and *up*, so screen y is flipped', () => {
  const topLeft = pointerToNdc(100, 50, rect);
  assert.deepEqual(topLeft, { x: -1, y: 1 });

  const bottomRight = pointerToNdc(900, 450, rect);
  assert.deepEqual(bottomRight, { x: 1, y: -1 });
});

function planetPicker(cellTerritory) {
  const cells = generateIcosphereCells(2);
  const { positions, indices, faceCellIds } = buildPlanetGeometry(cells, () => [1, 1, 1]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const planetMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 3.2);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  return {
    cells,
    pick: createTerritoryPicker({ planetMesh, camera, faceCellIds, cellTerritory }),
  };
}

test('a click on the planet reports the territory under it', () => {
  // the cell nearest the camera is whichever one is closest to +z
  const probe = planetPicker(new Map());
  const facing = probe.cells.reduce((a, b) => (b.center.z > a.center.z ? b : a));

  const cellTerritory = new Map(probe.cells.map((c) => [c.id, `t${c.id}`]));
  const { pick } = planetPicker(cellTerritory);

  assert.equal(pick({ x: 0, y: 0 }), `t${facing.id}`);
});

test('a click on empty space, or on cells belonging to no territory, picks nothing', () => {
  const cells = generateIcosphereCells(2);
  const { pick } = planetPicker(new Map(cells.map((c) => [c.id, 't0'])));

  assert.equal(pick({ x: 0.99, y: 0.99 }), null, 'off the edge of the planet');

  const { pick: oceanPick } = planetPicker(new Map()); // no cell has a territory
  assert.equal(oceanPick({ x: 0, y: 0 }), null, 'ocean is not clickable');
});
