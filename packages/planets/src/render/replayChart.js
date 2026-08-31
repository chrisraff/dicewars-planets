/**
 * The shape of a match, drawn: how much of the planet each player held, and
 * how many dice they had standing on it, from the opening board to the last
 * attack.
 *
 * It reads the replay and nothing else — `standingsOverReplay` is the same
 * walk over the same moves that draws the board, so the chart and the planet
 * under it can never disagree about a step.
 *
 * The pure half is `chartView`: everything about where a line goes, decided
 * as data so it can be read and tested without an SVG. The DOM below only
 * applies it.
 */

/**
 * The plot's own coordinates. The SVG scales uniformly to whatever width the
 * card gives it (`preserveAspectRatio` left at its default), so these are the
 * only numbers the geometry below is stated in — nothing here has to know how
 * many pixels wide the thing ended up.
 */
export const CHART_BOX = { width: 600, height: 200 };

// The band across the top is for the peak label, which sits above the line it
// labels rather than over the plot: a chart this short has no room for a
// label inside it that does not land on somebody's line.
const TOP = 16;
const BOTTOM = CHART_BOX.height - 4;

/** The two readings, in the order their tabs sit in. */
export const CHART_METRICS = [
  { id: 'territories', label: 'Territories' },
  { id: 'dice', label: 'Dice' },
];

/**
 * Where every player's line goes, for one reading of one replay.
 *
 * `series` is `standingsOverReplay`'s output. `step` is where the track is
 * standing and comes back as the x of the cursor, so the chart says which part
 * of the match is on the planet right now.
 *
 * **The scale is the peak itself rather than a round number above it**:
 * rounding 60 territories up to 100 spends two fifths of a short plot on
 * nothing, and a peak is a fact about the match worth reading in its own right.
 *
 * A replay of a single step is drawn as a line across rather than one point —
 * a dot in an empty box says nothing, and "it never changed" is the truth
 * about that match.
 */
export function chartView({ series, metric, step = null }) {
  const values = series.map((entry) => entry[metric] ?? []);
  const steps = Math.max(0, ...values.map((line) => line.length));
  // never zero: a board nobody holds anything on would otherwise be scaled by
  // dividing by it, and every line belongs on the floor in that case anyway
  const peak = Math.max(1, ...values.flat());

  const x = (index) => (steps > 1 ? (index / (steps - 1)) * CHART_BOX.width : 0);
  const y = (value) => BOTTOM - (value / peak) * (BOTTOM - TOP);

  const lines = series.map((entry, i) => {
    const points = values[i].map((value, index) => [x(index), y(value)]);
    // one sample is one point, which draws nothing at all — carry it across
    if (points.length === 1) points.push([CHART_BOX.width, points[0][1]]);
    return { playerId: entry.playerId, points };
  });

  return {
    peak,
    steps,
    lines,
    top: TOP,
    bottom: BOTTOM,
    // null while the track has not said, rather than 0 — those are different
    // places on the chart, and only one of them is "nowhere"
    cursor: step === null ? null : x(Math.max(0, Math.min(steps - 1, step))),
  };
}

/** A run of points as an SVG `points` attribute. */
export function polylinePoints(points) {
  return points.map(([px, py]) => `${round(px)},${round(py)}`).join(' ');
}

const round = (value) => Math.round(value * 100) / 100;

/**
 * What the chart says to somebody who cannot see it. The stats row above
 * already reads out the board at the cursor, so this describes the shape of
 * the whole match rather than one step of it.
 */
export function chartSummary({ metric, steps, peak }) {
  const label = CHART_METRICS.find((m) => m.id === metric)?.label ?? metric;
  const attacks = Math.max(0, steps - 1);
  const fights = `${attacks} ${attacks === 1 ? 'attack' : 'attacks'}`;
  return `${label} per player over ${fights}, peaking at ${peak}.`;
}

const rgb = ([r, g, b]) => `rgb(${[r, g, b].map((c) => Math.round(c * 255)).join(', ')})`;

/**
 * The panel itself: the two tabs and the plot they switch between. Built once
 * and repainted, since the replay's timer moves the cursor every step and the
 * lines only change when the tab does.
 *
 * Plain buttons rather than `role="tab"`: a real tablist owes a `tabpanel` its
 * tabs point at, and this is one graphic that changes what it plots.
 * `aria-pressed` says as much without promising a widget that is not here.
 */
export function createReplayChart(root, { playerColors = new Map(), playerNames = new Map() } = {}) {
  root.innerHTML = `
    <div class="hud-chart-tabs"></div>
    <svg class="hud-chart-plot" viewBox="0 0 ${CHART_BOX.width} ${CHART_BOX.height}" role="img">
      <line class="hud-chart-axis" x1="0" x2="${CHART_BOX.width}" y1="${TOP}" y2="${TOP}" />
      <line class="hud-chart-axis" x1="0" x2="${CHART_BOX.width}" y1="${BOTTOM}" y2="${BOTTOM}" />
      <text class="hud-chart-peak" x="2" y="${TOP - 4}"></text>
      <line class="hud-chart-cursor" y1="${TOP}" y2="${BOTTOM}" />
      <g class="hud-chart-lines"></g>
    </svg>
  `;

  const svg = root.querySelector('.hud-chart-plot');
  const tabs = root.querySelector('.hud-chart-tabs');
  const peakLabel = root.querySelector('.hud-chart-peak');
  const cursor = root.querySelector('.hud-chart-cursor');
  const lineGroup = root.querySelector('.hud-chart-lines');

  let series = [];
  let metric = CHART_METRICS[0].id;
  let step = null;

  const tabButtons = CHART_METRICS.map(({ id, label }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hud-chart-tab';
    button.textContent = label;
    button.addEventListener('click', () => {
      if (metric === id) return;
      metric = id;
      draw();
    });
    tabs.append(button);
    return { id, button };
  });

  // Taken away with `display` rather than with the `hidden` attribute: this
  // is an SVG element, and `hidden` is an HTML one.
  function placeCursor(at) {
    cursor.style.display = at === null ? 'none' : '';
    if (at === null) return;
    cursor.setAttribute('x1', String(round(at)));
    cursor.setAttribute('x2', String(round(at)));
  }

  function draw() {
    const view = chartView({ series, metric, step });

    for (const tab of tabButtons) {
      tab.button.classList.toggle('is-selected', tab.id === metric);
      tab.button.setAttribute('aria-pressed', String(tab.id === metric));
    }

    peakLabel.textContent = String(view.peak);
    svg.setAttribute('aria-label', chartSummary({ metric, steps: view.steps, peak: view.peak }));

    lineGroup.replaceChildren(
      ...view.lines.map((line) => {
        const element = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        element.setAttribute('class', 'hud-chart-line');
        element.setAttribute('points', polylinePoints(line.points));
        element.setAttribute('stroke', rgb(playerColors.get(line.playerId) ?? [1, 1, 1]));
        // the colours are the stats row's colours, but a line is thin and two
        // of them can cross — a name on hover is cheap and settles it
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = playerNames.get(line.playerId) ?? String(line.playerId);
        element.append(title);
        return element;
      })
    );

    placeCursor(view.cursor);
  }

  draw(); // an empty plot, so nothing here is half-drawn before a match arrives

  return {
    /** The whole match, as `standingsOverReplay` gives it. */
    setSeries(next) {
      series = next ?? [];
      step = null;
      draw();
    },

    /**
     * Where the track is standing. Only the cursor moves — the lines are the
     * whole match either way, since a chart that grew as the replay played
     * would be hiding exactly what somebody opened it to see.
     */
    setStep(next) {
      step = next;
      placeCursor(chartView({ series, metric, step }).cursor);
    },
  };
}
