// The background scrapes' video-worker handlers (handlers/background-scrape.ts):
// each runs its scrape's own settle with the payload its route enqueued, and
// nothing else. What a settle does is the route suites' (they run the real
// handler through the queue stand-in) and scrape-job-id-first.test.ts's.
import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({ updates: [] as Array<Record<string, unknown>> }))
vi.mock("../../../lib/supabase.js", () => ({
  supabase: { from: () => ({ update: (f: Record<string, unknown>) => { db.updates.push(f); return { eq: async () => ({ error: null }) } } }) },
}))
const settles = vi.hoisted(() => ({
  web: vi.fn(async (..._a: unknown[]) => ({ ok: true, result: {} })),
  capture: vi.fn(async (..._a: unknown[]) => undefined),
  metaAds: vi.fn(async (..._a: unknown[]) => ({ ok: true, result: {} })),
  instagram: vi.fn(async (..._a: unknown[]) => undefined),
}))
vi.mock("../../../lib/background-scrape/web-scrape.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/background-scrape/web-scrape.js")>()),
  settleWebScrape: settles.web,
}))
vi.mock("../../../lib/background-scrape/site-capture.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/background-scrape/site-capture.js")>()),
  settleSiteCapture: settles.capture,
}))
vi.mock("../../../lib/background-scrape/meta-ads.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/background-scrape/meta-ads.js")>()),
  settleMetaAdsScrape: settles.metaAds,
}))
vi.mock("../../../lib/background-scrape/instagram.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/background-scrape/instagram.js")>()),
  settleInstagramScrape: settles.instagram,
}))

const { backgroundScrapeHandlers } = await import("../background-scrape.js")
const { workerScrapeLog } = await import("../../../lib/background-scrape/common.js")
const { isDeterministicJobError } = await import("../../../lib/deterministic-job-error.js")
const { META_ADS_SCRAPE_NODE_TYPE, INSTAGRAM_SCRAPE_NODE_TYPE } = await import("@nodaro/shared/social")

const ctx = { jobId: "job-1", jobUserId: "u1", usageLogId: "usage-1", shouldWatermark: false }
const job = (name: string, data: Record<string, unknown>) => ({ id: "bull-1", name, data }) as never

const HOLD = { usageLogId: "usage-1", chargeId: "meta-ads-analysis:m", fixedCharged: 20, llmHoldCredits: 30, holdCredits: 50 }

beforeEach(() => {
  vi.clearAllMocks()
  db.updates.length = 0
})

/** The run tracker a settle was handed. */
const runsOf = (settle: { mock: { calls: unknown[][] } }) => (settle.mock.calls[0]![0] as { runs: import("../../../lib/background-scrape/scrape-run.js").ScrapeRunTracker }).runs

describe("background scrape handlers", () => {
  it("are named exactly their job types — the node types their rows are inserted with", () => {
    expect(Object.keys(backgroundScrapeHandlers).sort()).toEqual(
      ["web-scrape", "site-capture", META_ADS_SCRAPE_NODE_TYPE, INSTAGRAM_SCRAPE_NODE_TYPE].sort(),
    )
    expect(META_ADS_SCRAPE_NODE_TYPE).toBe("meta-ads-scrape")
    expect(INSTAGRAM_SCRAPE_NODE_TYPE).toBe("instagram-scrape")
  })

  it("each is data, not media, re-attaches to its saved run, ignores quiet stop and counts in the scrape capacity", () => {
    for (const [name, handler] of Object.entries(backgroundScrapeHandlers)) {
      const { outputIsData, resumesProviderTask, ignoresQuietStop, capacityGroup } = handler
      expect({ outputIsData, resumesProviderTask, ignoresQuietStop, capacityGroup }, name).toEqual({
        outputIsData: true, resumesProviderTask: true, ignoresQuietStop: true, capacityGroup: "scrape",
      })
    }
  })

  it("web-scrape runs its settle with the enqueued body and reservation, on the worker's log", async () => {
    const body = { actor: "google-search", query: "ai" }
    await backgroundScrapeHandlers["web-scrape"]!(job("web-scrape", { jobId: "job-1", userId: "u1", usageLogId: "usage-1", body }), ctx)
    expect(settles.web).toHaveBeenCalledWith({ jobId: "job-1", usageLogId: "usage-1", body, runs: expect.anything(), log: workerScrapeLog })
    expect(runsOf(settles.web).savedKind).toBeUndefined()
  })

  it("site-capture runs its settle with the runner its route resolved", async () => {
    const body = { url: "https://example.com/", maxStills: 8 }
    await backgroundScrapeHandlers["site-capture"]!(job("site-capture", { jobId: "job-1", userId: "u1", usageLogId: "usage-1", body, runner: "relay" }), ctx)
    expect(settles.capture).toHaveBeenCalledWith({ jobId: "job-1", userId: "u1", runner: "relay", body, usageLogId: "usage-1", runs: expect.anything(), log: workerScrapeLog })
  })

  it("meta-ads-scrape runs its settle with the route's plan; its deadline counts from the run, not from the request", async () => {
    const plan = {
      body: { mode: "pages", pageUrls: ["https://www.facebook.com/nike"], count: 10 },
      viaCloud: false, resolvedPageUrls: ["https://www.facebook.com/nike"], resolvedAdvertisers: [], sources: 1,
      analysisTier: "standard", analysisModel: "m", analysisHold: HOLD,
    }
    const before = Date.now()
    await backgroundScrapeHandlers[META_ADS_SCRAPE_NODE_TYPE]!(job(META_ADS_SCRAPE_NODE_TYPE, { jobId: "job-1", userId: "u1", usageLogId: "usage-1", ...plan }), ctx)
    const input = settles.metaAds.mock.calls[0]![0] as Record<string, unknown>
    expect(input).toMatchObject({ ...plan, jobId: "job-1", userId: "u1", usageLogId: "usage-1", log: workerScrapeLog })
    expect(input.startedAt).toBeGreaterThanOrEqual(before)
  })

  it("instagram-scrape runs its settle with the route's plan; its deadline counts from the run", async () => {
    const plan = {
      body: { mode: "profile", targets: ["nike"], count: 20, period: "30d" },
      viaCloud: false, requestedCount: 20, sources: 1, analysisTier: null, analysisModel: "m",
    }
    const before = Date.now()
    await backgroundScrapeHandlers[INSTAGRAM_SCRAPE_NODE_TYPE]!(job(INSTAGRAM_SCRAPE_NODE_TYPE, { jobId: "job-1", userId: "u1", usageLogId: "usage-1", ...plan }), ctx)
    const input = settles.instagram.mock.calls[0]![0] as Record<string, unknown>
    expect(input).toMatchObject({ ...plan, jobId: "job-1", userId: "u1", usageLogId: "usage-1", log: workerScrapeLog })
    expect(input.startedAt).toBeGreaterThanOrEqual(before)
  })

  it("a payload that is not this job's own background scrape is refused for good, and nothing runs", async () => {
    const bad: Array<Record<string, unknown>> = [
      { jobId: "another-job", userId: "u1", body: { actor: "rss", url: "https://e.com/f" } },
      { jobId: "job-1", body: { actor: "rss", url: "https://e.com/f" } },
      { jobId: "job-1", userId: "u1" },
    ]
    for (const name of Object.keys(backgroundScrapeHandlers)) {
      for (const data of bad) {
        const err = await backgroundScrapeHandlers[name]!(job(name, data), ctx).then(() => null, (e: unknown) => e)
        expect(isDeterministicJobError(err), `${name} ${JSON.stringify(data)}`).toBe(true)
      }
    }
    for (const s of Object.values(settles)) expect(s).not.toHaveBeenCalled()
  })

  it("refuses a payload whose user or reservation disagrees with its row; a row that could not be read is a plain (retryable) failure", async () => {
    const body = { actor: "google-search", query: "ai" }
    const refused: Array<[Record<string, unknown>, typeof ctx]> = [
      [{ jobId: "job-1", userId: "someone-else", usageLogId: "usage-1", body }, ctx],
      [{ jobId: "job-1", userId: "u1", usageLogId: "another-log", body }, ctx],
      [{ jobId: "job-1", userId: "u1", body }, ctx], // the row reserved, the payload names none
    ]
    for (const [data, c] of refused) {
      const err = await backgroundScrapeHandlers["web-scrape"]!(job("web-scrape", data), c).then(() => null, (e: unknown) => e)
      expect(isDeterministicJobError(err), JSON.stringify(data)).toBe(true)
    }
    // No credits (community): the payload and the row both name no reservation.
    await backgroundScrapeHandlers["web-scrape"]!(job("web-scrape", { jobId: "job-1", userId: "u1", body }), { ...ctx, usageLogId: null })
    expect(settles.web).toHaveBeenCalledTimes(1)
    const unread = await backgroundScrapeHandlers["web-scrape"]!(job("web-scrape", { jobId: "job-1", userId: "u1", usageLogId: "usage-1", body }), { ...ctx, jobUserId: undefined })
      .then(() => null, (e: unknown) => e)
    expect(unread).toBeInstanceOf(Error)
    expect(isDeterministicJobError(unread)).toBe(false)
  })

  it("a re-picked job re-attaches to the run its row saved, and restarts that row's staleness clock", async () => {
    const body = { actor: "google-search", query: "ai" }
    await backgroundScrapeHandlers["web-scrape"]!(
      job("web-scrape", { jobId: "job-1", userId: "u1", usageLogId: "usage-1", body }),
      { ...ctx, providerTask: { kind: "nodaro-cloud", id: "cloud-9" } },
    )
    const runs = runsOf(settles.web)
    expect(runs.savedKind).toBe("nodaro-cloud")
    expect(runs.resumeIdFor("nodaro-cloud")).toBe("cloud-9")
    expect(() => runs.resumeIdFor("apify-run")).toThrow(/already started a run/)
    expect(db.updates).toEqual([{ provider_call_started_at: expect.any(String) }])
  })

  it("a saved task of a kind no scrape starts is refused, never run again", async () => {
    const err = await backgroundScrapeHandlers["web-scrape"]!(
      job("web-scrape", { jobId: "job-1", userId: "u1", usageLogId: "usage-1", body: { actor: "google-search", query: "ai" } }),
      { ...ctx, providerTask: { kind: "kie-standard", id: "task-1" } },
    ).then(() => null, (e: unknown) => e)
    expect(isDeterministicJobError(err)).toBe(true)
    expect(settles.web).not.toHaveBeenCalled()
  })
})
