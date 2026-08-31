import { DEFAULT_PLAYER_COLORS } from './palette.js';
import { prefersReducedMotion } from './turnFlash.js';

/**
 * The fireworks over a won banner. Decoration rather than information: it says
 * nothing the title does not already say.
 *
 * Which is why **reduced motion turns it off outright** rather than softening
 * it — the opposite of what `turnFlash.js` does, and for the reason that flash
 * gives: a flash carries the fact that a turn has been handed over, and
 * somebody who asked for less movement did not ask to be told less. Here there
 * is nothing under the movement to preserve.
 *
 * It is **DOM and CSS the whole way down, and deliberately not ticked.** Every
 * other animation runs off the session's frame loop because it has to agree
 * with the planet — a roll lands when the dice land. A banner has no planet
 * and no loop, and a spark's whole life is "travel there, fade out", which is
 * what a keyframe is for. So the show is built once as a couple of hundred
 * absolutely positioned dots with their delays already on them, handed to the
 * compositor, and cleared by one timer. No JavaScript runs while it plays.
 *
 * The half worth testing is where the sparks go — `fireworksShow`, which is
 * pure and takes its randomness as an argument.
 */

const TAU = Math.PI * 2;

const rgb = ([r, g, b]) => `rgb(${[r, g, b].map((c) => Math.round(c * 255)).join(', ')})`;

export const FIREWORKS = {
  duration: 4.2, // seconds from the banner opening to the last spark gone
  bursts: 11,
  sparks: 14, // per burst

  // How far a spark flies and how long it takes, as a fraction of the layer's
  // shorter side and in seconds. Both jittered per spark, because a burst in
  // which every spark stops at the same radius at the same moment reads as a
  // ring closing rather than as an explosion.
  reach: 0.17,
  reachJitter: 0.4,
  rise: 0.9,
  riseJitter: 0.25,

  // The droop at the end, as a fraction of the spark's own reach. Sparks fade
  // while they fall, so this is small: enough to bend the flight, not enough
  // to read as a second movement.
  drop: 0.45,

  // Sparks are laid out on even spokes and then jittered by this fraction of
  // one spoke's width. At 1 a spark can reach its neighbour's spoke but never
  // pass it, so a burst always covers the full circle — a burst of uniformly
  // random angles clumps, and a clumped burst does not read as a burst.
  angleJitter: 0.9,

  // Where a burst may go off, as a fraction of the way from the middle of the
  // banner to its edge. The card is in the middle, and a firework behind the
  // one thing the player is reading is a firework making it harder to read;
  // the outer bound keeps the sparks from spending their flight off-screen.
  clear: 0.45,
  edge: 0.95,

  size: 0.42, // a spark, in rem
  colors: DEFAULT_PLAYER_COLORS,
};

/**
 * The whole show as data: every burst, where and when it goes off, and every
 * spark in it. One function for the lot rather than one per burst, because the
 * properties worth testing are about the show as a whole — nothing over the
 * card, no two running bursts the same colour, every spark out before the end.
 *
 * Positions are percentages of the layer, so they survive the banner being any
 * size; distances are fractions of its shorter side, which the DOM half turns
 * into pixels once, at the one moment it knows how big that is.
 */
export function fireworksShow(options = {}, rng = Math.random) {
  const o = { ...FIREWORKS, ...options };
  const jitter = (amount) => (rng() - 0.5) * 2 * amount;

  // The last moment a burst may start and still be finished by the end of the
  // run. Everything below is placed inside it, so `duration` is the honest
  // length of the show rather than roughly when it tails off.
  const longestSpark = o.rise * (1 + o.riseJitter);
  const last = Math.max(0, o.duration - longestSpark);
  const slot = o.bursts > 1 ? last / (o.bursts - 1) : 0;

  const bursts = [];
  let previousColor = -1;

  for (let i = 0; i < o.bursts; i++) {
    // Spread across the run and then nudged, so they do not go off on a
    // metronome. Half a slot of nudge is as much as can be given without one
    // burst overtaking the next.
    const at = Math.min(last, Math.max(0, i * slot + jitter(slot / 2)));

    // Somewhere in the ring around the card. In percentage space, so the ring
    // is an ellipse of the banner's own proportions — which is the right
    // shape, since the thing being kept clear is a card that is wider than it
    // is tall.
    const angle = rng() * TAU;
    const radius = o.clear + rng() * (o.edge - o.clear);

    // Never the same color twice running: two reds in a row read as one
    // firework that stuttered rather than as two.
    let color = Math.floor(rng() * o.colors.length) % o.colors.length;
    if (color === previousColor) color = (color + 1) % o.colors.length;
    previousColor = color;

    const sparks = [];
    for (let s = 0; s < o.sparks; s++) {
      const spoke = (s / o.sparks) * TAU;
      const reach = Math.max(0, o.reach * (1 + jitter(o.reachJitter)));
      sparks.push({
        angle: spoke + jitter((TAU / o.sparks / 2) * o.angleJitter),
        reach,
        drop: reach * o.drop,
        duration: Math.max(0.05, o.rise * (1 + jitter(o.riseJitter))),
      });
    }

    bursts.push({
      at,
      x: 50 + Math.cos(angle) * radius * 50,
      y: 50 + Math.sin(angle) * radius * 50,
      color: o.colors[color],
      sparks,
    });
  }

  return { duration: o.duration, bursts };
}

/**
 * The layer itself, over the banner and under its card.
 *
 * `before` is the card, and it is how this ends up behind it: an absolutely
 * positioned element paints above its in-flow siblings whatever the document
 * order says, so `.hud-banner-card` is given a position of its own and the two
 * are then settled by which comes first — the same bargain `turnFlash` makes
 * with the HUD.
 *
 * `play` answers whether it actually started, which is the half a test or a
 * preview wants: it declines for reduced motion, and for a banner that has not
 * been laid out yet, since a show measured against a layer of no size is a
 * couple of hundred dots that travel nowhere.
 */
export function createFireworks(host, { before = null, reducedMotion = null, ...options } = {}) {
  let settings = { ...FIREWORKS, ...options };

  const element = document.createElement('div');
  element.className = 'hud-fireworks';
  element.setAttribute('aria-hidden', 'true');
  if (before && before.parentNode === host) host.insertBefore(element, before);
  else host.append(element);

  // null asks the browser every time; true or false pins it, which is how a
  // preview shows the animation on a machine that has reduced motion on.
  const reduced = () => (reducedMotion === null ? prefersReducedMotion() : reducedMotion);

  let timer = null;

  function clear() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    element.replaceChildren();
  }

  return {
    element,
    get options() {
      return { ...settings };
    },

    set(next) {
      settings = { ...settings, ...next };
    },

    play(rng = Math.random) {
      clear();
      if (reduced()) return false;

      // Measured once, here, and never again: this is the only moment the
      // layer's size matters, and reading it per spark would be a layout
      // thrash for a number that cannot change while the show runs.
      const base = Math.min(element.clientWidth, element.clientHeight);
      if (!(base > 0)) return false;

      const show = fireworksShow(settings, rng);
      for (const burst of show.bursts) {
        const origin = document.createElement('div');
        origin.className = 'hud-firework';
        origin.style.left = `${burst.x}%`;
        origin.style.top = `${burst.y}%`;
        origin.style.setProperty('--firework-color', rgb(burst.color));

        for (const spark of burst.sparks) {
          const dot = document.createElement('i');
          dot.className = 'hud-firework-spark';
          dot.style.setProperty('--dx', `${Math.cos(spark.angle) * spark.reach * base}px`);
          dot.style.setProperty('--dy', `${Math.sin(spark.angle) * spark.reach * base}px`);
          dot.style.setProperty('--drop', `${spark.drop * base}px`);
          dot.style.animationDuration = `${spark.duration}s`;
          dot.style.animationDelay = `${burst.at}s`;
          origin.append(dot);
        }
        element.append(origin);
      }

      // One timer for the whole show rather than a listener per spark: they
      // all end by `duration` by construction, and two hundred `animationend`
      // handlers to learn something already known is two hundred too many.
      timer = setTimeout(clear, show.duration * 1000);
      return true;
    },

    /** Stops the show and empties the layer — a banner dismissed early. */
    cancel: clear,

    dispose() {
      clear();
      element.remove();
    },
  };
}
