import { describe, it, expect, vi, beforeEach } from "vitest"

// ffprobe is stubbed per URL: the reservation tests never touch it, the
// settlement tests decide what the delivered clip and the reference clips
// measure (a rejected promise = an unusable probe).
const probe = vi.hoisted(() => ({
  durations: new Map<string, number | Error>(),
  probeMediaDuration: vi.fn(async (url: string) => {
    const d = probe.durations.get(url)
    if (d === undefined) throw new Error(`unexpected probe of ${url}`)
    if (d instanceof Error) throw d
    return d
  }),
}))
vi.mock("../../../providers/video/ffmpeg-utils.js", () => ({ probeMediaDuration: probe.probeMediaDuration }))

import {
  refVideoWorstCaseSecFor,
  seedance2RefVideoActualBaseCredits,
  seedance2RefVideoBaseCredits,
  seedance2RefVideoExpectedBaseCredits,
  seedance2RefVideoBaseCreditsFromDurations,
} from "../seedance2-ref-video-credits.js"

// seedance-2-5:8s:1080p-ref = 1370 → 171.25/s; seedance-2-5:8s:720p-ref = 760 → 95/s;
// seedance-2:8s:720p-ref = 500 → 62.5/s.
const S25_1080P_PER_SEC = 1370 / 8
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
  it("seedance-2-5 1080p (2026-08-17 tier) per-sec base = 1370/8: 8s out + 5s in = ceil(171.25 × 13) = 2227", () => {
    expect(seedance2RefVideoBaseCredits({ provider: "seedance-2-5", resolution: "1080p", outputDurationSec: 8, inputVideoDurationSec: 5 })).toBe(2227)
  })
  it("seedance-2-5 1080p no input video → equals the plain -ref composite (8s = 1370)", () => {
    expect(seedance2RefVideoBaseCredits({ provider: "seedance-2-5", resolution: "1080p", outputDurationSec: 8, inputVideoDurationSec: 0 })).toBe(1370)
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
  it("a clip shorter than the requested duration changes nothing: 2.5 1080p, 8s out + 5s in = 2227", () => {
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: "seedance-2-5", resolution: "1080p", outputDurationSec: 8, durationsSec: [5] })).toBe(2227)
  })

  it("a clip LONGER than the requested duration bills the output at the clip's length (an edit renders it): 12s requested + 30s clip = ceil(171.25 × (30 + 30)) = 10275", () => {
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: "seedance-2-5", resolution: "1080p", outputDurationSec: 12, durationsSec: [30] })).toBe(10275)
    expect(Math.ceil(S25_1080P_PER_SEC * 60)).toBe(10275)
  })

  it("several clips: every clip is input, the LONGEST is the output worst case: 720p, 8s + [5, 20] = ceil(95 × (25 + 20)) = 4275", () => {
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: "seedance-2-5", resolution: "720p", outputDurationSec: 8, durationsSec: [5, 20] })).toBe(4275)
    expect(Math.ceil(S25_720P_PER_SEC * 45)).toBe(4275)
  })

  it("an unusable probe counts as the provider's per-clip cap, in AND out: seedance-2-5 (30s cap), 8s + [NaN] = ceil(95 × 60) = 5700", () => {
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: "seedance-2-5", resolution: "720p", outputDurationSec: 8, durationsSec: [NaN] })).toBe(5700)
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: "seedance-2-5", resolution: "720p", outputDurationSec: 8, durationsSec: [0] })).toBe(5700)
  })

  it("a provider with no declared bound keeps the 2.0 family's 15s worst case: seedance-2, 8s + [NaN] = ceil(62.5 × (15 + 15)) = 1875", () => {
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: "seedance-2", resolution: "720p", outputDurationSec: 8, durationsSec: [NaN] })).toBe(1875)
    expect(Math.ceil(S2_720P_PER_SEC * 30)).toBe(1875)
  })

  it("no clips at all → the requested duration alone (8s 720p seedance-2 = 500)", () => {
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: "seedance-2", resolution: "720p", outputDurationSec: 8, durationsSec: [] })).toBe(500)
  })

  it("the summed input is capped at the provider's declared total — past it the provider rejects the run: 2.5, 8s + [NaN, NaN] = ceil(95 × (30 + 30)) = 5700, not ceil(95 × 90)", () => {
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: "seedance-2-5", resolution: "720p", outputDurationSec: 8, durationsSec: [NaN, NaN] })).toBe(5700)
  })

  it("a null (a NaN that went through JSON) is an unusable probe too", () => {
    expect(seedance2RefVideoBaseCreditsFromDurations({ provider: "seedance-2-5", resolution: "720p", outputDurationSec: 8, durationsSec: [null as unknown as number] })).toBe(5700)
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

  it("a style run delivered at the requested 12s with a 30s clip wired settles to ceil(171.25 × (30 + 12)) = 7193 — below the 10275 reserved", async () => {
    probe.durations.set(OUT, 12)
    probe.durations.set(REF, 30)
    await expect(
      seedance2RefVideoActualBaseCredits({ provider: "seedance-2-5", resolution: "1080p", outputUrl: OUT, referenceVideoUrls: [REF] }),
    ).resolves.toBe(7193)
    expect(Math.ceil(S25_1080P_PER_SEC * 42)).toBe(7193)
  })

  it("an edit that rendered the full 30s clip settles at the reservation (10275)", async () => {
    probe.durations.set(OUT, 30)
    probe.durations.set(REF, 30)
    await expect(
      seedance2RefVideoActualBaseCredits({ provider: "seedance-2-5", resolution: "1080p", outputUrl: OUT, referenceVideoUrls: [REF] }),
    ).resolves.toBe(10275)
  })

  it("a reference clip that cannot be re-probed counts as the per-clip cap (never lowers the charge): 720p, 12s delivered + [failed] = ceil(95 × (30 + 12)) = 3990", async () => {
    probe.durations.set(OUT, 12)
    probe.durations.set(REF, new Error("ffprobe: connection reset"))
    await expect(
      seedance2RefVideoActualBaseCredits({ provider: "seedance-2-5", resolution: "720p", outputUrl: OUT, referenceVideoUrls: [REF] }),
    ).resolves.toBe(3990)
  })

  it("a delivered clip that cannot be measured THROWS — the caller then commits the reservation", async () => {
    probe.durations.set(OUT, new Error("ffprobe: 403"))
    probe.durations.set(REF, 30)
    await expect(
      seedance2RefVideoActualBaseCredits({ provider: "seedance-2-5", resolution: "720p", outputUrl: OUT, referenceVideoUrls: [REF] }),
    ).rejects.toThrow("ffprobe: 403")
  })

  it("with no stored probe: probes the delivered clip and every reference clip, nothing else", async () => {
    probe.durations.set(OUT, 8)
    probe.durations.set(REF, 5)
    await seedance2RefVideoActualBaseCredits({ provider: "seedance-2-5", resolution: "720p", outputUrl: OUT, referenceVideoUrls: [REF, 42, ""] })
    expect(probe.probeMediaDuration.mock.calls.map((c) => c[0]).sort()).toEqual([OUT, REF].sort())
  })

  it("with the reservation's probe on hand: prices the input from IT and probes only the delivered clip — a reference URL gone stale cannot erase the refund", async () => {
    probe.durations.set(OUT, 12)
    probe.durations.set(REF, new Error("ffprobe: 403"))
    await expect(
      seedance2RefVideoActualBaseCredits({ provider: "seedance-2-5", resolution: "720p", outputUrl: OUT, referenceVideoUrls: [REF], durationsSec: [5] }),
    ).resolves.toBe(Math.ceil(S25_720P_PER_SEC * (5 + 12)))
    expect(probe.probeMediaDuration.mock.calls.map((c) => c[0])).toEqual([OUT])
  })

  it("a stored probe that was unusable at reservation stays the worst case at settlement (the reserve counted it that way): [null] on 2.5 = 30s in", async () => {
    probe.durations.set(OUT, 12)
    await expect(
      seedance2RefVideoActualBaseCredits({ provider: "seedance-2-5", resolution: "720p", outputUrl: OUT, referenceVideoUrls: [REF], durationsSec: [null] }),
    ).resolves.toBe(3990)
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
    const reserved = seedance2RefVideoBaseCreditsFromDurations({ ...base, outputDurationSec: 15, durationsSec })
    expect(expected).toBeLessThanOrEqual(reserved)
  })

  it("has no answer when a clip could not be measured", () => {
    expect(seedance2RefVideoExpectedBaseCredits({ ...base, outputDurationSec: 5, autoDuration: false, durationsSec: [Number.NaN] }))
      .toBeUndefined()
  })
})
