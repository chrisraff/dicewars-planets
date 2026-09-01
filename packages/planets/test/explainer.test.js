import { test } from 'node:test';
import assert from 'node:assert/strict';
import { winProbability, MAX_DICE_PER_NODE } from '@dicewars/core';
import {
  EVEN_FIGHT,
  EXPLAINER_CAPTURES,
  EXPLAINER_SECTIONS,
  ONE_DIE_UP,
  explainerCaptureNames,
  oddsRowsView,
} from '../src/render/explainer.js';

// --- the odds it quotes ----------------------------------------------------

// The whole reason the figures are computed rather than typed: a table of
// percentages written into a document is a table that can quietly stop being
// true. These are the odds core deals, or they are wrong.
test('every number shown is the number core would deal', () => {
  for (const row of oddsRowsView([...EVEN_FIGHT, ...ONE_DIE_UP])) {
    assert.equal(row.chance, winProbability(row.attack, row.defend));
    assert.equal(row.percent, Math.round(winProbability(row.attack, row.defend) * 100));
  }
});

// The claim the ties section makes, checked against the rules rather than
// against the sentence: `resolveAttack` needs a strictly higher total, so an
// even fight is a losing bet at every size there is.
test('an even fight is never a coin flip, at any stack size', () => {
  const rows = oddsRowsView(EVEN_FIGHT);
  assert.equal(rows.length, MAX_DICE_PER_NODE, 'the whole range, so the shape is the point');

  for (const row of rows) {
    assert.ok(row.chance < 0.5, `${row.label} should favour the defender, got ${row.percent}%`);
  }
});

// The claim the odds section makes, and the one that costs games: the same
// one-die lead is worth less the bigger the stacks get, all the way down.
test('a one-die lead is worth steadily less as the stacks grow', () => {
  const rows = oddsRowsView(ONE_DIE_UP);

  for (let i = 1; i < rows.length; i++) {
    assert.ok(
      rows[i].chance < rows[i - 1].chance,
      `${rows[i].label} should be a worse bet than ${rows[i - 1].label}`
    );
  }
  assert.equal(rows.at(0).percent, 84, 'two against one');
  assert.equal(rows.at(-1).percent, 67, 'eight against seven, the same lead');
});

// A percentage bar has to be drawn on the whole 0–100, so the widths are the
// chances themselves rather than anything stretched to fit.
test('the rows carry the chance itself, not a scaled bar length', () => {
  const rows = oddsRowsView([[8, 1], [1, 8]]);
  assert.equal(rows[0].chance, winProbability(8, 1));
  assert.ok(rows[0].chance > 0.99, 'a fight that is nearly a certainty reads as one');
  assert.ok(rows[1].chance < 0.01);
});

// --- the document and the pictures it asks for -----------------------------

// The contract with `/preview/figures.html`, which shoots one picture per
// entry in EXPLAINER_CAPTURES. A section asking for a capture that is not
// declared is a picture nothing will ever take.
test('every picture a section asks for is one the harness knows to shoot', () => {
  for (const name of explainerCaptureNames()) {
    assert.ok(EXPLAINER_CAPTURES[name], `${name} is used but not declared`);
  }
});

test('every declared picture is actually used', () => {
  const used = new Set(explainerCaptureNames());
  for (const name of Object.keys(EXPLAINER_CAPTURES)) {
    assert.ok(used.has(name), `${name} is shot but nothing shows it`);
  }
});

// `alt` is for somebody who cannot see the picture; `shot` is for somebody who
// has to take it, and doubles as what the document shows in place of a capture
// that has not been committed yet. Neither can be blank without one of those
// two jobs quietly going undone.
test('each picture says what it shows and what has to be shot', () => {
  for (const [name, capture] of Object.entries(EXPLAINER_CAPTURES)) {
    assert.ok(capture.alt.length > 20, `${name} needs alt text`);
    assert.ok(capture.shot.length > 20, `${name} needs a brief`);
  }
});

test('every section has something to look at and something to read', () => {
  for (const section of EXPLAINER_SECTIONS) {
    assert.match(section.id, /^[a-z-]+$/);
    assert.ok(section.title.length > 0, `${section.id} needs a title`);
    assert.ok(section.body.length > 0, `${section.id} needs a body`);
    assert.ok(section.figures.length > 0, `${section.id} needs a figure`);
  }
});

test('the sections are distinct, so the anchors they become are too', () => {
  const ids = EXPLAINER_SECTIONS.map((section) => section.id);
  assert.equal(new Set(ids).size, ids.length);
});

// Every figure kind has to be one `createExplainer` can actually build. There
// is no browser here to catch a missing builder, and the failure without this
// is a section that silently renders as a heading and two paragraphs.
test('every figure is of a kind the document knows how to draw', () => {
  const kinds = new Set(['captures', 'dice', 'odds', 'banked']);
  for (const section of EXPLAINER_SECTIONS) {
    for (const figure of section.figures) {
      assert.ok(kinds.has(figure.kind), `${section.id}: no builder for ${figure.kind}`);
    }
  }
});

// A caption per picture, since the pair figures are a before and an after and
// which is which is not in the picture.
test('every capture in a figure is captioned', () => {
  for (const section of EXPLAINER_SECTIONS) {
    for (const figure of section.figures) {
      if (figure.kind !== 'captures') continue;
      assert.equal(figure.captions.length, figure.names.length, section.id);
    }
  }
});

// The dice figure is the concrete illustration of the tie rule, so it has to
// be an actual tie — a figure showing 7 against 6 would be teaching the rule
// with an example that does not exercise it.
test('the tie figure is a tie', () => {
  const sum = (values) => values.reduce((a, b) => a + b, 0);
  const figures = EXPLAINER_SECTIONS.flatMap((section) => section.figures);
  const dice = figures.filter((figure) => figure.kind === 'dice');

  assert.ok(dice.length > 0, 'the tie rule is worth showing, not only stating');
  for (const figure of dice) {
    assert.equal(sum(figure.attack), sum(figure.defend), 'equal totals, or it shows nothing');
  }
});

// The banked figure has to be a payout that genuinely overflows, and the
// numbers on it have to add up — it is the one figure whose caption states
// arithmetic the reader can check against the chips beside it.
test('the banked figure is a payout that really did not fit', () => {
  const figures = EXPLAINER_SECTIONS.flatMap((section) => section.figures);
  const banked = figures.filter((figure) => figure.kind === 'banked');

  assert.ok(banked.length > 0);
  for (const figure of banked) {
    assert.equal(figure.landed + figure.reserve, figure.earned, 'the chips have to add up');
    assert.ok(figure.reserve > 0, 'nothing is banked unless something failed to land');
  }
});
