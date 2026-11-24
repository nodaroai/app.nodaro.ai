/**
 * fal's Topaz Rhea request: exactly the clip, Rhea, the planned factor and
 * H.264 output — no frame rate, no enhancement knobs, no safety parameter with
 * nothing set — and never loosened (it always takes a video). The provider cost
 * is the listed per-second rate of the target over the billed seconds.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const seen = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>>, overrides: {} as Record<string, Record<string, boolean | number>>, guard: true, fail: undefined as undefined | { submit: boolean; err: Error } }))
vi.mock("../client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client.js")>()
  return {
    FalRequestError: actual.FalRequestError,
    FalSubmitAmbiguousError: actual.FalSubmitAmbiguousError,
    runFalRequest: vi.fn(async (opts: Record<string, unknown> & { onSubmitted?: (id: string) => Promise<void> }) => {
      seen.calls.push(opts)
      if (seen.fail) {
        if (seen.fail.submit && !opts.resumeRequestId) await opts.onSubmitted?.("req-1")
        throw seen.fail.err
      }
      return { output: { video: { url: "https://fal.media/out.mp4" } }, requestId: "req-1" }
    }),
    extractFalUrl: (o: { video: { url: string } }) => o.video.url,
  }
})
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => ({ provider_safety_overrides: seen.overrides }) }))
vi.mock("@/lib/provider-safety-guard-probe.js", () => ({ contentGuardRegistered: async () => seen.guard }))
vi.mock("@/lib/result-check.js", () => ({ hasResultCheck: () => true }))

import { falTopazRheaUpscale, topazRheaCostUsd, topazRheaSafetyEntries } from "../topaz-rhea.js"
import { useProviderSafetySettings } from "../../../lib/provider-safety.js"
import { providerSafetyEntriesForModel } from "../../safety-entries.js"
import { TOPAZ_RHEA_MAX_WAIT_MS } from "../../../lib/topaz-rhea-timeouts.js"

const onTaskCreated = vi.fn()
const run = () => falTopazRheaUpscale({
  videoUrl: "https://in.test/take.mp4",
  upscaleFactor: 1.5,
  target: "720p",
  billedSec: 4,
  reconcileOpts: { onTaskCreated },
})

beforeEach(() => {
  seen.fail = undefined
  useProviderSafetySettings()
  seen.calls.length = 0
  seen.overrides = {}
  seen.guard = true
})

describe("falTopazRheaUpscale", () => {
  it("sends exactly the clip, Rhea, the factor and H.264, on the Topaz endpoint, and persists the request for the reconcile", async () => {
    const result = await run()
    expect(seen.calls).toHaveLength(1)
    const call = seen.calls[0]!
    expect(call.endpoint).toBe("topaz/upscale/video/precision")
    expect(call.input).toEqual({
      video_url: "https://in.test/take.mp4",
      model: "Rhea",
      upscale_factor: 1.5,
      H264_output: true,
    })
    expect(call.reconcileOpts).toEqual({ onTaskCreated })
    expect(call.keyCoverage).toEqual({ coveredByConnection: false })
    expect(call.maxPolls).toBe(1200)
    // Bounded by wall clock too: the figure the reconcile's `fal-rhea` threshold is derived from.
    expect(call.maxWaitMs).toBe(TOPAZ_RHEA_MAX_WAIT_MS)
    // One submit is one billed run: never re-sent by the SDK after an unreadable outcome.
    expect(call.submitOnce).toBe(true)
    expect(call.statusErrorRetries).toBe(5)
    expect(result.url).toBe("https://fal.media/out.mp4")
    expect(result.cost).toBe(topazRheaCostUsd("720p", 4))
  })

  it("ignores a looser setting: this model is never loosened", async () => {
    seen.overrides = { "topaz-rhea": { enable_safety_checker: false } }
    await run()
    expect(seen.calls[0]!.input).not.toHaveProperty("enable_safety_checker")
  })

  it("its content-filter lever is declared on the admin page's fal group", () => {
    expect(topazRheaSafetyEntries()).toEqual([
      { modelId: "topaz-rhea", wireModel: "topaz/upscale/video/precision", levers: [expect.objectContaining({ param: "enable_safety_checker", shipped: null, providerDefault: true, neverLoosen: true })] },
    ])
    expect(providerSafetyEntriesForModel("topaz-rhea")).toHaveLength(1)
  })

  it("records a cost for every target, growing with the target and the seconds", () => {
    const c720 = topazRheaCostUsd("720p", 10)!
    const c1080 = topazRheaCostUsd("1080p", 10)!
    const c4k = topazRheaCostUsd("4k", 10)!
    expect(c720).toBeGreaterThan(0)
    expect(c1080).toBeGreaterThan(c720)
    expect(c4k).toBeGreaterThan(c1080)
    expect(topazRheaCostUsd("1080p", 20)).toBeCloseTo(c1080 * 2, 10)
  })
})

describe("a wait that gives up leaves the run to the recovery", () => {
  it("the poll budget running out after a submit is PENDING (left for the reconcile), never a failure that resubmits", async () => {
    const { isProviderRunPending } = await import("../../../lib/provider-run-pending.js")
    seen.fail = { submit: true, err: new Error("fal request failed (req-1): timed out after 1200 polls") }
    const err = await run().catch((e: unknown) => e)
    expect(isProviderRunPending(err)).toBe(true)
    // Resuming a request that times out again stays pending too.
    seen.fail = { submit: false, err: new Error("fal request failed (req-1): timed out after 1200 polls") }
    const again = await falTopazRheaUpscale({ videoUrl: "https://in.test/take.mp4", upscaleFactor: 1.5, target: "720p", billedSec: 4, resumeRequestId: "req-1" }).catch((e: unknown) => e)
    expect(isProviderRunPending(again)).toBe(true)
    expect(seen.calls.at(-1)).toMatchObject({ resumeRequestId: "req-1" })
  })

  it("the engine's own failure answer stays a failure; nothing submitted is no pending run", async () => {
    const { isProviderRunPending } = await import("../../../lib/provider-run-pending.js")
    const { FalRequestError } = await import("../client.js")
    seen.fail = { submit: true, err: new FalRequestError("req-1", "boom", "boom", true) }
    expect(isProviderRunPending(await run().catch((e: unknown) => e))).toBe(false)
    seen.fail = { submit: false, err: new Error("network down before the submit") }
    expect(isProviderRunPending(await run().catch((e: unknown) => e))).toBe(false)
  })
})
