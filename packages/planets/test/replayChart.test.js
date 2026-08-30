import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartView, chartSummary, polylinePoints, CHART_BOX } from '../src/render/replayChart.js';

const series = (over = {}) => [
  { playerId: 'p1', territories: [2, 3, 4], dice: [4, 6, 9], ...over },
];

// The chart is read against the stats row above it, so the two have to be
// talking about the same thing: what the scale means is the whole of that.
test('the plot is scaled by the largest value anybody reaches, not by one player', () => {
  const view = chartView({
    series: [
      { playerId: 'p1', territories: [1, 2] },
      { playerId: 'p2', territories: [9, 4] },
    ],
    metric: 'territories',
  });

  assert.equal(view.peak, 9);
  assert.equal(view.lines[1].points[0][1], view.top, "the peak sits on the plot's ceiling");
  assert.equal(view.lines[0].points[0][1], view.bottom - (1 / 9) * (view.bottom - view.top));
});

test('zero is the floor, so a knocked-out player reads as gone rather than as small', () => {
  const view = chartView({
    series: [{ playerId: 'p1', territories: [5, 0] }],
    metric: 'territories',
  });

  assert.equal(view.lines[0].points[1][1], view.bottom);
});

test('a board nobody holds anything on still draws, rather than dividing by zero', () => {
  const view = chartView({ series: [{ playerId: 'p1', dice: [0, 0] }], metric: 'dice' });

  assert.equal(view.peak, 1, 'a floor of one, so the scale is a number');
  for (const [, y] of view.lines[0].points) assert.ok(Number.isFinite(y));
});

test('the steps are spread across the whole width, first to last', () => {
  const view = chartView({ series: series(), metric: 'territories' });
  const xs = view.lines[0].points.map(([x]) => x);

  assert.deepEqual(xs, [0, CHART_BOX.width / 2, CHART_BOX.width]);
});

// A match with no attacks in it never opens a replay, but one whose head has
// been trimmed to a single step can — and a lone point draws nothing at all.
test('a single-step replay is carried across as a flat line rather than left as a dot', () => {
  const view = chartView({ series: [{ playerId: 'p1', dice: [7] }], metric: 'dice' });
  const points = view.lines[0].points;

  assert.equal(points.length, 2);
  assert.deepEqual(points.map(([x]) => x), [0, CHART_BOX.width]);
  assert.equal(points[0][1], points[1][1], 'flat: nothing about the match changed');
});

test('the two tabs read the same replay differently', () => {
  const held = chartView({ series: series(), metric: 'territories' });
  const dice = chartView({ series: series(), metric: 'dice' });

  assert.equal(held.peak, 4);
  assert.equal(dice.peak, 9, 'each reading is scaled to itself — they are different units');
});

test('the cursor stands where the track does, and nowhere at all until it says', () => {
  assert.equal(chartView({ series: series(), metric: 'dice' }).cursor, null);
  assert.equal(chartView({ series: series(), metric: 'dice', step: 0 }).cursor, 0);
  assert.equal(chartView({ series: series(), metric: 'dice', step: 2 }).cursor, CHART_BOX.width);
});

// The track is a count of attacks and the series has a step per attack *plus*
// the opening board, so the last step is one off the end of a naive index.
test('a cursor past the last step lands on the end of the chart, not off it', () => {
  const view = chartView({ series: series(), metric: 'dice', step: 99 });
  assert.equal(view.cursor, CHART_BOX.width);
});

test('a player missing a reading draws nothing rather than throwing', () => {
  const view = chartView({ series: [{ playerId: 'p1' }], metric: 'dice' });
  assert.deepEqual(view.lines[0].points, []);
});

test('points are written out short enough to read in a devtools inspector', () => {
  assert.equal(polylinePoints([[0, 1.0149], [10.5, 2]]), '0,1.01 10.5,2');
});

test('the summary counts attacks rather than steps, which is what the track counts', () => {
  assert.equal(
    chartSummary({ metric: 'territories', steps: 3, peak: 9 }),
    'Territories per player over 2 attacks, peaking at 9.'
  );
  assert.match(chartSummary({ metric: 'dice', steps: 2, peak: 1 }), /over 1 attack,/);
});
