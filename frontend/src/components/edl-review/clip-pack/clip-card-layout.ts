/**
 * The windowed grid's fixed card geometry (A4-2). The virtualised rows have one
 * height, so a windowed card is a fixed height with `overflow-hidden`; its 16:9
 * poster, though, scales with the card's width, and at one column (a 380-560px
 * card) it alone was 215-315px, which pushed the Keep switch and the state line
 * below the clip. The poster is therefore capped in a fixed card, and the rest of
 * the card (below) must fit in what is left. jsdom has no layout, so
 * `clip-grid.test.tsx` guards this arithmetic and that the class strings carry it.
 *
 * The classes in `clip-card.tsx` are literal (Tailwind reads them statically) and
 * the test checks they spell these numbers.
 */
export const FIXED_CARD_HEIGHT = 432
export const FIXED_POSTER_MAX_HEIGHT = 168

/** Worst case for everything but the poster, in px. */
const PADDING = 16 // p-2, both sides
const GAPS = 5 * 8 // gap-2 between the poster, title, hook, edited line, keep block
const TITLE_BLOCK = 36 // title + source span
const HOOK_BLOCK = 72 // label + two-row textarea
const EDITED_LINE = 16
const KEEP_BLOCK = 20 + 6 + 3 * 15 // switch row + gap + a state line wrapped to three lines
export const FIXED_PARTS_BUDGET = PADDING + GAPS + TITLE_BLOCK + HOOK_BLOCK + EDITED_LINE + KEEP_BLOCK
