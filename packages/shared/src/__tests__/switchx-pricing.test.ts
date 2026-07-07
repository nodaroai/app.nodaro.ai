import { describe, it, expect } from "vitest"
import { pickSwitchXFrameTier, resolveSwitchXCreditId, VIDEO_PRODUCER_TYPES } from "../index.js"

// switchXHoldCredits (the $-derived credits formula) moved to
// backend/src/lib/pricing/switchx-cost.ts (S5) — its test lives in
// backend/src/lib/pricing/__tests__/switchx-cost.test.ts. This file covers
// only the NON-monetary tier-bucketing + credit-id-construction logic that
// stays in the published package.

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
  it("registers switchx as a video producer", () => {
    expect(VIDEO_PRODUCER_TYPES.has("switchx")).toBe(true)
  })
})
