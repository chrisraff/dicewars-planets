import {
  MENU_SETTINGS,
  DEFAULT_SETTINGS,
  normalizeSettings,
  seatsInRange,
} from '../game/settings.js';
import { DEFAULT_PLAYER_COLORS, readableTextColor } from './palette.js';

const rgb = (color) => `rgb(${color.map((c) => Math.round(c * 255)).join(', ')})`;

/**
 * The turn order as a row of seats, with the current choice painted onto it.
 *
 * A range and an exact seat are the same question — where do you sit — so they
 * share one control rather than being a mode picker plus a separate seat
 * picker. Choosing "Early" lights the first half of the row, which is what
 * "early" actually means; choosing a seat lights just that one.
 */
export function seatRowView(setting, value, players) {
  const isRange = setting.modes.some((mode) => mode.value === value);
  const covered = new Set(isRange ? seatsInRange(value, players) : []);

  return {
    modes: setting.modes.map((mode) => ({
      value: mode.value,
      label: mode.label,
      selected: mode.value === value,
    })),
    seats: Array.from({ length: players }, (_, index) => ({
      seat: index + 1,
      color: DEFAULT_PLAYER_COLORS[index % DEFAULT_PLAYER_COLORS.length],
      // exactly this seat was picked, versus merely falling inside a range
      picked: !isRange && value === index + 1,
      inRange: covered.has(index),
    })),
  };
}

/**
 * One option as the menu should draw it. Pure, so what "disabled" means and
 * which choice reads as picked are decided somewhere they can be checked
 * without a browser.
 */
export function settingRowView(setting, value, context = {}) {
  const disabled = !setting.available;
  const base = {
    key: setting.key,
    label: setting.label,
    help: setting.help,
    kind: setting.kind,
    disabled,
    note: disabled ? setting.note : null,
  };

  if (setting.kind === 'toggle') {
    // an unavailable option shows its default, not whatever was asked for
    return { ...base, checked: disabled ? setting.default : Boolean(value) };
  }

  if (setting.kind === 'seat') return { ...base, ...seatRowView(setting, value, context.players) };

  return {
    ...base,
    choices: setting.choices.map((choice) => ({
      value: choice.value,
      label: choice.label,
      selected: choice.value === value,
    })),
  };
}

export function menuView(settings, definitions = MENU_SETTINGS) {
  const resolved = normalizeSettings(settings);
  return definitions.map((setting) => settingRowView(setting, resolved[setting.key], resolved));
}

/**
 * The buttons along the bottom, and which of them leads.
 *
 * There are two different ways to have a game to go back to and they are never
 * both true. `canResume` is a match open behind this menu — the player pressed
 * Menu and can press their way back out. `canContinue` is a match saved from a
 * previous visit, with nothing running yet; that is what the player almost
 * certainly came back for, so it takes the primary look and the focus, and
 * starting a new game steps down to being the other option on the row.
 */
export function menuActionsView({ canResume = false, canContinue = false } = {}) {
  return {
    resume: { hidden: !canResume },
    continue: { hidden: !canContinue },
    start: {
      // from inside a match, throwing it away is a deliberate act and says so
      label: canResume ? 'Start over' : 'New game',
      secondary: canContinue,
    },
    // whatever the button is, the player should be able to just press enter
    focus: canContinue ? 'continue' : 'start',
  };
}

/**
 * The menu over the planet: pick a setup and start, go back to a game already
 * in progress, or pick up one saved from a previous visit.
 *
 * It renders itself from the setting definitions rather than from hand-written
 * markup, so adding an option to settings.js is all it takes to have one here.
 */
export function createMenu(root, { onStart, onResume, onContinue } = {}) {
  root.innerHTML = `
    <div class="menu-panel" role="dialog" aria-modal="true" aria-label="Game setup">
      <h1 class="menu-title">Dicewars Planets</h1>
      <div class="menu-settings"></div>
      <div class="menu-actions">
        <button class="menu-resume" type="button" hidden>Back to game</button>
        <button class="menu-start" type="button">New game</button>
        <button class="menu-continue" type="button" hidden>Continue</button>
      </div>
    </div>
  `;

  const settingsList = root.querySelector('.menu-settings');
  const startButton = root.querySelector('.menu-start');
  const resumeButton = root.querySelector('.menu-resume');
  const continueButton = root.querySelector('.menu-continue');

  let settings = normalizeSettings({});
  const controls = new Map(); // key -> a function that re-reads the DOM

  function buildChoice(setting, row) {
    const group = document.createElement('div');
    group.className = 'menu-choices';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-labelledby', `menu-label-${setting.key}`);

    for (const choice of row.choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'menu-choice';
      button.textContent = choice.label;
      button.setAttribute('role', 'radio');
      button.disabled = row.disabled;
      button.addEventListener('click', () => {
        settings = normalizeSettings({ ...settings, [setting.key]: choice.value });
        refresh();
      });
      group.append(button);
    }

    controls.set(setting.key, (view) => {
      view.choices.forEach((choice, i) => {
        const button = group.children[i];
        button.classList.toggle('is-selected', choice.selected);
        button.setAttribute('aria-checked', String(choice.selected));
      });
    });
    return group;
  }

  function buildToggle(setting, row) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu-toggle';
    button.setAttribute('role', 'switch');
    button.disabled = row.disabled;
    button.innerHTML = '<span class="menu-toggle-track"><span class="menu-toggle-knob"></span></span>';
    button.addEventListener('click', () => {
      settings = normalizeSettings({ ...settings, [setting.key]: !settings[setting.key] });
      refresh();
    });

    controls.set(setting.key, (view) => {
      button.classList.toggle('is-on', view.checked);
      button.setAttribute('aria-checked', String(view.checked));
    });
    return button;
  }

  // The turn order, drawn as the seats themselves: range chips paint a region
  // of the row, a seat claims one outright. Seats are rebuilt when the player
  // count changes, since the row *is* the table.
  function buildSeats(setting, row) {
    const group = document.createElement('div');
    group.className = 'menu-seats';

    const modes = document.createElement('div');
    modes.className = 'menu-choices';
    modes.setAttribute('role', 'radiogroup');
    modes.setAttribute('aria-labelledby', `menu-label-${setting.key}`);

    for (const mode of row.modes) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'menu-choice menu-mode';
      button.textContent = mode.label;
      button.setAttribute('role', 'radio');
      button.addEventListener('click', () => {
        settings = normalizeSettings({ ...settings, [setting.key]: mode.value });
        refresh();
      });
      modes.append(button);
    }

    const seats = document.createElement('div');
    seats.className = 'menu-seat-row';
    group.append(modes, seats);

    let drawn = 0;
    function drawSeats(view) {
      seats.replaceChildren();
      for (const seat of view.seats) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'menu-seat';
        button.textContent = String(seat.seat);
        // the seat decides which color you play, so the row shows you that too
        button.style.setProperty('--seat-color', rgb(seat.color));
        button.style.setProperty('--seat-ink', rgb(readableTextColor(seat.color)));
        button.setAttribute('aria-label', `Seat ${seat.seat} of ${view.seats.length}`);
        button.addEventListener('click', () => {
          settings = normalizeSettings({ ...settings, [setting.key]: seat.seat });
          refresh();
        });
        seats.append(button);
      }
      drawn = view.seats.length;
    }

    controls.set(setting.key, (view) => {
      if (view.seats.length !== drawn) drawSeats(view);
      view.modes.forEach((mode, i) => {
        modes.children[i].classList.toggle('is-selected', mode.selected);
        modes.children[i].setAttribute('aria-checked', String(mode.selected));
      });
      view.seats.forEach((seat, i) => {
        seats.children[i].classList.toggle('is-picked', seat.picked);
        seats.children[i].classList.toggle('is-in-range', seat.inRange);
        seats.children[i].setAttribute('aria-pressed', String(seat.picked));
      });
    });

    drawSeats(row);
    return group;
  }

  const builders = { toggle: buildToggle, seat: buildSeats, choice: buildChoice };

  for (const setting of MENU_SETTINGS) {
    const row = settingRowView(setting, setting.default, { players: DEFAULT_SETTINGS.players });

    const item = document.createElement('div');
    item.className = 'menu-row';
    if (row.disabled) item.classList.add('is-disabled');

    const text = document.createElement('div');
    text.className = 'menu-row-text';
    text.innerHTML = `
      <div class="menu-row-label"><span></span><em class="menu-row-note"></em></div>
      <p class="menu-row-help"></p>
    `;
    const labelText = text.querySelector('.menu-row-label span');
    labelText.id = `menu-label-${setting.key}`;
    labelText.textContent = row.label;
    text.querySelector('.menu-row-help').textContent = row.help;

    const note = text.querySelector('.menu-row-note');
    if (row.note) note.textContent = row.note;
    else note.remove();

    item.append(text, builders[row.kind](setting, row));
    settingsList.append(item);
  }

  function refresh() {
    for (const view of menuView(settings)) controls.get(view.key)?.(view);
  }

  startButton.addEventListener('click', () => onStart?.(settings));
  resumeButton.addEventListener('click', () => onResume?.());
  continueButton.addEventListener('click', () => onContinue?.());

  // Escape backs out, but only when there is something to back out to
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !resumeButton.hidden) onResume?.();
  });

  return {
    get settings() {
      return settings;
    },

    /**
     * `canResume` shows the way back to a match already under way;
     * `canContinue` offers one saved from a previous visit.
     */
    show(next = settings, { canResume = false, canContinue = false } = {}) {
      settings = normalizeSettings(next);
      refresh();

      const actions = menuActionsView({ canResume, canContinue });
      resumeButton.hidden = actions.resume.hidden;
      continueButton.hidden = actions.continue.hidden;
      startButton.textContent = actions.start.label;
      startButton.classList.toggle('is-secondary', actions.start.secondary);

      root.hidden = false;
      const lead = actions.focus === 'continue' ? continueButton : startButton;
      lead.focus({ preventScroll: true });
    },

    hide() {
      root.hidden = true;
    },

    isOpen: () => !root.hidden,
  };
}
