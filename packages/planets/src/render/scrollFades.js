/**
 * "There is more this way."
 *
 * A strip that scrolls sideways with no scrollbar has nothing to say that it
 * scrolls at all, so it fades out over whichever edge it can still be
 * scrolled towards: the right while there is more waiting off-screen, the
 * left once some has been scrolled past, both at once in the middle, and
 * neither when it all fits.
 *
 * Shared by the dice strip in the battle readout and the player stats row —
 * they are the same problem, so they are the same fade rather than two that
 * can drift apart. The gradients themselves live once in `hud.css` as
 * `.is-faded-left` / `.is-faded-right`; each strip only says how wide it
 * wants them, with `--fade`.
 *
 * A mask rather than an overlay, because what sits behind either of them is
 * translucent over a moving planet — there is no solid color to fade into.
 */

/**
 * Which edges of a scrolling strip have more content beyond them.
 *
 * The one-pixel tolerance is not fussiness: scrollLeft is fractional on a
 * zoomed or high-DPI display, so a strip scrolled fully to the end lands a
 * hair short of scrollWidth - clientWidth and would keep claiming there was
 * more to the right forever.
 */
export function scrollFades({ scrollLeft, scrollWidth, clientWidth }) {
  const furthest = scrollWidth - clientWidth;
  if (furthest <= 1) return { left: false, right: false };
  return {
    left: scrollLeft > 1,
    right: scrollLeft < furthest - 1,
  };
}

/**
 * Applies the fades to every element given. Every read happens before every
 * write, so a whole history of rows costs one reflow rather than one per row
 * — which is the entire reason this takes a list rather than an element.
 */
export function showScrollFades(elements) {
  const present = [...elements].filter(Boolean);
  const states = present.map(scrollFades); // all reads
  present.forEach((element, i) => {
    element.classList.toggle('is-faded-left', states[i].left);
    element.classList.toggle('is-faded-right', states[i].right);
  });
}
