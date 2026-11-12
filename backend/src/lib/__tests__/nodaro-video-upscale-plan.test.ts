import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The plan of a Nodaro Video Upscale run (decided 2026-11-11): the clip goes
 * through the outside-input copy first — an outside clip is copied to our
 * storage and measured from the LOCAL copy (its probe killed when the copy's
 * time is up), a stored one used as it is and sized from storage — and that
 * copy is what is measured, billed and sent. A quote checks the same and
 * stores nothing.
 */

const probe = vi.hoisted(() => ({
  source: { width: 1920, height: 1080, durationSeconds: 10, videoDurationSeconds: 10 } as Record<string, unknown>,
  fail: undefined as Error | undefined,
  calls: [] as Array<{ src: string; signal?: AbortSignal }>,
}))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  probeVideoSource: vi.fn(async (src: string, opts: { signal?: AbortSignal } = {}) => {
    probe.calls.push({ src, signal: opts.signal })
    if (probe.fail) throw probe.fail
    return probe.source
  }),
}))

const STORED = "https://cdn.example.com/tmp/provider-input/outside-input-x.mp4"
const OWN = "https://cdn.example.com/uploads/videos/a.mp4"
/** The copy helper: an outside clip is "copied" (its inspect run on a local path), a stored one answered as it is. */
const copy = vi.hoisted(() => ({
  bytes: 20_000_000,
  error: undefined as unknown,
  calls: [] as Array<{ fn: "copy" | "inspect"; url: string; opts: Record<string, unknown> }>,
}))
vi.mock("@/lib/outside-input-copy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/outside-input-copy.js")>()
  const run = async (fn: "copy" | "inspect", url: string, opts: Record<string, unknown> & { inspect?: (p: string, s: AbortSignal) => unknown }) => {
    copy.calls.push({ fn, url, opts })
    if (copy.error) throw copy.error
    if (url === OWN) return fn === "copy" ? { url, bytes: copy.bytes, copied: false } : { bytes: copy.bytes, outside: false }
    let inspected: unknown
    try {
      inspected = await opts.inspect?.("/tmp/outside-input-abc/input", new AbortController().signal)
    } catch (err) {
      throw new actual.OutsideInputInspectRefusedError(err)
    }
    return fn === "copy" ? { url: STORED, bytes: copy.bytes, copied: true, inspected } : { bytes: copy.bytes, outside: true, inspected }
  }
  return {
    ...actual,
    copyOutsideInput: vi.fn((url: string, opts: Record<string, unknown>) => run("copy", url, opts)),
    inspectOutsideInput: vi.fn((url: string, opts: Record<string, unknown>) => run("inspect", url, opts)),
  }
})
// The tiers' four-second rows (the migration's), rounded up once as the real helper does.
const ROWS: Record<string, number> = {
  "nodaro-video-upscale:1080p:per-4s": 15,
  "nodaro-video-upscale:2k:per-4s": 30,
  "nodaro-video-upscale:4k:per-4s": 60,
}
vi.mock("@/lib/credit-base-cost.js", () => ({
  unitRateBaseCredits: vi.fn(async (id: string, units: number) => Math.ceil(ROWS[id]! * units)),
}))
const seam = vi.hoisted(() => ({ served: true }))
vi.mock("@/lib/house-models-served.js", () => ({ houseModelServed: vi.fn(() => seam.served) }))

import {
  nodaroVideoUpscaleBaseCredits,
  nodaroVideoUpscaleRefusalOf,
  nodaroVideoUpscaleReserveId,
  nodaroVideoUpscaleStampedBaseCredits,
  NodaroVideoUpscaleSourceUnreadableError,
  NodaroVideoUpscaleTooLargeError,
  NodaroVideoUpscaleTooLongError,
  NodaroVideoUpscaleTryAgainError,
  NODARO_VIDEO_UPSCALE_NOT_SERVED_MESSAGE,
  planNodaroVideoUpscale,
  stampNodaroVideoUpscale,
} from "../nodaro-video-upscale-plan.js"
import {
  OutsideInputBusyError,
  OutsideInputFailedError,
  OutsideInputTimedOutError,
  OutsideInputTooLargeError,
  OutsideInputUnreadableError,
  OutsideInputWrongKindError,
} from "../outside-input-copy.js"
import { LinkImportsDisabledError } from "../link-imports.js"
import { UploadBlockedError } from "../upload-policy.js"
import { JobCancelledError } from "../job-cancellation.js"

const URL = "https://media.example.test/clip.mp4"
const USER = { userId: "user-a" }

beforeEach(() => {
  probe.source = { width: 1920, height: 1080, durationSeconds: 10, videoDurationSeconds: 10 }
  probe.fail = undefined
  probe.calls = []
  copy.bytes = 20_000_000
  copy.error = undefined
  copy.calls = []
  seam.served = true
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
})

describe("planNodaroVideoUpscale", () => {
  it("copies an outside clip, measures the LOCAL copy (its probe given the copy's signal), and plans on the stored clip", async () => {
    probe.source = { width: 1280, height: 720, durationSeconds: 10.31, videoDurationSeconds: 10.2 }
    const plan = await planNodaroVideoUpscale(URL, "2k", USER)
    expect(plan).toEqual({
      tier: "2k",
      creditId: "nodaro-video-upscale:2k:per-4s",
      videoUrl: STORED,
      sourceDurationSec: 10.2,
      billedSec: 11,
      sourceSizeBytes: 20_000_000,
    })
    expect(copy.calls).toHaveLength(1)
    expect(copy.calls[0]).toMatchObject({ fn: "copy", url: URL, opts: { kind: "video", maxBytes: 50_000_000, userId: "user-a" } })
    expect(probe.calls).toHaveLength(1)
    expect(probe.calls[0]!.src).toBe("/tmp/outside-input-abc/input")
    expect(probe.calls[0]!.signal).toBeInstanceOf(AbortSignal)
  })

  it("a caller's signal reaches the copy and the stored clip's probe; once it fires, its stop is thrown as it is, never read as a refusal of the clip", async () => {
    const gone = new AbortController()
    await planNodaroVideoUpscale(URL, "1080p", { userId: "user-a", signal: gone.signal })
    expect(copy.calls[0]!.opts.signal).toBe(gone.signal)
    await planNodaroVideoUpscale(OWN, "1080p", { userId: "user-a", signal: gone.signal })
    expect(probe.calls.at(-1)).toEqual({ src: OWN, signal: gone.signal })

    // The copy stopped by the caller (its reason thrown as is): not "unreadable", not "try again".
    gone.abort()
    const stop = new DOMException("This operation was aborted", "AbortError")
    copy.error = stop
    await expect(planNodaroVideoUpscale(URL, "1080p", { userId: "user-a", signal: gone.signal })).rejects.toBe(stop)
    copy.error = undefined
    probe.fail = Object.assign(new Error("ffprobe failed: killed"), { killed: true })
    await expect(planNodaroVideoUpscale(OWN, "1080p", { userId: "user-a", signal: gone.signal })).rejects.toBe(probe.fail)
  })

  it("copies into the job's scratch folder when it has a job", async () => {
    await planNodaroVideoUpscale(URL, "1080p", { userId: "user-a", jobId: "job-1" })
    expect(copy.calls[0]!.opts.jobId).toBe("job-1")
  })

  it("a quote checks the same and stores nothing (the no-store twin)", async () => {
    const plan = await planNodaroVideoUpscale(URL, "1080p", { userId: "user-a", quote: true })
    expect(copy.calls.map((c) => c.fn)).toEqual(["inspect"])
    expect(plan.videoUrl).toBe(URL)
    expect(plan.sourceSizeBytes).toBe(20_000_000)
  })

  it("a stored clip is used as it is, sized from storage, measured where it is stored", async () => {
    copy.bytes = 12_345
    const plan = await planNodaroVideoUpscale(OWN, "1080p", USER)
    expect(plan.videoUrl).toBe(OWN)
    expect(plan.sourceSizeBytes).toBe(12_345)
    expect(probe.calls.map((c) => c.src)).toEqual([OWN])
  })

  it("bills the container's length when the picture reports none, and a sliver one second", async () => {
    probe.source = { width: 1280, height: 720, durationSeconds: 7.5 }
    expect((await planNodaroVideoUpscale(URL, "1080p", USER)).billedSec).toBe(8)
    probe.source = { width: 1280, height: 720, durationSeconds: 0.2, videoDurationSeconds: 0.2 }
    expect((await planNodaroVideoUpscale(URL, "1080p", USER)).billedSec).toBe(1)
  })

  it("coerces the tier from the catalog: a spelling variant, another provider's value, and unset", async () => {
    expect((await planNodaroVideoUpscale(URL, "2K", USER)).tier).toBe("2k")
    expect((await planNodaroVideoUpscale(URL, "720p", USER)).tier).toBe("1080p")
    expect((await planNodaroVideoUpscale(URL, undefined, USER)).tier).toBe("1080p")
    expect((await planNodaroVideoUpscale(URL, "4k", USER)).creditId).toBe("nodaro-video-upscale:4k:per-4s")
  })

  it("takes exactly 60 seconds and refuses a longer clip from the copy's check (nothing stored), judged on the longer of the container and the picture", async () => {
    probe.source = { width: 1920, height: 1080, durationSeconds: 60, videoDurationSeconds: 59.98 }
    expect((await planNodaroVideoUpscale(URL, "4k", USER)).billedSec).toBe(60)
    probe.source = { width: 1920, height: 1080, durationSeconds: 60.05, videoDurationSeconds: 59.98 }
    const err = await planNodaroVideoUpscale(URL, "4k", USER).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NodaroVideoUpscaleTooLongError)
    expect((err as Error).message).toMatch(/^This clip is 60.05 seconds long\./)
    expect((err as Error).message).toMatch(/Topaz/)
    // A stored clip past the limit too.
    const stored = await planNodaroVideoUpscale(OWN, "4k", USER).catch((e: unknown) => e)
    expect(stored).toBeInstanceOf(NodaroVideoUpscaleTooLongError)
  })

  it("a clip over 50 MB (the copy's cap) is refused in this model's words", async () => {
    copy.error = new OutsideInputTooLargeError(50_000_000)
    const err = await planNodaroVideoUpscale(URL, "1080p", USER).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NodaroVideoUpscaleTooLargeError)
    expect((err as Error).message).toMatch(/larger than 50 MB/)
    expect((err as Error).message).toMatch(/Topaz/)
    expect((err as NodaroVideoUpscaleTooLargeError).code).toBe("video_too_large")
  })

  it("an unreadable clip, one that is not a video, and one whose probe fails are refused as unreadable, pointing to Topaz", async () => {
    for (const error of [new OutsideInputUnreadableError(), new OutsideInputWrongKindError("video")]) {
      copy.error = error
      const err = await planNodaroVideoUpscale(URL, "1080p", USER).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(NodaroVideoUpscaleSourceUnreadableError)
      expect((err as Error).message).toMatch(/choose Topaz/)
    }
    copy.error = undefined
    probe.fail = new Error("ffprobe failed: Invalid data")
    expect(await planNodaroVideoUpscale(URL, "1080p", USER).catch((e: unknown) => e)).toBeInstanceOf(NodaroVideoUpscaleSourceUnreadableError)
  })

  it("busy, slow or failed on our side reads as try again in a moment (the copy's code kept), a killed probe too", async () => {
    for (const [error, code] of [
      [new OutsideInputBusyError(), "input_busy"],
      [new OutsideInputTimedOutError(), "input_timed_out"],
      [new OutsideInputFailedError(), "input_failed"],
    ] as const) {
      copy.error = error
      const err = await planNodaroVideoUpscale(URL, "1080p", USER).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(NodaroVideoUpscaleTryAgainError)
      expect((err as NodaroVideoUpscaleTryAgainError).code).toBe(code)
      expect((err as Error).message).toMatch(/Try again in a moment/)
    }
    copy.error = undefined
    probe.fail = Object.assign(new Error("ffprobe failed"), { killed: true })
    expect(((await planNodaroVideoUpscale(URL, "1080p", USER).catch((e: unknown) => e)) as NodaroVideoUpscaleTryAgainError).code).toBe("input_failed")
  })

  it("the link switch, the upload policy and a cancellation pass through as they are", async () => {
    for (const error of [new LinkImportsDisabledError(), new UploadBlockedError({ allow: false, reason: "No." }), new JobCancelledError("job-1")]) {
      copy.error = error
      expect(await planNodaroVideoUpscale(URL, "1080p", USER).catch((e: unknown) => e)).toBe(error)
    }
    expect(nodaroVideoUpscaleRefusalOf(new LinkImportsDisabledError())?.code).toBe("link_imports_disabled")
    expect(nodaroVideoUpscaleRefusalOf(new UploadBlockedError({ allow: false, reason: "No." }))).toEqual({ code: "upload_blocked", message: "No." })
    expect(nodaroVideoUpscaleRefusalOf(new JobCancelledError("job-1"))).toBeUndefined()
  })
})

describe("what a plan holds and is charged (base credits, before the markup)", () => {
  // The tier's four-second row × billed seconds ÷ 4, rounded up ONCE.
  it.each([
    ["1080p", 10, 38], ["2k", 10, 75], ["4k", 10, 150],
    ["1080p", 60, 225], ["2k", 60, 450], ["4k", 60, 900],
    // Never rounded per second first: 5 s at 1080p is 18.75 → 19, not 5 × 4.
    ["1080p", 5, 19],
  ] as const)("%s, %i s → %i", async (tier, billedSec, base) => {
    expect(await nodaroVideoUpscaleBaseCredits({ creditId: `nodaro-video-upscale:${tier}:per-4s`, billedSec })).toBe(base)
  })
})

describe("stampNodaroVideoUpscale (the workflow run's twin of the route)", () => {
  const payload = (extra: Record<string, unknown> = {}) => ({ provider: "nodaro-video-upscale", videoUrl: URL, tier: "2k", ...extra })
  const ctx = { userId: "user-a", jobId: "job-1" }

  it("leaves every other job alone", async () => {
    expect(await stampNodaroVideoUpscale("video-upscale", { provider: "topaz", videoUrl: URL }, ctx)).toEqual({ ok: true, patch: {} })
    expect(await stampNodaroVideoUpscale("image-to-video", payload(), ctx)).toEqual({ ok: true, patch: {} })
    expect(copy.calls).toEqual([])
  })

  it("copies the clip into the job's scratch folder and stamps the plan — the STORED clip's URL in place of the caller's", async () => {
    const stamp = await stampNodaroVideoUpscale("video-upscale", payload(), ctx)
    expect(stamp).toEqual({
      ok: true,
      patch: { targetResolution: "2k", videoUrl: STORED, tier: "2k", sourceDurationSec: 10, billedSec: 10, sourceSizeBytes: 20_000_000 },
    })
    expect(copy.calls[0]).toMatchObject({ fn: "copy", url: URL, opts: { userId: "user-a", jobId: "job-1" } })
  })

  it("hands the run's stop signal to the copy, and a stop is thrown as it is, never read as a refusal", async () => {
    const stop = new AbortController()
    await stampNodaroVideoUpscale("video-upscale", payload(), { ...ctx, signal: stop.signal })
    expect(copy.calls[0]!.opts.signal).toBe(stop.signal)
    stop.abort()
    const reason = new Error("Execution cancelled")
    copy.error = reason
    await expect(stampNodaroVideoUpscale("video-upscale", payload(), { ...ctx, signal: stop.signal })).rejects.toBe(reason)
  })

  it("a backstop (a workflow's build refuses an unserved model before the stamp runs): refuses where the deployment does not serve it, naming nothing behind it, without fetching the clip", async () => {
    seam.served = false
    expect(await stampNodaroVideoUpscale("video-upscale", payload(), ctx)).toEqual({
      ok: false,
      refusal: { code: "model_not_available", message: NODARO_VIDEO_UPSCALE_NOT_SERVED_MESSAGE },
    })
    expect(copy.calls).toEqual([])
    expect(NODARO_VIDEO_UPSCALE_NOT_SERVED_MESSAGE).toBe(
      "Nodaro Video Upscale is not available on this server. Choose Topaz to upscale this clip. You were not charged.",
    )
  })

  it("refuses a clip past a limit, one the deployment refuses, and a busy fetch — each before anything is held", async () => {
    probe.source = { width: 1920, height: 1080, durationSeconds: 75, videoDurationSeconds: 75 }
    expect(await stampNodaroVideoUpscale("video-upscale", payload(), ctx)).toMatchObject({ ok: false, refusal: { code: "video_too_long" } })
    probe.source = { width: 1920, height: 1080, durationSeconds: 10, videoDurationSeconds: 10 }
    copy.error = new LinkImportsDisabledError()
    expect(await stampNodaroVideoUpscale("video-upscale", payload(), ctx)).toMatchObject({ ok: false, refusal: { code: "link_imports_disabled" } })
    copy.error = new OutsideInputBusyError()
    expect(await stampNodaroVideoUpscale("video-upscale", payload(), ctx)).toMatchObject({ ok: false, refusal: { code: "input_busy" } })
  })

  it("rethrows a cancellation", async () => {
    const cancelled = new JobCancelledError("job-1")
    copy.error = cancelled
    await expect(stampNodaroVideoUpscale("video-upscale", payload(), ctx)).rejects.toBe(cancelled)
  })

  it("reserves under the stamped tier's row, at its exact price", async () => {
    const stamped = payload({ tier: "4k", billedSec: 10 })
    expect(nodaroVideoUpscaleReserveId("video-upscale", stamped)).toBe("nodaro-video-upscale:4k:per-4s")
    expect(await nodaroVideoUpscaleStampedBaseCredits("video-upscale", stamped)).toBe(150)
    expect(nodaroVideoUpscaleReserveId("video-upscale", { provider: "topaz" })).toBeUndefined()
    expect(await nodaroVideoUpscaleStampedBaseCredits("video-upscale", payload({ billedSec: 10.5 }))).toBeUndefined()
  })
})
