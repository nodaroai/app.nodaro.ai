import { describe, it, expect } from "vitest"
import { pickSwitchXFrameTier, resolveSwitchXCreditId, switchXHoldCredits, VIDEO_PRODUCER_TYPES } from "../index.js"

describe("switchx pricing", () => {
  it("snaps frames up to the next 30-frame block tier; undefined/over → 240", () => {
    expect(pickSwitchXFrameTier(1)).toBe(30)
    expect(pickSwitchXFrameTier(30)).toBe(30)
    expect(pickSwitchXFrameTier(45)).toBe(60)
    expect(pickSwitchXFrameTier(96)).toBe(120)
    expect(pickSwitchXFrameTier(150)).toBe(150)
    expect(pickSwitchXFrameTier(999)).toBe(240)
    expect(pickSwitchXFrameTier(undefined)).toBe(240)
  })
  it("composes the credit id from frames + resolution", () => {
    expect(resolveSwitchXCreditId({ __probedFrameCount: 90, maxResolution: 1080 })).toBe("beeble-switchx:90f:1080p")
    expect(resolveSwitchXCreditId({ __probedFrameCount: 200, maxResolution: 720 })).toBe("beeble-switchx:210f:720p")
    expect(resolveSwitchXCreditId({})).toBe("beeble-switchx:240f:1080p") // bare/worst-case
  })
  it("holds at-cost block credits: 15/block @1080p, 5/block @720p", () => {
    expect(switchXHoldCredits(30, 1080)).toBe(15) // 1 block
    expect(switchXHoldCredits(30, 720)).toBe(5)
    expect(switchXHoldCredits(150, 1080)).toBe(75) // 5 blocks (a ~5s clip)
    expect(switchXHoldCredits(240, 1080)).toBe(120) // 8 blocks (worst case)
    expect(switchXHoldCredits(240, 720)).toBe(40)
  })
  it("hold credits are monotonic in frames and resolution", () => {
    expect(switchXHoldCredits(48, 1080)).toBeGreaterThan(switchXHoldCredits(48, 720))
    expect(switchXHoldCredits(240, 1080)).toBeGreaterThan(switchXHoldCredits(48, 1080))
  })
  it("registers switchx as a video producer", () => {
    expect(VIDEO_PRODUCER_TYPES.has("switchx")).toBe(true)
  })
})
