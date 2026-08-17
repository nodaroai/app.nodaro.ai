import { describe, it, expect } from "vitest"
import { seedance2RefVideoBaseCredits } from "../seedance2-ref-video-credits.js"

describe("seedance2RefVideoBaseCredits", () => {
  it("scales by (input + output): 720p, 8s out + 5s in = ceil(6.25 × 13) = 82", () => {
    expect(seedance2RefVideoBaseCredits({ provider: "seedance-2", resolution: "720p", outputDurationSec: 8, inputVideoDurationSec: 5 })).toBe(813)
  })
  it("no input video → equals the plain -ref composite (8s 720p = 50)", () => {
    expect(seedance2RefVideoBaseCredits({ provider: "seedance-2", resolution: "720p", outputDurationSec: 8, inputVideoDurationSec: 0 })).toBe(500)
  })
  it("4k per-sec base = 32: 8s out + 4s in = ceil(32×12) = 384", () => {
    expect(seedance2RefVideoBaseCredits({ provider: "seedance-2", resolution: "4k", outputDurationSec: 8, inputVideoDurationSec: 4 })).toBe(3840)
  })
  it("clamps unsupported resolution to the provider's top tier (mini 1080p→720p)", () => {
    const mini = seedance2RefVideoBaseCredits({ provider: "seedance-2-mini", resolution: "1080p", outputDurationSec: 8, inputVideoDurationSec: 0 })
    const mini720 = seedance2RefVideoBaseCredits({ provider: "seedance-2-mini", resolution: "720p", outputDurationSec: 8, inputVideoDurationSec: 0 })
    expect(mini).toBe(mini720)
  })
  it("seedance-2-5 1080p (2026-08-17 tier) per-sec base = 1370/8: 8s out + 5s in = ceil(171.25 × 13) = 2227", () => {
    expect(seedance2RefVideoBaseCredits({ provider: "seedance-2-5", resolution: "1080p", outputDurationSec: 8, inputVideoDurationSec: 5 })).toBe(2227)
  })
  it("seedance-2-5 1080p no input video → equals the plain -ref composite (8s = 1370)", () => {
    expect(seedance2RefVideoBaseCredits({ provider: "seedance-2-5", resolution: "1080p", outputDurationSec: 8, inputVideoDurationSec: 0 })).toBe(1370)
  })
})
