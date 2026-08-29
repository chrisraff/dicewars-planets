import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const PAGES = [
  'index',
  'menu',
  'hud',
  'hints',
  'battles',
  'endgame',
  'poles',
  'dice',
  'replay',
  'replay-perf',
  'surrender',
  'terrain',
];

/**
 * Compiles the development preview pages — the directory at /preview/ and the
 * pages it lists — on their own, into a throwaway directory that is never
 * deployed.
 *
 * The point is only that they still build: if someone renames an export a
 * preview imports, `npm run build` fails here rather than the next time
 * somebody happens to open the page. The output is discarded, and `dist/`
 * (which is what GitHub Pages publishes) never contains any of it.
 */
export default defineConfig({
  build: {
    outDir: 'dist-preview',
    emptyOutDir: true,
    rollupOptions: {
      input: PAGES.map((page) =>
        fileURLToPath(new URL(`./preview/${page}.html`, import.meta.url))
      ),
    },
  },
});
