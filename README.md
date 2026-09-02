# Dice Wars Planets

Dice Wars played on a sphere: a procedurally generated planet of hexagonal
territories, rendered with three.js.

Take a territory that holds more than one die, attack a neighbour, and both
sides roll everything they have. Win and you move in, leaving one die behind.
At the end of your turn you earn one die for every territory in your largest
*connected* region — so a sprawling empire pays less than a solid one.

## Running it

```bash
npm install
npm run dev      # vite dev server, --host so a phone on the LAN can reach it
npm test         # every test in every package
npm run build    # site -> dist/, plus the guards and the preview pages
```

`npm run build` does four things in order: the conventions lint, the site
build, a check that nothing preview-shaped leaked into `dist/`, and a separate
compile of the preview pages so that breaking one fails the build. The
previews are never deployed.

## Deploying

Pushing to `main` publishes to GitHub Pages, from the `deploy` job in
`.github/workflows/ci.yml`. It runs only after the tests and the build pass,
and publishes the artifact that build produced rather than building again — so
what is served is the bytes that were checked. Pull requests build, and publish
nothing.

It needs the repository's **Settings → Pages → Source** set to *GitHub
Actions*; on the default *Deploy from a branch* the job fails rather than
quietly serving something else.

The site is built with a relative `base`, so the same output works at the root
of a domain and under a repository path
(`chrisraff.github.io/dicewars-planets/`). Anything that fetches a file by URL
has to go through `import.meta.env.BASE_URL` rather than writing a leading
slash — `explainer.js` and its pictures are the only place that does.

## Layout

An npm workspace with two packages.

**`packages/core`** (`@dicewars/core`) is the rules, and nothing else: pure,
dependency-free, and unaware of planets, three.js and the DOM. State is a plain
object, actions are plain objects, and `reduce(state, action, deps)` returns
`{ state, events }` without mutating anything. Both sources of chance arrive
through `deps` — `rollDie` for a battle, `rng` for where reinforcements land —
so a test or a replay can pin either.

The graph core plays on is topology only: which territory touches which, with
no coordinates and no shape. That is what lets a second board (the classic flat
map) sit alongside the planet without core changing.

**`packages/planets`** (`@dicewars/planets`) is the world, the renderer and the
interface:

- `src/geometry/` builds a Goldberg polyhedron — subdivide an icosahedron, take
  the dual, and every original vertex becomes a pentagon while every
  subdivision vertex becomes a hexagon.
- `src/world/` carves ocean out of the sphere, groups the remaining land into
  territories, and rotates the planet so its strongest ring of territories runs
  along the equator.
- `src/game/` sits between core and the screen. `createGame.js` owns turn flow
  and takes time through `tick(dt)` rather than a clock, so a hundred turns run
  instantly in a test. `session.js` is one match, created whole and disposed
  whole. `settings.js` declares every option once, as data. `saveGame.js` keeps
  a game in progress across a reload.
- `src/render/` is three.js and the DOM, with the decisions worth testing
  pulled out as pure functions.

## Coming back to a game

Close the tab mid-game and the next visit leads with **Continue**. The planet
is stored as the single number it was grown from rather than as geometry —
world generation is deterministic given a seed, so one number rebuilds every
cell — alongside the things no amount of regrowing recovers: who owns what, how
many dice, whose turn it is, what has been banked, and the battles fought so
far. It is written after every move, so nothing is lost to a crash or a phone
killing the tab. If the world generator ever changes under an old save, a
fingerprint of the planet catches it and the save is discarded rather than
laid over land that is not there any more.

## Previews

`/preview/` is a directory of development pages showing each part of the
interface in every state it reaches, without playing a game to get there. They
use the real components and the real stylesheet, so they cannot drift from what
the game actually shows. `src/preview/pages.js` is the manifest.

## Tests

Plain `node --test` ESM files: no framework, no transpiler, no mocking library.
The suite is a few hundred tests and runs in well under a second, which is the
point — it is fast because nothing in it needs a browser.

Tests state a claim the implementation does not itself guarantee, rather than
restating what the code does. Conventions that can only be checked by reading
the source as text — a class agreeing with the stylesheet, a shared constant
not having grown a second copy — live in `packages/planets/scripts/lint-conventions.js`
instead, and run as part of the build. That keeps a red test meaning a real
defect.

See `CLAUDE.md` for the longer notes on how each part is put together.
