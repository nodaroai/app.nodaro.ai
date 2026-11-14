import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ffprobe is stubbed per URL: the reservation tests never touch it, the
// settlement tests decide what the delivered clip and the reference clips
// measure (a rejected promise = an unusable probe).
const probe = vi.hoisted(() => ({
  durations: new Map<string, number | Error | "hang">(),
  probeMediaDuration: vi.fn(async (url: string): Promise<number> => {
    const d = probe.durations.get(url)
    if (d === undefined) throw new Error(`unexpected probe of ${url}`)
    if (d instanceof Error) throw d
    // A probe that never answers (a stalled host).
    if (d === "hang") return new Promise<number>(() => {})
    return d
  }),
}))
vi.mock("../../../providers/video/ffmpeg-utils.js", () => ({ probeMediaDuration: probe.probeMediaDuration }))

import { MODEL_CATALOG, VIDEO_DURATION_AUTO } from "@nodaro/shared/model-catalog"
import { VIDEO_REF_RATE_PROVIDERS, billsReferenceVideoSeconds, pricedOutputDurationSec, supportsAutoVideoDuration } from "@nodaro/shared/models"
import {
  SETTLE_REMEASURE_CLIP_TIMEOUT_MS,
  SETTLE_REMEASURE_TOTAL_MS,
  refVideoWorstCaseSecFor,
  seedance2RefVideoActualBaseCredits,
  seedance2RefVideoActualSeconds,
  seedance2RefVideoBaseCredits,
  seedance2RefVideoExpectedBaseCredits,
  seedance2RefVideoBaseCreditsFromDurations,
  seedance2RefVideoHeldOutputSec,
} from "../seedance2-ref-video-credits.js"
import { seedance2RefVideoQuote } from "../seedance2-ref-video-quote.js"
import { applyServiceMarkup } from "../service-margin.js"
import { measureSeedance2RefVideoBaseCredits, measureSeedance2Settle } from "../../../lib/seedance2-ref-video-settle.js"

// seedance-2-5:8s:1080p-ref = 1900 → 237.5/s; seedance-2-5:8s:720p-ref = 760 → 95/s;
// seedance-2:8s:720p-ref = 500 → 62.5/s.
const S25_1080P_PER_SEC = 1900 / 8
const S25_720P_PER_SEC = 760 / 8
const S2_720P_PER_SEC = 500 / 8

describe("seedance2RefVideoBaseCredits", () => {
  it("scales by (input + output): 720p, 8s out + 5s in = ceil(62.5 × 13) = 813", () => {
    expect(seedance2RefVideoBaseCredits({ provider: "seedance-2", resolution: "720p", outputDurationSec: 8, inputVideoDurationSec: 5 })).toBe(813)
  })
  it("no input video → equals the plain -ref composite (8s 720p = 500)", () => {
    expect(seedance2RefVideoBaseCredits({ provider: "seedance-2", resolution: "720p", outputDurationSec: 8, inputVideoDurationSec: 0 })).toBe(500)
  })
  it("4k per-sec base = 320: 8s out + 4s in = ceil(320×12) = 3840", () => {
    expect(seedance2RefVideoBaseCredits({ provider: "seedance-2", resolution: "4k", outputDurationSec: 8, inputVideoDurationSec: 4 })).toBe(3840)
  })
  it("clamps unsupported resolution to the provider's top tier (mini 1080p→720p)", () => {
    const mini = seedance2RefVideoBaseCredits({ provider: "seedance-2-mini", resolution: "1080p", outputDurationSec: 8, inputVideoDurationSec: 0 })
    const mini720 = seedance2RefVideoBaseCredits({ provider: "seedance-2-mini", resolution: "720p", outputDurationSec: 8, inputVideoDurationSec: 0 })
    expect(mini).toBe(mini720)
  })
  it("seedance-2-5 1080p (2026-08-17 tier) per-sec base = 1900/8: 8s out + 5s in = ceil(237.5 × 13) = 3088", () => {
    expect(seedance2RefVideoBaseCredits({ provider: "seedance-2-5", resolution: "1080p", outputDurationSec: 8, inputVideoDurationSec: 5 })).toBe(3088)
  })
  it("seedance-2-5 1080p no input video → equals the plain -ref composite (8s = 1900)", () => {
    expect(seedance2RefVideoBaseCredits({ provider: "seedance-2-5", resolution: "1080p", outputDurationSec: 8, inputVideoDurationSec: 0 })).toBe(1900)
  })
})

/**
 * The RESERVATION is the worst case the run can bill. Seedance may read the
 * prompt as an EDIT of the wired clip and render the clip's own length instead
 * of the requested duration — the verdict is only known after the provider
 * rejected the first submit (`runVideoTaskWithSeedanceEditRetry`) — and
 * `commit_credits` can only refund, so the reserve bills the output at the
 * longer of the two. The settlement below measures what was delivered.
 */
describe("seedance2RefVideoBaseCreditsFromDurations (the reservation)", () => {
  it("a clip shorter than the requested duration changes nothing: 2.5 1080p, 8s out + 5s in = 3088", () => {
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: "seedance-2-5", resolution: "1080p", outputDurationSec: 8, requestedDuration: 8, referenceTaskType: undefined, durationsSec: [5] })).toBe(3088)
  })

  it("a clip LONGER than the requested duration bills the output at the clip's length (an edit renders it): 12s requested + 30s clip = ceil(237.5 × (30 + 30)) = 14250", () => {
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: "seedance-2-5", resolution: "1080p", outputDurationSec: 12, requestedDuration: 12, referenceTaskType: undefined, durationsSec: [30] })).toBe(14250)
    expect(Math.ceil(S25_1080P_PER_SEC * 60)).toBe(14250)
  })

  it("several clips: every clip is input, the LONGEST is the output worst case: 720p, 8s + [5, 20] = ceil(95 × (25 + 20)) = 4275", () => {
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: "seedance-2-5", resolution: "720p", outputDurationSec: 8, requestedDuration: 8, referenceTaskType: undefined, durationsSec: [5, 20] })).toBe(4275)
    expect(Math.ceil(S25_720P_PER_SEC * 45)).toBe(4275)
  })

  it("an unusable probe counts as the provider's per-clip cap, in AND out: seedance-2-5 (30s cap), 8s + [NaN] = ceil(95 × 60) = 5700", () => {
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: "seedance-2-5", resolution: "720p", outputDurationSec: 8, requestedDuration: 8, referenceTaskType: undefined, durationsSec: [NaN] })).toBe(5700)
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: "seedance-2-5", resolution: "720p", outputDurationSec: 8, requestedDuration: 8, referenceTaskType: undefined, durationsSec: [0] })).toBe(5700)
  })

  it("a provider with no declared bound keeps the 2.0 family's 15s worst case: seedance-2, 8s + [NaN] = ceil(62.5 × (15 + 15)) = 1875", () => {
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: "seedance-2", resolution: "720p", outputDurationSec: 8, requestedDuration: 8, referenceTaskType: undefined, durationsSec: [NaN] })).toBe(1875)
    expect(Math.ceil(S2_720P_PER_SEC * 30)).toBe(1875)
  })

  it("no clips at all → the requested duration alone (8s 720p seedance-2 = 500)", () => {
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: "seedance-2", resolution: "720p", outputDurationSec: 8, requestedDuration: 8, referenceTaskType: undefined, durationsSec: [] })).toBe(500)
  })

  it("the summed input is capped at the provider's declared total — past it the provider rejects the run: 2.5, 8s + [NaN, NaN] = ceil(95 × (30 + 30)) = 5700, not ceil(95 × 90)", () => {
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: "seedance-2-5", resolution: "720p", outputDurationSec: 8, requestedDuration: 8, referenceTaskType: undefined, durationsSec: [NaN, NaN] })).toBe(5700)
  })

  it("a null (a NaN that went through JSON) is an unusable probe too", () => {
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: "seedance-2-5", resolution: "720p", outputDurationSec: 8, requestedDuration: 8, referenceTaskType: undefined, durationsSec: [null as unknown as number] })).toBe(5700)
  })
})

/**
 * The AUTO-duration edit hold (2026-10-26): an Auto run with every reference
 * clip measured renders the length of the clip it edits, so the hold covers
 * the LONGEST clip (the model may edit any of them; with one clip, that clip)
 * rounded up to a whole second plus one second — never the model's longest
 * clip. Evidence: a 4.1 s clip at 720p on seedance-2-5 used to hold 4.1 + 30 s
 * and delivered ≈ 4.1 s.
 */
describe("the Auto-duration edit hold", () => {
  const AUTO = VIDEO_DURATION_AUTO
  const s25 = { provider: "seedance-2-5", resolution: "720p", outputDurationSec: pricedOutputDurationSec("seedance-2-5", AUTO) }

  it("Auto is priced at the model's longest clip before any clip is read (30 s on 2.5)", () => {
    expect(s25.outputDurationSec).toBe(30)
  })

  it("one clip: 4.1 s → 6 s output held (ceil 5 + 1), input 4.1 s: ceil(95 × 10.1) = 960, not ceil(95 × 34.1) = 3240", () => {
    expect(seedance2RefVideoHeldOutputSec({ ...s25, requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [4.1] })).toBe(6)
    expect(seedance2RefVideoBaseCreditsFromDurations({ ...s25, requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [4.1] })).toBe(960)
    expect(Math.ceil(S25_720P_PER_SEC * 10.1)).toBe(960)
    // The old hold, for the record: the model's 30 s out.
    expect(Math.ceil(S25_720P_PER_SEC * (4.1 + 30))).toBe(3240)
  })

  it("the evidence case, charged at 10% markup: hold 3564 → 1056 (settled 854 in production)", () => {
    const settings = { cost_markup_percent: 10 } as never
    const charge = (id: string, base: number) => applyServiceMarkup(base, settings, id)
    const quote = seedance2RefVideoQuote({ provider: "seedance-2-5", resolution: "720p", duration: AUTO, durationsSec: [4.1], unknownClips: 0, referenceTaskType: undefined, charge })
    const reserve = charge("seedance-2-5:30s:720p-ref", seedance2RefVideoBaseCreditsFromDurations({ ...s25, requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [4.1] }))
    expect(quote).toEqual({ credits: reserve, min: reserve, exact: true })
    expect(reserve).toBe(1056)
    expect(charge("seedance-2-5:30s:720p-ref", Math.ceil(S25_720P_PER_SEC * (4.1 + 30)))).toBe(3564)
  })

  it("a whole-second clip still gets its second of margin: 4 s → 5 s", () => {
    expect(seedance2RefVideoHeldOutputSec({ ...s25, requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [4] })).toBe(5)
  })

  it("several clips: the LONGEST clip decides the output hold (the model may edit any of them), every clip counts as input: [4.1, 12] → 13 s out + 16.1 s in = ceil(95 × 29.1) = 2765", () => {
    expect(seedance2RefVideoHeldOutputSec({ ...s25, requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [4.1, 12] })).toBe(13)
    expect(seedance2RefVideoBaseCreditsFromDurations({ ...s25, requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [4.1, 12] })).toBe(2765)
    expect(Math.ceil(S25_720P_PER_SEC * 29.1)).toBe(2765)
  })

  it("the longest clip wherever it is: [5, 25] and [25, 5] both hold 26 s; one 6 s clip holds 7 s", () => {
    expect(seedance2RefVideoHeldOutputSec({ ...s25, requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [5, 25] })).toBe(26)
    expect(seedance2RefVideoHeldOutputSec({ ...s25, requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [25, 5] })).toBe(26)
    expect(seedance2RefVideoHeldOutputSec({ ...s25, requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [6] })).toBe(7)
    expect(seedance2RefVideoBaseCreditsFromDurations({ ...s25, requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [5, 25] })).toBe(Math.ceil(S25_720P_PER_SEC * (30 + 26)))
  })

  it("a longest clip whose margin passes the model's longest clip is held at that cap: [5, 29.5] → 30 s", () => {
    expect(seedance2RefVideoHeldOutputSec({ ...s25, requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [5, 29.5] })).toBe(30)
  })

  it("an unmeasured clip beside a long one keeps today's worst case: [5, NaN] and [NaN, 25] hold 30 s", () => {
    expect(seedance2RefVideoHeldOutputSec({ ...s25, requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [5, Number.NaN] })).toBe(30)
    expect(seedance2RefVideoHeldOutputSec({ ...s25, requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [Number.NaN, 25] })).toBe(30)
  })

  it("the quote of an Auto run with several clips is exactly its reservation", () => {
    const settings = { cost_markup_percent: 10 } as never
    const charge = (id: string, base: number) => applyServiceMarkup(base, settings, id)
    const quote = seedance2RefVideoQuote({ provider: "seedance-2-5", resolution: "720p", duration: AUTO, durationsSec: [5, 25], unknownClips: 0, referenceTaskType: undefined, charge })
    const reserve = charge("seedance-2-5:30s:720p-ref", seedance2RefVideoBaseCreditsFromDurations({ ...s25, requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [5, 25] }))
    expect(quote).toEqual({ credits: reserve, min: reserve, exact: true })
  })

  it("never above the model's longest clip: a 29.5 s clip holds 30 s out, not 31", () => {
    expect(seedance2RefVideoHeldOutputSec({ ...s25, requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [29.5] })).toBe(30)
  })

  it("Auto is recognized as the string \"-1\" too (a workflow field may carry it as text)", () => {
    expect(seedance2RefVideoHeldOutputSec({ ...s25, requestedDuration: "-1", referenceTaskType: undefined, durationsSec: [4.1] })).toBe(6)
  })

  it("a fixed duration is unchanged: the longer of the requested seconds and the longest clip", () => {
    const fixed = (d: number, durationsSec: number[]) =>
      seedance2RefVideoBaseCreditsFromDurations({ provider: "seedance-2-5", resolution: "720p", outputDurationSec: d, requestedDuration: d, referenceTaskType: undefined, durationsSec })
    expect(fixed(8, [4.1])).toBe(Math.ceil(S25_720P_PER_SEC * (4.1 + 8)))
    expect(fixed(4, [12])).toBe(Math.ceil(S25_720P_PER_SEC * (12 + 12)))
    expect(seedance2RefVideoHeldOutputSec({ ...s25, outputDurationSec: 8, requestedDuration: 8, referenceTaskType: undefined, durationsSec: [4.1, 12] })).toBe(12)
  })

  it("an unmeasurable clip keeps today's worst case, the first clip's or any other's: [NaN] and [4.1, NaN] both hold 30 s out", () => {
    expect(seedance2RefVideoHeldOutputSec({ ...s25, requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [Number.NaN] })).toBe(30)
    expect(seedance2RefVideoHeldOutputSec({ ...s25, requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [4.1, Number.NaN] })).toBe(30)
    expect(seedance2RefVideoBaseCreditsFromDurations({ ...s25, requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [Number.NaN] })).toBe(Math.ceil(S25_720P_PER_SEC * 60))
    expect(seedance2RefVideoBaseCreditsFromDurations({ ...s25, requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [null as unknown as number] })).toBe(Math.ceil(S25_720P_PER_SEC * 60))
  })

  it("no reference clip: the rule does not apply (Auto stays at the model's longest clip)", () => {
    expect(seedance2RefVideoHeldOutputSec({ ...s25, requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [] })).toBe(30)
  })

  it("the 2.0 family: seedance-2 Auto + 4.1 s = 6 s out, ceil(62.5 × 10.1) = 632; capped at its 15 s longest clip", () => {
    const s2 = { provider: "seedance-2", resolution: "720p", outputDurationSec: pricedOutputDurationSec("seedance-2", AUTO), requestedDuration: AUTO, referenceTaskType: undefined }
    expect(s2.outputDurationSec).toBe(15)
    expect(seedance2RefVideoBaseCreditsFromDurations({ ...s2, durationsSec: [4.1] })).toBe(632)
    expect(Math.ceil(S2_720P_PER_SEC * 10.1)).toBe(632)
    expect(seedance2RefVideoHeldOutputSec({ ...s2, durationsSec: [14.5] })).toBe(15)
  })

  it("every model whose output follows its reference clip and that takes Auto holds the (longest) clip + margin", () => {
    const models = Object.keys(MODEL_CATALOG).filter(
      (id) => billsReferenceVideoSeconds(id) && supportsAutoVideoDuration(id) && !VIDEO_REF_RATE_PROVIDERS.has(id),
    )
    expect(models).toEqual(expect.arrayContaining(["seedance-2", "seedance-2-fast", "seedance-2-mini", "seedance-2-5"]))
    for (const provider of models) {
      const outputDurationSec = pricedOutputDurationSec(provider, AUTO)
      expect(seedance2RefVideoHeldOutputSec({ provider, outputDurationSec, requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [4.1] }), provider).toBe(6)
      expect(seedance2RefVideoHeldOutputSec({ provider, outputDurationSec, requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [Number.NaN] }), provider)
        .toBe(Math.max(outputDurationSec, refVideoWorstCaseSecFor(provider)))
    }
  })

  it("Kling 4.0 renders the requested duration: Auto changes nothing there", () => {
    const k = { provider: "kling-4", resolution: "720p", outputDurationSec: 10 }
    expect(seedance2RefVideoHeldOutputSec({ ...k, requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [4.1] })).toBe(10)
    expect(seedance2RefVideoBaseCreditsFromDurations({ ...k, requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [4.1] }))
      .toBe(seedance2RefVideoBaseCreditsFromDurations({ ...k, requestedDuration: 10, referenceTaskType: undefined, durationsSec: [4.1] }))
  })
})

describe("refVideoWorstCaseSecFor", () => {
  it("is the provider's declared per-clip cap (seedance-2-5 → 30), else 15", () => {
    expect(refVideoWorstCaseSecFor("seedance-2-5")).toBe(30)
    expect(refVideoWorstCaseSecFor("seedance-2")).toBe(15)
    expect(refVideoWorstCaseSecFor("seedance-2-mini")).toBe(15)
  })
})

/**
 * The SETTLEMENT: `unit × (Σ reference clips + the DELIVERED clip)`, measured
 * after the provider returned. A style run refunds down to its requested
 * duration; an edit pays for the length it rendered.
 */
describe("seedance2RefVideoActualBaseCredits (the settlement)", () => {
  const OUT = "https://kie.example/out.mp4"
  const REF = "https://r2.example.com/videos/ref.mp4"

  beforeEach(() => {
    probe.durations.clear()
    probe.probeMediaDuration.mockClear()
  })

  it("a style run delivered at the requested 12s with a 30s clip wired settles to ceil(237.5 × (30 + 12)) = 9975 — below the 14250 reserved", async () => {
    probe.durations.set(OUT, 12)
    probe.durations.set(REF, 30)
    await expect(
      seedance2RefVideoActualBaseCredits({ provider: "seedance-2-5", resolution: "1080p", requestedDuration: undefined, referenceTaskType: undefined, outputUrl: OUT, referenceVideoUrls: [REF] }),
    ).resolves.toBe(9975)
    expect(Math.ceil(S25_1080P_PER_SEC * 42)).toBe(9975)
  })

  it("an edit that rendered the full 30s clip settles at the reservation (14250)", async () => {
    probe.durations.set(OUT, 30)
    probe.durations.set(REF, 30)
    await expect(
      seedance2RefVideoActualBaseCredits({ provider: "seedance-2-5", resolution: "1080p", requestedDuration: undefined, referenceTaskType: undefined, outputUrl: OUT, referenceVideoUrls: [REF] }),
    ).resolves.toBe(14250)
  })

  it("a reference clip that cannot be re-probed counts as the per-clip cap (never lowers the charge): 720p, 12s delivered + [failed] = ceil(95 × (30 + 12)) = 3990", async () => {
    probe.durations.set(OUT, 12)
    probe.durations.set(REF, new Error("ffprobe: connection reset"))
    await expect(
      seedance2RefVideoActualBaseCredits({ provider: "seedance-2-5", resolution: "720p", requestedDuration: undefined, referenceTaskType: undefined, outputUrl: OUT, referenceVideoUrls: [REF] }),
    ).resolves.toBe(3990)
  })

  it("a clip the reservation could not read is measured again at the settlement and billed at its real length", async () => {
    probe.durations.set(OUT, 12)
    probe.durations.set(REF, 6)
    // Stored probe [NaN] (null once it has been through JSON): reserved as the 30s cap.
    for (const stored of [[Number.NaN], [null]]) {
      await expect(
        seedance2RefVideoActualBaseCredits({ provider: "seedance-2-5", resolution: "720p", requestedDuration: undefined, referenceTaskType: undefined, outputUrl: OUT, referenceVideoUrls: [REF], durationsSec: stored }),
      ).resolves.toBe(Math.ceil(95 * (6 + 12)))
    }
  })

  it("a clip measured only at the settlement never counts above the worst case the reservation held (no cap of its own on Seedance 2.0: 15s)", async () => {
    probe.durations.set(OUT, 8)
    probe.durations.set(REF, 40)
    const measured = await seedance2RefVideoActualBaseCredits({ provider: "seedance-2", resolution: "720p", requestedDuration: 8, referenceTaskType: undefined, outputUrl: OUT, referenceVideoUrls: [REF], durationsSec: [Number.NaN] })
    const heldAtWorst = await seedance2RefVideoActualBaseCredits({ provider: "seedance-2", resolution: "720p", requestedDuration: 8, referenceTaskType: undefined, outputUrl: OUT, referenceVideoUrls: [REF], durationsSec: [15] })
    expect(measured).toBe(heldAtWorst)
  })

  it("ten reference clips whose probes all hang: the re-measure stops at its overall ceiling and keeps the worst case", async () => {
    vi.useFakeTimers()
    try {
      const refs = Array.from({ length: 10 }, (_, i) => `https://r2.example.com/videos/ref-${i}.mp4`)
      probe.durations.set(OUT, 12)
      for (const r of refs) probe.durations.set(r, "hang")
      let done = false
      const settled = seedance2RefVideoActualBaseCredits({
        provider: "seedance-2-5", resolution: "720p", requestedDuration: undefined, referenceTaskType: undefined, outputUrl: OUT,
        referenceVideoUrls: refs, durationsSec: refs.map(() => Number.NaN),
      }).finally(() => { done = true })
      // Four at a time, ten clips would take three rounds of the per-clip budget; the ceiling allows two.
      expect(3 * SETTLE_REMEASURE_CLIP_TIMEOUT_MS).toBeGreaterThan(SETTLE_REMEASURE_TOTAL_MS)
      await vi.advanceTimersByTimeAsync(SETTLE_REMEASURE_TOTAL_MS - 1)
      expect(done).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(done).toBe(true)
      // Every clip at the 30 s cap, capped at 30 s in all: ceil(95 × (30 + 12)), as reserved.
      await expect(settled).resolves.toBe(3990)
    } finally {
      vi.useRealTimers()
    }
  })

  it("a clip already measured by the reservation is not probed again", async () => {
    probe.durations.set(OUT, 12)
    await seedance2RefVideoActualBaseCredits({ provider: "seedance-2-5", resolution: "720p", requestedDuration: undefined, referenceTaskType: undefined, outputUrl: OUT, referenceVideoUrls: [REF], durationsSec: [6] })
    expect(probe.probeMediaDuration).toHaveBeenCalledTimes(1)
  })

  describe("a clip measured only at the settlement re-sizes no hold: every hold reads the reservation's probe", () => {
    // Stored probe [NaN]: the reservation held that clip at the 30 s cap. It
    // reads now, so the input side bills its real length; the hold a delivery
    // is compared with stays the one the reservation made.
    const unread = { provider: "seedance-2-5", resolution: "720p", outputUrl: OUT, referenceVideoUrls: [REF], durationsSec: [Number.NaN], jobId: "job-remeasure" }
    let alert: ReturnType<typeof vi.spyOn>
    beforeEach(() => { alert = vi.spyOn(console, "error").mockImplementation(() => {}) })
    afterEach(() => { alert.mockRestore() })

    it("a fixed 8 s run held at the 30 s clip: a 12 s delivery is charged as measured, with no over-run alert against the re-measured 6 s", async () => {
      probe.durations.set(OUT, 12)
      probe.durations.set(REF, 6)
      const run = { ...unread, requestedDuration: 8, referenceTaskType: undefined }
      await expect(seedance2RefVideoActualSeconds(run)).resolves.toStrictEqual({ deliveredSec: 12, chargedOutputSec: 12, inputSec: 6, measuredSec: 12 })
      expect(alert).not.toHaveBeenCalled()
    })

    it("an undeclared Auto run held at the worst case: no edit hold is made from the re-measured clip (5 s → 6 s), so a 12 s delivery is charged as measured, with no alert", async () => {
      probe.durations.set(OUT, 12)
      probe.durations.set(REF, 5)
      const run = { ...unread, requestedDuration: VIDEO_DURATION_AUTO, referenceTaskType: undefined }
      await expect(seedance2RefVideoActualSeconds(run)).resolves.toStrictEqual({ deliveredSec: 12, chargedOutputSec: 12, inputSec: 5, measuredSec: 12 })
      expect(alert).not.toHaveBeenCalled()
    })

    it("a declared reference with an automatic length: charged what it delivered up to the 30 s hold, the clip billed at its re-measured length", async () => {
      probe.durations.set(REF, 5)
      const run = { ...unread, requestedDuration: VIDEO_DURATION_AUTO, referenceTaskType: "reference" }
      probe.durations.set(OUT, 12)
      await expect(seedance2RefVideoActualSeconds(run)).resolves.toStrictEqual({ deliveredSec: 12, chargedOutputSec: 12, inputSec: 5, measuredSec: 12 })
      expect(alert).not.toHaveBeenCalled()
      probe.durations.set(OUT, 31.5)
      await expect(seedance2RefVideoActualSeconds(run)).resolves.toStrictEqual({ deliveredSec: 31.5, chargedOutputSec: 30, inputSec: 5, measuredSec: 31.5 })
      expect(alert).toHaveBeenCalledTimes(1)
      expect(String(alert.mock.calls[0]?.[0])).toContain("heldSec=30")
    })
  })

  it("a delivered clip that cannot be measured THROWS — the caller then commits the reservation", async () => {
    probe.durations.set(OUT, new Error("ffprobe: 403"))
    probe.durations.set(REF, 30)
    await expect(
      seedance2RefVideoActualBaseCredits({ provider: "seedance-2-5", resolution: "720p", requestedDuration: undefined, referenceTaskType: undefined, outputUrl: OUT, referenceVideoUrls: [REF] }),
    ).rejects.toThrow("ffprobe: 403")
  })

  it("with no stored probe: probes the delivered clip and every reference clip, nothing else", async () => {
    probe.durations.set(OUT, 8)
    probe.durations.set(REF, 5)
    await seedance2RefVideoActualBaseCredits({ provider: "seedance-2-5", resolution: "720p", requestedDuration: undefined, referenceTaskType: undefined, outputUrl: OUT, referenceVideoUrls: [REF, 42, ""] })
    expect(probe.probeMediaDuration.mock.calls.map((c) => c[0]).sort()).toEqual([OUT, REF].sort())
  })

  it("with the reservation's probe on hand: prices the input from IT and probes only the delivered clip — a reference URL gone stale cannot erase the refund", async () => {
    probe.durations.set(OUT, 12)
    probe.durations.set(REF, new Error("ffprobe: 403"))
    await expect(
      seedance2RefVideoActualBaseCredits({ provider: "seedance-2-5", resolution: "720p", requestedDuration: undefined, referenceTaskType: undefined, outputUrl: OUT, referenceVideoUrls: [REF], durationsSec: [5] }),
    ).resolves.toBe(Math.ceil(S25_720P_PER_SEC * (5 + 12)))
    expect(probe.probeMediaDuration.mock.calls.map((c) => c[0])).toEqual([OUT])
  })

  it("a stored probe that was unusable at reservation stays the worst case at settlement (the reserve counted it that way): [null] on 2.5 = 30s in", async () => {
    probe.durations.set(OUT, 12)
    await expect(
      seedance2RefVideoActualBaseCredits({ provider: "seedance-2-5", resolution: "720p", requestedDuration: undefined, referenceTaskType: undefined, outputUrl: OUT, referenceVideoUrls: [REF], durationsSec: [null] }),
    ).resolves.toBe(3990)
  })

  describe("an Auto edit held for its source clip + 1 s", () => {
    const auto = { provider: "seedance-2-5", resolution: "720p", outputUrl: OUT, referenceVideoUrls: [REF], durationsSec: [4.1], requestedDuration: VIDEO_DURATION_AUTO, referenceTaskType: undefined, jobId: "job-evidence" }
    let alert: ReturnType<typeof vi.spyOn>
    beforeEach(() => { alert = vi.spyOn(console, "error").mockImplementation(() => {}) })
    afterEach(() => { alert.mockRestore() })

    it("the docs' worked example: a 4.1 s edit delivered at 4.1 s settles to ceil(95 × 8.2) = 779 base (857 charged at 10%)", async () => {
      probe.durations.set(OUT, 4.1)
      await expect(seedance2RefVideoActualBaseCredits(auto)).resolves.toBe(779)
      expect(Math.ceil(S25_720P_PER_SEC * 8.2)).toBe(779)
      expect(applyServiceMarkup(779, { cost_markup_percent: 10 } as never, "seedance-2-5:30s:720p-ref")).toBe(857)
      expect(alert).not.toHaveBeenCalled()
    })

    it("delivered within the hold: charged what was delivered, no alert (4.1 in + 4.08 out)", async () => {
      probe.durations.set(OUT, 4.08)
      await expect(seedance2RefVideoActualBaseCredits(auto)).resolves.toBe(Math.ceil(S25_720P_PER_SEC * (4.1 + 4.08)))
      expect(alert).not.toHaveBeenCalled()
    })

    it("delivered past the hold: charged AT the hold (never above the reservation) and alerted with the job, held and delivered seconds", async () => {
      probe.durations.set(OUT, 9.5)
      const reserved = seedance2RefVideoBaseCreditsFromDurations({
        provider: "seedance-2-5", resolution: "720p", outputDurationSec: 30, requestedDuration: VIDEO_DURATION_AUTO, referenceTaskType: undefined, durationsSec: [4.1],
      })
      await expect(seedance2RefVideoActualBaseCredits(auto)).resolves.toBe(reserved)
      expect(reserved).toBe(960)
      expect(alert).toHaveBeenCalledTimes(1)
      const line = String(alert.mock.calls[0]?.[0])
      expect(line).toMatch(/^\[ALERT\]/)
      expect(line).toContain("job=job-evidence")
      expect(line).toContain("heldSec=6")
      expect(line).toContain("deliveredSec=9.5")
    })

    it("a fixed-duration run is not this rule: a hair over its held seconds raises no alert (the commit's own clamp still applies)", async () => {
      probe.durations.set(OUT, 8.04)
      await expect(seedance2RefVideoActualBaseCredits({ ...auto, requestedDuration: 8, referenceTaskType: undefined })).resolves.toBe(Math.ceil(S25_720P_PER_SEC * (4.1 + 8.04)))
      expect(alert).not.toHaveBeenCalled()
    })

    it("several clips: held for the longest clip, so a delivery of that clip's length is charged as delivered, with no alert", async () => {
      probe.durations.set(OUT, 25.04)
      const several = { ...auto, durationsSec: [5, 25] }
      await expect(seedance2RefVideoActualSeconds(several)).resolves.toEqual({ deliveredSec: 25.04, chargedOutputSec: 25.04, inputSec: 30, measuredSec: 25.04 })
      expect(alert).not.toHaveBeenCalled()
      probe.durations.set(OUT, 27)
      await expect(seedance2RefVideoActualSeconds(several)).resolves.toMatchObject({ deliveredSec: 27, chargedOutputSec: 26 })
      expect(alert).toHaveBeenCalledTimes(1)
      expect(String(alert.mock.calls[0]?.[0])).toContain("heldSec=26")
    })

    it("an Auto run whose clip was unmeasurable was held at the worst case: nothing to alert on", async () => {
      probe.durations.set(OUT, 12)
      await expect(seedance2RefVideoActualBaseCredits({ ...auto, durationsSec: [null] })).resolves.toBe(3990)
      expect(alert).not.toHaveBeenCalled()
    })
  })

  describe("a fixed-length run (a declared extend) delivered past its hold", () => {
    // Held at the longer of the priced length and the longest clip (8 s here).
    // A delivery past it costs more than the reservation, which the commit
    // cannot collect: the charge stays as measured, and an [ALERT] says so.
    const extend = { provider: "seedance-2-5", resolution: "720p", outputUrl: OUT, referenceVideoUrls: [REF], durationsSec: [6], requestedDuration: 8, referenceTaskType: undefined, jobId: "job-extend" }
    let alert: ReturnType<typeof vi.spyOn>
    beforeEach(() => { alert = vi.spyOn(console, "error").mockImplementation(() => {}) })
    afterEach(() => { alert.mockRestore() })

    it("alerts with the job, held and delivered seconds, and charges exactly what it charged before", async () => {
      probe.durations.set(OUT, 14.04)
      const seconds = await seedance2RefVideoActualSeconds(extend)
      expect(seconds).toEqual({ deliveredSec: 14.04, chargedOutputSec: 14.04, inputSec: 6, measuredSec: 14.04 })
      await expect(seedance2RefVideoActualBaseCredits(extend, seconds)).resolves.toBe(Math.ceil(S25_720P_PER_SEC * (6 + 14.04)))
      expect(alert).toHaveBeenCalledTimes(1)
      const line = String(alert.mock.calls[0]?.[0])
      expect(line).toMatch(/^\[ALERT\]/)
      expect(line).toContain("job=job-extend")
      expect(line).toContain("heldSec=8")
      expect(line).toContain("deliveredSec=14.04")
    })

    it("held at the longest clip when it is longer than the length asked for", async () => {
      probe.durations.set(OUT, 20)
      await seedance2RefVideoActualSeconds({ ...extend, durationsSec: [20] })
      expect(alert).not.toHaveBeenCalled()
      probe.durations.set(OUT, 28)
      await seedance2RefVideoActualSeconds({ ...extend, durationsSec: [20] })
      expect(alert).toHaveBeenCalledTimes(1)
      expect(String(alert.mock.calls[0]?.[0])).toContain("heldSec=20")
    })

    it("a container's hair over the hold raises nothing", async () => {
      probe.durations.set(OUT, 8.08)
      await seedance2RefVideoActualSeconds(extend)
      expect(alert).not.toHaveBeenCalled()
    })

    it("Kling 4.0 renders the length asked for: rounded to the second, nothing to alert on", async () => {
      probe.durations.set(OUT, 5.04)
      await seedance2RefVideoActualSeconds({ ...extend, provider: "kling-4", requestedDuration: 5, referenceTaskType: undefined, durationsSec: [4] })
      expect(alert).not.toHaveBeenCalled()
    })
  })
})

/**
 * The seconds the settlement measures, exported so a run's recorded provider
 * cost reads the very seconds its charge bills: `deliveredSec` is what was
 * rendered (never capped), `chargedOutputSec` what the charge bills for the
 * output (an Auto edit past its hold is charged at the hold), `inputSec` the
 * reference clips as billed. The settlement above prices these, so its
 * figures are unchanged.
 */
describe("seedance2RefVideoActualSeconds (what the settlement measures)", () => {
  const OUT = "https://kie.example/out.mp4"
  const REF = "https://r2.example.com/videos/ref.mp4"
  const run = { provider: "seedance-2-5", resolution: "1080p", requestedDuration: 12, referenceTaskType: undefined, outputUrl: OUT, referenceVideoUrls: [REF] }

  beforeEach(() => {
    probe.durations.clear()
    probe.probeMediaDuration.mockClear()
  })

  it("a style run: rendered as asked, charged as rendered, the reference clips as the input", async () => {
    probe.durations.set(OUT, 12)
    await expect(seedance2RefVideoActualSeconds({ ...run, durationsSec: [30] }))
      .resolves.toEqual({ deliveredSec: 12, chargedOutputSec: 12, inputSec: 30, measuredSec: 12 })
  })

  it("a Seedance length is kept as measured; Kling 4.0's rounds to the whole second it billed", async () => {
    probe.durations.set(OUT, 12.04)
    await expect(seedance2RefVideoActualSeconds({ ...run, durationsSec: [30] })).resolves.toMatchObject({ deliveredSec: 12.04, chargedOutputSec: 12.04 })
    probe.durations.set(OUT, 3.04)
    await expect(seedance2RefVideoActualSeconds({ ...run, provider: "kling-4", resolution: "720p", requestedDuration: 3, referenceTaskType: undefined, durationsSec: [5] }))
      .resolves.toMatchObject({ deliveredSec: 3, chargedOutputSec: 3, measuredSec: 3.04 })
  })

  it("with no stored probe, the reference clips are probed under the same worst-case rule", async () => {
    probe.durations.set(OUT, 12)
    probe.durations.set(REF, new Error("ffprobe: connection reset"))
    await expect(seedance2RefVideoActualSeconds({ ...run, resolution: "720p" }))
      .resolves.toEqual({ deliveredSec: 12, chargedOutputSec: 12, inputSec: 30, measuredSec: 12 })
  })

  it("a delivery past an Auto edit's hold: deliveredSec > chargedOutputSec, and its credits are the hold's, as today", async () => {
    const alert = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      probe.durations.set(OUT, 9.5)
      const auto = { provider: "seedance-2-5", resolution: "720p", outputUrl: OUT, referenceVideoUrls: [REF], durationsSec: [4.1], requestedDuration: VIDEO_DURATION_AUTO, referenceTaskType: undefined, jobId: "job-evidence" }
      const seconds = await seedance2RefVideoActualSeconds(auto)
      expect(seconds).toEqual({ deliveredSec: 9.5, chargedOutputSec: 6, inputSec: 4.1, measuredSec: 9.5 })
      expect(seconds.deliveredSec).toBeGreaterThan(seconds.chargedOutputSec)
      expect(alert).toHaveBeenCalledTimes(1)
      expect(String(alert.mock.calls[0]?.[0])).toContain("job=job-evidence")
      // The settlement priced from that measurement: the hold's 960, with no
      // second probe and no second alert.
      probe.probeMediaDuration.mockClear()
      await expect(seedance2RefVideoActualBaseCredits(auto, seconds)).resolves.toBe(960)
      expect(probe.probeMediaDuration).not.toHaveBeenCalled()
      expect(alert).toHaveBeenCalledTimes(1)
    } finally {
      alert.mockRestore()
    }
  })

  it("the settlement priced from a measurement already taken probes nothing and answers what it answers alone", async () => {
    probe.durations.set(OUT, 12)
    const args = { ...run, durationsSec: [30] }
    const alone = await seedance2RefVideoActualBaseCredits(args)
    const measured = await seedance2RefVideoActualSeconds(args)
    probe.probeMediaDuration.mockClear()
    await expect(seedance2RefVideoActualBaseCredits(args, measured)).resolves.toBe(alone)
    expect(alone).toBe(Math.ceil(S25_1080P_PER_SEC * 42))
    expect(probe.probeMediaDuration).not.toHaveBeenCalled()
  })

  it("a delivered clip that cannot be measured THROWS, as the settlement does", async () => {
    probe.durations.set(OUT, new Error("ffprobe: 403"))
    await expect(seedance2RefVideoActualSeconds({ ...run, durationsSec: [30] })).rejects.toThrow("ffprobe: 403")
  })
})

/**
 * The core shim over this settlement (`lib/seedance2-ref-video-settle.ts`),
 * run against the real thing with ffprobe counted: ONE measurement of the
 * delivered clip gives both the credits the charge commits and the seconds
 * behind them.
 */
describe("measureSeedance2Settle over the real settlement", () => {
  const OUT = "https://kie.example/out.mp4"
  const REF = "https://r2.example.com/videos/ref.mp4"

  beforeEach(() => {
    probe.durations.clear()
    probe.probeMediaDuration.mockClear()
  })

  it("probes the delivered clip once and returns the settlement's credits with its seconds", async () => {
    probe.durations.set(OUT, 12)
    const args = { provider: "seedance-2-5", resolution: "1080p", outputUrl: OUT, referenceVideoUrls: [REF], refVideoDurationsSec: [30], duration: 12, referenceTaskType: undefined, characterReferences: undefined, jobId: "job-1" }
    const baseCredits = Math.ceil(S25_1080P_PER_SEC * 42)
    await expect(measureSeedance2Settle(args)).resolves.toEqual({ baseCredits, seconds: { outputSec: 12, inputSec: 30 }, deliveredSec: 12 })
    expect(probe.probeMediaDuration.mock.calls.map((c) => c[0])).toEqual([OUT])
    // The old entry point (the reconcile cron's) answers the same credits.
    await expect(measureSeedance2RefVideoBaseCredits(args)).resolves.toBe(baseCredits)
  })

  it("an Auto edit past its hold: the credits are the hold's, the seconds what was rendered; one probe, one alert", async () => {
    const alert = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      probe.durations.set(OUT, 9.5)
      const args = { provider: "seedance-2-5", resolution: "720p", outputUrl: OUT, referenceVideoUrls: [REF], refVideoDurationsSec: [4.1], duration: VIDEO_DURATION_AUTO, referenceTaskType: undefined, characterReferences: undefined, jobId: "job-evidence" }
      await expect(measureSeedance2Settle(args)).resolves.toEqual({ baseCredits: 960, seconds: { outputSec: 9.5, inputSec: 4.1 }, deliveredSec: 9.5 })
      expect(probe.probeMediaDuration).toHaveBeenCalledTimes(1)
      expect(alert).toHaveBeenCalledTimes(1)
    } finally {
      alert.mockRestore()
    }
  })
})

// The quote's `expected`: what the run should bill once delivered, from the
// clips the reservation measured. 480p `-ref` is 340 / 8 = 42.5 base a second.
describe("seedance2RefVideoExpectedBaseCredits", () => {
  const base = { provider: "seedance-2-5", resolution: "480p" }

  it("an Auto (edit-shape) run renders the clip's own length: input + that clip", () => {
    expect(seedance2RefVideoExpectedBaseCredits({ ...base, outputDurationSec: 15, autoDuration: true, durationsSec: [10] }))
      .toBe(Math.ceil(42.5 * (10 + 10)))
  })

  it("an Auto run with extra clips renders the SOURCE clip (the first), even when an extra one is longer", () => {
    expect(seedance2RefVideoExpectedBaseCredits({ ...base, outputDurationSec: 15, autoDuration: true, durationsSec: [5, 12] }))
      .toBe(Math.ceil(42.5 * (5 + 12 + 5)))
  })

  it("a fixed-duration run renders what was asked: input + the requested seconds", () => {
    expect(seedance2RefVideoExpectedBaseCredits({ ...base, outputDurationSec: 5, autoDuration: false, durationsSec: [10] }))
      .toBe(Math.ceil(42.5 * (10 + 5)))
  })

  it("is never above what the reservation holds", () => {
    const durationsSec = [12, 4]
    const expected = seedance2RefVideoExpectedBaseCredits({ ...base, outputDurationSec: 15, autoDuration: true, durationsSec })!
    const reserved = seedance2RefVideoBaseCreditsFromDurations({ ...base, outputDurationSec: 15, requestedDuration: -1, referenceTaskType: undefined, durationsSec })
    expect(expected).toBeLessThanOrEqual(reserved)
  })

  it("has no answer when a clip could not be measured", () => {
    expect(seedance2RefVideoExpectedBaseCredits({ ...base, outputDurationSec: 5, autoDuration: false, durationsSec: [Number.NaN] }))
      .toBeUndefined()
  })
})

/**
 * A request that DECLARES `reference` with an automatic length: Seedance runs a
 * reference at a length it picks within its range (4 to 30 s on 2.5), not the
 * length of a clip — only an edit renders its clip's length. So the edit hold
 * (the longest clip + 1 s) does not apply: the run is held at the worst case
 * (the model's longest output, or the longest clip if that is longer) and
 * charged what it makes, never above that hold. Every other request holds,
 * quotes and settles exactly as before.
 */
describe("a declared reference with an automatic length", () => {
  const AUTO = VIDEO_DURATION_AUTO
  const OUT = "https://kie.example/out.mp4"
  const REF = "https://r2.example.com/videos/ref.mp4"
  const longest = pricedOutputDurationSec("seedance-2-5", AUTO)
  const s25 = { provider: "seedance-2-5", resolution: "720p", outputDurationSec: longest, requestedDuration: AUTO, referenceTaskType: undefined }
  /** The worst case through the code's own arithmetic: the longest output (or clip), every clip as input. */
  const worst = (clips: number[], provider = "seedance-2-5") => seedance2RefVideoBaseCredits({
    provider, resolution: "720p",
    outputDurationSec: Math.max(pricedOutputDurationSec(provider, AUTO), ...clips),
    inputVideoDurationSec: clips.reduce((sum, d) => sum + d, 0),
  })
  const settings = { cost_markup_percent: 10 } as never
  const charge = (id: string, base: number) => applyServiceMarkup(base, settings, id)

  it("one 5 s clip at 720p holds the model's longest output (30 s), not the edit hold's 6 s: ceil(95 × 35) = 3325, not 1045", () => {
    expect(longest).toBe(30)
    expect(seedance2RefVideoHeldOutputSec({ ...s25, durationsSec: [5], referenceTaskType: "reference" })).toBe(30)
    expect(seedance2RefVideoBaseCreditsFromDurations({ ...s25, durationsSec: [5], referenceTaskType: "reference" })).toBe(worst([5]))
    expect(worst([5])).toBe(Math.ceil(S25_720P_PER_SEC * 35))
    expect(worst([5])).toBe(3325)
    // Undeclared, the same request is held as an edit: 5 + (5 + 1) s.
    expect(seedance2RefVideoBaseCreditsFromDurations({ ...s25, durationsSec: [5], referenceTaskType: undefined })).toBe(1045)
  })

  it("two clips [5, 12]: the longest output, both clips as input", () => {
    expect(seedance2RefVideoHeldOutputSec({ ...s25, durationsSec: [5, 12], referenceTaskType: "reference" })).toBe(30)
    expect(seedance2RefVideoBaseCreditsFromDurations({ ...s25, durationsSec: [5, 12], referenceTaskType: "reference" })).toBe(worst([5, 12]))
  })

  it("the quote of the request is exactly that reservation, one clip or two", () => {
    for (const clips of [[5], [5, 12]]) {
      const quote = seedance2RefVideoQuote({ provider: "seedance-2-5", resolution: "720p", duration: AUTO, referenceTaskType: "reference", durationsSec: clips, unknownClips: 0, charge })
      const reserve = charge("seedance-2-5:30s:720p-ref", worst(clips))
      expect(quote).toStrictEqual({ credits: reserve, min: reserve, exact: true })
    }
  })

  it("the quote resolves the declaration as the run does: a model that does not take it declares nothing, a draft declares as any run", () => {
    const quote = (args: Record<string, unknown>) => seedance2RefVideoQuote({ resolution: "720p", duration: AUTO, durationsSec: [5], unknownClips: 0, charge, provider: "seedance-2-5", referenceTaskType: undefined, ...args })
    expect(quote({ provider: "seedance-2", referenceTaskType: "reference" })).toStrictEqual(quote({ provider: "seedance-2" }))
    // A draft: the declared reference's worst-case hold, at the draft's 480p — the same request at 480p without Draft.
    expect(quote({ draft: true, referenceTaskType: "reference" })).toStrictEqual(quote({ resolution: "480p", referenceTaskType: "reference" }))
    expect(quote({ draft: true, referenceTaskType: "reference" })).not.toStrictEqual(quote({ draft: true }))
  })

  describe("the settlement: charged what it makes, never above the hold", () => {
    const run = { provider: "seedance-2-5", resolution: "720p", outputUrl: OUT, referenceVideoUrls: [REF], durationsSec: [5], requestedDuration: AUTO, referenceTaskType: "reference", jobId: "job-ref" }
    let alert: ReturnType<typeof vi.spyOn>
    beforeEach(() => {
      probe.durations.clear()
      probe.probeMediaDuration.mockClear()
      alert = vi.spyOn(console, "error").mockImplementation(() => {})
    })
    afterEach(() => { alert.mockRestore() })

    it("a delivered 30 s is charged as 30 s, not capped at the edit's 6 s", async () => {
      probe.durations.set(OUT, 30)
      await expect(seedance2RefVideoActualSeconds(run)).resolves.toStrictEqual({ deliveredSec: 30, chargedOutputSec: 30, inputSec: 5, measuredSec: 30 })
      await expect(seedance2RefVideoActualBaseCredits(run)).resolves.toBe(worst([5]))
      expect(alert).not.toHaveBeenCalled()
    })

    it("a delivered 12 s is charged as 12 s", async () => {
      probe.durations.set(OUT, 12)
      await expect(seedance2RefVideoActualSeconds(run)).resolves.toStrictEqual({ deliveredSec: 12, chargedOutputSec: 12, inputSec: 5, measuredSec: 12 })
      await expect(seedance2RefVideoActualBaseCredits(run)).resolves.toBe(Math.ceil(S25_720P_PER_SEC * (5 + 12)))
      expect(alert).not.toHaveBeenCalled()
    })

    it("two clips: a delivered 30 s is charged as 30 s, both clips as input", async () => {
      probe.durations.set(OUT, 30)
      const two = { ...run, durationsSec: [5, 12] }
      await expect(seedance2RefVideoActualSeconds(two)).resolves.toStrictEqual({ deliveredSec: 30, chargedOutputSec: 30, inputSec: 17, measuredSec: 30 })
      await expect(seedance2RefVideoActualBaseCredits(two)).resolves.toBe(worst([5, 12]))
    })

    it("a container's hair past the hold (30.04 s) is charged at the hold, with no alert", async () => {
      probe.durations.set(OUT, 30.04)
      await expect(seedance2RefVideoActualSeconds(run)).resolves.toStrictEqual({ deliveredSec: 30.04, chargedOutputSec: 30, inputSec: 5, measuredSec: 30.04 })
      await expect(seedance2RefVideoActualBaseCredits(run)).resolves.toBe(seedance2RefVideoBaseCreditsFromDurations({ ...s25, durationsSec: [5], referenceTaskType: "reference" }))
      expect(alert).not.toHaveBeenCalled()
    })

    it("past the hold by more than that: charged at the hold and alerted with the job, held and delivered seconds", async () => {
      probe.durations.set(OUT, 31.5)
      await expect(seedance2RefVideoActualSeconds(run)).resolves.toStrictEqual({ deliveredSec: 31.5, chargedOutputSec: 30, inputSec: 5, measuredSec: 31.5 })
      expect(alert).toHaveBeenCalledTimes(1)
      const line = String(alert.mock.calls[0]?.[0])
      expect(line).toMatch(/^\[ALERT\]/)
      expect(line).toContain("job=job-ref")
      expect(line).toContain("heldSec=30")
      expect(line).toContain("deliveredSec=31.5")
    })

    it("an unmeasured clip: held at the worst case as before, a delivery within it charged as delivered", async () => {
      probe.durations.set(OUT, 12)
      const unmeasured = { ...run, durationsSec: [null] }
      await expect(seedance2RefVideoActualSeconds(unmeasured)).resolves.toStrictEqual(await seedance2RefVideoActualSeconds({ ...unmeasured, referenceTaskType: undefined }))
      await expect(seedance2RefVideoActualBaseCredits(unmeasured)).resolves.toBe(3990)
    })

    it("the core shim reads the job's recorded type: the settle lanes charge the delivered 30 s", async () => {
      probe.durations.set(OUT, 30)
      const lane = { provider: "seedance-2-5", resolution: "720p", outputUrl: OUT, referenceVideoUrls: [REF], refVideoDurationsSec: [5], duration: AUTO, referenceTaskType: "reference", characterReferences: undefined, jobId: "job-ref" }
      await expect(measureSeedance2Settle(lane)).resolves.toStrictEqual({ baseCredits: worst([5]), seconds: { outputSec: 30, inputSec: 5 }, deliveredSec: 30 })
      // Without the recorded type (undeclared), the same delivery is charged at the edit hold, as before.
      await expect(measureSeedance2Settle({ ...lane, referenceTaskType: undefined })).resolves.toStrictEqual({ baseCredits: 1045, seconds: { outputSec: 30, inputSec: 5 }, deliveredSec: 30 })
    })
  })

  describe("every other request is byte-identical to an undeclared one", () => {
    const clipSets = [[5], [5, 12], [Number.NaN], [5, Number.NaN], [3], [30]]
    const shapes = [
      ["edit with an automatic length", { requestedDuration: AUTO, outputDurationSec: longest, referenceTaskType: "edit" }],
      ["extend at a fixed 8 s", { requestedDuration: 8, outputDurationSec: 8, referenceTaskType: "extend" }],
      ["reference at a fixed 8 s", { requestedDuration: 8, outputDurationSec: 8, referenceTaskType: "reference" }],
      ["auto", { requestedDuration: AUTO, outputDurationSec: longest, referenceTaskType: "auto" }],
    ] as const

    it.each(shapes)("%s: the same hold and reservation", (_name, shape) => {
      for (const durationsSec of clipSets) {
        const args = { provider: "seedance-2-5", resolution: "720p", ...shape, durationsSec }
        expect(seedance2RefVideoHeldOutputSec(args), String(durationsSec)).toBe(seedance2RefVideoHeldOutputSec({ ...args, referenceTaskType: undefined }))
        expect(seedance2RefVideoBaseCreditsFromDurations(args), String(durationsSec)).toBe(seedance2RefVideoBaseCreditsFromDurations({ ...args, referenceTaskType: undefined }))
      }
    })

    it("an undeclared Auto run keeps the edit hold it had: [5] → 6 s, ceil(95 × 11) = 1045", () => {
      expect(seedance2RefVideoHeldOutputSec({ ...s25, durationsSec: [5], referenceTaskType: undefined })).toBe(6)
      expect(seedance2RefVideoBaseCreditsFromDurations({ ...s25, durationsSec: [5], referenceTaskType: undefined })).toBe(Math.ceil(S25_720P_PER_SEC * 11))
    })

    it("a model that does not take the type: reference changes nothing (Seedance 2.0, Kling 4.0, Gemini Omni)", () => {
      for (const provider of ["seedance-2", "seedance-2-fast", "kling-4", "gemini-omni-flash-1-2"]) {
        const args = { provider, resolution: "720p", outputDurationSec: pricedOutputDurationSec(provider, AUTO), requestedDuration: AUTO, referenceTaskType: undefined, durationsSec: [5] }
        expect(seedance2RefVideoHeldOutputSec({ ...args, referenceTaskType: "reference" }), provider).toBe(seedance2RefVideoHeldOutputSec({ ...args, referenceTaskType: undefined }))
        expect(seedance2RefVideoBaseCreditsFromDurations({ ...args, referenceTaskType: "reference" }), provider).toBe(seedance2RefVideoBaseCreditsFromDurations({ ...args, referenceTaskType: undefined }))
      }
    })

    it.each(shapes)("%s: the same quote", (_name, shape) => {
      for (const durationsSec of clipSets) {
        for (const unknownClips of [0, 1]) {
          const req = { provider: "seedance-2-5", resolution: "720p", duration: shape.requestedDuration, durationsSec, unknownClips, charge }
          expect(seedance2RefVideoQuote({ ...req, referenceTaskType: shape.referenceTaskType }), `${String(durationsSec)} +${unknownClips}`)
            .toStrictEqual(seedance2RefVideoQuote({ ...req, referenceTaskType: undefined }))
        }
      }
    })

    it.each(shapes)("%s: the same settlement", async (_name, shape) => {
      const alert = vi.spyOn(console, "error").mockImplementation(() => {})
      try {
        for (const delivered of [4.1, 8.04, 9.5, 14.04, 30]) {
          for (const durationsSec of [[5], [5, 12], [null]]) {
            probe.durations.clear()
            probe.durations.set(OUT, delivered)
            const run = { provider: "seedance-2-5", resolution: "720p", outputUrl: OUT, referenceVideoUrls: [REF], durationsSec, requestedDuration: shape.requestedDuration, referenceTaskType: undefined, jobId: "job-x" }
            const before = alert.mock.calls.length
            const declared = await seedance2RefVideoActualSeconds({ ...run, referenceTaskType: shape.referenceTaskType })
            const between = alert.mock.calls.length
            const undeclared = await seedance2RefVideoActualSeconds({ ...run, referenceTaskType: undefined })
            expect(declared, `${delivered} ${String(durationsSec)}`).toStrictEqual(undeclared)
            // The same alerts too: as many from the declared run as from the undeclared one.
            expect(between - before, `${delivered} ${String(durationsSec)}`).toBe(alert.mock.calls.length - between)
          }
        }
      } finally {
        alert.mockRestore()
      }
    })
  })
})
