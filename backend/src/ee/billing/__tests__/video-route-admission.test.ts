// @test-units-by-name it names only Seedance price ids and video job types, never a node unit
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Admission of a routable video job (video-route-admission.ts) and its
 * settlement (video-route-settlement.ts):
 *  - nothing routed: null, and nothing read;
 *  - routed: the decision is decided HERE, signed, stored, and the hold is the quote;
 *  - a decision already on the row (a caller's forged one, a copy) is never
 *    trusted: replaced at admission, ignored when the model is not routed;
 *  - settlement charges what the route billed (collecting over the hold, with
 *    an alert and a factor raise when it billed more than quoted).
 */
const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  job: null as Record<string, unknown> | null,
  parentType: null as string | null,
  draftSource: null as Record<string, unknown> | null,
  jobReadFails: false,
  settingsFail: false,
  updates: [] as Record<string, unknown>[],
  log: { action: "seedance-2-5:8s:720p", credits_used: 200, job_id: "11111111-1111-4111-8111-111111111111" } as Record<string, unknown>,
  commits: [] as unknown[][],
  factorWrites: [] as unknown[],
  reads: 0,
  ledger: { starts: [], tasks: [], segments: [], addonsBase: undefined, settle: undefined } as Record<string, unknown>,
  settles: [] as unknown[][],
  ownLoss: [] as unknown[][],
  ownLossUnmarked: false,
  patches: [] as unknown[][],
  alerts: vi.fn(async (_alert: { key: string; message: string }) => {}),
}))
vi.mock("../video-route-alerts.js", () => ({ recordVideoRouteAlert: h.alerts }))
vi.mock("@/lib/video-route-ledger.js", async (orig) => ({
  ...(await orig<typeof import("@/lib/video-route-ledger.js")>()),
  readRouteLedger: async () => h.ledger,
  recordRouteSettle: async (...a: unknown[]) => { h.settles.push(a) },
  holdRouteSettle: async (...a: unknown[]) => { h.settles.push([a[0], "hold", a[1]]); return true },
  // (A test can make the mark fail to land, as a write that matched no row does.)
  markRouteTaskOwnLoss: async (...a: unknown[]) => { h.ownLoss.push(a); return !h.ownLossUnmarked },
  patchRouteSettle: async (...a: unknown[]) => (h.patches.push(a), true),
}))

vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => h.settings, invalidateSettingsCache: () => {}, settingsReadFailed: () => h.settingsFail }))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    rpc: async (name: string, args: object) => { h.updates.push({ name, ...args }); return { error: null } },
    from: (table: string) => {
      h.reads++
      let id = ""
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (c: string, v: string) => { if (c === "id") id = v; return chain },
        maybeSingle: async () => {
          if (table === "usage_logs") return { data: h.log, error: null }
          if (table === "jobs" && h.jobReadFails) return { data: null, error: { message: "connection reset" } }
          if (table === "jobs") return { data: id === "parent-1" ? { job_type: h.parentType } : id === "draft-src" ? h.draftSource : h.job, error: null }
          return { data: null, error: null }
        },
        update: (row: Record<string, unknown>) => {
          h.updates.push({ table, ...row })
          if (table === "jobs" && row.input_data && h.job) h.job = { ...h.job, input_data: row.input_data }
          return { eq: async () => ({ error: null }) }
        },
      }
      return chain
    },
  },
}))
vi.mock("@/lib/ref-video-probe.js", () => ({ probeRefVideoDurations: async (a: { referenceVideoUrls: readonly unknown[] }) => a.referenceVideoUrls.map(() => 14.2) }))
const commitOutcome = vi.hoisted(() => ({
  next: null as null | { charged: number; collectedOverHold: number; shortfall: number },
  take(charged: number) {
    const o = this.next ?? { charged, collectedOverHold: 0, shortfall: 0 }
    this.next = null
    return o
  },
}))
vi.mock("../credits.js", async (orig) => ({
  ...(await orig<typeof import("../credits.js")>()),
  CreditsService: { commitCredits: async (...a: unknown[]) => (h.commits.push(a), commitOutcome.take(a[1] as number)) },
}))
vi.mock("@/lib/video-route-policy-store.js", () => ({
  updateVideoRoutePriceFactor: async (key: string, change: (c: unknown) => unknown) => {
    const next = change(undefined)
    if (next) h.factorWrites.push({ key, next })
    return next
  },
}))

const { admitRoutedVideo } = await import("../video-route-admission.js")
const { settleRoutedJob } = await import("../video-route-settlement.js")
const { PriceNotConfiguredError } = await import("../credits.js")
const { setPluginServices, _resetPluginServicesForTests } = await import("../../../lib/private-plugins/services-registry.js")
const { _resetAlternateRoutePricesForTests } = await import("../../../lib/alternate-route-prices.js")
const { VIDEO_ROUTE_STAMP_KEY, videoRouteStamp, videoRouteStampOf } = await import("../../../lib/video-route-decision.js")
const { defaultVideoRoutePolicy, ROUTE_BILL_ANOMALY_MULTIPLE_DEFAULT } = await import("../../../lib/video-route-policy.js")
const { CREDIT_BASE_USD } = await import("@nodaro/shared/models")

const JOB = "11111111-1111-4111-8111-111111111111"
const routed = (models: Record<string, unknown>) => ({ ...defaultVideoRoutePolicy(), models })
const quote = vi.fn((_req: unknown) => ({ billedSeconds: 8, usd: CREDIT_BASE_USD * 100 }) as { billedSeconds: number; usd: number } | null)

beforeEach(() => {
  h.settings = { cost_markup_percent: 0, service_margin_percent: {} }
  h.job = { job_type: "image-to-video", parent_job_id: null, input_data: { provider: "seedance-2-5", prompt: "a cat", duration: 8, resolution: "720p" } }
  h.updates = []
  h.commits = []
  h.factorWrites = []
  h.reads = 0
  h.log = { action: "seedance-2-5:8s:720p", credits_used: 100, job_id: JOB }
  h.ledger = { starts: [], tasks: [], segments: [], addonsBase: undefined, settle: undefined }
  h.settles = []
  h.ownLoss = []
  h.ownLossUnmarked = false
  h.patches = []
  h.alerts.mockClear()
  quote.mockClear()
  h.draftSource = null
  h.jobReadFails = false
  h.settingsFail = false
  _resetPluginServicesForTests()
  _resetAlternateRoutePricesForTests()
  setPluginServices({
    alternateRoutes: {
      accepts: (req) => ({ routeId: req.kind === "draft-finalize" ? "finalize:1080p" : "r1" }),
      quotePlan: (plan) => {
        if (!plan.outputSec || !plan.resolution || !plan.service) return null
        const result = quote(plan)
        if (!result) throw new PriceNotConfiguredError(plan.model)
        return { ...result, routeId: plan.referenceVideoDurationsSec.length ? "with-reference" : "r1" }
      },
      start: async () => ({ taskRef: "t" }),
      poll: async () => ({ state: "running" }),
      prices: () => [{ id: "seedance-2-5:8s:720p", usd: 0.2 }],
      quote: (req) => quote(req),
    },
  })
})

describe("admitRoutedVideo", () => {
  it("is null with nothing routed, and reads no job", async () => {
    expect(await admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5:8s:720p" })).toBeNull()
    h.settings = { ...h.settings, video_route_policy: defaultVideoRoutePolicy() }
    expect(await admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5:8s:720p" })).toBeNull()
    expect(h.reads).toBe(0)
  })

  it("refuses an unreadable route policy before consulting or reserving a default supplier", async () => {
    const { markSettingsReadFailed } = await import("../../../lib/app-settings-read-status.js")
    markSettingsReadFailed(h.settings)
    await expect(admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5:8s:720p" })).rejects.toBeInstanceOf(PriceNotConfiguredError)
    expect(quote).not.toHaveBeenCalled()
    expect(h.reads).toBe(0)
  })

  it("uses the selected service quote for the direct route affordability preflight", async () => {
    const { videoPreflightQuote } = await import("../video-route-preflight.js")
    const req = { method: "POST", url: "/v1/text-to-video", body: { provider: "seedance-2-5", prompt: "track the dancer", duration: 8, resolution: "720p" } }
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "default", services: { "text-to-video": "alternate" } } }) }
    await expect(videoPreflightQuote(req as never, "seedance-2-5:8s:720p", req.url, () => ({ input: req.body, jobType: "text-to-video" }))).resolves.toEqual({ price: 100, withAddons: true })
    expect(quote.mock.calls.at(-1)?.[0]).toMatchObject({ jobType: "text-to-video", prompt: "track the dancer", durationSec: 8 })
  })

  it("does not probe a routed request the owning route has not validated", async () => {
    const { videoPreflightQuote } = await import("../video-route-preflight.js")
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate" } }) }
    const req = { method: "POST", url: "/v1/text-to-video", body: { provider: "seedance-2-5", videoUrl: "https://unvalidated.example" } }
    await expect(videoPreflightQuote(req as never, "seedance-2-5:8s:720p", req.url, () => null)).resolves.toBeUndefined()
    await expect(videoPreflightQuote(req as never, "seedance-2-5:8s:720p", req.url)).resolves.toBeUndefined()
    expect(quote).not.toHaveBeenCalled()
  })

  it("is null for a model that is not routable, whatever is routed", async () => {
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate" } }) }
    expect(await admitRoutedVideo({ jobId: JOB, priceId: "kling-3.0:5s" })).toBeNull()
  })

  it("decides, signs and stores the route, and holds the quote (asked with service and kind)", async () => {
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate" } }) }
    const admitted = await admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5:8s:720p" })
    expect(admitted?.holdCredits).toBe(100)
    expect(quote.mock.calls[0]![0]).toMatchObject({ service: "image-to-video", kind: "generate", durationSec: 8, outputSec: 8 })
    const stored = (h.job!.input_data as Record<string, unknown>)
    expect(videoRouteStampOf(stored, JOB)).toMatchObject({ routeId: "r1", service: "image-to-video", quotedUsd: CREDIT_BASE_USD * 100 })
  })

  it("seats a lip-sync's portrait as the provider does: a reference image beside the voice, never a frame with references", async () => {
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate" } }) }
    h.job = { job_type: "lip-sync", parent_job_id: null, input_data: { provider: "seedance-2-5", prompt: "speaks", imageUrl: "https://m.example/face.png", audioUrl: "https://m.example/voice.mp3" } }
    await admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5:8s:720p" })
    const asked = quote.mock.calls[0]![0] as Record<string, unknown>
    expect(asked.firstFrameUrl).toBeUndefined()
    expect(asked.referenceImageUrls).toEqual(["https://m.example/face.png"])
    expect(asked.referenceAudioUrls).toEqual(["https://m.example/voice.mp3"])
  })

  it("sends a Seedance 2.5 first-frame run with a fixed ratio as the provider does (adaptive), so it is routed", async () => {
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate" } }) }
    h.job = { job_type: "image-to-video", parent_job_id: null, input_data: { provider: "seedance-2-5", prompt: "go", imageUrl: "https://m.example/start.png", aspectRatio: "16:9", duration: 8 } }
    expect(await admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5:8s:720p" })).not.toBeNull()
    expect(quote.mock.calls[0]![0]).toMatchObject({ aspectRatio: "adaptive", firstFrameUrl: "https://m.example/start.png", outputSec: 8 })
  })

  it("an edit's output length is its source's length MEASURED here (a length in the input is never trusted), signed into the decision", async () => {
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate" } }) }
    h.job = { job_type: "image-to-video", parent_job_id: null, input_data: { provider: "seedance-2-5", prompt: "edit", referenceVideoUrls: ["https://m.example/src.mp4"], refVideoDurationsSec: [12.4], referenceTaskType: "edit", duration: -1 } }
    const admitted = await admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5:8s:720p-ref" })
    expect(quote.mock.calls[0]![0]).toMatchObject({ referenceVideoDurationsSec: [14.2], outputSec: 14.2 })
    expect(admitted?.stamp).toMatchObject({ referenceVideoDurationsSec: [14.2], outputSec: 14.2 })
  })

  it("quotes a request with no job yet (/v1/quote) as its admission would hold it, and not at all while it is not routed", async () => {
    const { quoteRoutedVideo } = await import("../video-route-admission.js")
    expect(await quoteRoutedVideo({ priceId: "seedance-2-5:8s:720p", jobType: "text-to-video", input: { prompt: "x", duration: 8 } })).toBeNull()
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate" } }) }
    expect(await quoteRoutedVideo({ priceId: "seedance-2-5:8s:720p", jobType: "text-to-video", input: { prompt: "x", duration: 8 } })).toBe(100)
  })

  it("names a child job's service by its parent", async () => {
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "default", services: { "cast-swap": "alternate" } } }) }
    h.job = { ...h.job!, parent_job_id: "parent-1" }
    h.parentType = "cast-swap"
    expect((await admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5:8s:720p" }))?.stamp.service).toBe("cast-swap")
    h.parentType = "ugc"
    h.job = { ...h.job!, input_data: { provider: "seedance-2-5", prompt: "x" } }
    expect(await admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5:8s:720p" })).toBeNull()
  })

  it("hard-fails a routed run with no quote — never the default price", async () => {
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate" } }) }
    quote.mockReturnValueOnce(null)
    await expect(admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5:8s:720p" })).rejects.toBeInstanceOf(PriceNotConfiguredError)
  })

  it("never trusts a decision already on the row: a forged one is replaced by the server's own", async () => {
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate" } }) }
    const forged = { route: "alternate", routeId: "r-evil", service: "image-to-video", model: "seedance-2-5", decidedAt: "x", quotedUsd: 0.000001, quotedSec: 1, factor: 1, factorKey: "k", sig: "forged" }
    h.job = { ...h.job!, input_data: { ...(h.job!.input_data as object), [VIDEO_ROUTE_STAMP_KEY]: forged } }
    const admitted = await admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5:8s:720p" })
    expect(admitted?.holdCredits).toBe(100)
    expect(videoRouteStampOf(h.job!.input_data, JOB)).toMatchObject({ routeId: "r1", quotedUsd: CREDIT_BASE_USD * 100 })
  })

  it("a forged decision on a job whose model is not routed is no decision at all", () => {
    const forged = { route: "alternate", routeId: "r1", service: "image-to-video", model: "seedance-2-5", decidedAt: "x", quotedUsd: 1, quotedSec: 1, factor: 1, factorKey: "k", sig: "forged" }
    expect(videoRouteStampOf({ [VIDEO_ROUTE_STAMP_KEY]: forged }, JOB)).toBeUndefined()
  })
})

describe("a selected route that is gone or cannot take the model refuses the request, with an alert that says why", () => {
  const alertsMock = async () => vi.mocked((await import("../video-route-alerts.js")).recordVideoRouteAlert)
  const route = (over: Record<string, unknown> | null) => {
    _resetPluginServicesForTests()
    _resetAlternateRoutePricesForTests()
    if (over) setPluginServices({ alternateRoutes: { accepts: () => ({ routeId: "r1" }), start: async () => ({ taskRef: "t" }), poll: async () => ({ state: "running" }), quote: (req: unknown) => quote(req), ...over } as never })
  }
  it.each([
    ["no route is loaded", null, "no-route", /no alternate route is loaded/],
    ["the loaded route predates per-model routing (no prices)", {}, "route-v1", /predates per-model routing/],
    ["the loaded route does not take the model", { prices: () => [{ id: "seedance-2:5s:720p", usd: 0.2 }] }, "not-capable", /does not take this model/],
  ] as const)("%s", async (_name, over, why, words) => {
    const alerts = await alertsMock()
    alerts.mockClear()
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate" } }) }
    route(over as Record<string, unknown> | null)
    // Refused before anything is held, never sent to the default provider.
    await expect(admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5:8s:720p" })).rejects.toBeInstanceOf(PriceNotConfiguredError)
    expect(alerts).toHaveBeenCalledWith(expect.objectContaining({ key: `route-unavailable:seedance-2-5:${why}`, kind: "route-unavailable", model: "seedance-2-5", message: expect.stringMatching(words) }))
    expect(err.mock.calls.some((c) => String(c[0]).startsWith("[ALERT]") && words.test(String(c[0])))).toBe(true)
    err.mockRestore()
  })

  it("a request the route merely declines raises no such alert", async () => {
    const alerts = await alertsMock()
    alerts.mockClear()
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate" } }) }
    route({ prices: () => [{ id: "seedance-2-5:8s:720p", usd: 0.2 }], accepts: () => null })
    await expect(admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5:8s:720p" })).rejects.toBeInstanceOf(PriceNotConfiguredError)
    expect(alerts.mock.calls.filter((c) => (c[0] as { kind?: string }).kind === "route-unavailable")).toEqual([])
  })
})

describe("admitRoutedVideo — every lane's routable request is actually routed (none refused for a missing field)", () => {
  /** The plugin's rule as it stands: a request `quote` cannot price is refused. */
  const strictAccepts = (req: Record<string, unknown>) => {
    const urls = (req.referenceVideoUrls as unknown[]) ?? []
    const secs = (req.referenceVideoDurationsSec as unknown[] | undefined) ?? []
    if (urls.length > 0 && secs.length !== urls.length) return null
    if (req.kind === "draft-finalize" && typeof req.outputSec !== "number") return null
    if (req.kind !== "draft-finalize" && typeof req.outputSec !== "number" && typeof req.durationSec !== "number" && urls.length === 0) return null
    if (req.firstFrameUrl && (urls.length > 0 || ((req.referenceAudioUrls as unknown[]) ?? []).length > 0)) return null
    return { routeId: "r1" }
  }
  const lanes: Array<[string, string, Record<string, unknown>, string]> = [
    ["image-to-video (first frame)", "image-to-video", { provider: "seedance-2-5", prompt: "go", imageUrl: "https://m.example/a.png", duration: 8 }, "seedance-2-5:8s:720p"],
    ["image-to-video (Auto length)", "image-to-video", { provider: "seedance-2-5", prompt: "go", duration: -1 }, "seedance-2-5:15s:720p"],
    ["text-to-video", "text-to-video", { provider: "seedance-2", prompt: "go", duration: 5 }, "seedance-2:5s:720p"],
    ["reference video (probed here)", "image-to-video", { provider: "seedance-2-5", prompt: "go", referenceVideoUrls: ["https://m.example/v.mp4"], duration: 8 }, "seedance-2-5:8s:720p-ref"],
    ["extend (its source, cut to the window)", "extend-video", { provider: "seedance-2-5-extend", prompt: "go", videoUrl: "https://m.example/src.mp4", duration: 8 }, "seedance-2-5-extend:8s:720p"],
    ["lip-sync (portrait + voice, priced length)", "lip-sync", { provider: "seedance-2", prompt: "talk", imageUrl: "https://m.example/f.png", audioUrl: "https://m.example/v.mp3" }, "seedance-2:8s:720p"],
    ["voiced video", "voiced-video", { provider: "seedance-2-5", prompt: "talk", imageUrl: "https://m.example/f.png", duration: 8 }, "seedance-2-5:8s:720p"],
    ["entity motion (no length asked: the priced one)", "generate-character-motion", { provider: "seedance-2-fast", prompt: "walk", sourceImageUrl: "https://m.example/c.png" }, "seedance-2-fast:5s:480p"],
  ]
  for (const [label, jobType, input, priceId] of lanes) {
    it(label, async () => {
      const model = priceId.split(":")[0]!.replace(/-extend$/, "")
      h.settings = { ...h.settings, video_route_policy: routed({ [model]: { route: "alternate" } }) }
      h.job = { job_type: jobType, parent_job_id: null, input_data: input }
      setPluginServices({
        alternateRoutes: {
          accepts: (req) => strictAccepts(req as unknown as Record<string, unknown>),
          start: async () => ({ taskRef: "t" }), poll: async () => ({ state: "running" }),
          prices: () => [{ id: priceId, usd: 0.2 }], quote: (req) => quote(req),
        },
      })
      expect(await admitRoutedVideo({ jobId: JOB, priceId })).not.toBeNull()
    })
  }
  // The route id decided at admission is stored on the job, and the route's `start` derives its
  // own from the request the run PREPARES. A different id fails the start and refunds the job.
  // The rule below has the shape a route derives its id from: the model, draft or not, the
  // resolution, and whether a reference video is sent.
  describe("the route id decided at admission is the one the prepared request derives", () => {
    const ruleRouteId = (req: Record<string, unknown>) =>
      ["route", req.model, req.draft === true ? "draft" : "standard", req.resolution ?? "none", ((req.referenceVideoUrls as unknown[]) ?? []).length > 0 ? "v" : "n"].join(":")
    // [label, job type, the request as the person sent it, its price id, the body the default provider prepares for it]
    const prepared: Array<[string, string, Record<string, unknown>, string, Record<string, unknown>]> = [
      ["image-to-video (first frame)", "image-to-video",
        { provider: "seedance-2-5", prompt: "go", imageUrl: "https://m.example/a.png", duration: 8, resolution: "720p" }, "seedance-2-5:8s:720p",
        { prompt: "go", duration: 8, resolution: "720p", aspect_ratio: "adaptive", generate_audio: false, first_frame_url: "https://m.example/a.png" }],
      ["text-to-video", "text-to-video",
        { provider: "seedance-2", prompt: "go", duration: 5, resolution: "720p" }, "seedance-2:5s:720p",
        { prompt: "go", duration: 5, resolution: "720p", aspect_ratio: "16:9", generate_audio: false }],
      ["reference video", "image-to-video",
        { provider: "seedance-2-5", prompt: "go", referenceVideoUrls: ["https://m.example/v.mp4"], duration: 8, resolution: "720p" }, "seedance-2-5:8s:720p-ref",
        { prompt: "go", duration: 8, resolution: "720p", aspect_ratio: "16:9", generate_audio: false, reference_video_urls: ["https://r2.example/v-reencoded.mp4"] }],
      ["voiced video", "voiced-video",
        { provider: "seedance-2-5", prompt: "talk", imageUrl: "https://m.example/f.png", duration: 8, resolution: "720p" }, "seedance-2-5:8s:720p",
        { prompt: "talk", duration: 8, resolution: "720p", aspect_ratio: "16:9", generate_audio: false, reference_image_urls: ["https://m.example/f.png"], reference_audio_urls: ["https://r2.example/track.mp3"] }],
      ["extend (its source as the reference video)", "extend-video",
        { provider: "seedance-2-5-extend", prompt: "go", videoUrl: "https://m.example/src.mp4", duration: 8, resolution: "720p" }, "seedance-2-5-extend:8s:720p",
        { prompt: "go", duration: 8, resolution: "720p", aspect_ratio: "16:9", generate_audio: false, omni_reference_task_type: "extend", reference_video_urls: ["https://r2.example/src-tail.mp4"] }],
      ["lip-sync (portrait and voice as references)", "lip-sync",
        { provider: "seedance-2", prompt: "talk", imageUrl: "https://m.example/f.png", audioUrl: "https://m.example/v.mp3", resolution: "720p" }, "seedance-2:8s:720p",
        { prompt: "talk", duration: 8, resolution: "720p", aspect_ratio: "16:9", generate_audio: false, reference_image_urls: ["https://m.example/f.png"], reference_audio_urls: ["https://m.example/v.mp3"] }],
      ["entity motion (the entity's image as the first frame)", "generate-character-motion",
        { provider: "seedance-2-fast", prompt: "walk", sourceImageUrl: "https://m.example/c.png" }, "seedance-2-fast:5s:480p",
        // (No resolution is asked for: the lane sends the model's own default, the one admission quotes.)
        { prompt: "walk", duration: 5, resolution: "720p", aspect_ratio: "adaptive", generate_audio: false, first_frame_url: "https://m.example/c.png" }],
      ["a 480p draft", "image-to-video",
        { provider: "seedance-2-5", prompt: "go", imageUrl: "https://m.example/a.png", duration: 8, resolution: "480p", draft: true }, "seedance-2-5:8s:480p",
        { prompt: "go", duration: 8, resolution: "480p", aspect_ratio: "adaptive", generate_audio: false, draft: true, first_frame_url: "https://m.example/a.png" }],
    ]
    for (const [label, jobType, input, priceId, body] of prepared) {
      it(label, async () => {
        const { alternateRouteRequestOf } = await import("../../../lib/alternate-route-request.js")
        const model = priceId.split(":")[0]!.replace(/-extend$/, "")
        h.settings = { ...h.settings, video_route_policy: routed({ [model]: { route: "alternate" } }) }
        h.job = { job_type: jobType, parent_job_id: null, input_data: input }
        let admitted: string | undefined
        setPluginServices({
          alternateRoutes: {
            accepts: (req) => {
              const routeId = strictAccepts(req as unknown as Record<string, unknown>) ? ruleRouteId(req as unknown as Record<string, unknown>) : null
              if (routeId) admitted = routeId
              return routeId ? { routeId } : null
            },
            start: async () => ({ taskRef: "t" }), poll: async () => ({ state: "running" }),
            prices: () => [{ id: priceId, usd: 0.2 }], quote: (req) => quote(req),
          },
        })
        expect(await admitRoutedVideo({ jobId: JOB, priceId })).not.toBeNull()
        const sent = alternateRouteRequestOf(body, { jobId: JOB, jobType: jobType as never, model, parent: null })
        expect(sent).not.toBeNull()
        expect(admitted).toBe(ruleRouteId(sent as unknown as Record<string, unknown>))
      })
    }
  })

  it("a voiced run is quoted as it is sent: the voice track as reference audio, the model's own audio off", async () => {
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate" } }) }
    h.job = { job_type: "image-to-video", parent_job_id: null, input_data: { prompt: "talk", imageUrl: "https://m.example/f.png", duration: 8, generateAudio: true, dialogue: [{ speaker: "A", line: "hi" }], characterVoices: { A: "v1" } } }
    await admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5:8s:720p" })
    const asked = quote.mock.calls.at(-1)![0] as Record<string, unknown>
    expect(asked).toMatchObject({ generateAudio: false, durationSec: 8, outputSec: 8 })
    expect((asked.referenceAudioUrls as string[])).toHaveLength(1)
    // With a reference present the portrait is seated as a reference image, as the provider seats it.
    expect(asked.firstFrameUrl).toBeUndefined()
  })

  it("a voiced run: every field the quote reads is the same in the request admission quotes and the request the run sends", async () => {
    const { alternateRouteRequestOf } = await import("../../../lib/alternate-route-request.js")
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate" } }) }
    h.job = { job_type: "voiced-video", parent_job_id: null, input_data: { prompt: "talk", imageUrl: "https://m.example/f.png", duration: 8, resolution: "720p", aspectRatio: "16:9", generateAudio: true, dialogue: [{ speaker: "A", line: "hi" }], characterVoices: { A: "v1" } } }
    await admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5:8s:720p" })
    const quoted = quote.mock.calls.at(-1)![0] as Record<string, unknown>
    // What the default provider prepares for this run (voiced-video's audio_driven call): the portrait folded in as a
    // reference beside the synthesised voice track, the model's own audio off; the portrait is a reference, not a
    // frame, so the requested ratio is kept (the start-frame "adaptive" rule applies to a frame only).
    const sentBody = {
      prompt: "talk", aspect_ratio: "16:9", duration: 8, resolution: "720p", generate_audio: false,
      reference_image_urls: ["https://m.example/f.png"], reference_audio_urls: ["https://r2.example/track.mp3"],
    }
    const sent = alternateRouteRequestOf(sentBody, { jobId: JOB, jobType: "voiced-video", model: "seedance-2-5", parent: null })!
    const sentForRoute = { ...sent, outputSec: sent.durationSec }
    const field = (r: Record<string, unknown>) => ({
      model: r.model, durationSec: r.durationSec, outputSec: r.outputSec, resolution: r.resolution, generateAudio: r.generateAudio, draft: r.draft, aspectRatio: r.aspectRatio,
      firstFrame: Boolean(r.firstFrameUrl), lastFrame: Boolean(r.lastFrameUrl),
      images: (r.referenceImageUrls as unknown[]).length, videos: (r.referenceVideoUrls as unknown[]).length, audios: (r.referenceAudioUrls as unknown[]).length,
      videoSec: r.referenceVideoDurationsSec ?? [], referenceTaskType: r.referenceTaskType,
    })
    expect(field(quoted)).toEqual(field(sentForRoute as unknown as Record<string, unknown>))
  })

  it("refuses and records an unsupported seed before holding credits", async () => {
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate" } }) }
    h.job = { job_type: "image-to-video", parent_job_id: null, input_data: { prompt: "go", duration: 8, seed: 42 } }
    await expect(admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5:8s:720p" })).rejects.toBeInstanceOf(PriceNotConfiguredError)
    expect((h.job!.input_data as Record<string, { why?: string }>).__videoRouteOutcome!.why).toBe("not-accepted:seed-set")
  })

  it("the extend's reference length is the window it sends, not the whole source", async () => {
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate" } }) }
    h.job = { job_type: "extend-video", parent_job_id: null, input_data: { prompt: "go", videoUrl: "https://m.example/src.mp4", duration: 8 } }
    await admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5-extend:8s:720p" })
    const secs = (quote.mock.calls.at(-1)![0] as { referenceVideoDurationsSec: number[] }).referenceVideoDurationsSec
    expect(secs).toHaveLength(1)
    expect(secs[0]).toBeLessThanOrEqual(10)
  })
})

describe("a run estimate of a routed node equals its admission hold", () => {
  it("prices the admitted request and refuses an unsupported seed", async () => {
    const { estimateRoutedNode } = await import("../video-route-admission.js")
    const { currentRouteView } = await import("../../../lib/alternate-route-prices.js")
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate" } }) }
    const data = { provider: "seedance-2-5", prompt: "go", imageUrl: "https://m.example/a.png", duration: 8, resolution: "720p" }
    const est = estimateRoutedNode({ nodeType: "generate-video", data, priceId: "seedance-2-5:8s:720p", settings: h.settings as never, view: currentRouteView() })
    h.job = { job_type: "image-to-video", parent_job_id: null, input_data: data }
    const held = (await admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5:8s:720p" }))!.holdCredits
    expect(est).toEqual({ kind: "route", credits: held })
    const { routedWorkflowVideoAddonBase } = await import("../../../lib/loop-trim-addon.js")
    const loop = { ...data, loopTrim: { enabled: true, framesToTest: 16 } }
    const addon = routedWorkflowVideoAddonBase("image-to-video", loop)
    expect(addon).toBeGreaterThan(0)
    expect(estimateRoutedNode({ nodeType: "generate-video", data: loop, priceId: "seedance-2-5:8s:720p", settings: h.settings as never, view: currentRouteView() })).toEqual({ kind: "route", credits: held + addon })
    expect(() => estimateRoutedNode({ nodeType: "generate-video", data: { ...data, seed: 1 }, priceId: "seedance-2-5:8s:720p", settings: h.settings as never, view: currentRouteView() })).toThrow(PriceNotConfiguredError)
    // A known reference length: the quote for exactly that request (never a per-second formula over a -ref row).
    const withRef = estimateRoutedNode({ nodeType: "generate-video", data: { ...data, referenceVideoUrls: ["u"] }, priceId: "seedance-2-5:8s:720p-ref", referenceVideoDurationsSec: [5], settings: h.settings as never, view: currentRouteView() })
    expect(withRef).toEqual({ kind: "route", credits: 100 })
    expect(quote.mock.calls.at(-1)![0]).toMatchObject({ referenceVideoDurationsSec: [5], outputSec: 8 })
    // A reference clip whose length is not known yet: the highest supported plan quote.
    expect(estimateRoutedNode({ nodeType: "generate-video", data: { ...data, referenceVideoUrls: ["u"] }, priceId: "seedance-2-5:8s:720p-ref", settings: h.settings as never, view: currentRouteView() })).toEqual({ kind: "route", credits: 100 })
  })
})

describe("Video Remake (an edit on Seedance 2.5, children of a cast-swap parent) end to end", () => {
  it("never substitutes a default charge for pending routed evidence, while retaining a verified zero", async () => {
    const { plannedRoutedCredits } = await import("../video-route-settlement.js")
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate" } }) }
    const admitted = await admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5:8s:720p" })
    h.job = { [VIDEO_ROUTE_STAMP_KEY]: admitted!.stamp }
    const args = { jobId: JOB, log: { action: "seedance-2-5:8s:720p", credits_used: 100, job_id: JOB } }
    h.ledger = { ...h.ledger, tasks: [{ send: 1, ref: "task", billedUsd: null }] }
    expect(await plannedRoutedCredits(args)).toEqual({ kind: "pending" })
    h.ledger = { ...h.ledger, tasks: [{ send: 1, ref: "task", billedUsd: 0 }] }
    expect(await plannedRoutedCredits(args)).toEqual({ kind: "confirmed", credits: 0 })
    expect(await plannedRoutedCredits({ ...args, addonsBase: 13 })).toEqual({ kind: "confirmed", credits: 13 })
    h.settingsFail = true
    expect(await plannedRoutedCredits(args)).toEqual({ kind: "pending" })
    h.settingsFail = false
    h.jobReadFails = true
    expect(await plannedRoutedCredits(args)).toEqual({ kind: "pending" })
    h.jobReadFails = false
    h.job = {}
    expect(await plannedRoutedCredits(args)).toEqual({ kind: "default" })
  })

  it("the parent's planned total = each child's hold = the route quote; the child settles at what the route billed", async () => {
    const { routedRefVideoHoldQuote } = await import("../video-route-admission.js")
    const { plannedRoutedCredits } = await import("../video-route-settlement.js")
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "default", services: { "cast-swap": "alternate" } } }) }
    // The plugin's parent quote of one child: its clip measured at 14.2 s (the probe mock).
    const planned = await routedRefVideoHoldQuote({ provider: "seedance-2-5", resolution: "720p", duration: -1, referenceTaskType: "edit", durationsSec: [14.2], routeService: "cast-swap" })
    // The child's own admission, under its cast-swap parent.
    h.parentType = "cast-swap"
    h.job = { job_type: "image-to-video", parent_job_id: "parent-1", input_data: { provider: "seedance-2-5", prompt: "swap", resolution: "720p", duration: -1, referenceTaskType: "edit", referenceVideoUrls: ["https://m.example/src.mp4"] } }
    const admitted = await admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5:15s:720p-ref" })
    expect(admitted).not.toBeNull()
    expect(planned).toEqual({ hold: admitted!.holdCredits, expected: admitted!.holdCredits })
    expect(quote.mock.calls.at(-1)![0]).toMatchObject({ service: "cast-swap", referenceTaskType: "edit", outputSec: 14.2, referenceVideoDurationsSec: [14.2] })
    // Delivered and held as a deferred child: it shows, then settles, at its billed cost.
    h.job = { status: "completed", usage_log_id: "log", [VIDEO_ROUTE_STAMP_KEY]: admitted!.stamp }
    h.ledger = { ...h.ledger, tasks: [{ send: 1, ref: "t", billedUsd: CREDIT_BASE_USD * 60 }], addonsBase: 0 }
    const log = { action: "seedance-2-5:15s:720p-ref", credits_used: admitted!.holdCredits, job_id: JOB }
    expect(await plannedRoutedCredits({ jobId: JOB, log })).toEqual({ kind: "confirmed", credits: 60 })
    expect(await settleRoutedJob({ usageLogId: "log", jobId: JOB, log })).toBe(true)
    expect(h.commits.at(-1)).toEqual(["log", 60, { collectOverHold: true, routedJobId: JOB }])
  })

  it("not routed for cast-swap: the plugin's quote is the default one (null here)", async () => {
    const { routedRefVideoHoldQuote } = await import("../video-route-admission.js")
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate", services: { "cast-swap": "default" } } }) }
    expect(await routedRefVideoHoldQuote({ provider: "seedance-2-5", resolution: "720p", duration: -1, referenceTaskType: "edit", durationsSec: [14.2], routeService: "cast-swap" })).toBeNull()
  })
})

describe("Generate Video Pro routed pricing (PluginRoutedRunPricing)", () => {
  it("each segment quoted as sent (later ones with the tail as reference), plus the fee; a signed token", async () => {
    const { routedRunPricing } = await import("../video-route-admission.js")
    const { rowlessRouteTokenOf } = await import("../../../lib/video-route-decision.js")
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "default", services: { "generate-video-pro": "alternate" } } }) }
    const priced = await routedRunPricing({ service: "generate-video-pro", provider: "seedance-2-5", resolution: "720p", segmentDurations: [10, 8], tailSec: 2, feeBase: 30, feeId: "generate-video-pro" })
    expect(priced).toMatchObject({ segmentChargedCredits: [100, 100], feeChargedCredits: 30, reserveChargedCredits: 230 })
    expect(quote.mock.calls[0]![0]).toMatchObject({ outputSec: 10, service: "generate-video-pro" })
    expect(quote.mock.calls[1]![0]).toMatchObject({ outputSec: 8, referenceVideoDurationsSec: [2] })
    // The signed quote (it sends nothing until reserveRoutedRun binds it to the job).
    expect(rowlessRouteTokenOf(priced!.quote)).toMatchObject({ routeId: "r1", model: "seedance-2-5", service: "generate-video-pro", stage: "quote", reserveChargedCredits: 230, feeChargedCredits: 30, feeId: "generate-video-pro" })
  })

  it("uses the default when selected and refuses a missing selected segment quote", async () => {
    const { routedRunPricing } = await import("../video-route-admission.js")
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate", services: { "generate-video-pro": "default" } } }) }
    expect(await routedRunPricing({ service: "generate-video-pro", provider: "seedance-2-5", resolution: "720p", segmentDurations: [10], tailSec: 0, feeBase: 0, feeId: "generate-video-pro" })).toBeUndefined()
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate" } }) }
    quote.mockReturnValueOnce({ billedSeconds: 8, usd: CREDIT_BASE_USD * 100 }).mockReturnValueOnce(null)
    await expect(routedRunPricing({ service: "generate-video-pro", provider: "seedance-2-5", resolution: "720p", segmentDurations: [10, 8], tailSec: 2, feeBase: 0, feeId: "generate-video-pro" })).rejects.toBeInstanceOf(PriceNotConfiguredError)
  })
})

it("includes the wired Extend Source on the first planned Pro segment, including a single segment", async () => {
  const { routedGenerateVideoProPricing } = await import("../video-route-planned.js")
  h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate" } }) }
  await routedGenerateVideoProPricing({ segmentDurations: [8], tailSec: 3, resolution: "720p", feeBase: 0 }, { provider: "seedance-2-5", hasOpeningVideo: true })
  expect(quote.mock.lastCall?.[0]).toMatchObject({ outputSec: 8, referenceVideoDurationsSec: [3] })
})

describe("admitRoutedVideo — a draft finalize follows its draft's route", () => {
  it("a continuation uses its original signed supplier after an Admin change and only for its owner", async () => {
    const { routedContinuationPricing } = await import("../video-route-admission.js")
    const { bindRowlessRouteToken, rowlessRouteToken } = await import("../../../lib/video-route-decision.js")
    const token = bindRowlessRouteToken(rowlessRouteToken({ routeId: "source:no-ref", model: "seedance-2-5", service: "generate-video-pro" }), { parentJobId: "draft-src", userId: "owner", now: new Date(0) })
    h.draftSource = { metadata: { videoRouteRun: { token } } }
    const args = { sourceJobId: "draft-src", sourceUserId: "owner", provider: "seedance-2-5", resolution: "720p", segmentDurations: [8, 8], tailSec: 2 }
    expect(await routedContinuationPricing(args, { billFromSegment: 2, feeBase: 0 })).toMatchObject({ segmentChargedCredits: [100] })
    await expect(routedContinuationPricing({ ...args, sourceUserId: "someone-else" }, { feeBase: 0 })).rejects.toThrow()
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate" } }) }
    h.draftSource = { metadata: {} }
    expect(await routedContinuationPricing(args, { feeBase: 0 })).toBeUndefined()
  })

  it("a default draft finalizes as always (null), whatever is routed", async () => {
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate" } }) }
    h.job = { job_type: "video-upscale", parent_job_id: null, input_data: { taskId: "kie-task-1", sourceJobId: "draft-src", draftOutputSec: 8 } }
    expect(await admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5-hd:8s" })).toBeNull()
  })

  it("a route draft is finalized on its route even with nothing routed now: the draft's reference, measured length and clips", async () => {
    h.job = { job_type: "video-upscale", parent_job_id: null, input_data: { taskId: "alt:route-task-1", sourceJobId: "draft-src", draftOutputSec: 9, draftRefVideoDurationsSec: [6] } }
    h.draftSource = { input_data: { referenceVideoUrls: ["https://m.example/ref.mp4"], __alternateRoute: { state: "running", at: 1, routeId: "rt:seedance-2-5:draft:480p:v" } } }
    const admitted = await admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5-hd:9s-ref" })
    expect(admitted?.holdCredits).toBe(100)
    expect(quote.mock.calls[0]![0]).toMatchObject({ kind: "draft-finalize", draftRouteTaskRef: "route-task-1", outputSec: 9, referenceVideoUrls: ["https://m.example/ref.mp4"], referenceVideoDurationsSec: [6], jobType: "video-upscale" })
    expect(admitted?.stamp).toMatchObject({ routeId: "finalize:1080p", draftRouteTaskRef: "route-task-1", outputSec: 9 })
  })

  it("its estimate (/v1/quote, /v1/seedance-hd-estimate) is the same route quote as its hold", async () => {
    const { routedFinalizeCredits } = await import("../video-route-admission.js")
    h.draftSource = { input_data: { referenceVideoUrls: ["https://m.example/ref.mp4"], __alternateRoute: { state: "running", at: 1, routeId: "rt:seedance-2-5:draft:480p:v" } } }
    const shown = await routedFinalizeCredits({ draftTaskId: "alt:route-task-1", sourceJobId: "draft-src", outputSec: 9, refVideoDurationsSec: [6], creditId: "seedance-2-5-hd:9s-ref" })
    h.job = { job_type: "video-upscale", parent_job_id: null, input_data: { taskId: "alt:route-task-1", sourceJobId: "draft-src", draftOutputSec: 9, draftRefVideoDurationsSec: [6] } }
    const held = (await admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5-hd:9s-ref" }))!.holdCredits
    expect(shown).toBe(held)
    // A draft the default provider made is not the route's to price.
    expect(await routedFinalizeCredits({ draftTaskId: "kie-task", sourceJobId: "draft-src", outputSec: 9, refVideoDurationsSec: [], creditId: "seedance-2-5-hd:9s" })).toBeNull()
  })

  it("a route draft this process cannot finalize is refused (503), never priced at the default", async () => {
    h.job = { job_type: "video-upscale", parent_job_id: null, input_data: { taskId: "alt:route-task-1", sourceJobId: "draft-src", draftOutputSec: 9 } }
    h.draftSource = { input_data: {} }
    await expect(admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5-hd:9s" })).rejects.toBeInstanceOf(PriceNotConfiguredError)
  })
})

describe("settleRoutedJob (the one routed settlement)", () => {
  const signed = () => videoRouteStamp(JOB, { route: "alternate", routeId: "r1", service: "image-to-video" }, { model: "seedance-2-5", priceId: "seedance-2-5:8s:720p", requestKey: "rk", quotedUsd: CREDIT_BASE_USD * 100, quotedSec: 8, factor: 1, factorKey: "seedance-2-5:720p:noref:generate" })
  const log = (over: Record<string, unknown> = {}) => ({ action: "seedance-2-5:8s:720p", credits_used: 100, job_id: JOB, ...over }) as { action: string | null; credits_used: number | null; job_id: string | null }
  const billed = (...usd: number[]) => usd.map((u, i) => ({ send: i + 1, ref: `t${i}`, billedUsd: u }))
  const policy = () => { h.settings = { ...h.settings, video_route_policy: defaultVideoRoutePolicy() } }
  const ownLossAlerts = () => h.alerts.mock.calls.map((c) => c[0]).filter((a) => a.key.startsWith("own-loss:"))

  it("a price id no route can price is decided with no read at all", async () => {
    policy()
    h.reads = 0
    expect(await settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log({ action: "flux-pro" }) })).toBe(false)
    expect(h.reads).toBe(0)
    expect(h.commits).toEqual([])
  })

  it("a stored decision with an invalid signature stays pending", async () => {
    policy()
    h.job = { status: "completed", usage_log_id: "log", [VIDEO_ROUTE_STAMP_KEY]: { ...signed(), sig: "x" } }
    await expect(settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log() })).rejects.toThrow(/could not be verified/)
  })

  it("never hands a missing candidate job to the ordinary charge path", async () => {
    policy()
    h.job = null
    await expect(settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log() })).rejects.toThrow(/missing routed job/)
    expect(h.commits).toEqual([])
    expect(h.settles).toEqual([])
  })

  it("cannot take a foreign environment's stamped job or create a local retry row for it", async () => {
    policy()
    h.job = { status: "completed", usage_log_id: "log", [VIDEO_ROUTE_STAMP_KEY]: { ...signed(), env: "another-environment" } }
    await expect(settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log() })).rejects.toThrow(/another environment/)
    expect(h.commits).toEqual([])
    expect(h.settles).toEqual([])
  })

  it("honors a prior signed decision when the process has no route plugin", async () => {
    policy()
    setPluginServices({})
    h.job = { status: "completed", usage_log_id: "log", [VIDEO_ROUTE_STAMP_KEY]: signed() }
    h.ledger = { ...h.ledger, tasks: billed(CREDIT_BASE_USD * 50) }
    expect(await settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log() })).toBe(true)
    expect(h.commits.at(-1)?.[1]).toBe(50)
  })

  it("with no routing policy ever saved nothing is routed: not this entry's, with no read and no write", async () => {
    h.job = { status: "completed", usage_log_id: "log" }
    h.reads = 0
    for (const action of ["seedance-2-5:8s:720p", "generate-video-pro", "edit-video-pro", "ugc-clip"]) {
      expect(await settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log({ action }) })).toBe(false)
    }
    // Even a job read that would fail is never attempted.
    h.jobReadFails = true
    expect(await settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log() })).toBe(false)
    h.jobReadFails = false
    expect(h.reads).toBe(0)
    expect(h.commits).toEqual([])
    expect(h.settles).toEqual([])
  })

  it("a reservation marked routed settles on its route even when this process sees no policy row, with an alert", async () => {
    // (The mark is written at admission and read with the usage log itself: no extra read decides it.)
    h.job = { status: "completed", usage_log_id: "log", [VIDEO_ROUTE_STAMP_KEY]: signed() }
    h.ledger = { ...h.ledger, tasks: billed(CREDIT_BASE_USD * 50) }
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await settleRoutedJob({ usageLogId: "log", jobId: JOB, log: { ...log(), routed: true } })).toBe(true)
    expect(h.commits).toEqual([["log", 50, { collectOverHold: true, routedJobId: JOB }]])
    expect(err.mock.calls.some((c) => String(c[0]).includes("no routing policy saved"))).toBe(true)
    err.mockRestore()
    // The same job with an unmarked log and no policy is not this entry's (no read).
    h.reads = 0
    expect(await settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log() })).toBe(false)
    expect(h.reads).toBe(0)
  })

  it("a job with no route stamp always falls through to the ordinary settle, policy saved or not", async () => {
    policy()
    h.job = { status: "completed", usage_log_id: "log" }
    expect(await settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log() })).toBe(false)
    expect(h.settles).toEqual([])
  })

  it("charges the reported billed cost: below the hold the rest is released, recorded done", async () => {
    policy()
    h.job = { status: "completed", usage_log_id: "log", [VIDEO_ROUTE_STAMP_KEY]: signed() }
    h.ledger = { ...h.ledger, tasks: billed(CREDIT_BASE_USD * 50) }
    expect(await settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log() })).toBe(true)
    expect(h.commits).toEqual([["log", 50, { collectOverHold: true, routedJobId: JOB }]])
    expect(h.settles.at(-1)).toEqual([JOB, "done", { credits: 50 }])
    expect(h.factorWrites).toEqual([])
  })

  it("above the hold: collects the overrun, alerts, and raises the factor one capped step", async () => {
    policy()
    h.job = { status: "completed", usage_log_id: "log", [VIDEO_ROUTE_STAMP_KEY]: signed() }
    h.ledger = { ...h.ledger, tasks: billed(CREDIT_BASE_USD * 200) }
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log() })).toBe(true)
    expect(h.commits).toEqual([["log", 200, { collectOverHold: true, routedJobId: JOB }]])
    expect(err.mock.calls.some((c) => String(c[0]).includes("video route price went up"))).toBe(true)
    expect(h.factorWrites).toEqual([{ key: "seedance-2-5:720p:noref:generate", next: expect.objectContaining({ factor: 1.25, by: "auto" }) }])
    err.mockRestore()
  })

  it("adds the add-ons the run DELIVERED (base credits from the ledger, marked up like the hold)", async () => {
    h.settings = { ...h.settings, cost_markup_percent: 20, video_route_policy: defaultVideoRoutePolicy() }
    h.job = { status: "completed", usage_log_id: "log", [VIDEO_ROUTE_STAMP_KEY]: signed() }
    h.ledger = { ...h.ledger, tasks: billed(CREDIT_BASE_USD * 50), addonsBase: 10 }
    expect(await settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log() })).toBe(true)
    expect(h.commits).toEqual([["log", 60 + 12, { collectOverHold: true, routedJobId: JOB }]])
  })

  it("a balance that cannot cover the over-hold: the uncollected credits are recorded on the ledger and alerted", async () => {
    policy()
    h.job = { status: "completed", usage_log_id: "log", [VIDEO_ROUTE_STAMP_KEY]: signed() }
    h.ledger = { ...h.ledger, tasks: billed(CREDIT_BASE_USD * 150) }
    commitOutcome.next = { charged: 120, collectedOverHold: 20, shortfall: 30 }
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log() })).toBe(true)
    expect(h.updates).toContainEqual({ name: "sync_video_route_debt", p_usage_log_id: "log", p_job_id: JOB })
    expect(err.mock.calls.some((c) => String(c[0]).includes("could not cover 30 credits"))).toBe(true)
    err.mockRestore()
  })

  it("two delivered sends (a voiced run whose voice track could not be laid on, then a plain clip): only the delivered clip's send is charged; the other is our loss", async () => {
    policy()
    h.job = { status: "completed", usage_log_id: "log", [VIDEO_ROUTE_STAMP_KEY]: signed() }
    h.ledger = { ...h.ledger, tasks: billed(CREDIT_BASE_USD * 40, CREDIT_BASE_USD * 50) }
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log() })).toBe(true)
    // Never charged twice, never charged for a step of ours that failed: the second send's 50, not 90.
    expect(h.commits).toEqual([["log", 50, { collectOverHold: true, routedJobId: JOB }]])
    expect(h.ownLoss).toEqual([[JOB, 1]])
    expect(err.mock.calls.some((c) => String(c[0]).includes("our loss"))).toBe(true)
    // Its bill is known: it is recorded beside the charge as the loss (the route's bill, base credits), and nothing is left to read the route for.
    expect(ownLossAlerts()).toEqual([expect.objectContaining({ key: `own-loss:${JOB}:1`, message: expect.not.stringContaining("not reported yet") })])
    expect(h.patches).toEqual([[JOB, { loss: { credits: 40, usd: CREDIT_BASE_USD * 40 } }, {}]])
    err.mockRestore()
  })

  describe("an earlier delivered send the route has not billed yet", () => {
    const WATCH = [JOB, expect.objectContaining({ watchUntil: expect.any(String), knownUsd: expect.any(Number) }), expect.objectContaining({ next_attempt_at: expect.any(String) })]
    // The loss recorded beside the charge: the quote of a replaced send not billed yet (its best known figure), no markup.
    const LOSS = [JOB, { loss: { credits: expect.any(Number), usd: expect.any(Number) } }, {}]
    const replaced = (first: Record<string, unknown> = {}) => {
      policy()
      h.job = { status: "completed", usage_log_id: "log", [VIDEO_ROUTE_STAMP_KEY]: signed() }
      h.ledger = { ...h.ledger, tasks: [{ send: 1, ref: "t0", billedUsd: null, ...first }, { send: 2, ref: "t1", billedUsd: CREDIT_BASE_USD * 50 }] }
    }

    it("is our loss all the same: the delivered clip's send is charged, the loss is alerted with no amount, and the route is watched for its bill", async () => {
      replaced()
      const err = vi.spyOn(console, "error").mockImplementation(() => {})
      expect(await settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log() })).toBe(true)
      // The run does not wait for a bill that is not the person's to pay.
      expect(h.commits).toEqual([["log", 50, { collectOverHold: true, routedJobId: JOB }]])
      expect(h.ownLoss).toEqual([[JOB, 1]])
      expect(ownLossAlerts()).toEqual([expect.objectContaining({ key: `own-loss:${JOB}:1`, kind: "settlement", message: expect.stringContaining("amount not reported yet") })])
      expect(ownLossAlerts()[0]!.message).not.toContain("could NOT be marked")
      // After the charge: the loss at its best known figure, and the late-bill watch, so it gets its real figure when the bill comes.
      expect(h.patches).toEqual([LOSS, WATCH])
      expect(h.settles.at(-1)).toEqual([JOB, "done", { credits: 50 }])
      err.mockRestore()
    })

    it("a mark that could not be written says so in the alert", async () => {
      replaced()
      h.ownLossUnmarked = true
      const err = vi.spyOn(console, "error").mockImplementation(() => {})
      expect(await settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log() })).toBe(true)
      expect(h.commits).toEqual([["log", 50, { collectOverHold: true, routedJobId: JOB }]])
      expect(ownLossAlerts()).toEqual([expect.objectContaining({ key: `own-loss:${JOB}:1`, message: expect.stringContaining("could NOT be marked") })])
      expect(err.mock.calls.some((c) => String(c[0]).includes("could NOT be marked"))).toBe(true)
      expect(h.patches).toEqual([LOSS, WATCH])
      err.mockRestore()
    })

    it("every earlier delivered send is listed, billed or not; one already marked is not alerted again, and is still watched while unbilled", async () => {
      replaced({ ownLoss: true })
      h.ledger = { ...h.ledger, tasks: [...(h.ledger.tasks as unknown[]).slice(0, 1), { send: 2, ref: "t1", billedUsd: CREDIT_BASE_USD * 30 }, { send: 3, ref: "t2", billedUsd: CREDIT_BASE_USD * 50 }] }
      const err = vi.spyOn(console, "error").mockImplementation(() => {})
      expect(await settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log() })).toBe(true)
      expect(h.commits).toEqual([["log", 50, { collectOverHold: true, routedJobId: JOB }]])
      // Send 1 was marked before; send 2 is marked and alerted now, with its bill known.
      expect(h.ownLoss).toEqual([[JOB, 2]])
      expect(ownLossAlerts()).toEqual([expect.objectContaining({ key: `own-loss:${JOB}:2`, message: expect.not.stringContaining("not reported yet") })])
      expect(h.patches).toEqual([LOSS, WATCH])
      err.mockRestore()
    })
  })

  it("a missing billed cost leaves the reservation pending", async () => {
    policy()
    h.job = { status: "completed", usage_log_id: "log", [VIDEO_ROUTE_STAMP_KEY]: signed() }
    h.ledger = { ...h.ledger, tasks: [{ send: 1, ref: "t", billedUsd: null }] }
    await expect(settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log() })).rejects.toThrow(/reported no verified bill/)
    expect(h.commits).toEqual([])
    expect(h.settles.at(-1)?.[1]).toBe("retry")
  })

  it("a conflicting price id leaves the reservation pending", async () => {
    policy()
    h.job = { status: "completed", usage_log_id: "log", [VIDEO_ROUTE_STAMP_KEY]: signed() }
    h.ledger = { ...h.ledger, tasks: billed(CREDIT_BASE_USD * 50) }
    await expect(settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log({ action: "seedance-2-5:15s:720p" }) })).rejects.toThrow(/priced as/)
    expect(h.commits).toEqual([])
  })

  it("collects the full verified bill, with no cap, up to the anomaly multiple of the quote", async () => {
    policy()
    h.job = { status: "completed", usage_log_id: "log", [VIDEO_ROUTE_STAMP_KEY]: signed() }
    const most = 100 * ROUTE_BILL_ANOMALY_MULTIPLE_DEFAULT
    h.ledger = { ...h.ledger, tasks: billed(CREDIT_BASE_USD * most) }
    expect(await settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log() })).toBe(true)
    expect(h.commits).toEqual([["log", most, { collectOverHold: true, routedJobId: JOB }]])
    expect(h.settles.at(-1)).toEqual([JOB, "done", { credits: most }])
  })

  it("holds a bill above the multiple for an admin: nothing charged, no factor raised", async () => {
    policy()
    h.job = { status: "completed", usage_log_id: "log", [VIDEO_ROUTE_STAMP_KEY]: signed() }
    const over = 100 * ROUTE_BILL_ANOMALY_MULTIPLE_DEFAULT * 2
    h.ledger = { ...h.ledger, tasks: billed(CREDIT_BASE_USD * over) }
    await expect(settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log() })).rejects.toThrow(/await a decision/)
    expect(h.commits).toEqual([])
    expect(h.settles.at(-1)).toEqual([JOB, "hold", expect.objectContaining({ credits: over })])
    // Confirmed by an admin for a smaller total than the one now charged: not covered, held again.
    h.ledger = { ...h.ledger, settle: { state: "retry", decision: "confirmed", detail: { decidedForCredits: over - 10 } } }
    await expect(settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log() })).rejects.toThrow(/await a decision/)
    expect(h.commits).toEqual([])
    // Confirmed by an admin for this total: charged in full, through the same entry.
    h.ledger = { ...h.ledger, settle: { state: "retry", decision: "confirmed", detail: { decidedForCredits: over } } }
    expect(await settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log() })).toBe(true)
    expect(h.commits).toEqual([["log", over, { collectOverHold: true, routedJobId: JOB }]])
    h.ledger = { ...h.ledger, settle: undefined }
  })

  it("never settles on a guess: a job read that keeps failing throws with nothing written (no retry mark on a job not proven routed); a proven routed job waits on its settings", async () => {
    policy()
    h.jobReadFails = true
    h.reads = 0
    await expect(settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log() })).rejects.toThrow(/reading its routing decision failed/)
    // Read again before giving up, and nothing recorded: the job may carry no route at all.
    expect(h.reads).toBe(3)
    expect(h.settles).toEqual([])
    expect(h.commits).toEqual([])
    h.jobReadFails = false
    h.settingsFail = true
    h.job = { status: "completed", usage_log_id: "log", [VIDEO_ROUTE_STAMP_KEY]: signed() }
    await expect(settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log() })).rejects.toThrow(/settings could not be read/)
    expect(h.commits).toEqual([])
  })

  it("leaves a log shared with another job to that job", async () => {
    policy()
    h.job = { status: "completed", usage_log_id: "log", [VIDEO_ROUTE_STAMP_KEY]: signed() }
    await expect(settleRoutedJob({ usageLogId: "log", jobId: JOB, log: log({ job_id: "someone-else" }) })).rejects.toThrow(/another job/)
  })
})

describe("listedRoutedNode (a process with no route to quote: the standalone orchestrator)", () => {
  it("follows the admin's choice for the node's own service: the listing where it routes, the default price where it does not", async () => {
    const { listedRoutedNode } = await import("../video-route-admission.js")
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate", services: { "lip-sync": "default" } } }) }
    expect(listedRoutedNode({ nodeType: "generate-video", priceId: "seedance-2-5:8s:720p-ref", settings: h.settings as never })).toEqual({ kind: "listed" })
    expect(listedRoutedNode({ nodeType: "lip-sync", priceId: "seedance-2-5:8s:720p", settings: h.settings as never })).toEqual({ kind: "default" })
    expect(listedRoutedNode({ nodeType: "generate-image", priceId: "flux-pro", settings: h.settings as never })).toBeNull()
  })
})

describe("a policy flip between a job's two admissions (a replayed once-per-job reservation)", () => {
  it("keeps the job's own earlier decision with the hold it was made with; another job's decision never verifies here", async () => {
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate" } }) }
    const first = await admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5:8s:720p" })
    expect(first).not.toBeNull()
    // The admin reverts the model; the reservation is replayed (it keeps its first hold).
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "default" } }) }
    h.updates = []
    expect(await admitRoutedVideo({ jobId: JOB, priceId: "seedance-2-5:8s:720p" })).toBeNull()
    // Kept, not cleared: the run follows the decision its hold was priced on.
    expect(h.updates.filter((u) => u.table === "jobs")).toEqual([])
    expect(videoRouteStampOf((h.job as { input_data: Record<string, unknown> }).input_data, JOB)).toMatchObject({ routeId: "r1" })
    // The same decision copied onto another job is no decision there.
    expect(videoRouteStampOf((h.job as { input_data: Record<string, unknown> }).input_data, "22222222-2222-4222-8222-222222222222")).toBeUndefined()
  })
})

describe("Edit Video Pro routed pricing (PluginRoutedRunPricing)", () => {
  it("each segment quoted with the reference clips it is sent with: the source before the span, each continuation, the source after it", async () => {
    const { editVideoProSegmentReferences, routedEditVideoProPricing } = await import("../video-route-admission.js")
    const { SEEDANCE_2_CONTINUATION_REF_SEC: R } = await import("@nodaro/shared/models")
    // Span from 6 s, three segments, source continues after the span: 1 + 2 + 1 references.
    const plan = { spanStartSec: 6, segmentDurations: [12, 12, 11], refsSecReserve: 4 * R, reserveResolution: "720p", feeBase: 20 }
    expect(editVideoProSegmentReferences(plan)).toEqual([[R], [R], [R, R]])
    // Span from 0 (no head), single segment, a source after it: one reference.
    expect(editVideoProSegmentReferences({ spanStartSec: 0, segmentDurations: [8], refsSecReserve: R })).toEqual([[R]])
    // Span from 0 to the source's end, single segment: none.
    expect(editVideoProSegmentReferences({ spanStartSec: 0, segmentDurations: [8], refsSecReserve: 0 })).toEqual([[]])
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "default", services: { "edit-video-pro": "alternate" } } }) }
    const priced = await routedEditVideoProPricing("seedance-2-5", plan)
    expect(priced).toMatchObject({ segmentChargedCredits: [100, 100, 100], feeChargedCredits: 20, reserveChargedCredits: 320 })
    expect(quote.mock.calls.map((c) => (c[0] as { referenceVideoDurationsSec?: number[] }).referenceVideoDurationsSec)).toEqual([[R], [R], [R, R]])
    expect(quote.mock.calls[0]![0]).toMatchObject({ service: "edit-video-pro", resolution: "720p", outputSec: 12 })
  })

  it("not routed for edit-video-pro: the default pricing stands", async () => {
    const { routedEditVideoProPricing } = await import("../video-route-admission.js")
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate", services: { "edit-video-pro": "default" } } }) }
    expect(await routedEditVideoProPricing("seedance-2-5", { spanStartSec: 0, segmentDurations: [8], refsSecReserve: 0, reserveResolution: "720p", feeBase: 20 })).toBeUndefined()
  })
})

describe("routedRefVideoEstimate (the editor pill of a routed reference-video node)", () => {
  it("quotes the smallest and largest admissible unknown references using the selected service", async () => {
    const { routedRefVideoEstimate } = await import("../video-route-admission.js")
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "default", services: { "text-to-video": "alternate" } } }) }
    const atLength = (request: unknown) => {
      const { referenceVideoDurationsSec, outputSec } = request as { referenceVideoDurationsSec: number[]; outputSec: number }
      const billedSeconds = outputSec + referenceVideoDurationsSec.reduce((a, b) => a + b, 0)
      return { billedSeconds, usd: CREDIT_BASE_USD * billedSeconds }
    }
    quote.mockImplementationOnce(atLength).mockImplementationOnce(atLength)
    const result = await routedRefVideoEstimate({ provider: "seedance-2-5", duration: 8, resolution: "720p", durationsSec: [3], unknownClips: 1, routeService: "text-to-video" })
    expect(result?.exact).toBe(false)
    expect(result!.credits).toBeGreaterThan(result!.min)
    expect(quote.mock.calls.map(([r]) => (r as { referenceVideoDurationsSec: number[] }).referenceVideoDurationsSec[0])).toEqual([3, 3])
  })

  it("is the route's quote as admission holds it once every clip is measured; null when not routed for the node", async () => {
    const { routedRefVideoEstimate } = await import("../video-route-admission.js")
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "default", services: { "image-to-video": "alternate" } } }) }
    expect(await routedRefVideoEstimate({ provider: "seedance-2-5", resolution: "720p", duration: 8, durationsSec: [5], unknownClips: 0 })).toEqual({ credits: 100, min: 100, exact: true })
    expect(quote.mock.calls.at(-1)![0]).toMatchObject({ service: "image-to-video", referenceVideoDurationsSec: [5], outputSec: 8 })
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate", services: { "image-to-video": "default" } } }) }
    expect(await routedRefVideoEstimate({ provider: "seedance-2-5", resolution: "720p", duration: 8, durationsSec: [5], unknownClips: 0 })).toBeNull()
  })
})

describe("Generate Video Pro: keyframes anchors and continuations on the route", () => {
  it("a keyframes run holds its worst-case anchors (marked up at the fee id) and signs their unit", async () => {
    const { routedRunPricing } = await import("../video-route-admission.js")
    const { rowlessRouteTokenOf } = await import("../../../lib/video-route-decision.js")
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate" } }) }
    const priced = await routedRunPricing({ service: "generate-video-pro", provider: "seedance-2-5", resolution: "720p", segmentDurations: [8, 8], tailSec: 0, feeBase: 10, feeId: "generate-video-pro", anchors: { reserveBase: 120, count: 4 } })
    expect(priced).toMatchObject({ feeChargedCredits: 10, anchorChargedCredits: 120, reserveChargedCredits: 10 + 120 + 200 })
    expect(rowlessRouteTokenOf(priced!.quote)).toMatchObject({ anchorUnitBase: 30, anchorsMax: 4 })
  })

  it("a continuation is quoted on the route for exactly the segments it re-renders (extend: each after the first with its tail)", async () => {
    const { routedContinuationPricing } = await import("../video-route-admission.js")
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "default", services: { "generate-video-pro": "alternate" } } }) }
    const priced = await routedContinuationPricing({ provider: "seedance-2-5", resolution: "720p", segmentDurations: [10, 9, 8], tailSec: 2 }, { feeBase: 10, tailSec: 2, billFromSegment: 2 })
    expect(priced).toMatchObject({ segmentChargedCredits: [100, 100], reserveChargedCredits: 210 })
    expect(quote.mock.calls.map((c) => (c[0] as { outputSec?: number; referenceVideoDurationsSec?: number[] }).referenceVideoDurationsSec)).toEqual([[2], [2]])
    // A keyframes scene set: only its members, each from its own anchors (no reference).
    quote.mockClear()
    await routedContinuationPricing({ provider: "seedance-2-5", resolution: "720p", segmentDurations: [10, 9, 8], renderMethod: "keyframes" }, { feeBase: 10, billSegments: [1, 3] })
    expect(quote.mock.calls.map((c) => (c[0] as { outputSec?: number }).outputSec)).toEqual([10, 8])
    // Not routed for the service: the default pricing stands.
    h.settings = { ...h.settings, video_route_policy: routed({ "seedance-2-5": { route: "alternate", services: { "generate-video-pro": "default" } } }) }
    expect(await routedContinuationPricing({ provider: "seedance-2-5", resolution: "720p", segmentDurations: [10, 9], tailSec: 2 }, { feeBase: 10, billFromSegment: 2 })).toBeUndefined()
  })
})
