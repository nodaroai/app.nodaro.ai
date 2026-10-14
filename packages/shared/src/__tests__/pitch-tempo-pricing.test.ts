import { describe, expect, it } from "vitest"
import {
  PITCH_TEMPO_PRICING,
  parsePitchTempoCreditId,
  pitchTempoBaseCredits,
  pitchTempoCreditId,
  pitchTempoStartedMinutes,
  semitonesToPitchRatio,
} from "../credit-estimators/pitch-tempo.js"

const RATE = PITCH_TEMPO_PRICING.CREDITS_PER_MINUTE_DEFAULT

describe("pitch-tempo pricing", () => {
  // The worked examples in docs/nodes/processing-audio/pitch-tempo.md.
  it.each([
    [45, 20],
    [60, 20],
    [61, 40],
    [190, 80],
    [1800, 600],
  ])("%ss of input costs %s credits at the default rate", (sec, credits) => {
    expect(pitchTempoBaseCredits(RATE, pitchTempoStartedMinutes(sec))).toBe(credits)
  })

  it("prices an unknown or non-positive length as one minute", () => {
    expect(pitchTempoStartedMinutes(undefined)).toBe(1)
    expect(pitchTempoStartedMinutes(null)).toBe(1)
    expect(pitchTempoStartedMinutes(0)).toBe(1)
    expect(pitchTempoStartedMinutes(Number.NaN)).toBe(1)
  })

  it("clamps the minutes at the 30-minute cap (the route refuses longer input)", () => {
    expect(pitchTempoStartedMinutes(1800.4)).toBe(30)
    expect(pitchTempoStartedMinutes(5000)).toBe(30)
  })

  it("builds and parses the per-minute id", () => {
    expect(pitchTempoCreditId(190)).toBe("pitch-tempo:4m")
    expect(pitchTempoCreditId(undefined)).toBe("pitch-tempo:1m")
    expect(parsePitchTempoCreditId("pitch-tempo:4m")).toEqual({ minutes: 4 })
    expect(parsePitchTempoCreditId(pitchTempoCreditId(1800))).toEqual({ minutes: 30 })
  })

  it.each(["pitch-tempo", "pitch-tempo:0m", "pitch-tempo:31m", "pitch-tempo:2.5m", "edit-plan:tighten:economy:3m"])(
    "does not read %s as a per-minute id",
    (id) => {
      expect(parsePitchTempoCreditId(id)).toBeUndefined()
    },
  )

  it("never charges less than one credit and rounds up", () => {
    expect(pitchTempoBaseCredits(0, 3)).toBe(1)
    expect(pitchTempoBaseCredits(2.5, 3)).toBe(8)
  })

  it("converts semitones to a frequency ratio", () => {
    expect(semitonesToPitchRatio(0)).toBe(1)
    expect(semitonesToPitchRatio(12)).toBeCloseTo(2, 10)
    expect(semitonesToPitchRatio(-12)).toBeCloseTo(0.5, 10)
    expect(semitonesToPitchRatio(3)).toBeCloseTo(1.189207, 6)
  })
})

// A quote before a run names the id the run reserves for a known length, and
// the most a run can be charged for an unknown one (decided 2026-10-13): the
// run measures the file before it reserves and refuses one it cannot measure.
describe("the quote of an input of unknown length", () => {
  it("Pitch & Tempo: a known length's started minutes, else 30 minutes", async () => {
    const { pitchTempoQuoteCreditId } = await import("../index.js")
    expect(pitchTempoQuoteCreditId(190)).toBe("pitch-tempo:4m")
    expect(pitchTempoQuoteCreditId(45)).toBe("pitch-tempo:1m")
    for (const unknown of [undefined, null, 0, -3, Number.NaN]) expect(pitchTempoQuoteCreditId(unknown)).toBe("pitch-tempo:30m")
  })

  it("Video SFX: a known length's row, else the 300-second row", async () => {
    const { videoSfxQuoteCreditId, videoSfxCreditId } = await import("../index.js")
    expect(videoSfxQuoteCreditId(12)).toBe("replicate-mmaudio:15s")
    expect(videoSfxQuoteCreditId(12)).toBe(videoSfxCreditId(12))
    for (const unknown of [undefined, null, 0, Number.NaN]) expect(videoSfxQuoteCreditId(unknown)).toBe("replicate-mmaudio:300s")
    // The charge of an unmeasurable clip stays the 8-second row — never above the quote.
    expect(videoSfxCreditId(undefined)).toBe("replicate-mmaudio:8s")
  })
})
