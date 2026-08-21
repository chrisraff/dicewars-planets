import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// hud.js and battleReadout.js build their markup and toggle their state
// classes in JavaScript, while the rules that make any of it visible live in
// hud.css. Nothing else connects the two, so a renamed class fails silently —
// the element renders, just unstyled. This checks they still agree.
const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

// the interface's markup is split across these, and they all draw on one sheet
const hudSource = ['hud', 'battleReadout', 'menu']
  .map((module) => read(`../src/render/${module}.js`))
  .join('\n');
const stylesheet = read('../src/render/hud.css');
const previewStyles = read('../src/preview/preview.css');
const page = read('../index.html');
const previewPages = ['hud', 'battles'].map((page) => read(`../preview/${page}.html`));
const previewIndex = read('../preview/index.html');

// Classes that exist only so JavaScript can find the element again — they
// carry no appearance of their own, so having no rule is correct. Everything
// else on an element is there to be seen.
const QUERY_HANDLES = new Set([
  'hud-turn-text', // sits inside .hud-turn, which is what's styled
]);

function classesUsedBy(source) {
  const used = new Set();
  for (const [, list] of source.matchAll(/class="([^"]+)"/g)) {
    for (const name of list.trim().split(/\s+/)) used.add(name);
  }
  for (const [, name] of source.matchAll(/classList\.toggle\(\s*['"]([\w-]+)['"]/g)) {
    used.add(name);
  }
  // elements built with createElementNS take their class this way
  for (const [, list] of source.matchAll(/setAttribute\(\s*'class',\s*'([^']+)'/g)) {
    for (const name of list.trim().split(/\s+/)) used.add(name);
  }
  // the state classes the pure view hands back for the DOM to apply
  for (const [, name] of source.matchAll(/'(is-[\w-]+)':/g)) used.add(name);
  return used;
}

test('every class the HUD applies is actually styled', () => {
  const used = classesUsedBy(hudSource);
  assert.ok(used.size > 8, `expected to find the HUD's classes, only saw ${used.size}`);

  const unstyled = [...used]
    .filter((name) => !QUERY_HANDLES.has(name))
    .filter((name) => !stylesheet.includes(`.${name}`));
  assert.deepEqual(unstyled, [], `these render but have no styling: ${unstyled.join(', ')}`);
});

test('the query-handle exemptions really are handles, not forgotten styling', () => {
  // if one of these ever grows a rule, it stopped being a bare handle and the
  // exemption should go rather than quietly widening
  for (const name of QUERY_HANDLES) {
    assert.ok(hudSource.includes(name), `${name} is exempted but no longer used`);
    assert.ok(!stylesheet.includes(`.${name} `), `${name} now has styling — drop the exemption`);
  }
});

test('the state classes the stats row depends on are all defined', () => {
  for (const name of ['is-current', 'is-out', 'is-winner', 'is-empty', 'is-full']) {
    assert.ok(stylesheet.includes(`.${name}`), `${name} has no rule`);
  }
});

// Reading one rule's declarations out of the stylesheet.
function ruleFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `\s*\{` rather than just `\{`, so `.hud-player` doesn't match the rule for
  // `.hud-player-name` or `.hud-player.is-current`
  const match = stylesheet.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `no rule for ${selector}`);
  return match[1];
}

test('the banked-dice badge cannot change the size of a tile', () => {
  // it is hidden at zero and shown otherwise, so if it took part in layout the
  // tiles would be different sizes depending on who had dice banked
  assert.match(
    ruleFor('.hud-player-reserve'),
    /position:\s*absolute/,
    'the badge must stay out of flow'
  );
  assert.match(
    ruleFor('.hud-player'),
    /position:\s*relative/,
    'or it will anchor to the wrong ancestor'
  );
  assert.match(ruleFor('.hud-player-reserve'), /right:/, 'and sit against the right edge');
});

test('a battle shows every die when there is room, and falls back when there is not', () => {
  // full is the default reading: totals sit among the dice, nothing scrolls
  assert.match(ruleFor('.battle-summary'), /display:\s*none/, 'no stack marks unless compact');
  assert.doesNotMatch(ruleFor('.battle-dice'), /overflow-x/, 'and the strip does not scroll');
  assert.match(ruleFor('.battle-dice'), /min-width:\s*0/, 'or a flex child refuses to shrink');
});

test('the compact reading pins the result and scrolls only the dice', () => {
  assert.match(ruleFor('.is-compact .battle-summary'), /display:\s*flex/);
  assert.match(ruleFor('.battle-summary'), /flex:\s*0 0 auto/, 'the result must not shrink');
  assert.match(ruleFor('.is-compact .battle-dice'), /overflow-x:\s*auto/, 'only the dice scroll');
  assert.match(ruleFor('.is-compact .is-inline'), /display:\s*none/, 'inline totals step aside');

  for (const container of ['.battle-current', '.battle-row']) {
    assert.match(
      ruleFor(container),
      /overflow:\s*hidden/,
      `${container} must not scroll as a whole, or the result scrolls away with the dice`
    );
  }
});

test('a big battle can use the full width, but the history panel stays narrow', () => {
  // outside the history there is room to spread out, so an eight-on-eight is
  // read in full; inside it the panel is capped, which is what collapses rows
  assert.match(ruleFor('.hud-battle'), /align-self:\s*stretch/, 'the readout may use it all');
  assert.match(ruleFor('.battle-current'), /max-width:\s*100%/, 'up to the width available');
  assert.match(ruleFor('.battle-history'), /width:\s*min\(/, 'the panel is deliberately confined');
});

test('the stack mark is two wide and four high, as the dice stack on the planet', () => {
  const mark = ruleFor('.battle-count');
  assert.match(mark, /grid-template-columns:\s*repeat\(2,/, 'two columns');
  assert.match(mark, /grid-template-rows:\s*repeat\(4,/, 'four rows');
});

test('a scrollable dice strip fades over the edges it can scroll towards', () => {
  // a mask rather than an overlay: what sits behind the strip is a translucent
  // panel over a moving planet, so there is no solid color to fade into
  for (const [selector, edges] of [
    ['.battle-dice.is-faded-right', ['right']],
    ['.battle-dice.is-faded-left', ['left']],
    ['.battle-dice.is-faded-left.is-faded-right', ['left', 'right']],
  ]) {
    const rule = ruleFor(selector);
    assert.match(rule, /mask-image:\s*linear-gradient/, `${selector} needs a mask`);
    assert.match(rule, /-webkit-mask-image/, `${selector} needs the prefixed form too`);
    assert.equal(
      (rule.match(/transparent/g) ?? []).length / 2, // the rule is written twice, prefixed
      edges.length,
      `${selector} should fade exactly ${edges.length} edge(s)`
    );
  }
});

test('the winning side is marked by a border rather than a glow', () => {
  const winner = ruleFor('.battle-outcome.is-winner');
  assert.match(winner, /border-color:\s*#fff/, 'the same signal the stats row uses');
  assert.doesNotMatch(winner, /text-shadow/, 'a glow over digits makes them harder to read');
});

test('tiles are sized by a floor, not by their contents alone', () => {
  assert.match(ruleFor('.hud-player'), /min-width:/, 'tiles need a common minimum width');
  assert.match(ruleFor('.hud-player'), /flex:\s*0 0 auto/, 'and must not be squashed in the row');
});

test('the page is laid out for phones as well as desktops', () => {
  assert.ok(page.includes('viewport-fit=cover'), 'needs to reach under the notch');
  assert.ok(page.includes('100dvh'), 'browser chrome sliding away must not crop the canvas');
  assert.ok(stylesheet.includes('safe-area-inset'), 'controls must clear the home indicator');
  assert.ok(stylesheet.includes('overflow-x: auto'), 'the player row has to scroll when full');
  assert.ok(/@media[^{]*max-width/.test(stylesheet), 'no narrow-screen adjustments at all');
});

test('every preview page and the game share one stylesheet', () => {
  // a preview is only worth having if it cannot drift from the real thing
  const href = '/src/render/hud.css';
  assert.ok(page.includes(href), 'the game loads the shared HUD stylesheet');
  assert.ok(!/<style>[\s\S]*\.hud-player/.test(page), 'no HUD rules left inline in the game page');

  assert.equal(previewPages.length, 2, 'both preview pages are being checked');
  for (const preview of previewPages) {
    assert.ok(preview.includes(href), 'every preview loads the shared stylesheet');
    assert.doesNotMatch(preview, /<style>/, 'preview pages carry no styles of their own');
    assert.ok(
      !/<style>[\s\S]*\.hud-player/.test(preview),
      'a preview must not restyle the HUD, or it stops showing what the game shows'
    );
  }
});

test('every preview page links back to the directory', () => {
  for (const preview of previewPages) {
    assert.match(preview, /href="\/preview\/"/, 'each page offers a way back to the index');
  }
  assert.match(previewIndex, /id="directory"/, 'and the index has somewhere to render the list');
  assert.doesNotMatch(previewIndex, /<style>/, 'the directory uses the shared preview stylesheet');
});

// A preview stage contains the game's own markup. A descendant selector rooted
// at the preview's own furniture — `.scenario p` — reaches straight into it and
// outranks `.hud-banner-title` on specificity, silently restyling the very
// thing the preview exists to show. `.scenario > p` cannot.
test('preview furniture styles the caption, never the exhibit', () => {
  const containers = ['.scenario', '.stage', '.menu-host', '.hud-host'];
  const reaching = [];

  const SELECTOR = new RegExp('^([^@{}\\n][^{}]*)\\{', 'gm');
  for (const [, selector] of previewStyles.matchAll(SELECTOR)) {
    for (const part of selector.split(',')) {
      const trimmed = part.trim();
      for (const container of containers) {
        // `.scenario > h2` is fine; `.scenario h2` reaches arbitrarily deep
        if (trimmed.startsWith(`${container} `) && !trimmed.startsWith(`${container} >`)) {
          reaching.push(trimmed);
        }
      }
    }
  }

  assert.deepEqual(
    reaching.filter((selector) => !selector.includes('.battle-die')),
    [],
    'these reach into a stage and can restyle the game markup inside it'
  );
});

test('the outcome banner reads as a title whichever ending it is', () => {
  // the eliminated banner once had a size of its own, which made it the only
  // one that looked like a heading when a preview rule stole the base size
  const title = ruleFor('.hud-banner-title');
  assert.match(title, /font-size:\s*clamp/, 'one size, set in one place');
  assert.doesNotMatch(
    stylesheet,
    /\.hud-banner\.is-\w+\s+\.hud-banner-title\s*\{[^}]*font-size/,
    'no ending gets a different title size from the others'
  );
});
