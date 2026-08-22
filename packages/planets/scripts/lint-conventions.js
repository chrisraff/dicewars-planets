import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Conventions that hold the interface together but are not behavior, so they
 * cannot be tested by running anything: an element's class agreeing with the
 * stylesheet that makes it visible, a shared constant not having quietly grown
 * a second copy, a preview page not restyling the thing it exists to show.
 *
 * These read the source as text. That is exactly why they live here and not in
 * `npm test`: they are coupled to how the code is written rather than to what
 * it does, so a rename or a reformat can fail one without anything being
 * broken. Keeping them out of the test suite means a red test still means a
 * real defect, while these still run — `npm run build` will not produce a site
 * that has drifted.
 */

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const source = {
  // the interface's markup is split across these, and they all draw on one sheet
  hud: ['hud', 'battleReadout', 'menu'].map((m) => read(`../src/render/${m}.js`)).join('\n'),
  stylesheet: read('../src/render/hud.css'),
  previewStyles: read('../src/preview/preview.css'),
  page: read('../index.html'),
  previewPages: ['hud', 'battles'].map((p) => read(`../preview/${p}.html`)),
  previewIndex: read('../preview/index.html'),
};

// --- the checks --------------------------------------------------------------

// Each check returns the problems it found, as a list of strings. Empty passes.
const checks = [];
const check = (name, fn) => checks.push({ name, fn });

// Classes that exist only so JavaScript can find the element again — they
// carry no appearance of their own, so having no rule is correct.
const QUERY_HANDLES = new Set([
  'hud-turn-text', // sits inside .hud-turn, which is what's styled
]);

function classesUsedBy(text) {
  const used = new Set();
  for (const [, list] of text.matchAll(/class="([^"]+)"/g)) {
    for (const name of list.trim().split(/\s+/)) used.add(name);
  }
  for (const [, name] of text.matchAll(/classList\.toggle\(\s*['"]([\w-]+)['"]/g)) used.add(name);
  // elements built with createElementNS take their class this way
  for (const [, list] of text.matchAll(/setAttribute\(\s*'class',\s*'([^']+)'/g)) {
    for (const name of list.trim().split(/\s+/)) used.add(name);
  }
  // the state classes the pure view hands back for the DOM to apply
  for (const [, name] of text.matchAll(/'(is-[\w-]+)':/g)) used.add(name);
  return used;
}

/** Reads one rule's declarations out of the stylesheet. */
function ruleFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `\s*\{` rather than just `\{`, so `.hud-player` doesn't match the rule for
  // `.hud-player-name` or `.hud-player.is-current`
  const match = source.stylesheet.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : null;
}

const wants = (problems, selector, pattern, why) => {
  const rule = ruleFor(selector);
  if (rule === null) problems.push(`no rule for ${selector}`);
  else if (!pattern.test(rule)) problems.push(`${selector}: ${why}`);
};

const rejects = (problems, selector, pattern, why) => {
  const rule = ruleFor(selector);
  if (rule !== null && pattern.test(rule)) problems.push(`${selector}: ${why}`);
};

// === Structural: nothing else connects these, so drift is silent =============

check('every class the interface applies is actually styled', () => {
  const problems = [];
  const used = classesUsedBy(source.hud);
  if (used.size <= 8) problems.push(`expected to find the HUD's classes, only saw ${used.size}`);

  for (const name of used) {
    if (QUERY_HANDLES.has(name)) continue;
    if (!source.stylesheet.includes(`.${name}`)) problems.push(`.${name} renders but has no rule`);
  }
  return problems;
});

check('the query-handle exemptions really are handles', () => {
  // if one of these grows a rule it stopped being a bare handle, and the
  // exemption should go rather than quietly widening
  const problems = [];
  for (const name of QUERY_HANDLES) {
    if (!source.hud.includes(name)) problems.push(`${name} is exempted but no longer used`);
    if (source.stylesheet.includes(`.${name} `)) {
      problems.push(`${name} now has styling — drop the exemption`);
    }
  }
  return problems;
});

check('the state classes the stats row depends on are all defined', () => {
  const wanted = ['is-current', 'is-out', 'is-winner', 'is-empty', 'is-full'];
  return wanted.filter((n) => !source.stylesheet.includes(`.${n}`)).map((n) => `.${n} has no rule`);
});

check('the shared constants have not grown a second copy', () => {
  // a die on the planet and the same die in the battle readout only agree for
  // as long as there is one pip table between them
  const problems = [];
  for (const name of ['diceTextures', 'battleReadout']) {
    const text = read(`../src/render/${name}.js`);
    if (!/from '\.\/pips\.js'/.test(text)) problems.push(`${name}.js should import ./pips.js`);
    if (/PIP_LAYOUTS\s*=/.test(text)) problems.push(`${name}.js has grown its own pip table`);
    if (/0\.27,\s*0\.27/.test(text)) problems.push(`${name}.js has pip coordinates inlined`);
  }
  for (const name of ['diceLayer', 'battleReadout']) {
    const text = read(`../src/render/${name}.js`);
    if (!/from '\.\/diceStacks\.js'/.test(text)) {
      problems.push(`${name}.js should read stack slots from ./diceStacks.js`);
    }
  }
  return problems;
});

check('every preview page and the game share one stylesheet', () => {
  // a preview is only worth having if it cannot drift from the real thing
  const problems = [];
  const href = '/src/render/hud.css';
  if (!source.page.includes(href)) problems.push('the game does not load the shared stylesheet');
  if (/<style>[\s\S]*\.hud-player/.test(source.page)) {
    problems.push('HUD rules left inline in the game page');
  }
  if (source.previewPages.length !== 2) problems.push('expected two preview pages to check');

  for (const preview of source.previewPages) {
    if (!preview.includes(href)) problems.push('a preview does not load the shared stylesheet');
    if (/<style>/.test(preview)) problems.push('a preview page carries styles of its own');
    if (/<style>[\s\S]*\.hud-player/.test(preview)) problems.push('a preview restyles the HUD');
    if (!/href="\/preview\/"/.test(preview)) problems.push('a preview has no way back to the index');
  }
  if (!/id="directory"/.test(source.previewIndex)) {
    problems.push('the preview index has nowhere to render its list');
  }
  if (/<style>/.test(source.previewIndex)) problems.push('the directory carries its own styles');
  return problems;
});

check('preview furniture styles the caption, never the exhibit', () => {
  // A preview stage contains the game's own markup. A descendant selector
  // rooted at the preview's own furniture — `.scenario p` — reaches straight
  // into it and outranks `.hud-banner-title` on specificity, silently
  // restyling the very thing the preview exists to show. `.scenario > p` cannot.
  const containers = ['.scenario', '.stage', '.menu-host', '.hud-host'];
  const reaching = [];

  for (const [, selector] of source.previewStyles.matchAll(/^([^@{}\n][^{}]*)\{/gm)) {
    for (const part of selector.split(',')) {
      const trimmed = part.trim();
      for (const container of containers) {
        if (trimmed.startsWith(`${container} `) && !trimmed.startsWith(`${container} >`)) {
          reaching.push(trimmed);
        }
      }
    }
  }
  return reaching
    .filter((selector) => !selector.includes('.battle-die'))
    .map((selector) => `${selector} reaches into a stage and can restyle the game markup inside`);
});

// === Appearance: these encode a layout decision, not a behavior ==============
//
// Every check below asserts an exact CSS declaration, which is the brittle
// kind: a shorthand, a reformat, or moving a rule into a media query fails one
// without anything having broken. They are here because the invariants are
// real and nothing else guards them — but the right home for them is a couple
// of headless-browser layout assertions, and when that exists this block
// should go rather than grow.

check('the banked-dice badge cannot change the size of a tile', () => {
  // it is hidden at zero and shown otherwise, so if it took part in layout the
  // tiles would be different sizes depending on who had dice banked
  const problems = [];
  wants(problems, '.hud-player-reserve', /position:\s*absolute/, 'the badge must stay out of flow');
  wants(problems, '.hud-player', /position:\s*relative/, 'or it anchors to the wrong ancestor');
  wants(problems, '.hud-player-reserve', /right:/, 'and must sit against the right edge');
  return problems;
});

check('tiles are sized by a floor, not by their contents alone', () => {
  const problems = [];
  wants(problems, '.hud-player', /min-width:/, 'tiles need a common minimum width');
  wants(problems, '.hud-player', /flex:\s*0 0 auto/, 'and must not be squashed in the row');
  return problems;
});

check('a battle shows every die when there is room, and falls back when there is not', () => {
  const problems = [];
  wants(problems, '.battle-summary', /display:\s*none/, 'no stack marks unless compact');
  rejects(problems, '.battle-dice', /overflow-x/, 'the full strip must not scroll');
  wants(problems, '.battle-dice', /min-width:\s*0/, 'or a flex child refuses to shrink');
  return problems;
});

check('the compact reading pins the result and scrolls only the dice', () => {
  const problems = [];
  wants(problems, '.is-compact .battle-summary', /display:\s*flex/, 'the summary must appear');
  wants(problems, '.battle-summary', /flex:\s*0 0 auto/, 'the result must not shrink');
  wants(problems, '.is-compact .battle-dice', /overflow-x:\s*auto/, 'only the dice scroll');
  wants(problems, '.is-compact .is-inline', /display:\s*none/, 'inline totals step aside');
  for (const container of ['.battle-current', '.battle-row']) {
    wants(problems, container, /overflow:\s*hidden/, 'or the result scrolls away with the dice');
  }
  return problems;
});

check('the battle readout is a fixed width, shared between the button and its history', () => {
  // one cap, defined once, so the button that opens the panel and the panel
  // itself can never quietly drift apart — which is also what keeps the
  // chevron on the button from bouncing around battle to battle. Each rule
  // still turns the cap into its own width rather than sharing one literal
  // `width` value, because the button (normal flow) and the panel (absolute
  // over a padded parent) resolve a bare `100%` against different boxes.
  const problems = [];
  wants(problems, '.hud-battle', /align-self:\s*stretch/, 'the row still spans the top of the screen');
  wants(problems, ':root', /--battle-readout-cap:\s*21rem/, 'deliberately narrow, not full width');
  for (const selector of ['.battle-current', '.battle-history']) {
    wants(problems, selector, /width:\s*min\(var\(--battle-readout-cap\)/, 'must track the shared cap');
  }
  return problems;
});

check('the stack mark is two wide and four high, as the dice stack on the planet', () => {
  const problems = [];
  wants(problems, '.battle-count', /grid-template-columns:\s*repeat\(2,/, 'two columns');
  wants(problems, '.battle-count', /grid-template-rows:\s*repeat\(4,/, 'four rows');
  return problems;
});

check('a scrollable dice strip fades over the edges it can scroll towards', () => {
  // a mask rather than an overlay: what sits behind the strip is a translucent
  // panel over a moving planet, so there is no solid color to fade into
  const problems = [];
  for (const [selector, edges] of [
    ['.battle-dice.is-faded-right', 1],
    ['.battle-dice.is-faded-left', 1],
    ['.battle-dice.is-faded-left.is-faded-right', 2],
  ]) {
    const rule = ruleFor(selector);
    if (rule === null) {
      problems.push(`no rule for ${selector}`);
      continue;
    }
    if (!/mask-image:\s*linear-gradient/.test(rule)) problems.push(`${selector} needs a mask`);
    if (!/-webkit-mask-image/.test(rule)) problems.push(`${selector} needs the prefixed form too`);
    // the rule is written twice, prefixed and not
    const faded = (rule.match(/transparent/g) ?? []).length / 2;
    if (faded !== edges) problems.push(`${selector} should fade exactly ${edges} edge(s)`);
  }
  return problems;
});

check('the winning side is marked by a border rather than a glow', () => {
  const problems = [];
  wants(problems, '.battle-outcome.is-winner', /border-color:\s*#fff/, 'as the stats row does');
  rejects(problems, '.battle-outcome.is-winner', /text-shadow/, 'a glow makes digits harder to read');
  return problems;
});

check('the outcome banner reads as a title whichever ending it is', () => {
  // the eliminated banner once had a size of its own, which made it the only
  // one that looked like a heading when a preview rule stole the base size
  const problems = [];
  wants(problems, '.hud-banner-title', /font-size:\s*clamp/, 'one size, set in one place');
  if (/\.hud-banner\.is-\w+\s+\.hud-banner-title\s*\{[^}]*font-size/.test(source.stylesheet)) {
    problems.push('one ending gets a different title size from the others');
  }
  return problems;
});

check('the page is laid out for phones as well as desktops', () => {
  const problems = [];
  if (!source.page.includes('viewport-fit=cover')) problems.push('needs to reach under the notch');
  if (!source.page.includes('100dvh')) problems.push('browser chrome sliding away crops the canvas');
  if (!source.stylesheet.includes('safe-area-inset')) {
    problems.push('controls must clear the home indicator');
  }
  if (!source.stylesheet.includes('overflow-x: auto')) {
    problems.push('the player row has to scroll when full');
  }
  if (!/@media[^{]*max-width/.test(source.stylesheet)) {
    problems.push('no narrow-screen adjustments at all');
  }
  return problems;
});

// --- running them ------------------------------------------------------------

export function runChecks() {
  const failures = [];
  for (const { name, fn } of checks) {
    const problems = fn() ?? [];
    for (const problem of problems) failures.push({ name, problem });
  }
  return failures;
}

function main() {
  const failures = runChecks();
  if (failures.length === 0) {
    console.log(`lint-conventions: ${checks.length} conventions hold. OK`);
    return;
  }

  console.error('lint-conventions: the interface has drifted from its own conventions\n');
  let last = null;
  for (const { name, problem } of failures) {
    if (name !== last) console.error(`  ${name}`);
    console.error(`    - ${problem}`);
    last = name;
  }
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
