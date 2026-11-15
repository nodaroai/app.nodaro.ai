/**
 * Every step whose run measures its input and bills a step that has no
 * rounding grace of its own forgives up to `CLIP_PRICE_GRACE_SEC` (0.05 s) past
 * a mark on its CHARGE and its HOLD — never on its quote (decided 2026-11-14):
 * a container a hair past its planned length (a re-encoded 30 s cut measures
 * 30.016 s) is charged the mark its length is quoted at. The guard: for every
 * length a quote reads and every overhang up to the grace, the quote is never
 * below the charge — `quote(planned) ≥ charge(planned + overhang)`.
 *
 * Nemotron (Transcribe, Add Captions) forgives a whole second the same way
 * (`nemotronHeldMinutes`). The steps with a grace of their own on both quote
 * and charge (Mask Composite, Video Mask, Video Depth, Video Overlay; Trim,
 * Loop and Combine Videos' 0.1 s) keep their rule.
 */
import { describe, expect, it } from "vitest"
import {
  CLIP_PRICE_GRACE_SEC,
} from "@nodaro/shared/media"
import {
  addCaptionsNemotronHeldCreditId,
  addCaptionsNemotronQuoteCreditId,
  lipSyncAudioRateOf,
  lipSyncEstimateSeconds,
  lipSyncHeldSeconds,
  nemotronTranscribeHeldCreditId,
  nemotronTranscribeQuoteCreditId,
  parseAddCaptionsNemotronCreditId,
  parseNemotronTranscribeCreditId,
  parsePitchTempoCreditId,
  pitchTempoHeldCreditId,
  pitchTempoQuoteCreditId,
  videoSfxHeldCreditId,
  videoSfxQuoteCreditId,
  PITCH_TEMPO_PRICING,
  VIDEO_SFX_PRICING,
} from "@nodaro/shared/credits"
import { dubbingHeldMinutes, dubbingQuotedMinutes, DUBBING_MAX_SPAN_MINUTES, LIP_SYNC_AUDIO_WIRE_READ_OPTIONS, measuredWireLengthSec } from "@nodaro/render-rules"
import { pickLipSyncBucket } from "@nodaro/shared/credits"
import { LIP_SYNC_BUCKET_EDGE_TOLERANCE_SEC, lipSyncAudioCapSec, lipSyncAudioPricingOf, lipSyncHeldSecondsOf } from "../../../lib/lip-sync-inputs.js"

const SFX_ROWS = ["replicate-mmaudio:8s", "replicate-mmaudio:15s", "replicate-mmaudio:30s", "replicate-mmaudio:60s", "replicate-mmaudio:120s", "replicate-mmaudio:300s"]
const OMNI = lipSyncAudioRateOf("omnihuman-2-0")!

/** Each step: the rank of the row its quote names for a known length, and of the row its run holds and charges for a measured one, within the lengths the run accepts. */
const STEPS: ReadonlyArray<{ readonly name: string; readonly maxSec: number; readonly quote: (sec: number) => number; readonly charge: (sec: number) => number }> = [
  { name: "Video SFX (its rows)", maxSec: VIDEO_SFX_PRICING.MAX_DURATION_SEC, quote: (s) => SFX_ROWS.indexOf(videoSfxQuoteCreditId(s)), charge: (s) => SFX_ROWS.indexOf(videoSfxHeldCreditId(s)) },
  { name: "Pitch & Tempo (started minutes)", maxSec: PITCH_TEMPO_PRICING.MAX_DURATION_SEC, quote: (s) => parsePitchTempoCreditId(pitchTempoQuoteCreditId(s))!.minutes, charge: (s) => parsePitchTempoCreditId(pitchTempoHeldCreditId(s))!.minutes },
  { name: "Dubbing (started minutes of the span)", maxSec: DUBBING_MAX_SPAN_MINUTES * 60, quote: (s) => dubbingQuotedMinutes({}, s), charge: (s) => dubbingHeldMinutes(s) },
  { name: "Lip Sync on OmniHuman 2.0 (started seconds)", maxSec: OMNI.maxSeconds, quote: (s) => lipSyncEstimateSeconds(OMNI, s), charge: (s) => lipSyncHeldSeconds(OMNI, s) },
  { name: "Nemotron Transcribe (started minutes, a 1 s grace)", maxSec: 3600, quote: (s) => parseNemotronTranscribeCreditId(nemotronTranscribeQuoteCreditId(s))!.minutes, charge: (s) => parseNemotronTranscribeCreditId(nemotronTranscribeHeldCreditId(s))!.minutes },
  { name: "Add Captions on Nemotron (started minutes, a 1 s grace)", maxSec: 3600, quote: (s) => parseAddCaptionsNemotronCreditId(addCaptionsNemotronQuoteCreditId(s))!.minutes, charge: (s) => parseAddCaptionsNemotronCreditId(addCaptionsNemotronHeldCreditId(s))!.minutes },
]

/** Lengths a quote reads: the marks of every step, just under and just past them, and lengths in between. */
const MARKS = [1, 4, 5, 8, 10, 15, 30, 60, 120, 180, 300, 600, 1800, 3600]
const KNOWN = [0.5, 2.5, 7.3, 14.98, 29.97, 59.5, 61.5, 299.2, ...MARKS.flatMap((m) => [m - 0.04, m - 0.01, m, m + 0.01, m + 0.03, m + 0.049])]
const OVERHANG = [0, 0.001, 0.01, 0.016, 0.025, 0.04, 0.049, CLIP_PRICE_GRACE_SEC]

describe("the charge grace (CLIP_PRICE_GRACE_SEC)", () => {
  it("is the platform's 0.05 s, the grace Mask Composite, Video Mask and Video Depth price by", () => {
    expect(CLIP_PRICE_GRACE_SEC).toBe(0.05)
  })

  it.each(STEPS)("$name: the quote of a length is never below the charge of a file up to the grace past it", ({ maxSec, quote, charge }) => {
    for (const known of KNOWN.filter((k) => k > 0 && k <= maxSec)) {
      for (const over of OVERHANG) {
        const measured = Math.min(known + over, maxSec)
        expect(charge(measured), `${known} + ${over}`).toBeLessThanOrEqual(quote(known))
      }
    }
  })

  it.each(STEPS.filter((s) => !s.name.startsWith("Nemotron") && !s.name.startsWith("Add Captions")))("$name: a file a hair past a mark is charged the mark; past the grace, the next one", ({ charge, quote }) => {
    // The first mark of each step's own rule: 8 s (SFX), 60 s (minutes), 5 s (OmniHuman's seconds past its 4 s floor).
    const mark = quote(8) !== quote(8.01) ? 8 : quote(60) !== quote(60.01) ? 60 : 5
    expect(charge(mark + 0.03)).toBe(quote(mark))
    expect(charge(mark + 0.06)).toBe(quote(mark + 0.06))
  })
})

/**
 * An AAC recording decodes up to one frame (1024 / its sample rate) past the
 * length recorded for it, and every Lip Sync model priced by its audio's
 * length holds the decoded length (decided 2026-11-14): the quote reads the
 * record plus that frame, less the 0.05 s each hold forgives
 * (`LIP_SYNC_AUDIO_WIRE_READ_OPTIONS`). The guard, per sample rate and over the
 * tiers' and seconds' marks: `quote(record) ≥ hold(record + up to one frame)`.
 */
describe("an AAC recording on every Lip Sync model priced by its audio's length", () => {
  const RATES = [8000, 11025, 16000, 22050, 24000, 32000, 44100, 48000]
  const RECORDS = [4, 5, 7.3, 10, 14.95, 14.99, 15, 29.97, 30, 60, 120, 240]
  const quoted = (record: number, sampleRate: number) =>
    measuredWireLengthSec("a", [{ id: "a", type: "upload-audio", data: { url: "https://cdn.example/a.m4a", metadata: { durationSeconds: record, codec: "aac", sampleRate } } }], [], new Set(), LIP_SYNC_AUDIO_WIRE_READ_OPTIONS)!
  const decoded = (seconds: number) => ({ overCap: false as const, samples: Math.round(seconds * 48_000), seconds })

  it.each(["kling-avatar", "kling-avatar-pro", "omnihuman-1-5", "lipsync-2-pro"])("%s (a length tier): the quoted tier is never below the held one", (provider) => {
    const pricing = lipSyncAudioPricingOf(provider)!
    expect(pricing.kind).toBe("bucket")
    for (const rate of RATES) for (const record of RECORDS.filter((r) => r <= lipSyncAudioCapSec(pricing))) {
      for (const share of [0, 0.25, 0.5, 0.99, 1]) {
        const held = lipSyncHeldSecondsOf(pricing, decoded(record + (share * 1024) / rate))!
        expect(pickLipSyncBucket(quoted(record, rate)), `${record} s at ${rate} Hz, ${share} of a frame`).toBeGreaterThanOrEqual(held)
      }
    }
  })

  it("OmniHuman 2.0 (started seconds): the quoted seconds are never below the held ones", () => {
    for (const rate of RATES) for (const record of RECORDS) {
      for (const share of [0, 0.5, 1]) {
        expect(lipSyncEstimateSeconds(OMNI, quoted(record, rate)), `${record} s at ${rate} Hz`).toBeGreaterThanOrEqual(lipSyncHeldSeconds(OMNI, record + (share * 1024) / rate))
      }
    }
  })

  it("the tiers' edge is the charge grace the quote's allowance is figured with", () => {
    expect(LIP_SYNC_BUCKET_EDGE_TOLERANCE_SEC).toBe(CLIP_PRICE_GRACE_SEC)
  })
})
