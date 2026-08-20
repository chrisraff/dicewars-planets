import * as THREE from 'three';
import { createInitialState } from '@dicewars/core';
import { generatePlanetWorld } from './world/generateWorld.js';
import { buildPlanetGeometry } from './render/buildPlanetGeometry.js';
import { assignPlayerColors } from './render/palette.js';
import { makeCellColorer } from './render/colorByOwner.js';
import { createViewer } from './render/createViewer.js';

const playerIds = ['p1', 'p2', 'p3', 'p4'];

const world = generatePlanetWorld({
  subdivisions: 3,
  territoryCount: 40,
  playerIds,
});

const state = createInitialState(world);
const playerColors = assignPlayerColors(playerIds);
const colorFor = makeCellColorer(world, state, playerColors);

const { positions, colors, indices } = buildPlanetGeometry(world.cells, colorFor);

const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
geometry.setIndex(new THREE.BufferAttribute(indices, 1));

const material = new THREE.MeshBasicMaterial({ vertexColors: true });
const planet = new THREE.Mesh(geometry, material);

const canvas = document.getElementById('planet-canvas');
const viewer = createViewer(canvas);
viewer.scene.add(planet);

function animate() {
  requestAnimationFrame(animate);
  viewer.render();
}
animate();
