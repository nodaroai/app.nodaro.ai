import { describe, it, expect } from "vitest"
import { bucketBaseCreditsFor } from "../../../routes/video-sfx.js"

describe("video-sfx pricing — worked examples (must match docs + STATIC_CREDIT_COSTS + migration 159)", () => {
  // (durationSec, versions, BASE total per-job × versions, visible after configured pricing factor ceil)
  const CASES = [
    [5,   1, 1,  2],
    [8,   1, 1,  2],
    [12,  1, 1,  2],
    [30,  1, 2,  3],
    [31,  1, 3,  4],
    [60,  4, 12, 15],
    [180, 1, 11, 14],
  ] as const

  it.each(CASES)("(duration=%i s, versions=%i) → BASE %i, visible %i", (dur, versions, base, visible) => {
    const baseTotal = bucketBaseCreditsFor(dur) * versions
    expect(baseTotal).toBe(base)
    const visibleTotal = Math.ceil(baseTotal * 1.25)
    expect(visibleTotal).toBe(visible)
  })
})
