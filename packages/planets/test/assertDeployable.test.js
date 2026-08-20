import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findPreviewArtifacts, findStrayPages } from '../scripts/assert-deployable.js';
import { PREVIEW_PAGES } from '../src/preview/pages.js';

// What a clean deployable build actually looks like.
const deployable = ['index.html', 'assets/index-wzgTuuhE.css', 'assets/index-pwr-3yKr.js'];

test('a clean build has nothing to complain about', () => {
  assert.deepEqual(findPreviewArtifacts(deployable), []);
  assert.deepEqual(findStrayPages(deployable), []);
});

test('anything under preview/ is caught', () => {
  const leaked = ['preview/index.html', 'preview/hud.html', 'preview/battles.html'];
  assert.deepEqual(findPreviewArtifacts([...deployable, ...leaked]), leaked);
});

test('the older flat preview names are still caught', () => {
  // in case one comes back, or a stray copy is left behind by an old build
  const leaked = ['preview.html', 'preview-battles.html', 'assets/preview-Db8-oh0m.js'];
  assert.deepEqual(findPreviewArtifacts([...deployable, ...leaked]), leaked);
});

// The preview pages' chunks are named after their entries — `hud-<hash>.js`,
// `battles-<hash>.js` — which no pattern can tell apart from an ordinary
// chunk. Catching the pages themselves is what actually holds the line.
test('any page other than the game is caught, whatever it is called', () => {
  const strays = ['preview/hud.html', 'scratch.html', 'docs/notes.html'];
  assert.deepEqual(findStrayPages([...deployable, ...strays]), strays);
  assert.deepEqual(findStrayPages(['index.html']), [], 'the game itself is the one page allowed');
});

test('innocent names that merely contain "preview" are left alone', () => {
  const innocent = [
    'assets/previewer-abc123.js',
    'assets/livePreviewPanel-def456.js',
    'assets/index-preview-fallback.js',
  ];
  assert.deepEqual(findPreviewArtifacts(innocent), []);
});

// --- the directory at /preview/ stays honest ------------------------------

const previewDir = fileURLToPath(new URL('../preview', import.meta.url));

test('every page the directory lists actually exists', () => {
  const onDisk = new Set(readdirSync(previewDir).filter((name) => name.endsWith('.html')));
  for (const { href } of PREVIEW_PAGES) {
    const file = href.replace('/preview/', '');
    assert.ok(onDisk.has(file), `the directory links to ${href}, which is not there`);
  }
});

test('every preview page is listed in the directory', () => {
  const listed = new Set(PREVIEW_PAGES.map(({ href }) => href.replace('/preview/', '')));
  const pages = readdirSync(previewDir).filter((name) => name.endsWith('.html'));

  for (const file of pages) {
    if (file === 'index.html') continue; // the directory does not list itself
    assert.ok(listed.has(file), `${file} exists but nothing links to it`);
  }
  assert.equal(listed.size, pages.length - 1, 'the list and the folder agree');
});

test('each listed page says what it is for', () => {
  for (const page of PREVIEW_PAGES) {
    assert.match(page.href, /^\/preview\/[\w-]+\.html$/);
    assert.ok(page.title.length > 0, `${page.href} needs a title`);
    assert.ok(page.description.length > 30, `${page.href} needs a real description`);
  }
});
