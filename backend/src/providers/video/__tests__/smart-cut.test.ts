/**
 * smart-cut tests — the matcher REGISTRY only. The boundary-matching
 * ALGORITHMS moved to the private plugins package (2026-07-24, Tal: "it is
 * important that the smart algorithm will stay private"); their tests live
 * there (`src/plugins/smart-cut/__tests__/`). What stays public — and
 * tested here — is the registration seam `combineVideos` resolves through,
 * and the degrade contract when no engine is present.
 */
import { describe, it, expect } from "vitest"
import { registerSmartCutMatcher, getSmartCutMatcher, type SmartCutMatcher, type SmartCutBoundary } from "../smart-cut.js"

const boundary: SmartCutBoundary = {
  trimEndFrames: 0, trimStartFrames: 1, psnr: 30, matched: true,
  searchedPrevFrames: 8, searchedNextFrames: 8,
}

describe("smart-cut matcher registry", () => {
  it("starts empty — community/business worker boots never register an engine", () => {
    expect(getSmartCutMatcher()).toBeNull()
  })

  it("register → get roundtrip; last registration wins (mirrors the loader's engine merge)", async () => {
    const first: SmartCutMatcher = async () => boundary
    const second: SmartCutMatcher = async () => ({ ...boundary, trimStartFrames: 2 })
    registerSmartCutMatcher(first)
    expect(getSmartCutMatcher()).toBe(first)
    registerSmartCutMatcher(second)
    expect(getSmartCutMatcher()).toBe(second)
    await expect(getSmartCutMatcher()!("/p.mp4", "/n.mp4", 8, 8, "best-pair")).resolves.toMatchObject({ trimStartFrames: 2 })
  })
})
