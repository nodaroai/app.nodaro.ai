import { describe, expect, it } from "vitest"
import {
  NEMOTRON_TRANSCRIBE_ID,
  NEMOTRON_TRANSCRIBE_PRICING,
  nemotronTranscribeBaseCredits,
  nemotronTranscribeCreditId,
  nemotronTranscribeQuoteCreditId,
  nemotronTranscribeStartedMinutes,
  parseNemotronTranscribeCreditId,
} from "../credit-estimators/nemotron-transcribe.js"
import { MODEL_CATALOG } from "../model-catalog.js"

const RATE = NEMOTRON_TRANSCRIBE_PRICING.CREDITS_PER_RATE_DEFAULT

describe("Nemotron 3.5 Transcribe pricing (per started minute, decided 2026-11-12)", () => {
  // 0.75 base credits a minute: the four-minute row (3) × minutes ÷ 4, rounded up once.
  it.each([
    [45, 1],
    [60, 1],
    [61, 2], // 2 started minutes → 1.5 → 2
    [180, 3], // 3 minutes → 2.25 → 3
    [600, 8], // 10 minutes → 7.5 → 8
    [3600, 45], // 60 minutes → 45
  ])("%ss of audio has a base of %s credits at the launch rate", (sec, credits) => {
    expect(nemotronTranscribeBaseCredits(RATE, nemotronTranscribeStartedMinutes(sec))).toBe(credits)
  })

  it("is 0.75 credits a minute at the launch rate", () => {
    expect(RATE / NEMOTRON_TRANSCRIBE_PRICING.RATE_MINUTES).toBe(0.75)
  })

  it("counts an unknown or non-positive length as one minute, and caps at 60", () => {
    expect(nemotronTranscribeStartedMinutes(undefined)).toBe(1)
    expect(nemotronTranscribeStartedMinutes(0)).toBe(1)
    expect(nemotronTranscribeStartedMinutes(Number.NaN)).toBe(1)
    expect(nemotronTranscribeStartedMinutes(3600.2)).toBe(60)
    expect(nemotronTranscribeStartedMinutes(99_999)).toBe(60)
  })

  it("builds and parses the per-minute id", () => {
    expect(nemotronTranscribeCreditId(190)).toBe("nemotron-3-5-transcribe:4m")
    expect(parseNemotronTranscribeCreditId("nemotron-3-5-transcribe:4m")).toEqual({ minutes: 4 })
    expect(parseNemotronTranscribeCreditId("nemotron-3-5-transcribe:60m")).toEqual({ minutes: 60 })
    expect(parseNemotronTranscribeCreditId("nemotron-3-5-transcribe:61m")).toBeUndefined()
    expect(parseNemotronTranscribeCreditId("nemotron-3-5-transcribe:0m")).toBeUndefined()
    expect(parseNemotronTranscribeCreditId("nemotron-3-5-transcribe")).toBeUndefined()
    expect(parseNemotronTranscribeCreditId(NEMOTRON_TRANSCRIBE_PRICING.RATE_CREDIT_ID)).toBeUndefined()
  })

  it("quotes an unknown length at 60 minutes, the most a run is charged", () => {
    expect(nemotronTranscribeQuoteCreditId(undefined)).toBe("nemotron-3-5-transcribe:60m")
    expect(nemotronTranscribeQuoteCreditId(null)).toBe("nemotron-3-5-transcribe:60m")
    expect(nemotronTranscribeQuoteCreditId(125)).toBe("nemotron-3-5-transcribe:3m")
  })

  it("lists the four-minute rate row in the catalog at the launch rate", () => {
    const entry = MODEL_CATALOG[NEMOTRON_TRANSCRIBE_ID as keyof typeof MODEL_CATALOG] as unknown as { pricing: Array<{ identifier: string; credits: number }>; maker?: string }
    expect(entry.pricing).toEqual([expect.objectContaining({ identifier: NEMOTRON_TRANSCRIBE_PRICING.RATE_CREDIT_ID, credits: RATE })])
    expect(entry.maker).toBe("nvidia")
  })
})
