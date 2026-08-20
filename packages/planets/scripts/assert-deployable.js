import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, relative, sep } from 'node:path';

// Anything living under a `preview/` directory, or named `preview.*` /
// `preview-*`. Paths are normalized to forward slashes by listFiles below.
const PREVIEW_PATTERN = /(^|\/)preview([-./]|$)/i;

export function findPreviewArtifacts(paths) {
  return paths.filter((path) => PREVIEW_PATTERN.test(path));
}

/**
 * Any page other than the game itself.
 *
 * This is the check that actually holds the line: the preview pages' script
 * chunks are named after their entries (`hud-<hash>.js`, `battles-<hash>.js`),
 * which is indistinguishable from an ordinary chunk — but a page cannot be
 * reached without its HTML, so it is the HTML that has to be absent.
 */
export function findStrayPages(paths) {
  return paths.filter((path) => path.endsWith('.html') && path !== 'index.html');
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

  const leaked = [...new Set([...findPreviewArtifacts(files), ...findStrayPages(files)])];
  if (leaked.length > 0) {
    console.error(
      'assert-deployable: the deployed site is the game and nothing else, but ' +
        `dist/ contains:\n  ${leaked.join('\n  ')}\n` +
        'Preview pages are built only by vite.preview.config.js, into dist-preview/.'
    );
    process.exit(1);
  }

  console.log(`assert-deployable: ${files.length} files in dist/, one page, no previews. OK`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
