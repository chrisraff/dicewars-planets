import { defineConfig } from 'vite';

// The deployable site: index.html and nothing else. preview.html is compiled
// separately by vite.preview.config.js so that breaking it fails the build
// without ever putting it in what gets published.
export default defineConfig({
  // Relative, so one build works wherever it is served from. GitHub Pages puts
  // a project site under the repository name
  // (chrisraff.github.io/dicewars-planets/), where root-absolute asset URLs
  // resolve off the top of the domain and 404 — but hard-coding that path
  // instead would break the day this moves to a custom domain, and would make
  // a local `npm run build` produce a site that is not the deployed one.
  //
  // Safe here because the game is a single page that never changes its own
  // path: `main.js` rewrites only the query string. Anything that reaches for
  // a file by URL has to go through `import.meta.env.BASE_URL` rather than
  // writing a leading slash — see `explainer.js`, which is the only one.
  base: './',
  build: { outDir: 'dist' },
});
