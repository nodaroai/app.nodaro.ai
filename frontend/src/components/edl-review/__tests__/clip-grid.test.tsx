import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import type { ClipCard } from "@/lib/edl-review/build-clip-cards"
import { CLIP_GRID_BREAKPOINTS, ClipGrid, VIRTUAL_FROM } from "../clip-pack/clip-grid"
import { FIXED_CARD_HEIGHT, FIXED_PARTS_BUDGET, FIXED_POSTER_MAX_HEIGHT } from "../clip-pack/clip-card-layout"

/**
 * The Clip Pack grid (§4.2 of the inspectors design, A4-2): a plain CSS grid up
 * to 40 cards, windowed past that, at 1, 2, 3 or 4 columns from 640 / 1024 /
 * 1440 px.
 */
afterEach(cleanup)

const card = (row: number): ClipCard => ({
  row,
  clipKey: `${row}-${row + 1}`,
  title: `Clip ${row + 1}`,
  hookEdited: false,
  keep: true,
  durationMs: 60_000,
  sourceSpan: { inMs: 0, outMs: 60_000 },
  unchanged: false,
  previewStale: false,
  state: "no-preview",
})
const grid = (count: number) => (
  <ClipGrid
    cards={Array.from({ length: count }, (_, i) => card(i))}
    active={null}
    canEdit
    onPlay={vi.fn()}
    onKeep={vi.fn()}
    onHook={vi.fn()}
    onResetHook={vi.fn()}
  />
)

describe("ClipGrid", () => {
  it("mounts every card up to the windowing threshold", () => {
    render(grid(VIRTUAL_FROM))
    expect(screen.getByTestId("clip-grid").dataset.virtual).toBeUndefined()
    expect(screen.getAllByTestId(/^clip-card-/)).toHaveLength(VIRTUAL_FROM)
  })

  it("windows the rows past it: a hundred clips do not mount a hundred cards", () => {
    render(grid(100))
    expect(screen.getByTestId("clip-grid").dataset.virtual).toBe("true")
    expect(screen.getAllByTestId(/^clip-card-/).length).toBeLessThan(100)
  })

  it("steps 1, 2, 3, 4 columns at 640, 1024 and 1440 px", () => {
    expect(CLIP_GRID_BREAKPOINTS).toEqual([
      { min: 0, cols: 1 },
      { min: 640, cols: 2 },
      { min: 1024, cols: 3 },
      { min: 1440, cols: 4 },
    ])
  })

  // jsdom has no layout, so the guard is on the declared geometry. The card is a
  // fixed height in the windowed grid while its 16:9 poster scales with the card's
  // width; at one column a 380-560px card made the poster alone 215-315px and the
  // Keep switch fell below the clip. The poster is therefore capped.
  it("caps the windowed card's poster so the poster and the rest of the card fit the fixed height", () => {
    expect(FIXED_POSTER_MAX_HEIGHT + FIXED_PARTS_BUDGET).toBeLessThanOrEqual(FIXED_CARD_HEIGHT)
    render(grid(VIRTUAL_FROM + 1))
    const article = screen.getAllByTestId(/^clip-card-/)[0]
    expect(article.className).toContain(`h-[${FIXED_CARD_HEIGHT}px]`)
    expect(article.firstElementChild?.className).toContain(`max-h-[${FIXED_POSTER_MAX_HEIGHT}px]`)
  })

  it("leaves the poster uncapped in the plain grid, where the card grows with its content", () => {
    render(grid(VIRTUAL_FROM))
    const article = screen.getAllByTestId(/^clip-card-/)[0]
    expect(article.className).not.toMatch(/h-\[\d+px\]/)
    expect(article.firstElementChild?.className).not.toContain("max-h-")
  })
})
