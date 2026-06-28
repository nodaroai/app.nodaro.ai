import { describe, it, expect } from "vitest"
import { resolveSeedance2Inputs } from "@nodaro/shared"
// Pure-logic guard for the indicator: the panel derives its label + directive
// from resolveSeedance2Inputs, so this pins the mapping the UI renders.
describe("seedance-2 mode indicator mapping", () => {
  it("frames only → strict, no directive", () => {
    const r = resolveSeedance2Inputs({ firstFrameUrl: "f", lastFrameUrl: "l" })
    expect(r.mode).toBe("first-last-frame")
    expect(r.promptSuffix).toBe("")
  })
  it("frame + ref image → reference + directive shown to the user", () => {
    const r = resolveSeedance2Inputs({ firstFrameUrl: "f", refImageUrls: ["r"] })
    expect(r.mode).toBe("reference")
    expect(r.promptSuffix).toContain("Use @image_2 as the opening")
  })
})
