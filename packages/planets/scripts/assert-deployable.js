import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, relative, sep } from 'node:path';

// Anything whose name marks it as part of the HUD preview page. Vite names
// entry chunks after their input, so preview.html's JavaScript and CSS come
// out as `preview-<hash>.js` and friends.
// paths are normalized to forward slashes by listFiles below
const PREVIEW_PATTERN = /(^|\/)preview[-.]/i;

export function findPreviewArtifacts(paths) {
  return paths.filter((path) => PREVIEW_PATTERN.test(path));
}

export function listFiles(directory, base = directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...listFiles(full, base));
    else found.push(relative(base, full).replaceAll(sep, '/'));
  }
  return found;
}

function main() {
  const dist = fileURLToPath(new URL('../dist', import.meta.url));

  let files;
  try {
    files = listFiles(dist);
  } catch {
    console.error('assert-deployable: no dist/ to check — run the build first');
    process.exit(1);
  }

  const leaked = findPreviewArtifacts(files);
  if (leaked.length > 0) {
    console.error(
      'assert-deployable: the HUD preview page must not be published, but ' +
        `dist/ contains:\n  ${leaked.join('\n  ')}\n` +
        'It should only be built by vite.preview.config.js, into dist-preview/.'
    );
    process.exit(1);
  }

  console.log(`assert-deployable: ${files.length} files in dist/, no preview page. OK`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
