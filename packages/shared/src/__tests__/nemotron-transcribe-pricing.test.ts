import { describe, expect, it } from "vitest"
import {
  NEMOTRON_TRANSCRIBE_ID,
  NEMOTRON_TRANSCRIBE_PRICING,
  NEMOTRON_UPWARD_GRACE_SEC,
  nemotronHeldMinutes,
  nemotronTranscribeBaseCredits,
  nemotronTranscribeCreditId,
  nemotronTranscribeHeldCreditId,
  nemotronTranscribeQuoteCreditId,
  nemotronTranscribeStartedMinutes,
  parseNemotronTranscribeCreditId,
} from "../credit-estimators/nemotron-transcribe.js"
import { addCaptionsNemotronHeldCreditId, addCaptionsNemotronQuoteCreditId, parseAddCaptionsNemotronCreditId } from "../credit-estimators/add-captions-nemotron.js"
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

  it("holds a measured file at the minutes the charge settles at: up to the grace past a minute is the minute below", () => {
    expect(NEMOTRON_UPWARD_GRACE_SEC).toBe(1)
    // A re-encoded 60-second cut measures a hair past 60 s (60.0004–60.011 s): held, and charged, at one minute.
    expect(nemotronHeldMinutes(60)).toBe(1)
    expect(nemotronHeldMinutes(60.0004)).toBe(1)
    expect(nemotronHeldMinutes(60.011)).toBe(1)
    expect(nemotronHeldMinutes(61)).toBe(1)
    expect(nemotronHeldMinutes(61.001)).toBe(2)
    expect(nemotronHeldMinutes(0.4)).toBe(1)
    expect(nemotronHeldMinutes(3600)).toBe(60)
    expect(nemotronTranscribeHeldCreditId(60.011)).toBe("nemotron-3-5-transcribe:1m")
    expect(nemotronTranscribeHeldCreditId(125)).toBe("nemotron-3-5-transcribe:3m")
  })

  // The guard: a quote of a known length is never below the hold of a file that measures up to the grace past it.
  const KNOWN = [0.5, 1, 30, 59, 59.5, 60, 60.5, 61, 119, 120, 180, 599.99, 600, 1800, 3540, 3599, 3600]
  const OVER = [0, 1e-6, 0.0004, 0.011, 0.25, 0.5, 0.999, NEMOTRON_UPWARD_GRACE_SEC]
  it.each(KNOWN)("a quote of %s s is never below the hold of a file measured up to the grace past it", (known) => {
    for (const over of OVER) {
      const measured = Math.min(known + over, NEMOTRON_TRANSCRIBE_PRICING.MAX_DURATION_SEC)
      const quoted = parseNemotronTranscribeCreditId(nemotronTranscribeQuoteCreditId(known))!.minutes
      expect(parseNemotronTranscribeCreditId(nemotronTranscribeHeldCreditId(measured))!.minutes, `${known} + ${over}`).toBeLessThanOrEqual(quoted)
      // Add Captions on Nemotron: the same rule, its own ids.
      const captionQuote = parseAddCaptionsNemotronCreditId(addCaptionsNemotronQuoteCreditId(known))!.minutes
      expect(parseAddCaptionsNemotronCreditId(addCaptionsNemotronHeldCreditId(measured))!.minutes, `${known} + ${over}`).toBeLessThanOrEqual(captionQuote)
    }
  })

  it("lists the four-minute rate row in the catalog at the launch rate", () => {
    const entry = MODEL_CATALOG[NEMOTRON_TRANSCRIBE_ID as keyof typeof MODEL_CATALOG] as unknown as { pricing: Array<{ identifier: string; credits: number }>; maker?: string }
    expect(entry.pricing).toEqual([expect.objectContaining({ identifier: NEMOTRON_TRANSCRIBE_PRICING.RATE_CREDIT_ID, credits: RATE })])
    expect(entry.maker).toBe("nvidia")
  })
})
