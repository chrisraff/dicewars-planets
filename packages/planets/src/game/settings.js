export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

/**
 * Everything the menu can configure, declared once. The menu renders itself
 * from this list and the settings pipeline validates against it, so a new
 * option — difficulty, board size, whatever comes next — is added here and
 * appears in both without either being touched.
 *
 * Two flags say how finished an option is, and they answer different
 * questions.
 *
 * `available: false` — the option is real and carried through the pipeline,
 * but the thing it controls has not been built. The menu greys it out and
 * shows its `note`, which is the point: it tells a player what is coming.
 * `normalizeSettings` pins it to its default, so nothing downstream can be
 * handed a setting the game cannot honor. This is how `moon` sits.
 *
 * `hidden: true` — the menu does not draw it at all. For an option that works
 * but is not ready to be offered, where a greyed-out row would be advertising
 * something half-finished rather than promising something to come. It is still
 * declared here, still normalized, and still read by the game, so it stays one
 * flag away from being offered. This is how `size` sits.
 */
export const SETTING_DEFINITIONS = [
  {
    key: 'players',
    label: 'Players',
    help: 'How many rivals battle for the planet.',
    kind: 'choice',
    default: 6,
    available: true,
    choices: Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => {
      const count = MIN_PLAYERS + i;
      return { value: count, label: String(count) };
    }),
  },
  {
    key: 'start',
    label: 'Your turn',
    help: 'Where you sit in the turn order. Early takes ground before anyone is strong; '
      + 'late lets you see what everyone else did first.',
    kind: 'seat',
    default: 'any',
    available: true,
    modes: [
      { value: 'any', label: 'Any' },
      { value: 'early', label: 'Early' },
      { value: 'late', label: 'Late' },
    ],
  },
  {
    key: 'size',
    label: 'Planet',
    help: 'How much ground there is to fight over. A bigger planet is a longer '
      + 'game and takes a moment more to build.',
    kind: 'choice',
    default: 3,
    available: false,
    hidden: true,
    // subdivisions of the icosahedron the globe is built from, so the jump
    // from one to the next is roughly four times the territories: 16, 55, 238.
    // The generator handles all three; what needs work is the game on them —
    // starting dice, territory size and ocean all want different values on a
    // small planet than on a large one.
    choices: [
      { value: 2, label: 'Small' },
      { value: 3, label: 'Medium' },
      { value: 4, label: 'Large' },
    ],
  },
  {
    key: 'moon',
    label: 'Moon',
    help: 'A moon passes overhead, bridging the territories it covers as it goes.',
    kind: 'toggle',
    default: false,
    available: false,
    note: 'Not built yet',
  },
];

/**
 * The options the menu draws. Everything in `SETTING_DEFINITIONS` is still
 * parsed, stored and read — this is only about what a player is shown.
 */
export const MENU_SETTINGS = SETTING_DEFINITIONS.filter((setting) => !setting.hidden);

const byKey = new Map(SETTING_DEFINITIONS.map((setting) => [setting.key, setting]));

export const DEFAULT_SETTINGS = Object.freeze(
  Object.fromEntries(SETTING_DEFINITIONS.map(({ key, default: value }) => [key, value]))
);

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

const isAbsent = (raw) => raw === undefined || raw === null || raw === '';

function normalizeOne(setting, raw, context) {
  if (!setting.available) return setting.default; // cannot be turned on yet
  // `Number('')` and `Number(null)` are both 0, which would sail through the
  // range check below and quietly become the smallest allowed value — so
  // anything blank has to be caught as absent before it is coerced
  if (isAbsent(raw)) return setting.default;

  if (setting.kind === 'toggle') {
    return raw === true || raw === 1 || raw === '1' || raw === 'true' || raw === 'on';
  }

  if (setting.kind === 'seat') {
    const modes = setting.modes.map((mode) => mode.value);
    if (modes.includes(raw)) return raw;
    const seat = Number(raw);
    if (!Number.isFinite(seat)) return setting.default;
    // a seat that no longer exists — say the player count was turned down
    // after it was chosen — becomes the last seat rather than nothing
    return clamp(Math.round(seat), 1, context.players);
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) return setting.default;
  const allowed = setting.choices.map((choice) => choice.value);
  return clamp(Math.round(value), Math.min(...allowed), Math.max(...allowed));
}

/**
 * Fills in defaults and drags anything out of range back into it.
 *
 * The player count is settled first because other options are bounded by it —
 * a chosen seat only makes sense against a known number of seats — rather than
 * leaving that to the order the definitions happen to be declared in.
 */
export function normalizeSettings(raw = {}) {
  const players = normalizeOne(byKey.get('players'), raw.players, {});
  const context = { players };

  return Object.fromEntries(
    SETTING_DEFINITIONS.map((setting) => [
      setting.key,
      setting.key === 'players' ? players : normalizeOne(setting, raw[setting.key], context),
    ])
  );
}

/**
 * Which seat in the turn order the player takes, 0-based.
 *
 * `early` and `late` are halves rounded up, so with an odd number of players
 * the middle seat belongs to both — better than a seat that neither range can
 * ever land on.
 *
 * Takes settings that have already been through `normalizeSettings`, as
 * everything below this line does: settings are parsed once, at the edge —
 * `resolveSettings` for the page, and the menu for anything the player picks —
 * and are a settled answer from then on. Re-validating here would mean no
 * caller could ever be sure which of the two had the last word.
 */
export function resolveStartSeat({ players, start }, rng = Math.random) {
  const pick = (from, count) => from + Math.min(count - 1, Math.floor(rng() * count));

  if (start === 'any') return pick(0, players);
  if (start === 'early') return pick(0, Math.ceil(players / 2));
  if (start === 'late') {
    const first = Math.floor(players / 2);
    return pick(first, players - first);
  }
  return clamp(start, 1, players) - 1;
}

/** The seats a range covers, 0-based — what the menu paints as "in range". */
export function seatsInRange(mode, players) {
  const all = Array.from({ length: players }, (_, i) => i);
  if (mode === 'early') return all.slice(0, Math.ceil(players / 2));
  if (mode === 'late') return all.slice(Math.floor(players / 2));
  if (mode === 'any') return all;
  return [];
}

/** `?players=6&moon=1` — handy for sharing a setup or jumping straight in. */
export function settingsFromQuery(search = '') {
  const params = new URLSearchParams(search);
  const raw = {};
  for (const { key } of SETTING_DEFINITIONS) {
    if (params.has(key)) raw[key] = params.get(key);
  }
  return raw;
}

/** Only what differs from the defaults, so a plain game has a plain URL. */
export function settingsToQuery(settings) {
  const params = new URLSearchParams();
  for (const { key, default: fallback, kind } of SETTING_DEFINITIONS) {
    const value = settings[key];
    if (value === fallback) continue;
    params.set(key, kind === 'toggle' ? (value ? '1' : '0') : String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

const STORAGE_KEY = 'dicewars-planets:settings';

// localStorage throws in private browsing on some engines, and is missing
// outside a browser entirely — a remembered setup is a nicety, never a reason
// for the game to fail to start.
export function readStoredSettings(storage) {
  try {
    const stored = storage?.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

export function writeStoredSettings(storage, settings) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

/**
 * The settings a page should open with: defaults, overlaid with whatever was
 * used last time, overlaid with anything named in the URL. The URL wins
 * because it is the more deliberate act of the two.
 */
export function resolveSettings({ search = '', storage } = {}) {
  return normalizeSettings({
    ...DEFAULT_SETTINGS,
    ...readStoredSettings(storage),
    ...settingsFromQuery(search),
  });
}

export function settingDefinition(key) {
  return byKey.get(key);
}

/** The player ids a game with these (normalized) settings is played by. */
export function playerIdsFor({ players }) {
  return Array.from({ length: players }, (_, i) => `p${i + 1}`);
}

/**
 * How finely the globe is subdivided for these (normalized) settings — the one
 * number the world generator needs out of the whole set.
 */
export function subdivisionsFor({ size }) {
  return size;
}
