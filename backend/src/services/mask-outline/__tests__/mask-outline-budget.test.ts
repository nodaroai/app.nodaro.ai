/** Mask Outline's hold (mask-outline-budget.ts): the drawing's memory grows with the clip's and the mask's pixels. */
import { describe, expect, it } from "vitest"
import { MASK_OUTLINE_DRAW_FIXED_MIB, maskOutlineDrawPeakMiB, maskOutlinePeakMemoryMiB, maskOutlineTimeoutMs } from "../mask-outline-budget.js"

const THREADS = { decode: 2, encode: 2, filter: 2 } as never

describe("the drawing's working set", () => {
  it("is the fixed part plus 14 bytes a clip pixel and 5 a mask pixel", () => {
    // 1080p clip, 1080p mask: (14 + 5) × 2,073,600 B = 37.6 MiB → 38.
    expect(maskOutlineDrawPeakMiB({ draw: { width: 1920, height: 1080 }, mask: { width: 1920, height: 1080 } })).toBe(MASK_OUTLINE_DRAW_FIXED_MIB + 38)
    // 4K clip, 1080p mask (Video Mask samples a large clip down): 14 × 8,294,400 + 5 × 2,073,600 B = 120.6 MiB → 121.
    expect(maskOutlineDrawPeakMiB({ draw: { width: 3840, height: 2160 }, mask: { width: 1920, height: 1080 } })).toBe(MASK_OUTLINE_DRAW_FIXED_MIB + 121)
  })

  it("a 4K run declares more than a 1080p one: it is admitted at its real size", () => {
    const hd = maskOutlinePeakMemoryMiB({ draw: { width: 1920, height: 1080 }, mask: { width: 1920, height: 1080 } }, THREADS)
    const uhd = maskOutlinePeakMemoryMiB({ draw: { width: 3840, height: 2160 }, mask: { width: 3840, height: 2160 } }, THREADS)
    expect(uhd - hd).toBeGreaterThan(maskOutlineDrawPeakMiB({ draw: { width: 3840, height: 2160 }, mask: { width: 3840, height: 2160 } }) - maskOutlineDrawPeakMiB({ draw: { width: 1920, height: 1080 }, mask: { width: 1920, height: 1080 } }) - 1)
  })

  it("the hold's time grows with the frames", () => {
    expect(maskOutlineTimeoutMs(900)).toBeGreaterThan(maskOutlineTimeoutMs(300))
  })
})
