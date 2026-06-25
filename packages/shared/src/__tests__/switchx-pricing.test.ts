import { describe, it, expect } from "vitest"
import { pickSwitchXFrameTier, resolveSwitchXCreditId, switchXHoldCredits, VIDEO_PRODUCER_TYPES } from "../index.js"

describe("switchx pricing", () => {
  it("snaps frames up to a tier; undefined/over → 240", () => {
    expect(pickSwitchXFrameTier(1)).toBe(48)
    expect(pickSwitchXFrameTier(96)).toBe(96)
    expect(pickSwitchXFrameTier(120)).toBe(144)
    expect(pickSwitchXFrameTier(999)).toBe(240)
    expect(pickSwitchXFrameTier(undefined)).toBe(240)
  })
  it("composes the credit id from frames + resolution", () => {
    expect(resolveSwitchXCreditId({ __probedFrameCount: 90, maxResolution: 1080 })).toBe("beeble-switchx:96f:1080p")
    expect(resolveSwitchXCreditId({ __probedFrameCount: 200, maxResolution: 720 })).toBe("beeble-switchx:240f:720p")
    expect(resolveSwitchXCreditId({})).toBe("beeble-switchx:240f:1080p") // bare/worst-case
  })
  it("hold credits are monotonic in frames and resolution", () => {
    expect(switchXHoldCredits(48, 1080)).toBeGreaterThan(switchXHoldCredits(48, 720))
    expect(switchXHoldCredits(240, 1080)).toBeGreaterThan(switchXHoldCredits(48, 1080))
  })
  it("registers switchx as a video producer", () => {
    expect(VIDEO_PRODUCER_TYPES.has("switchx")).toBe(true)
  })
})
