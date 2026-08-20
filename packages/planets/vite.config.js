import { defineConfig } from 'vite';

// The deployable site: index.html and nothing else. preview.html is compiled
// separately by vite.preview.config.js so that breaking it fails the build
// without ever putting it in what gets published.
export default defineConfig({
  build: { outDir: 'dist' },
});
