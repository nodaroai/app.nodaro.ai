/**
 * Shared flip-above-when-cramped positioning math for the editor's
 * body-mounted floating popups (`@`/`{`/`/` suggestion lists and the snippet
 * pill's swap menu). Extracted verbatim from the three byte-identical
 * `positionMount` closures in `index.tsx` so the placement heuristic lives in
 * one place.
 *
 * Heuristic (matches the original `positionMount`):
 *   - Anchor below the trigger rect when there's room, else flip above.
 *   - "Room below" = the space below the rect is at least `placeBelowThreshold`
 *     px, OR at least the rect's own top offset minus `secondaryClauseMargin`
 *     (so a popup near the bottom of a short viewport still opens downward
 *     rather than off-screen).
 *   - Clamp `left` into the viewport, leaving `margin` on both sides.
 *
 * The suggestion lists use the fixed 160px threshold (their `max-h` clamp is
 * 300px but the flip decision keys off 160 — preserved exactly) and a
 * secondary clause of `spaceBelow >= rect.top` (no margin subtraction). The
 * snippet pill menu passes its own dynamic `estHeight` as the threshold (its
 * sibling count drives the menu height) and `secondaryClauseMargin: margin`,
 * reproducing `spaceBelow >= estH || spaceBelow >= anchor.top - MARGIN` from
 * `snippet-pill-view` byte-for-byte.
 */
export function computeFlipPosition(
  rect: DOMRect,
  opts: {
    width: number
    estHeight: number
    margin?: number
    /** Flip-below threshold for the primary clause. Defaults to 160 (the
     *  suggestion lists' value); the pill passes its dynamic `estHeight`. */
    placeBelowThreshold?: number
    /** Subtracted from `rect.top` in the secondary "room below" clause. The
     *  suggestion lists use 0; the pill uses `margin` (its original `- MARGIN`). */
    secondaryClauseMargin?: number
  },
): { top: number; left: number } {
  const margin = opts.margin ?? 4
  const threshold = opts.placeBelowThreshold ?? 160
  const secondaryMargin = opts.secondaryClauseMargin ?? 0
  const vh = window.innerHeight
  const vw = window.innerWidth
  const spaceBelow = vh - rect.bottom - margin
  const placeBelow = spaceBelow >= threshold || spaceBelow >= rect.top - secondaryMargin
  const top = placeBelow
    ? rect.bottom + margin
    : Math.max(margin, rect.top - opts.estHeight - margin)
  const left = Math.min(Math.max(margin, rect.left), vw - opts.width - margin)
  return { top, left }
}
