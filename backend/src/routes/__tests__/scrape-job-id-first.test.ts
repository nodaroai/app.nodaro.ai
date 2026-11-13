// The background scrapes' routes since their work moved to the video worker
// (handlers/background-scrape.ts): a request answered with a job id inserts,
// reserves, enqueues the scrape's worker job under its job type and answers
// `{ jobId, status: "pending" }` at once; the worker job settles exactly as the
// route used to in-process. The synchronous mode of web-scrape and
// meta-ads-scrape still runs in the request, under the slot its laneGuard took.
import Fastify, { type FastifyInstance } from "fastify"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ConcurrencyGate } from "../../lib/concurrency-lanes/gate.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "../../lib/concurrency-lanes/__tests__/fake-lane-redis.js"

const h = vi.hoisted(() => ({
  gate: null as unknown,
  added: [] as Array<{ name: string; data: Record<string, unknown> }>,
  /** Run the enqueued job's real handler (as the worker does), or only record it. */
  runInline: false,
  runs: [] as Array<Promise<void>>,
  inserted: [] as Array<Record<string, unknown>>,
  holds: [] as unknown[],
  completed: vi.fn(async (..._a: unknown[]) => true),
  completedDetailed: vi.fn(async (..._a: unknown[]) => "completed"),
  commitJobCredits: vi.fn(async (..._a: unknown[]) => undefined),
  failed: vi.fn(async (..._a: unknown[]) => true),
  commit: vi.fn(async (..._a: unknown[]) => undefined),
  refund: vi.fn(async (..._a: unknown[]) => 0),
  runScraper: vi.fn(),
  runMetaAds: vi.fn(),
  runCapture: vi.fn(),
  runInstagram: vi.fn(),
  storeLocal: vi.fn(),
}))

vi.mock("../../lib/concurrency-lanes/instance.js", () => ({ concurrencyGate: () => h.gate }))
vi.mock("../../lib/concurrency-lanes/sizes.js", () => ({
  laneSizesFor: async () => ({ provider: 1, llm: 2, local: 1, run: 1 }),
  laneSettings: async () => ({ queueTimeoutMs: 3_600_000, liveWaitLimitMs: 600_000 }),
}))
vi.mock("../../lib/queue.js", () => ({
  videoQueue: {
    add: vi.fn(async (name: string, data: Record<string, unknown>) => {
      // Through JSON, as BullMQ stores it.
      const payload = JSON.parse(JSON.stringify(data)) as Record<string, unknown>
      h.added.push({ name, data: payload })
      if (h.runInline) {
        const { backgroundScrapeHandlers } = await import("../../workers/handlers/background-scrape.js")
        const ctx = { jobId: String(payload.jobId), jobUserId: String(payload.userId), usageLogId: payload.usageLogId as string | undefined, shouldWatermark: false }
        h.runs.push(backgroundScrapeHandlers[name]!({ id: "bull-1", name, data: payload } as never, ctx))
      }
      return { id: "bull-1" }
    }),
  },
}))
vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: () => async () => undefined,
  reserveCreditsForJob: vi.fn(async () => ({ usageLogId: "usage-1" })),
}))
vi.mock("../../middleware/rate-limit.js", () => ({ rateLimiter: () => async () => undefined }))
vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        h.inserted.push(row)
        return { select: () => ({ single: () => ({ data: { id: "job-1" }, error: null }) }) }
      },
    }),
  },
}))
vi.mock("../../workers/shared.js", () => ({ markJobCompleted: h.completed, markJobCompletedDetailed: h.completedDetailed, commitJobCredits: h.commitJobCredits }))
vi.mock("../../lib/job-failure.js", () => ({ markJobFailed: h.failed, markJobFailedDetailed: async (...args: unknown[]) => ((await h.failed(...args)) ? "flipped" : "missed") }))
vi.mock("../../lib/app-reports.js", () => ({ insertAppReport: vi.fn().mockResolvedValue(true) }))
vi.mock("../../lib/credits-job-lifecycle.js", () => ({ commitReservedCreditsForJob: h.commit, refundReservedCreditsForJob: h.refund, refundJobHoldsConfirmed: async (id: string) => (await h.refund(id), true) }))
vi.mock("../../providers/nodaro/run-on-cloud.js", () => ({ shouldRunOnCloud: async () => false }))
vi.mock("../../providers/apify/scraper.js", () => ({ runScraper: h.runScraper }))
vi.mock("../../providers/apify/meta-ads.js", () => ({ runMetaAdsScrape: h.runMetaAds }))
vi.mock("../../providers/apify/instagram.js", () => ({ runInstagramScrape: h.runInstagram }))
vi.mock("../../providers/apify/site-capture.js", () => {
  class SiteCaptureError extends Error {}
  return { SiteCaptureError, runSiteCapture: h.runCapture }
})
vi.mock("../../lib/site-capture-store.js", () => {
  class CaptureStorageFullError extends Error {}
  return { CaptureStorageFullError, storeLocalCapture: h.storeLocal, restoreRelayCapture: vi.fn(), deleteCaptureAssets: vi.fn(async () => undefined) }
})
vi.mock("../../lib/site-capture-robots.js", () => ({ checkRobots: async () => "allowed" }))
vi.mock("../../lib/storage.js", async (importOriginal) => ({ ...(await importOriginal<object>()), isStorageConfigured: () => true }))
const passMedia = (key: "ads" | "posts") => vi.fn(async (items: Array<Record<string, unknown>>) => ({
  [key]: items.map((i) => ({ ...i, format: "unknown", creatives: [] })),
  stats: { classified: 0, stored: 0, videosStored: 0, kept: items.length, filteredOut: 0 },
}))
vi.mock("../../lib/meta-ads-media.js", () => ({ classifyAndStoreMetaAdsMedia: passMedia("ads"), metaAdsWithoutMedia: (a: unknown[]) => a }))
vi.mock("../../lib/instagram-media.js", () => ({ classifyAndStoreInstagramMedia: passMedia("posts"), instagramWithoutMedia: (p: unknown[]) => p }))
vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/config.js")>()
  return {
    ...actual,
    llmMeteredPricing: () => false,
    config: new Proxy(actual.config, { get: (t, p, r) => (p === "APIFY_API_TOKEN" ? "apify-key" : Reflect.get(t, p, r)) }),
  }
})

const { installLaneRequestScope, laneOfRoute } = await import("../../lib/concurrency-lanes/request-scope.js")
const { currentConcurrencyHold } = await import("../../lib/concurrency-lanes/hold.js")
const { webScrapeRoutes } = await import("../web-scrape.js")
const { metaAdsScrapeRoutes } = await import("../meta-ads-scrape.js")
const { siteCaptureRoutes } = await import("../site-capture.js")
const { instagramScrapeRoutes } = await import("../instagram-scrape.js")
const { settleSiteCapture } = await import("../../lib/background-scrape/site-capture.js")
const { settleInstagramScrape } = await import("../../lib/background-scrape/instagram.js")
const { workerScrapeLog } = await import("../../lib/background-scrape/common.js")
const { scrapeRunTracker } = await import("../../lib/background-scrape/scrape-run.js")

const BILLING = { payer: "user", userId: "u1" }

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify()
  installLaneRequestScope(app)
  app.addHook("preHandler", async (req, reply) => {
    req.raw.setTimeout = (() => {}) as never
    reply.raw.setTimeout = (() => {}) as never
    ;(req as unknown as { userId: string }).userId = "u1"
    ;(req as unknown as { billingContext: unknown }).billingContext = BILLING
  })
  await app.register(webScrapeRoutes)
  await app.register(metaAdsScrapeRoutes)
  await app.register(siteCaptureRoutes)
  await app.register(instagramScrapeRoutes)
  await app.ready()
  return app
}

const BODIES = {
  "/v1/web-scrape": { actor: "google-search", query: "running shoes" },
  "/v1/meta-ads-scrape": { mode: "search", query: "nike", count: 10 },
  "/v1/site-capture": { url: "https://example.com/" },
  "/v1/instagram-scrape": { mode: "profile", targets: ["nike"], count: 20 },
} as const
const JOB_TYPE_OF = {
  "/v1/web-scrape": "web-scrape",
  "/v1/meta-ads-scrape": "meta-ads-scrape",
  "/v1/site-capture": "site-capture",
  "/v1/instagram-scrape": "instagram-scrape",
} as const
type Url = keyof typeof BODIES
const URLS = Object.keys(BODIES) as Url[]
/** The two with a synchronous mode answer with a job id only when asked to. */
const jobIdFirstBody = (url: Url): Record<string, unknown> =>
  url === "/v1/web-scrape" || url === "/v1/meta-ads-scrape" ? { ...BODIES[url], respondAsync: true } : { ...BODIES[url] }

const AD = { adArchiveId: "1", title: "Just do it", text: "Shoes", images: ["https://cdn/i.jpg"], videos: [], videoPreviews: [] }
const POST = { postId: "1", shortCode: "AbC", caption: "just do it", images: ["https://cdn/i.jpg"], videos: [], videoPreviews: [] }
const CAPTURE_OUTPUT = { pageUrl: "https://example.com/", stills: [], usableStills: 0 }

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  h.gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(makeFakeLaneStore()) })
  h.added.length = 0
  h.inserted.length = 0
  h.holds.length = 0
  h.runs.length = 0
  h.runInline = false
  h.runScraper.mockImplementation(async () => { h.holds.push(currentConcurrencyHold()); return { json: [{ title: "T", url: "u" }] } })
  h.runMetaAds.mockImplementation(async () => { h.holds.push(currentConcurrencyHold()); return { json: [AD] } })
  h.runInstagram.mockResolvedValue({ json: [POST] })
  h.runCapture.mockResolvedValue({ raw: true, deleteStorages: async () => undefined })
  h.storeLocal.mockResolvedValue({ output: CAPTURE_OUTPUT, assetIds: ["a1"] })
  app = await buildApp()
})

const post = (url: Url, payload: Record<string, unknown>) => app.inject({ method: "POST", url, payload })

/** What reached the job's settlement funnels, in a comparable form. */
function settlement(): Record<string, unknown> {
  return {
    completed: h.completed.mock.calls,
    completedDetailed: h.completedDetailed.mock.calls,
    commitJobCredits: h.commitJobCredits.mock.calls,
    failed: h.failed.mock.calls,
    commit: h.commit.mock.calls,
    refund: h.refund.mock.calls,
  }
}

function resetSettlement(): void {
  for (const f of [h.completed, h.completedDetailed, h.commitJobCredits, h.failed, h.commit, h.refund]) f.mockClear()
}

describe("a request answered with a job id", () => {
  it("a job-id-first scrape answers pending at once and enqueues a worker job", async () => {
    for (const url of URLS) {
      h.added.length = 0
      const gate = h.gate as ConcurrencyGate
      const acquire = vi.spyOn(gate, "acquire")
      const res = await post(url, jobIdFirstBody(url))
      expect(res.statusCode, url).toBe(200)
      expect(res.json(), url).toEqual({ jobId: "job-1", status: "pending" })
      expect(h.added, url).toHaveLength(1)
      expect(h.added[0]!.data, url).toMatchObject({ jobId: "job-1", userId: "u1", billingContext: BILLING, usageLogId: "usage-1" })
      // Nothing ran in the request: no provider call, no slot taken there.
      expect(acquire, url).not.toHaveBeenCalled()
      acquire.mockRestore()
    }
    expect(h.runScraper).not.toHaveBeenCalled()
    expect(h.runMetaAds).not.toHaveBeenCalled()
    expect(h.runCapture).not.toHaveBeenCalled()
    expect(h.runInstagram).not.toHaveBeenCalled()
    expect(h.completed).not.toHaveBeenCalled()
    expect(h.completedDetailed).not.toHaveBeenCalled()
  })

  it("each moved job keeps its job_type: the worker job is named the type its row is inserted with", async () => {
    for (const url of URLS) {
      h.added.length = 0
      h.inserted.length = 0
      await post(url, jobIdFirstBody(url))
      const row = h.inserted[0]!
      expect(h.added[0]!.name, url).toBe(JOB_TYPE_OF[url])
      expect(row.job_type, url).toBe(JOB_TYPE_OF[url])
      expect((row.input_data as { type: string }).type, url).toBe(JOB_TYPE_OF[url])
    }
  })

  it("takes the server-only fields from the server, never from the client body", async () => {
    const forged = {
      userId: "someone-else", billingContext: { payer: "workspace", workspaceId: "w-x", userId: "someone-else" },
      usageLogId: "forged-log", runner: "relay", viaCloud: true, analysisHold: { usageLogId: "x", chargeId: "y", fixedCharged: 0, llmHoldCredits: 0, holdCredits: 0 },
      resolvedPageUrls: ["https://www.facebook.com/forged"], sources: 99, jobId: "forged-job",
    }
    for (const url of URLS) {
      h.added.length = 0
      await post(url, { ...jobIdFirstBody(url), ...forged })
      const data = h.added[0]!.data
      expect(data, url).toMatchObject({ jobId: "job-1", userId: "u1", billingContext: BILLING, usageLogId: "usage-1" })
      expect(data.analysisHold, url).toBeUndefined()
      if ("viaCloud" in data) expect(data.viaCloud, url).toBe(false)
      if ("runner" in data) expect(data.runner, url).toBe("keyed")
      if ("sources" in data) expect(data.sources, url).toBe(1)
      if ("resolvedPageUrls" in data) expect(data.resolvedPageUrls, url).toEqual([])
      // The validated body carries none of them either.
      for (const k of Object.keys(forged)) expect(data.body as object, `${url} body.${k}`).not.toHaveProperty(k)
    }
  })

  it("an enqueue that fails fails the job, refunds it and answers a sanitized 500 — nothing is left waiting", async () => {
    const { videoQueue } = await import("../../lib/queue.js")
    for (const url of URLS) {
      resetSettlement()
      vi.mocked(videoQueue.add).mockRejectedValueOnce(new Error("Connection is closed."))
      const res = await post(url, jobIdFirstBody(url))
      expect(res.statusCode, url).toBe(500)
      expect(res.json().error.code, url).toBe("internal_error")
      // The shared rule (lib/enqueue-route-job.ts): failed from pending with its key released, refunded confirmed.
      expect(h.failed, url).toHaveBeenCalledWith("job-1", expect.objectContaining({ from: ["pending"], extra: { idempotency_key: null } }))
      expect(h.refund, url).toHaveBeenCalledWith("job-1")
    }
  })
})

describe("the worker job settles as the request used to", () => {
  it("web-scrape: the same result and charge as its in-request settle", async () => {
    for (const fails of [false, true]) {
      if (fails) h.runScraper.mockRejectedValue(new Error("Too many requests"))
      resetSettlement()
      const sync = await post("/v1/web-scrape", { ...BODIES["/v1/web-scrape"] })
      const inRequest = settlement()
      // Not vacuous: the in-request run settled (completed + committed, or failed + refunded).
      expect(h.completed).toHaveBeenCalledTimes(fails ? 0 : 1)
      expect(fails ? h.refund : h.commit).toHaveBeenCalledWith("job-1")
      resetSettlement()
      h.runInline = true
      const answered = await post("/v1/web-scrape", jobIdFirstBody("/v1/web-scrape"))
      await Promise.all(h.runs)
      h.runInline = false
      expect(answered.json()).toEqual({ jobId: "job-1", status: "pending" })
      expect(settlement(), `fails=${fails}`).toEqual(inRequest)
      expect(sync.statusCode).toBe(fails ? 502 : 200)
    }
  })

  it("meta-ads-scrape: the same result and charge as its in-request settle", async () => {
    for (const fails of [false, true]) {
      if (fails) h.runMetaAds.mockRejectedValue(new Error("actor failed"))
      resetSettlement()
      const sync = await post("/v1/meta-ads-scrape", { ...BODIES["/v1/meta-ads-scrape"] })
      const inRequest = settlement()
      // Not vacuous: the in-request run settled (completed + committed, or failed + refunded).
      expect(h.completed).toHaveBeenCalledTimes(fails ? 0 : 1)
      expect(fails ? h.refund : h.commit).toHaveBeenCalledWith("job-1")
      resetSettlement()
      h.runInline = true
      const answered = await post("/v1/meta-ads-scrape", jobIdFirstBody("/v1/meta-ads-scrape"))
      await Promise.all(h.runs)
      h.runInline = false
      expect(answered.json()).toEqual({ jobId: "job-1", status: "pending" })
      expect(settlement(), `fails=${fails}`).toEqual(inRequest)
      expect(sync.statusCode).toBe(fails ? 502 : 200)
    }
  })

  it("site-capture: the worker job settles exactly as its settle run in the request would", async () => {
    resetSettlement()
    await settleSiteCapture({ jobId: "job-1", userId: "u1", runner: "keyed", body: { url: "https://example.com/", maxStills: 8 }, usageLogId: "usage-1", runs: scrapeRunTracker("job-1"), log: workerScrapeLog })
    const inRequest = settlement()
    expect(h.completedDetailed).toHaveBeenCalledWith("job-1", { output_data: CAPTURE_OUTPUT })
    expect(h.commit).toHaveBeenCalledWith("job-1")
    resetSettlement()
    h.runInline = true
    await post("/v1/site-capture", jobIdFirstBody("/v1/site-capture"))
    await Promise.all(h.runs)
    expect(settlement()).toEqual(inRequest)
  })

  it("instagram-scrape: the worker job settles exactly as its settle run in the request would", async () => {
    resetSettlement()
    await settleInstagramScrape({
      jobId: "job-1", userId: "u1", usageLogId: "usage-1", startedAt: Date.now(), runs: scrapeRunTracker("job-1"), log: workerScrapeLog,
      body: { mode: "profile", targets: ["nike"], count: 20, period: "30d" }, viaCloud: false, requestedCount: 20, sources: 1,
      analysisTier: null, analysisModel: "unused",
    })
    const inRequest = settlement()
    expect(h.completed).toHaveBeenCalledTimes(1)
    expect(h.commit).toHaveBeenCalledWith("job-1")
    resetSettlement()
    h.runInline = true
    await post("/v1/instagram-scrape", jobIdFirstBody("/v1/instagram-scrape"))
    await Promise.all(h.runs)
    expect(settlement()).toEqual(inRequest)
  })
})

describe("lanes at the routes", () => {
  it("the synchronous mode of web-scrape and meta-ads-scrape still runs in the request under laneGuard", async () => {
    expect(laneOfRoute("/v1/web-scrape")).toBe("provider")
    expect(laneOfRoute("/v1/meta-ads-scrape")).toBe("provider")
    for (const url of ["/v1/web-scrape", "/v1/meta-ads-scrape"] as const) {
      h.added.length = 0
      h.holds.length = 0
      const res = await post(url, { ...BODIES[url] })
      expect(res.statusCode, url).toBe(200)
      expect(res.json().jobId, url).toBe("job-1")
      expect(h.added, url).toEqual([]) // no worker job
      // The provider call ran under the provider slot the request took.
      expect(h.holds[0], url).toMatchObject({ lane: "provider", userId: "u1", leaseId: expect.any(String) })
    }
  })

  it("site-capture and instagram-scrape have no laneGuard and always enqueue a worker job", async () => {
    expect(laneOfRoute("/v1/site-capture")).toBeNull()
    expect(laneOfRoute("/v1/instagram-scrape")).toBeNull()
    for (const url of ["/v1/site-capture", "/v1/instagram-scrape"] as const) {
      for (const extra of [{}, { respondAsync: true }, { respondAsync: false }]) {
        h.added.length = 0
        const res = await post(url, { ...BODIES[url], ...extra })
        expect(res.json(), `${url} ${JSON.stringify(extra)}`).toEqual({ jobId: "job-1", status: "pending" })
        expect(h.added.map((a) => a.name)).toEqual([JOB_TYPE_OF[url]])
      }
    }
  })
})
