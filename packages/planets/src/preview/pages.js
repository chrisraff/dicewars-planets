/**
 * Every preview page there is. The directory at /preview/ is built from this
 * list, so a new page appears there by being added here rather than by
 * somebody remembering to hand-edit an index — and a test checks the list and
 * the files on disk still agree.
 */
export const PREVIEW_PAGES = [
  {
    href: '/preview/menu.html',
    title: 'Setup menu',
    description:
      'The game-setup menu in each state it opens in — first visit, mid-game, and phone width — '
      + 'plus a live panel showing what the settings pipeline makes of your choices.',
  },
  {
    href: '/preview/endgame.html',
    title: 'Endings & knockouts',
    description:
      'Where play stops — winning, losing, and being knocked out of a game that carries on '
      + 'without you — with the turn indicator each one leaves behind, and the replay a fought-out '
      + 'match offers.',
  },
  {
    href: '/preview/hud.html',
    title: 'HUD & player stats',
    description:
      'The stats row in every state it reaches: fresh game, mixed reserves, a full eight-player '
      + 'table, players knocked out, game over, and at phone and very-narrow widths.',
  },
  {
    href: '/preview/hints.html',
    title: 'First-turn prompt',
    description:
      'The one-off panel that tells a first-time player how to attack — both wordings, at phone '
      + 'width, over a payout, and every state where it correctly says nothing at all.',
  },
  {
    href: '/preview/battles.html',
    title: 'Battle readout & history',
    description:
      'Every die face on every player color, the readout from a one-on-one up to eight against '
      + 'eight, and the history panel at every length — including past its entry cap.',
  },
  {
    href: '/preview/poles.html',
    title: 'Pole markers',
    description:
      'The reference cone at each pole on a live planet — every knob on a slider, the head-on '
      + 'and edge-on extremes a button away, and a full dice tower on the pole to check it '
      + 'against.',
  },
  {
    href: '/preview/replay.html',
    title: 'Replay',
    description:
      'A real match played out by itself and dropped straight into its own replay on the actual '
      + 'planet — surface, dice and camera all live, and at phone width too.',
  },
];
