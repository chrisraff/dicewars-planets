import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPreviewArtifacts } from '../scripts/assert-deployable.js';

// What a clean deployable build actually looks like.
const deployable = [
  'index.html',
  'assets/index-wzgTuuhE.css',
  'assets/index-pwr-3yKr.js',
];

test('a clean build has nothing to complain about', () => {
  assert.deepEqual(findPreviewArtifacts(deployable), []);
});

test('the preview page itself is caught', () => {
  assert.deepEqual(findPreviewArtifacts([...deployable, 'preview.html']), ['preview.html']);
});

test('the preview’s chunks are caught too, not just its page', () => {
  // deleting preview.html but leaving its JavaScript behind would still ship it
  const leaked = ['assets/preview-Db8-oh0m.js', 'assets/preview-wzgTuuhE.css'];
  assert.deepEqual(findPreviewArtifacts([...deployable, ...leaked]), leaked);
});

test('a nested copy is caught wherever it ends up', () => {
  assert.deepEqual(findPreviewArtifacts(['docs/dev/preview.html']), ['docs/dev/preview.html']);
});

test('innocent names that merely contain "preview" are left alone', () => {
  // the separator after "preview" is what marks it as an entry name, so real
  // application files are not swept up by accident
  const innocent = [
    'assets/previewer-abc123.js',
    'assets/livePreviewPanel-def456.js',
    'assets/index-preview-fallback.js',
  ];
  assert.deepEqual(findPreviewArtifacts(innocent), []);
});
