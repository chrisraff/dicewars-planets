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
    href: '/preview/dice.html',
    title: 'Dice, light and colour',
    description:
      'The only lit thing in the scene, on a real planet you can turn — the light rig against '
      + 'the world-fixed one it replaced, dice painted by owner at every tint, and the record of '
      + 'the double encoding that used to leave the whole palette pale on the globe.',
  },
  {
    href: '/preview/replay.html',
    title: 'Replay',
    description:
      'A real match played out by itself and dropped straight into its own replay on the actual '
      + 'planet — surface, dice and camera all live, and at phone width too.',
  },
  {
    href: '/preview/surrender.html',
    title: 'Surrender, right and wrong',
    description:
      'Two named matches replayed on the real planet — the game that argued the surrender ratio '
      + 'down to a sixth, and an ordinary match where the call is the right one.',
  },
  {
    href: '/preview/terrain.html',
    title: 'Terrain & lakes',
    description:
      'What the ocean carver makes and what it used to make — the same seed carved both '
      + 'ways side by side, the lakes it now punches into a continent, and a count of how '
      + 'often each of the two leaves a planet that is a cap of land facing a cap of ocean.',
  },
  {
    href: '/preview/replay-perf.html',
    title: 'Replay storage & timing',
    description:
      'What keeping a replay in the save costs: real matches encoded, written to real '
      + 'localStorage and read back, from a two-player game up to a replay filled to the cap.',
  },
];
