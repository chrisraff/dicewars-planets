/**
 * Every preview page there is. The directory at /preview/ is built from this
 * list, so a new page appears there by being added here rather than by
 * somebody remembering to hand-edit an index — and a test checks the list and
 * the files on disk still agree.
 */
export const PREVIEW_PAGES = [
  {
    href: '/preview/hud.html',
    title: 'HUD & player stats',
    description:
      'The stats row in every state it reaches: fresh game, mixed reserves, a full eight-player '
      + 'table, players knocked out, game over, and at phone and very-narrow widths.',
  },
  {
    href: '/preview/battles.html',
    title: 'Battle readout & history',
    description:
      'Every die face on every player color, the readout from a one-on-one up to eight against '
      + 'eight, and the history panel at every length — including past its entry cap.',
  },
];
