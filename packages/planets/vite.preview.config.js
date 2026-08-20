import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * Compiles preview.html — the HUD development page — on its own, into a
 * throwaway directory that is never deployed.
 *
 * The point is only that it still builds: if someone renames an export the
 * preview imports, or deletes a scenario helper, `npm run build` fails here
 * rather than the next time somebody happens to open the page. The output is
 * discarded, and `dist/` (which is what GitHub Pages publishes) never contains
 * preview.html or any chunk of it.
 */
export default defineConfig({
  build: {
    outDir: 'dist-preview',
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./preview.html', import.meta.url)),
    },
  },
});
