import { describe, it, expect } from "vitest"
import { loopTrimAddonCreditsFor } from "../loop-trim-addon.js"
import { loopTrimAddonForReconcile } from "../reconcile/loop-trim-refund.js"
import { estimateLoopTrimAddonCredits, pricedOutputDurationSec } from "@nodaro/shared"

const loopTrim = { enabled: true, framesToTest: 16 }

describe("Loop Trim add-on sizing agrees across route, worker and reconcile", () => {
  it.each([
    ["kling", undefined],
    ["kling", 12],
    ["kling", 8],
    ["kling-3.0", 12],
    ["seedance-2-5", undefined],
  ])("%s duration=%s", (provider, duration) => {
    const rendered = estimateLoopTrimAddonCredits(loopTrim, pricedOutputDurationSec(provider, duration))
    expect(loopTrimAddonCreditsFor(loopTrim, provider, duration)).toBe(rendered)
    expect(loopTrimAddonForReconcile("image-to-video", { provider, duration, loopTrim })).toBe(rendered)
  })

  it("a Kling run with no duration is sized on its 5 s default, not a literal 8 s", () => {
    // 10 x (ceil(5/5) + ceil(16/24)) = 20, where 8 s would have been 30.
    expect(loopTrimAddonCreditsFor(loopTrim, "kling", undefined)).toBe(20)
    expect(loopTrimAddonForReconcile("image-to-video", { provider: "kling", loopTrim })).toBe(20)
  })

  it("an off-ladder 12 s Kling run is sized on the 10 s it renders", () => {
    // 10 x (ceil(10/5) + 1) = 30; the raw 12 s would have been 40.
    expect(loopTrimAddonCreditsFor(loopTrim, "kling", 12)).toBe(30)
    expect(loopTrimAddonForReconcile("image-to-video", { provider: "kling", duration: 12, loopTrim })).toBe(30)
  })
})
