import { describe, it, expect } from "vitest"
import { MODEL_CATALOG } from "../model-catalog.js"
import { pricedOutputDurationSec, snapToNearestDuration, videoDefaultDurationSec } from "../model-constants.js"
import { buildVideoCreditModelIdentifier } from "../credit-identifiers.js"

/**
 * A video request that names no duration is CHARGED for the length the model
 * renders by default (catalog `defaultDuration`), never for a global 5 s; one
 * that names a length the model does not offer is charged for the nearest length
 * it does (the runners' own snap rule). `pricedOutputDurationSec` is the one
 * funnel every price path reads.
 */
describe("pricedOutputDurationSec", () => {
  it("an offered duration wins, as a number or a numeric string", () => {
    expect(pricedOutputDurationSec("seedance-2-5", 12)).toBe(12)
    expect(pricedOutputDurationSec("seedance-2-5", "12")).toBe(12)
    expect(pricedOutputDurationSec("minimax-h3", 4)).toBe(4)
  })

  it("an omitted duration is the model's catalog default render length", () => {
    expect(pricedOutputDurationSec("seedance-2", undefined)).toBe(8)
    expect(pricedOutputDurationSec("seedance-2-fast", undefined)).toBe(8)
    expect(pricedOutputDurationSec("seedance-2-mini", undefined)).toBe(8)
    expect(pricedOutputDurationSec("seedance-2-5", undefined)).toBe(8)
    expect(pricedOutputDurationSec("grok-i2v", undefined)).toBe(6)
    expect(pricedOutputDurationSec("grok-imagine-video-1.5", undefined)).toBe(8)
    expect(pricedOutputDurationSec("minimax-h3", undefined)).toBe(6)
    expect(pricedOutputDurationSec("hailuo-2.3-pro", undefined)).toBe(6)
    expect(pricedOutputDurationSec("kling", undefined)).toBe(5)
    expect(pricedOutputDurationSec("ltx-2.3-pro", undefined)).toBe(6)
  })

  it("an unparseable duration is priced the same way", () => {
    expect(pricedOutputDurationSec("seedance-2", "abc")).toBe(8)
    expect(pricedOutputDurationSec("grok-i2v", "abc")).toBe(6)
  })

  it("a length the model does not offer is charged as the nearest one it does (a tie goes shorter)", () => {
    expect(pricedOutputDurationSec("kling", 7)).toBe(5)
    expect(pricedOutputDurationSec("kling", 8)).toBe(10)
    expect(pricedOutputDurationSec("grok-i2v", 8)).toBe(6)
    expect(pricedOutputDurationSec("grok-i2v", 15)).toBe(10)
    expect(pricedOutputDurationSec("seedance", 6)).toBe(4)
    expect(pricedOutputDurationSec("seedance", 10)).toBe(8)
  })

  it("snapToNearestDuration is the runners' rule: offered values pass, ties go to the earlier entry", () => {
    expect(snapToNearestDuration(5, [4, 8, 12])).toBe(4)
    expect(snapToNearestDuration(6, [4, 8, 12])).toBe(4)
    expect(snapToNearestDuration(7, [4, 8, 12])).toBe(8)
    expect(snapToNearestDuration(9, undefined)).toBe(9)
    expect(snapToNearestDuration(9, [])).toBe(9)
  })

  it("every default is a length the model offers", () => {
    for (const e of Object.values(MODEL_CATALOG)) {
      if (e.defaultDuration === undefined) continue
      expect(e.durations, `${e.id} declares defaultDuration but no durations`).toBeDefined()
      expect(e.durations, `${e.id}: defaultDuration ${e.defaultDuration}`).toContain(e.defaultDuration)
      expect(videoDefaultDurationSec(e.id)).toBe(e.defaultDuration)
    }
  })

  it("an unset duration prices the SAME tier as that default sent explicitly (worked examples)", () => {
    for (const nodeType of ["image-to-video", "text-to-video"] as const) {
      expect(buildVideoCreditModelIdentifier("seedance-2", undefined, undefined, nodeType, undefined, "720p")).toBe("seedance-2:8s:720p")
      expect(buildVideoCreditModelIdentifier("seedance-2-5", undefined, undefined, nodeType, undefined, "720p")).toBe(
        buildVideoCreditModelIdentifier("seedance-2-5", 8, undefined, nodeType, undefined, "720p"),
      )
      expect(buildVideoCreditModelIdentifier("seedance-2-5", undefined, undefined, nodeType, undefined, "720p", true)).toBe(
        "seedance-2-5:8s:720p-ref",
      )
    }
    expect(buildVideoCreditModelIdentifier("grok-i2v", undefined, undefined, "image-to-video")).toBe("grok-i2v:6s")
    expect(buildVideoCreditModelIdentifier("ltx-2.3-fast", undefined)).toBe("ltx-2.3-fast:1080p:6s")
    expect(buildVideoCreditModelIdentifier("gemini-omni-video", undefined)).toBe("gemini-omni-video:8")
    expect(buildVideoCreditModelIdentifier("gemini-omni-video", 7)).toBe("gemini-omni-video:6")
  })

  it("a snapped length is charged as the tier it renders (worked examples)", () => {
    expect(buildVideoCreditModelIdentifier("kling", 7)).toBe("kling:5s")
    expect(buildVideoCreditModelIdentifier("kling", 8)).toBe("kling:10s")
    expect(buildVideoCreditModelIdentifier("ltx-2.3-pro", 7)).toBe("ltx-2.3-pro:1080p:6s")
    expect(buildVideoCreditModelIdentifier("ltx-2.3-fast", 14, undefined, undefined, undefined, "2k")).toBe("ltx-2.3-fast:2k:10s")
  })
})
