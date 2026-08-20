import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// hud.js builds its markup and toggles its state classes in JavaScript, while
// the rules that make any of it visible live in hud.css. Nothing else connects
// the two, so a renamed class fails silently — the panel renders, just
// unstyled. This checks they still agree.
const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const hudSource = read('../src/render/hud.js');
const stylesheet = read('../src/render/hud.css');
const page = read('../index.html');
const previewPage = read('../preview.html');

// Classes that exist only so JavaScript can find the element again — they
// carry no appearance of their own, so having no rule is correct. Everything
// else on an element is there to be seen.
const QUERY_HANDLES = new Set([
  'hud-turn-text', // sits inside .hud-turn, which is what's styled
  'hud-roll-attacker', // both get their looks from .hud-roll; the side-specific
  'hud-roll-defender', // class only tells the two labels apart in code
]);

function classesUsedBy(source) {
  const used = new Set();
  for (const [, list] of source.matchAll(/class="([^"]+)"/g)) {
    for (const name of list.trim().split(/\s+/)) used.add(name);
  }
  for (const [, name] of source.matchAll(/classList\.toggle\(\s*['"]([\w-]+)['"]/g)) {
    used.add(name);
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

test('the preview page and the game share one stylesheet', () => {
  // the preview is only worth having if it cannot drift from the real thing
  const href = '/src/render/hud.css';
  assert.ok(page.includes(href), 'the game loads the shared HUD stylesheet');
  assert.ok(previewPage.includes(href), 'and so does the preview');
  assert.ok(!/<style>[\s\S]*\.hud-player/.test(page), 'no HUD rules left inline in the game page');
  assert.ok(!/<style>[\s\S]*\.hud-player/.test(previewPage), 'nor restyled in the preview');
});
