import { describe, it, expect } from "vitest"
import { LISTING_MAX_MINUTES, listingCeilingCredits } from "../listing-price"

// Where a figure must never under-quote and no recording is known yet (a
// component inside a run estimate, the app runner before its live estimate),
// a per-minute listing is read at the longest recording: the figure the
// listing stored before it was split (decided 2026-10-07).
describe("listingCeilingCredits", () => {
  it("is the fixed part plus the per-minute part at 180 minutes", () => {
    expect(LISTING_MAX_MINUTES).toBe(180)
    // Tighten Episode: 82 + 14/min → 2602, its price before the split.
    expect(listingCeilingCredits(82, 14)).toBe(2602)
  })

  it("is the fixed part alone when there is no per-minute part", () => {
    expect(listingCeilingCredits(130, 0)).toBe(130)
    expect(listingCeilingCredits(130, undefined)).toBe(130)
    expect(listingCeilingCredits(null, null)).toBe(0)
  })
})
