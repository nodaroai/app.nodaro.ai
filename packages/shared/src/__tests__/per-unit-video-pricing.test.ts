import { describe, it, expect } from "vitest"
import {
  LTX_EXTEND_DURATION,
  LTX_RETAKE_MIN_DURATION_SEC,
  LTX_RETAKE_PER_SECOND_CREDIT_ID,
  ltxRetakeDurationSec,
  LTX_EXTEND_PER_SECOND_CREDIT_ID,
  VIDEO_SFX_PRICING,
  ltxExtendDurationSec,
  videoSfxCreditId,
} from "../index.js"

describe("videoSfxCreditId", () => {
  it.each([
    [1, "replicate-mmaudio:8s"],
    [5, "replicate-mmaudio:8s"],
    [8, "replicate-mmaudio:8s"],
    [8.3, "replicate-mmaudio:15s"],
    [9, "replicate-mmaudio:15s"],
    [12, "replicate-mmaudio:15s"],
    [15, "replicate-mmaudio:15s"],
    [16, "replicate-mmaudio:30s"],
    [30, "replicate-mmaudio:30s"],
    [31, "replicate-mmaudio:60s"],
    [60, "replicate-mmaudio:60s"],
    [61, "replicate-mmaudio:120s"],
    [120, "replicate-mmaudio:120s"],
    [121, "replicate-mmaudio:300s"],
    [180, "replicate-mmaudio:300s"],
    [300, "replicate-mmaudio:300s"],
  ])("%s s → %s", (seconds, id) => {
    expect(videoSfxCreditId(seconds)).toBe(id)
  })

  it("prices the fallback length when the video could not be measured", () => {
    const fallback = videoSfxCreditId(VIDEO_SFX_PRICING.FALLBACK_DURATION_SEC)
    for (const unknown of [undefined, null, 0, -4, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(videoSfxCreditId(unknown)).toBe(fallback)
    }
  })

  it("a length past the cap prices the last bucket", () => {
    expect(videoSfxCreditId(VIDEO_SFX_PRICING.MAX_DURATION_SEC + 1)).toBe("replicate-mmaudio:300s")
  })
})

describe("ltxExtendDurationSec", () => {
  it("names the per-second price row", () => {
    expect(LTX_EXTEND_PER_SECOND_CREDIT_ID).toBe("ltx-2.3-pro-extend:per-second")
  })

  it.each([
    [2, 2],
    [6, 6],
    [20, 20],
    [7.4, 7],
    [7.5, 8],
    ["8", 8],
    [" 12 ", 12],
    [0, 1],
    [-3, 1],
    [25, 20],
  ])("%j → %i seconds", (raw, seconds) => {
    expect(ltxExtendDurationSec(raw)).toBe(seconds)
  })

  it("an absent or unreadable length is the model's default", () => {
    for (const raw of [undefined, null, "", "abc", Number.NaN, {}, true]) {
      expect(ltxExtendDurationSec(raw)).toBe(LTX_EXTEND_DURATION.DEFAULT_SEC)
    }
    expect(LTX_EXTEND_DURATION.DEFAULT_SEC).toBe(6)
  })
})

describe("ltxRetakeDurationSec", () => {
  it("names the per-second price row", () => {
    expect(LTX_RETAKE_PER_SECOND_CREDIT_ID).toBe("ltx-2.3-pro-retake:per-second")
  })

  it.each([
    [2, 2],
    [2.5, 2.5],
    [12, 12],
    ["4", 4],
    [1, 2],
    [0, 2],
    [-3, 2],
  ])("%j → %s seconds (never below the 2-second minimum)", (raw, seconds) => {
    expect(ltxRetakeDurationSec(raw)).toBe(seconds)
  })

  it("an absent or unreadable window is the minimum", () => {
    for (const raw of [undefined, null, "", "abc", Number.NaN, {}]) {
      expect(ltxRetakeDurationSec(raw)).toBe(LTX_RETAKE_MIN_DURATION_SEC)
    }
  })
})
