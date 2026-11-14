import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The core shim every lane that completes a Seedance reference-video run
 * calls (the i2v/t2v worker handlers, the reconcile cron). `undefined` means
 * "commit the reservation" — today's behaviour, never an under-bill — so every
 * early exit and the failure path must resolve to it rather than throw.
 *
 * ONE measurement of the delivered clip serves both the charge (the credits)
 * and the run's recorded provider cost (the seconds behind them): the shim
 * measures once and prices from that measurement.
 */

const edition = vi.hoisted(() => ({ hasCredits: { value: true } }))
vi.mock("../config.js", () => ({
  config: {},
  hasCredits: () => edition.hasCredits.value,
  isCloud: () => edition.hasCredits.value,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

// The ee helper is dynamically imported (the credit-guard escape hatch); its
// maths is tested next to it (and the shim is run there against the real
// settlement) — here only the shim's gating, forwarding and fallback matter.
const REF_SECONDS = { deliveredSec: 12, chargedOutputSec: 12, inputSec: 30 }
const settle = vi.hoisted(() => ({
  refSeconds: vi.fn(async (_args: Record<string, unknown>) => ({ deliveredSec: 12, chargedOutputSec: 12, inputSec: 30 })),
  actual: vi.fn(async (_args: Record<string, unknown>, _measured?: unknown) => 7193),
  autoSeconds: vi.fn(async (_args: Record<string, unknown>) => 9),
  autoMeasured: {} as { measuredSec?: number },
  auto: vi.fn(async (_args: Record<string, unknown>, _measuredSec?: unknown) => 311),
}))
vi.mock("../../ee/billing/seedance2-ref-video-credits.js", () => ({
  seedance2RefVideoActualSeconds: settle.refSeconds,
  seedance2RefVideoActualBaseCredits: settle.actual,
  seedance2AutoDurationActualSeconds: settle.autoSeconds,
  // The one measurement of an Auto run: its billed seconds (and, when a case
  // sets one, its unrounded length).
  seedance2AutoDurationMeasure: async (a: Record<string, unknown>) => ({ outputSec: await settle.autoSeconds(a), ...settle.autoMeasured }),
  seedance2AutoDurationActualBaseCredits: settle.auto,
}))

import { measureSeedance2RefVideoBaseCredits, measureSeedance2Settle } from "../seedance2-ref-video-settle.js"

const args = {
  provider: "seedance-2-5",
  resolution: "1080p",
  outputUrl: "https://kie.example/out.mp4",
  referenceVideoUrls: ["https://r2.example.com/videos/ref.mp4"],
  referenceTaskType: undefined,
  characterReferences: undefined,
}
const NOT_MEASURED = { baseCredits: undefined, seconds: undefined }

beforeEach(() => {
  settle.refSeconds.mockClear()
  settle.refSeconds.mockResolvedValue(REF_SECONDS)
  settle.actual.mockClear()
  settle.actual.mockResolvedValue(7193)
  settle.autoSeconds.mockClear()
  settle.autoSeconds.mockResolvedValue(9)
  settle.auto.mockClear()
  settle.auto.mockResolvedValue(311)
  settle.autoMeasured = {}
  edition.hasCredits.value = true
})

describe("measureSeedance2RefVideoBaseCredits", () => {
  it("hands the measured base back for a Seedance run with a reference video", async () => {
    await expect(measureSeedance2RefVideoBaseCredits(args)).resolves.toBe(7193)
    expect(settle.refSeconds).toHaveBeenCalledWith(args)
    // Priced from that one measurement, never measured again.
    expect(settle.actual).toHaveBeenCalledWith(args, REF_SECONDS)
  })

  it("forwards the reservation's probe of the reference clips so the settlement does not probe them again", async () => {
    await measureSeedance2RefVideoBaseCredits({ ...args, refVideoDurationsSec: [30, null] })
    expect(settle.refSeconds).toHaveBeenCalledWith({ ...args, durationsSec: [30, null] })
    expect(settle.actual).toHaveBeenCalledWith({ ...args, durationsSec: [30, null] }, REF_SECONDS)
  })

  it("forwards the job's recorded reference task type: the hold was sized from it", async () => {
    await measureSeedance2RefVideoBaseCredits({ ...args, duration: -1, referenceTaskType: "reference" })
    const run = { ...args, requestedDuration: -1, referenceTaskType: "reference" }
    expect(settle.refSeconds.mock.calls[0]![0]).toStrictEqual({ provider: run.provider, resolution: run.resolution, outputUrl: run.outputUrl, referenceVideoUrls: run.referenceVideoUrls, requestedDuration: -1, referenceTaskType: "reference" })
    expect(settle.actual).toHaveBeenCalledWith(run, REF_SECONDS)
  })

  it("a job that carries no probe (in flight across the deploy) sends none — the helper re-probes", async () => {
    await measureSeedance2RefVideoBaseCredits({ ...args, refVideoDurationsSec: undefined })
    expect(settle.refSeconds).toHaveBeenCalledWith(args)
    expect(settle.refSeconds.mock.calls[0]![0]).not.toHaveProperty("durationsSec")
  })

  it("defaults an unset resolution to 720p — the same default both reservation lanes use", async () => {
    await measureSeedance2RefVideoBaseCredits({ ...args, resolution: undefined })
    expect(settle.refSeconds).toHaveBeenCalledWith({ ...args, resolution: "720p" })
    expect(settle.actual).toHaveBeenCalledWith({ ...args, resolution: "720p" }, REF_SECONDS)
  })

  it("is not a Seedance run → undefined, no ee module touched", async () => {
    await expect(measureSeedance2RefVideoBaseCredits({ ...args, provider: "veo3.1" })).resolves.toBeUndefined()
    await expect(measureSeedance2RefVideoBaseCredits({ ...args, provider: undefined })).resolves.toBeUndefined()
    expect(settle.refSeconds).not.toHaveBeenCalled()
    expect(settle.actual).not.toHaveBeenCalled()
  })

  it("no reference video wired → undefined (the -ref composite already prices it)", async () => {
    await expect(measureSeedance2RefVideoBaseCredits({ ...args, referenceVideoUrls: [] })).resolves.toBeUndefined()
    await expect(measureSeedance2RefVideoBaseCredits({ ...args, referenceVideoUrls: undefined })).resolves.toBeUndefined()
    expect(settle.refSeconds).not.toHaveBeenCalled()
    expect(settle.actual).not.toHaveBeenCalled()
  })

  it("no credits in this edition → undefined without loading the ee helper", async () => {
    edition.hasCredits.value = false
    await expect(measureSeedance2RefVideoBaseCredits(args)).resolves.toBeUndefined()
    expect(settle.refSeconds).not.toHaveBeenCalled()
    expect(settle.actual).not.toHaveBeenCalled()
  })

  it("a failed measurement resolves to undefined (the reservation is committed), never throws", async () => {
    settle.refSeconds.mockRejectedValueOnce(new Error("ffprobe: 403"))
    await expect(measureSeedance2RefVideoBaseCredits(args)).resolves.toBeUndefined()
    expect(settle.actual).not.toHaveBeenCalled()
  })

  it("a failed pricing of a good measurement resolves to undefined too, never throws", async () => {
    settle.actual.mockRejectedValueOnce(new Error("price not configured"))
    await expect(measureSeedance2RefVideoBaseCredits(args)).resolves.toBeUndefined()
  })

  // AUTO duration with nothing wired is the other worst-case reservation (the
  // model's longest clip) — it settles to the tier of the delivered length.
  describe("auto duration, no reference video", () => {
    const auto = { provider: "seedance-2-5", resolution: "480p", outputUrl: args.outputUrl, referenceVideoUrls: undefined, duration: -1, referenceTaskType: undefined, characterReferences: undefined }

    it("measures the delivered clip", async () => {
      await expect(measureSeedance2RefVideoBaseCredits(auto)).resolves.toBe(311)
      expect(settle.autoSeconds).toHaveBeenCalledWith({ outputUrl: args.outputUrl })
      expect(settle.auto).toHaveBeenCalledWith({ provider: "seedance-2-5", resolution: "480p", outputUrl: args.outputUrl }, 9)
      expect(settle.refSeconds).not.toHaveBeenCalled()
      expect(settle.actual).not.toHaveBeenCalled()
    })

    it("a fixed duration with nothing wired still commits its reservation", async () => {
      await expect(measureSeedance2RefVideoBaseCredits({ ...auto, duration: 8 })).resolves.toBeUndefined()
      await expect(measureSeedance2RefVideoBaseCredits({ ...auto, duration: undefined })).resolves.toBeUndefined()
      expect(settle.autoSeconds).not.toHaveBeenCalled()
      expect(settle.auto).not.toHaveBeenCalled()
    })

    it("with a reference video wired, Auto rides the reference lane (input seconds are billed too)", async () => {
      await measureSeedance2RefVideoBaseCredits({ ...args, duration: -1 })
      expect(settle.refSeconds).toHaveBeenCalledTimes(1)
      expect(settle.actual).toHaveBeenCalledTimes(1)
      expect(settle.autoSeconds).not.toHaveBeenCalled()
      expect(settle.auto).not.toHaveBeenCalled()
    })

    it("an unmeasurable delivery commits the reservation rather than throwing", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      settle.autoSeconds.mockRejectedValue(new Error("ffprobe failed"))
      await expect(measureSeedance2RefVideoBaseCredits(auto)).resolves.toBeUndefined()
      expect(settle.auto).not.toHaveBeenCalled()
    })

    it("another provider, or an edition without credits, is never measured", async () => {
      await expect(measureSeedance2RefVideoBaseCredits({ ...auto, provider: "kling-3.0" })).resolves.toBeUndefined()
      edition.hasCredits.value = false
      await expect(measureSeedance2RefVideoBaseCredits(auto)).resolves.toBeUndefined()
      expect(settle.autoSeconds).not.toHaveBeenCalled()
      expect(settle.auto).not.toHaveBeenCalled()
    })
  })
})

/**
 * The same measurement, with the seconds the charge was priced from: the
 * delivered clip's length (`outputSec`, what was rendered, never capped at a
 * hold) and the reference clips billed on the input side (`inputSec`, 0
 * without a reference video). The credits are exactly the old function's.
 */
describe("per-second Gemini Omni", () => {
  const run = { provider: "gemini-omni-flash-1-2", resolution: "720p", outputUrl: "out", referenceVideoUrls: ["clip"], duration: 8, referenceTaskType: undefined, characterReferences: undefined }

  it("commits the hold when the source clip was measured", async () => {
    expect(await measureSeedance2RefVideoBaseCredits({ ...run, refVideoDurationsSec: [10] })).toBeUndefined()
    expect(settle.refSeconds).not.toHaveBeenCalled()
  })

  it("settles on the delivered clip when the source could not be read", async () => {
    expect(await measureSeedance2RefVideoBaseCredits({ ...run, refVideoDurationsSec: [null] })).toBe(7193)
    expect(settle.refSeconds).toHaveBeenCalled()
  })
})

describe("measureSeedance2Settle", () => {
  it.each([
    ["a reference run", args],
    ["the reservation's probe forwarded", { ...args, refVideoDurationsSec: [30, null] }],
    ["no probe carried", { ...args, refVideoDurationsSec: undefined }],
    ["an unset resolution", { ...args, resolution: undefined }],
    ["Auto with a reference video", { ...args, duration: -1 }],
  ])("%s: the old function's credits, plus the seconds behind them", async (_name, run) => {
    const old = await measureSeedance2RefVideoBaseCredits(run)
    settle.refSeconds.mockClear()
    await expect(measureSeedance2Settle(run)).resolves.toEqual({ baseCredits: old, seconds: { outputSec: 12, inputSec: 30 } })
    expect(old).toBe(7193)
    // One measurement: the clip is read once, and the credits are priced from it.
    expect(settle.refSeconds).toHaveBeenCalledTimes(1)
    expect(settle.actual.mock.calls.at(-1)![1]).toEqual(REF_SECONDS)
  })

  it("the seconds are what was rendered, not the charge's held seconds", async () => {
    settle.refSeconds.mockResolvedValue({ deliveredSec: 9.5, chargedOutputSec: 6, inputSec: 4.1 })
    settle.actual.mockResolvedValue(960)
    await expect(measureSeedance2Settle({ ...args, duration: -1 })).resolves.toEqual({ baseCredits: 960, seconds: { outputSec: 9.5, inputSec: 4.1 } })
    expect(settle.actual).toHaveBeenCalledWith({ ...args, requestedDuration: -1 }, { deliveredSec: 9.5, chargedOutputSec: 6, inputSec: 4.1 })
  })

  it("auto duration with nothing wired: the length chosen is the output, nothing is input", async () => {
    const auto = { provider: "seedance-2-5", resolution: "480p", outputUrl: args.outputUrl, referenceVideoUrls: undefined, duration: -1, referenceTaskType: undefined, characterReferences: undefined }
    await expect(measureSeedance2Settle(auto)).resolves.toEqual({ baseCredits: 311, seconds: { outputSec: 9, inputSec: 0 } })
    expect(settle.autoSeconds).toHaveBeenCalledTimes(1)
    expect(settle.auto).toHaveBeenCalledWith({ provider: "seedance-2-5", resolution: "480p", outputUrl: args.outputUrl }, 9)
  })

  it("nothing to measure: neither credits nor seconds", async () => {
    await expect(measureSeedance2Settle({ ...args, provider: "veo3.1" })).resolves.toEqual(NOT_MEASURED)
    await expect(measureSeedance2Settle({ ...args, referenceVideoUrls: [] })).resolves.toEqual(NOT_MEASURED)
    await expect(measureSeedance2Settle({ ...args, referenceVideoUrls: undefined, duration: 8 })).resolves.toEqual(NOT_MEASURED)
    edition.hasCredits.value = false
    await expect(measureSeedance2Settle(args)).resolves.toEqual(NOT_MEASURED)
    expect(settle.refSeconds).not.toHaveBeenCalled()
    expect(settle.autoSeconds).not.toHaveBeenCalled()
  })

  it("a measurement that cannot be priced: no credits (the reservation is committed), but the seconds stay — the run's cost is known", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    settle.actual.mockRejectedValueOnce(new Error("price not configured"))
    await expect(measureSeedance2Settle(args)).resolves.toStrictEqual({ baseCredits: undefined, seconds: { outputSec: 12, inputSec: 30 } })
    settle.auto.mockRejectedValueOnce(new Error("price not configured"))
    await expect(measureSeedance2Settle({ ...args, referenceVideoUrls: undefined, duration: -1 }))
      .resolves.toStrictEqual({ baseCredits: undefined, seconds: { outputSec: 9, inputSec: 0 } })
  })

  it("a failed measurement: neither credits nor seconds, never a throw", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    settle.refSeconds.mockRejectedValueOnce(new Error("ffprobe: 403"))
    await expect(measureSeedance2Settle(args)).resolves.toEqual(NOT_MEASURED)
    settle.autoSeconds.mockRejectedValueOnce(new Error("ffprobe failed"))
    await expect(measureSeedance2Settle({ ...args, referenceVideoUrls: undefined, duration: -1 })).resolves.toEqual(NOT_MEASURED)
  })

  it("the delivered clip's unrounded length rides along, for the run to record (one measurement, never a second probe)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    // A reference run: the measurement's own unrounded length.
    settle.refSeconds.mockResolvedValue({ ...REF_SECONDS, measuredSec: 12.04 } as typeof REF_SECONDS)
    await expect(measureSeedance2Settle(args)).resolves.toStrictEqual({ baseCredits: 7193, seconds: { outputSec: 12, inputSec: 30 }, deliveredSec: 12.04 })
    // An Auto run with nothing wired: billed by the whole second, recorded as measured.
    settle.autoMeasured = { measuredSec: 8.62 }
    const auto = { ...args, referenceVideoUrls: undefined, duration: -1 }
    await expect(measureSeedance2Settle(auto)).resolves.toStrictEqual({ baseCredits: 311, seconds: { outputSec: 9, inputSec: 0 }, deliveredSec: 8.62 })
    // Kept when only the pricing failed, like the seconds.
    settle.auto.mockRejectedValueOnce(new Error("price not configured"))
    await expect(measureSeedance2Settle(auto)).resolves.toStrictEqual({ baseCredits: undefined, seconds: { outputSec: 9, inputSec: 0 }, deliveredSec: 8.62 })
  })
})
