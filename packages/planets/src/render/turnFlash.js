/**
 * The flash that says the planet is yours again.
 *
 * A turn handing back from the AI currently changes nothing you can see
 * without reading: the attacks stop and a small line of text at the bottom
 * left changes wording. This is the loud half of the answer — a brief veil
 * over the whole view, which is the one cue that cannot be missed by looking
 * somewhere else, because there is nowhere else to look.
 *
 * Two decisions are worth knowing before touching it.
 *
 * It is **DOM over the canvas rather than `scene.background`**. Flashing the
 * scene background only lights the ring of empty space around the planet, and
 * how much of the frame that is varies enormously — a portrait phone frames
 * the planet at about 4.9 radii against a desktop's 3.2 — so the same flash is
 * a wide halo on one and a thin rim on the other. It also stops working the
 * day the background becomes a starfield or a texture, which is exactly the
 * sort of thing a background is for. An overlay composites over whatever ends
 * up back there.
 *
 * And the shape is a **vignette by default**: opaque at the edges, clear over
 * the middle. The point of the flash is to announce, not to hide, and the
 * thing it would otherwise hide is the board you have just been handed. A
 * flat veil is kept as an option because it is the stronger signal of the two,
 * and which of those wins is a judgement made by eye on
 * `preview/handover.html` rather than by argument here.
 */
export const TURN_FLASH = {
  // Two flashes rather than one: a single veil reads as a glitch, a pair
  // reads as deliberate. Well under the three-per-second that a
  // photosensitivity guideline draws its line at, and with only two in the
  // whole burst no spacing can reach it.
  flashes: 2,
  spacing: 0.3, // onset to onset, seconds

  // The envelope of one flash. Short rise, almost no hold, and a fall long
  // enough to read as a fade rather than a cut — a hard edge on both sides of
  // a full-frame grey is what makes a flash feel like a fault.
  rise: 0.05,
  hold: 0.03,
  fall: 0.17,
  peak: 0.5, // opacity at the top of a flash

  color: [0.63, 0.64, 0.67], // a neutral medium grey, in the palette's 0..1
  shape: 'vignette', // or 'full'

  // Where the vignette starts and finishes, as a fraction of the distance
  // from the centre of the frame to its corner. The planet sits inside
  // `inner` and stays clear.
  inner: 0.3,
  outer: 0.95,
};

/**
 * The same announcement for somebody who has asked not to be flashed at: one
 * slow swell instead of two quick ones, and dimmer. Deliberately still
 * *something* — `prefers-reduced-motion` is a request for less movement, not
 * a request to be told less.
 */
export const REDUCED_TURN_FLASH = {
  flashes: 1,
  spacing: 0,
  rise: 0.35,
  hold: 0.12,
  fall: 0.45,
  peak: 0.32,
};

/**
 * Whether this browser has been asked for less movement — an accessibility
 * setting of the operating system's, surfaced as a media query.
 *
 * Read at the moment of playing rather than latched at startup, so turning it
 * on mid-match takes effect on the next turn without a reload and without
 * anything having to listen. Guarded for the no-DOM case because this module's
 * timing half is imported by tests that never open a window.
 */
export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Eased at both ends. A linear ramp across a whole frame of grey reads as a
// wipe rather than a swell, and the ease is most of what separates the two.
const smoothstep = (t) => t * t * (3 - 2 * t);

// One flash, `t` seconds after its own onset.
function envelope(t, { rise, hold, fall, peak }) {
  if (t <= 0) return 0;
  if (t < rise) return peak * smoothstep(t / rise);
  if (rise <= 0 && t <= 0) return 0;
  if (t < rise + hold) return peak;
  const out = t - rise - hold;
  if (fall <= 0) return 0;
  if (out < fall) return peak * smoothstep(1 - out / fall);
  return 0;
}

/**
 * How opaque the veil is `elapsed` seconds into the burst, 0 to `peak`.
 *
 * The flashes are combined with `max` rather than by adding them up, so a
 * spacing tighter than one flash's own length overlaps into a plateau instead
 * of climbing past `peak` — which is the one way a tuning could accidentally
 * produce a much brighter flash than the number called `peak` promises.
 */
export function flashOpacity(elapsed, options = {}) {
  const settings = { ...TURN_FLASH, ...options };
  let value = 0;
  for (let i = 0; i < settings.flashes; i++) {
    value = Math.max(value, envelope(elapsed - i * settings.spacing, settings));
  }
  return value;
}

/** How long the whole burst lasts, in seconds. */
export function flashDuration(options = {}) {
  const settings = { ...TURN_FLASH, ...options };
  if (settings.flashes <= 0) return 0;
  return (settings.flashes - 1) * settings.spacing
    + settings.rise + settings.hold + settings.fall;
}

/**
 * The veil itself, mounted into `host` — which must be positioned, since this
 * lays itself over it. Belongs *under* the HUD and over the canvas: the point
 * is to veil the board, and greying out the controls at the same moment would
 * make the one thing you have just been invited to use harder to read.
 *
 * `tick` returns whether the burst is still running, so a caller with a frame
 * loop can drop it the moment it finishes rather than painting zeros forever.
 */
export function createTurnFlash(host, { before = null, reducedMotion = null, ...options } = {}) {
  let settings = { ...TURN_FLASH, ...options };

  const element = document.createElement('div');
  element.className = 'turn-flash';
  element.setAttribute('aria-hidden', 'true');
  // `before` exists for one reason: in the game this has to land *under* the
  // HUD, and the HUD is a plain unlayered element, so the only thing deciding
  // which paints on top is which comes first in the document.
  if (before && before.parentNode === host) host.insertBefore(element, before);
  else host.append(element);

  // null asks the browser every time; true or false pins it, which is how a
  // preview shows both without anybody changing their system settings.
  const reduced = () => (reducedMotion === null ? prefersReducedMotion() : reducedMotion);

  let elapsed = null;
  let playing = settings; // the settings this burst is actually running on

  function applySettings() {
    const [r, g, b] = settings.color.map((c) => Math.round(c * 255));
    element.style.setProperty('--flash-color', `${r}, ${g}, ${b}`);
    element.style.setProperty('--flash-inner', `${settings.inner * 100}%`);
    element.style.setProperty('--flash-outer', `${settings.outer * 100}%`);
    element.classList.toggle('is-vignette', settings.shape === 'vignette');
  }
  applySettings();

  return {
    element,
    get options() {
      return { ...settings };
    },

    set(next) {
      settings = { ...settings, ...next };
      applySettings();
    },

    /** Starts the burst over, whether or not one was already running. */
    play() {
      playing = reduced() ? { ...settings, ...REDUCED_TURN_FLASH } : settings;
      elapsed = 0;
      element.style.opacity = '0';
    },

    tick(dt) {
      if (elapsed === null) return false;
      elapsed += dt;
      if (elapsed >= flashDuration(playing)) {
        elapsed = null;
        element.style.opacity = '0';
        return false;
      }
      element.style.opacity = String(flashOpacity(elapsed, playing));
      return true;
    },

    /** Stops mid-burst and clears the veil — for a suppression rule firing late. */
    cancel() {
      elapsed = null;
      element.style.opacity = '0';
    },

    dispose() {
      element.remove();
    },
  };
}
