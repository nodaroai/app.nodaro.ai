import { describe, it, expect } from "vitest"
import { planBlockFit, assembleNarratedVideoCredits } from "./narrated-block-fit.js"

describe("planBlockFit", () => {
  it("passthrough when there is no audio", () => {
    expect(planBlockFit({ videoDurationSec: 10, audioDurationSec: null, maxSlowdown: 1.5 }))
      .toEqual({ kind: "passthrough" })
  })

  it("centers a shorter voice with half the slack as delay", () => {
    // clip 10s, voice 8s → 1s pad each side
    expect(planBlockFit({ videoDurationSec: 10, audioDurationSec: 8, maxSlowdown: 1.5 }))
      .toEqual({ kind: "pad", voiceDelaySec: 1 })
  })

  it("treats equal durations as a zero-delay pad (boundary)", () => {
    expect(planBlockFit({ videoDurationSec: 10, audioDurationSec: 10, maxSlowdown: 1.5 }))
      .toEqual({ kind: "pad", voiceDelaySec: 0 })
  })

  it("slows the clip to the voice when the voice is longer, under the cap", () => {
    // clip 10s, voice 13s → factor 1.3, no hold
    expect(planBlockFit({ videoDurationSec: 10, audioDurationSec: 13, maxSlowdown: 1.5 }))
      .toEqual({ kind: "slow", factor: 1.3, holdSec: 0 })
  })

  it("caps the slow factor and holds the last frame for the remainder", () => {
    // clip 10s, voice 25s, cap 1.5 → factor 1.5, video reaches 15s, hold 10s
    expect(planBlockFit({ videoDurationSec: 10, audioDurationSec: 25, maxSlowdown: 1.5 }))
      .toEqual({ kind: "slow", factor: 1.5, holdSec: 10 })
  })

  it("slows exactly to the cap with no hold at the boundary", () => {
    // clip 10s, voice 15s, cap 1.5 → factor 1.5, hold 0
    expect(planBlockFit({ videoDurationSec: 10, audioDurationSec: 15, maxSlowdown: 1.5 }))
      .toEqual({ kind: "slow", factor: 1.5, holdSec: 0 })
  })
})

describe("assembleNarratedVideoCredits", () => {
  it("matches the worked examples 6→4, 24→7, 60→13", () => {
    expect(assembleNarratedVideoCredits(6)).toBe(4)
    expect(assembleNarratedVideoCredits(24)).toBe(7)
    expect(assembleNarratedVideoCredits(60)).toBe(13)
  })
})
