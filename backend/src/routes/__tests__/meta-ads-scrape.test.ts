import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"

vi.mock("../../providers/apify/meta-ads.js", () => ({
  runMetaAdsScrape: vi.fn(),
}))
const advertiserMocks = vi.hoisted(() => ({
  searchMetaAdvertisers: vi.fn(),
}))
vi.mock("../../providers/apify/meta-ads-advertisers.js", () => ({
  searchMetaAdvertisers: advertiserMocks.searchMetaAdvertisers,
}))
// Media classify/store is a separate, deadlined step (lib/meta-ads-media);
// here it is a pass-through that tags every ad so the route's assembly can
// be asserted without sharp / R2.
const mediaMocks = vi.hoisted(() => ({
  classifyAndStoreMetaAdsMedia: vi.fn(async (ads: Array<Record<string, unknown>>) => ({
    ads: ads.map((ad) => ({ ...ad, format: "unknown", creatives: [] })),
    stats: { classified: 0, stored: 0, videosStored: 0, kept: ads.length, filteredOut: 0 },
  })),
}))
vi.mock("../../lib/meta-ads-media.js", () => ({
  classifyAndStoreMetaAdsMedia: mediaMocks.classifyAndStoreMetaAdsMedia,
  metaAdsWithoutMedia: (ads: Array<Record<string, unknown>>) => ads.map((ad) => ({ ...ad, format: "unknown", creatives: [] })),
}))
const creditMocks = vi.hoisted(() => ({
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1" }),
  guardIds: [] as string[],
}))
vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: (resolve: (req: unknown) => string) => async (req: unknown) => {
    creditMocks.guardIds.push(resolve(req))
  },
  reserveCreditsForJob: creditMocks.reserveCreditsForJob,
}))
vi.mock("../../lib/credits-job-lifecycle.js", () => ({
  commitReservedCreditsForJob: vi.fn(),
  refundReservedCreditsForJob: vi.fn(),
}))
const jobMocks = vi.hoisted(() => ({
  markJobCompleted: vi.fn(async () => true),
  markJobFailed: vi.fn(async () => true),
}))
vi.mock("../../workers/shared.js", () => ({ markJobCompleted: jobMocks.markJobCompleted }))
vi.mock("../../lib/job-failure.js", () => ({ markJobFailed: jobMocks.markJobFailed }))
const cloudMocks = vi.hoisted(() => ({
  shouldRunOnCloud: vi.fn(async () => false),
  // The advertiser lookup is a short, held call; the scrape itself asks the
  // cloud for a job id and polls it.
  callCloudRoute: vi.fn(),
  createCloudJob: vi.fn(),
  waitForCloudJob: vi.fn(),
}))
vi.mock("../../providers/nodaro/run-on-cloud.js", () => ({ shouldRunOnCloud: cloudMocks.shouldRunOnCloud }))
vi.mock("../../providers/nodaro/client.js", () => ({
  callCloudRoute: cloudMocks.callCloudRoute,
  createCloudJob: cloudMocks.createCloudJob,
  waitForCloudJob: cloudMocks.waitForCloudJob,
}))
// The video queue: the route enqueues the scrape's worker job, and this
// stand-in runs the real handler at once, as the worker does with lanes off.
vi.mock("../../lib/queue.js", async () => ({ videoQueue: (await import("./helpers/inline-scrape-worker.js")).inlineScrapeQueue }))
vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      insert: () => ({ select: () => ({ single: () => ({ data: { id: "job-1" }, error: null }) }) }),
      update: () => {
        // The relay saves its cloud job (a CAS: .eq().is().in().select()); any other write awaits .eq().
        const c: Record<string, unknown> = { eq: () => c, is: () => c, in: () => c, select: async () => ({ data: [{ id: "job-1" }], error: null }), then: (ok: (v: unknown) => unknown) => ok({ error: null }) }
        return c
      },
    }),
  },
}))

async function buildTestApp() {
  const { metaAdsScrapeRoutes } = await import("../meta-ads-scrape.js")
  const app = Fastify()
  app.addHook("preHandler", async (req, reply) => {
    req.raw.setTimeout = (() => {}) as never
    reply.raw.setTimeout = (() => {}) as never
    ;(req as unknown as { userId: string }).userId = "u1"
  })
  await app.register(metaAdsScrapeRoutes)
  return app
}

const AD = { adArchiveId: "1", pageName: "Nike", title: "Air Max", text: "Just do it.", images: ["https://img/1.jpg"], videos: [], videoPreviews: [] }
const AD_OUT = { ...AD, format: "unknown", creatives: [] }

describe("POST /v1/meta-ads-scrape", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    creditMocks.guardIds.length = 0
    cloudMocks.shouldRunOnCloud.mockResolvedValue(false)
    jobMocks.markJobCompleted.mockResolvedValue(true)
    jobMocks.markJobFailed.mockResolvedValue(true)
  })

  it("search happy path: defaults applied, provider called with the parsed body, json echoed with the local job id", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [AD] } as never)
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "search", query: "running shoes" },
    })
    expect(res.statusCode).toBe(200)
    expect(runMetaAdsScrape).toHaveBeenCalledWith({
      mode: "search", query: "running shoes", count: 20, period: "30d", activeStatus: "active", countryCode: "ALL",
    }, expect.anything())
    // Featured-ad outputs (text / image / video) ride on the response — and
    // therefore on output_data — so the orchestrator's typed handles carry them.
    expect(res.json()).toEqual({
      jobId: "job-1",
      json: [AD_OUT],
      mediaStorage: { classified: 0, stored: 0, videosStored: 0, kept: 1, filteredOut: 0 },
      text: "Air Max\n\nJust do it.",
      imageUrl: "https://img/1.jpg",
    })
    expect(mediaMocks.classifyAndStoreMetaAdsMedia).toHaveBeenCalledWith([AD], expect.objectContaining({
      userId: "u1", jobId: "job-1", storeImages: true, storeFeaturedVideoIndex: undefined, formats: undefined,
    }))
  })

  it("passes the format filter, the featured index and the wired-video flag through to the media step", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [AD, { ...AD, adArchiveId: "2", title: "Second" }] } as never)
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "search", query: "nike", formats: ["vertical", "square"], featuredIndex: 1, ingestVideo: true, ingestAllVideos: true },
    })
    expect(res.statusCode).toBe(200)
    expect(mediaMocks.classifyAndStoreMetaAdsMedia).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      formats: ["vertical", "square"], storeFeaturedVideoIndex: 1, storeAllVideos: true,
    }))
    expect(res.json().text).toBe("Second\n\nJust do it.")
    const bad = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: { mode: "search", query: "nike", formats: ["round"] } })
    expect(bad.statusCode).toBe(400)
  })

  it("a media-step crash never fails the paid scrape: the ads go out with their source urls and the reservation commits", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    const { commitReservedCreditsForJob, refundReservedCreditsForJob } = await import("../../lib/credits-job-lifecycle.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [AD] } as never)
    mediaMocks.classifyAndStoreMetaAdsMedia.mockRejectedValueOnce(new Error("sharp exploded"))
    const app = await buildTestApp()
    const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: { mode: "search", query: "nike" } })
    expect(res.statusCode).toBe(200)
    expect(res.json().json).toEqual([AD_OUT])
    expect(res.json().mediaStorage).toEqual({ classified: 0, stored: 0, videosStored: 0, kept: 1, filteredOut: 0 })
    expect(res.json().imageUrl).toBe("https://img/1.jpg")
    expect(jobMocks.markJobFailed).not.toHaveBeenCalled()
    expect(commitReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(refundReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("a cloud relay classifies but does not store again (the connected account already did)", async () => {
    cloudMocks.shouldRunOnCloud.mockResolvedValue(true)
    cloudMocks.createCloudJob.mockResolvedValue("cloud-job-9")
    cloudMocks.waitForCloudJob.mockResolvedValue({ id: "cloud-job-9", status: "completed", output_data: { json: [AD] } })
    const app = await buildTestApp()
    await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: { mode: "search", query: "nike", ingestVideo: true } })
    expect(mediaMocks.classifyAndStoreMetaAdsMedia).toHaveBeenCalledWith([AD], expect.objectContaining({ storeImages: false, storeFeaturedVideoIndex: undefined }))
  })

  describe("advertiser names → Page urls (advertiser mode driven by the `in` input)", () => {
    const OPENART = { pageId: "615", name: "OpenArt AI", url: "https://www.facebook.com/people/OpenArt-AI/615/", verified: true }
    const NIKE = { pageId: "150", name: "Nike", url: "https://www.facebook.com/nike", verified: true }

    beforeEach(async () => {
      const { _resetAdvertiserLookupMeterForTests } = await import("../meta-ads-scrape.js")
      _resetAdvertiserLookupMeterForTests()
    })

    it("in-scrape name resolution is metered per user — a scrape cannot bypass the daily lookup cap", async () => {
      const { META_ADS_ADVERTISER_LOOKUPS_PER_DAY, takeAdvertiserLookup } = await import("../meta-ads-scrape.js")
      // Exhaust this user's daily lookups, then a scrape whose names would each
      // start an actor run must be refused, not run un-metered.
      for (let i = 0; i < META_ADS_ADVERTISER_LOOKUPS_PER_DAY; i += 1) expect(takeAdvertiserLookup("u1")).toBe(true)
      const app = await buildTestApp()
      const res = await app.inject({
        method: "POST", url: "/v1/meta-ads-scrape",
        payload: { mode: "pages", advertiserNames: ["OpenArt AI", "Nike"], count: 20 },
      })
      expect(res.statusCode).toBe(429)
      expect(res.json().error.code).toBe("rate_limit_exceeded")
      expect(advertiserMocks.searchMetaAdvertisers).not.toHaveBeenCalled()
    })

    it("dedupes repeated names (case-insensitive) — one lookup, one source", async () => {
      const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
      vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [AD] } as never)
      advertiserMocks.searchMetaAdvertisers.mockResolvedValue({ items: [NIKE], cached: false })
      const app = await buildTestApp()
      const res = await app.inject({
        method: "POST", url: "/v1/meta-ads-scrape",
        payload: { mode: "pages", advertiserNames: ["Nike", "nike", "NIKE"], count: 20 },
      })
      expect(res.statusCode).toBe(200)
      expect(advertiserMocks.searchMetaAdvertisers).toHaveBeenCalledTimes(1)
      expect(runMetaAdsScrape).toHaveBeenCalledWith(expect.objectContaining({ pageUrls: [NIKE.url] }), expect.anything())
    })

    it("resolves each name (verified-first), scrapes the resolved Pages, and reports who each name matched", async () => {
      const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
      vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [AD] } as never)
      // First name: a fan page THEN the verified brand → the verified one wins.
      advertiserMocks.searchMetaAdvertisers
        .mockResolvedValueOnce({ items: [{ pageId: "fan", name: "OpenArt Fans", url: "https://www.facebook.com/fans", verified: false }, OPENART], cached: false })
        .mockResolvedValueOnce({ items: [NIKE], cached: true })
      const app = await buildTestApp()
      const res = await app.inject({
        method: "POST", url: "/v1/meta-ads-scrape",
        payload: { mode: "pages", advertiserNames: ["OpenArt AI", "Nike"], count: 30 },
      })
      expect(res.statusCode).toBe(200)
      expect(runMetaAdsScrape).toHaveBeenCalledWith(expect.objectContaining({ pageUrls: [OPENART.url, NIKE.url] }), expect.anything())
      expect(res.json().resolvedAdvertisers).toEqual([
        { name: "OpenArt AI", pageId: "615", url: OPENART.url },
        { name: "Nike", pageId: "150", url: NIKE.url },
      ])
      // 2 sources × 30 → 100 tier.
      expect(creditMocks.reserveCreditsForJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", "meta-ads-scrape:100")
    })

    it("404 advertiser_not_found when no name resolves — no scrape, nothing reserved (resolution precedes the reservation)", async () => {
      const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
      advertiserMocks.searchMetaAdvertisers.mockResolvedValue({ items: [], cached: false })
      const app = await buildTestApp()
      const res = await app.inject({
        method: "POST", url: "/v1/meta-ads-scrape",
        payload: { mode: "pages", advertiserNames: ["zzqx"], count: 20 },
      })
      expect(res.statusCode).toBe(404)
      expect(res.json().error.code).toBe("advertiser_not_found")
      expect(runMetaAdsScrape).not.toHaveBeenCalled()
      expect(creditMocks.reserveCreditsForJob).not.toHaveBeenCalled()
    })

    it("400 when the combined Page urls + advertiser names exceed the source ceiling", async () => {
      const app = await buildTestApp()
      const res = await app.inject({
        method: "POST", url: "/v1/meta-ads-scrape",
        payload: { mode: "pages", pageUrls: ["https://www.facebook.com/a", "https://www.facebook.com/b", "https://www.facebook.com/c"], advertiserNames: ["dd", "ee", "ff"] },
      })
      expect(res.statusCode).toBe(400)
    })
  })

  it("guard (raw body) and reservation (parsed body) resolve the SAME tier", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [] } as never)
    const app = await buildTestApp()
    await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "pages", pageUrls: ["https://www.facebook.com/nike", "facebook.com/adidas"], count: 30 },
    })
    expect(creditMocks.guardIds).toEqual(["meta-ads-scrape:100"]) // 30 × 2 → 100 tier
    expect(creditMocks.reserveCreditsForJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", "meta-ads-scrape:100")
  })

  it("guard and reservation still agree when count is OMITTED (Zod default × sources)", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [] } as never)
    const app = await buildTestApp()
    await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "pages", pageUrls: ["https://www.facebook.com/a", "https://www.facebook.com/b", "https://www.facebook.com/c"] },
    })
    const reservedId = creditMocks.reserveCreditsForJob.mock.calls[0][3]
    expect(reservedId).toBe("meta-ads-scrape:100") // default 20 × 3 pages → 60 → 100 tier
    expect(creditMocks.guardIds).toEqual([reservedId])
  })

  it("pages mode infers the scheme and normalizes the country code", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [] } as never)
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "pages", pageUrls: ["facebook.com/nike"], countryCode: " us ", period: "7d", activeStatus: "all", count: 5 },
    })
    expect(res.statusCode).toBe(200)
    expect(runMetaAdsScrape).toHaveBeenCalledWith(expect.objectContaining({
      pageUrls: ["https://facebook.com/nike"], countryCode: "US", period: "7d", activeStatus: "all", count: 5,
    }), expect.anything())
  })

  it("passes a platform filter through and rejects an unknown platform", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [] } as never)
    const app = await buildTestApp()
    const ok = await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "search", query: "nike", platforms: ["INSTAGRAM", "THREADS"] },
    })
    expect(ok.statusCode).toBe(200)
    expect(runMetaAdsScrape).toHaveBeenCalledWith(expect.objectContaining({ platforms: ["INSTAGRAM", "THREADS"] }), expect.anything())
    const bad = await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "search", query: "nike", platforms: ["TIKTOK"] },
    })
    expect(bad.statusCode).toBe(400)
  })

  it("400 on an empty body", async () => {
    const app = await buildTestApp()
    const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: {} })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("400 when a page url is not on facebook.com", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "pages", pageUrls: ["https://www.instagram.com/nike"] },
    })
    expect(res.statusCode).toBe(400)
    expect(runMetaAdsScrape).not.toHaveBeenCalled()
  })

  it("400 above the count ceiling, above the sources ceiling, or with a bad country code", async () => {
    const app = await buildTestApp()
    const tooMany = await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "search", query: "x", count: 101 },
    })
    expect(tooMany.statusCode).toBe(400)
    const tooManyPages = await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "pages", pageUrls: Array.from({ length: 6 }, (_, i) => `https://www.facebook.com/p${i}`) },
    })
    expect(tooManyPages.statusCode).toBe(400)
    const badCountry = await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "search", query: "x", countryCode: "USA" },
    })
    expect(badCountry.statusCode).toBe(400)
  })

  it("relays to the nodaro.ai connection when the install has no Apify token — same shape, local job id", async () => {
    cloudMocks.shouldRunOnCloud.mockResolvedValue(true)
    cloudMocks.createCloudJob.mockResolvedValue("cloud-job-9")
    cloudMocks.waitForCloudJob.mockResolvedValue({ id: "cloud-job-9", status: "completed", output_data: { json: [AD] } })
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "search", query: "nike" },
    })
    expect(res.statusCode).toBe(200)
    // Job id first, then poll: the cloud sits behind the same ~100 s edge
    // timeout a browser does.
    expect(cloudMocks.createCloudJob).toHaveBeenCalledWith(
      "/v1/meta-ads-scrape",
      expect.objectContaining({ mode: "search", query: "nike", respondAsync: true }), { idempotencyKey: "scrape-relay:job-1" })
    expect(cloudMocks.waitForCloudJob).toHaveBeenCalledWith("cloud-job-9")
    expect(runMetaAdsScrape).not.toHaveBeenCalled()
    expect(res.json().jobId).toBe("job-1")
    expect(res.json().json).toEqual([AD_OUT])
  })

  it("502 + refund (by job id) on a provider error", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    const { commitReservedCreditsForJob, refundReservedCreditsForJob } = await import("../../lib/credits-job-lifecycle.js")
    vi.mocked(runMetaAdsScrape).mockRejectedValue(Object.assign(new Error("The target site blocked the scrape."), { name: "ApifyError" }))
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/meta-ads-scrape",
      payload: { mode: "search", query: "nike" },
    })
    expect(res.statusCode).toBe(502)
    expect(res.json().error).toEqual({ code: "scrape_error", message: "The target site blocked the scrape." })
    expect(jobMocks.markJobFailed).toHaveBeenCalledWith("job-1", expect.objectContaining({ error_message: "The target site blocked the scrape." }))
    expect(refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(commitReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("does NOT refund when the failure CAS missed (the cancel path already refunded)", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    const { refundReservedCreditsForJob } = await import("../../lib/credits-job-lifecycle.js")
    vi.mocked(runMetaAdsScrape).mockRejectedValue(new Error("boom"))
    jobMocks.markJobFailed.mockResolvedValueOnce(false)
    const app = await buildTestApp()
    const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: { mode: "search", query: "nike" } })
    expect(res.statusCode).toBe(502)
    expect(refundReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("commits the reservation (by job id) on success, through the completion funnel", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    const { commitReservedCreditsForJob } = await import("../../lib/credits-job-lifecycle.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [AD] } as never)
    const app = await buildTestApp()
    await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: { mode: "search", query: "nike" } })
    expect(jobMocks.markJobCompleted).toHaveBeenCalledWith("job-1", {
      output_data: expect.objectContaining({ json: [AD_OUT], text: "Air Max\n\nJust do it.", imageUrl: "https://img/1.jpg" }),
    })
    expect(commitReservedCreditsForJob).toHaveBeenCalledWith("job-1")
  })

  it("409 and no commit when the job was cancelled mid-flight (completion CAS lost)", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    const { commitReservedCreditsForJob } = await import("../../lib/credits-job-lifecycle.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [AD] } as never)
    jobMocks.markJobCompleted.mockResolvedValueOnce(false)
    const app = await buildTestApp()
    const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: { mode: "search", query: "nike" } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("job_cancelled")
    expect(commitReservedCreditsForJob).not.toHaveBeenCalled()
  })

  describe("POST /v1/meta-ads-scrape/advertisers (name → Pages, no credits)", () => {
    const OPENART = { pageId: "61562658466287", name: "OpenArt AI", url: "https://www.facebook.com/people/OpenArt-AI/61562658466287/", verified: true }

    beforeEach(async () => {
      const { _resetAdvertiserLookupMeterForTests } = await import("../meta-ads-scrape.js")
      _resetAdvertiserLookupMeterForTests()
    })

    it("returns the provider's matches for a trimmed query", async () => {
      advertiserMocks.searchMetaAdvertisers.mockResolvedValueOnce({ items: [OPENART], cached: false })
      const app = await buildTestApp()
      const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape/advertisers", payload: { query: "  OpenArt AI " } })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ advertisers: [OPENART] })
      expect(advertiserMocks.searchMetaAdvertisers).toHaveBeenCalledWith("OpenArt AI")
      expect(creditMocks.reserveCreditsForJob).not.toHaveBeenCalled()
    })

    it("meters lookups per USER per day (the route limiter is per credential), 429 past the allowance", async () => {
      const { META_ADS_ADVERTISER_LOOKUPS_PER_DAY, takeAdvertiserLookup } = await import("../meta-ads-scrape.js")
      let clock = Date.UTC(2026, 8, 17, 12)
      const now = () => clock
      for (let i = 0; i < META_ADS_ADVERTISER_LOOKUPS_PER_DAY; i += 1) expect(takeAdvertiserLookup("u-meter", now)).toBe(true)
      expect(takeAdvertiserLookup("u-meter", now)).toBe(false)
      expect(takeAdvertiserLookup("someone-else", now)).toBe(true)
      clock += 24 * 60 * 60 * 1000 // a new day resets it
      expect(takeAdvertiserLookup("u-meter", now)).toBe(true)

      advertiserMocks.searchMetaAdvertisers.mockResolvedValue({ items: [OPENART], cached: true })
      const app = await buildTestApp()
      for (let i = 0; i < META_ADS_ADVERTISER_LOOKUPS_PER_DAY; i += 1) {
        await app.inject({ method: "POST", url: "/v1/meta-ads-scrape/advertisers", payload: { query: `brand ${i}` } })
      }
      const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape/advertisers", payload: { query: "one more" } })
      expect(res.statusCode).toBe(429)
      expect(res.json().error.code).toBe("rate_limit_exceeded")
      expect(advertiserMocks.searchMetaAdvertisers).toHaveBeenCalledTimes(META_ADS_ADVERTISER_LOOKUPS_PER_DAY)
    })

    it("503 provider_key_missing with the ACTIONABLE message when the install has no key and no connection", async () => {
      const { MissingProviderKeyError } = await import("../../providers/provider-keys.js")
      advertiserMocks.searchMetaAdvertisers.mockRejectedValueOnce(new MissingProviderKeyError("apify" as never))
      const app = await buildTestApp()
      const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape/advertisers", payload: { query: "OpenArt AI" } })
      expect(res.statusCode).toBe(503)
      expect(res.json().error.code).toBe("provider_key_missing")
      expect(res.json().error.message).toMatch(/APIFY_API_TOKEN|nodaro\.ai/i)
    })

    it("400 on a one-letter or missing query, before any lookup", async () => {
      const app = await buildTestApp()
      for (const payload of [{ query: "x" }, {}, { query: "a".repeat(101) }]) {
        const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape/advertisers", payload })
        expect(res.statusCode).toBe(400)
      }
      expect(advertiserMocks.searchMetaAdvertisers).not.toHaveBeenCalled()
    })

    it("a pick's Page url on any facebook.com host is accepted by the scrape route (one predicate, shared)", async () => {
      const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
      vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [] } as never)
      const app = await buildTestApp()
      for (const url of ["https://web.facebook.com/nike", "https://de-de.facebook.com/nike", "https://www.facebook.com/people/OpenArt-AI/61562658466287/"]) {
        const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: { mode: "pages", pageUrls: [url] } })
        expect(res.statusCode, url).toBe(200)
      }
    })

    it("relays to the nodaro.ai connection on a keyless install and re-sanitizes the answer", async () => {
      cloudMocks.shouldRunOnCloud.mockResolvedValue(true)
      cloudMocks.callCloudRoute.mockResolvedValue({ advertisers: [OPENART, { pageId: "x", name: "Off-site", url: "https://instagram.com/x" }] })
      const app = await buildTestApp()
      const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape/advertisers", payload: { query: "OpenArt AI" } })
      expect(res.statusCode).toBe(200)
      expect(cloudMocks.callCloudRoute).toHaveBeenCalledWith("/v1/meta-ads-scrape/advertisers", { query: "OpenArt AI" })
      expect(res.json().advertisers).toEqual([OPENART])
      expect(advertiserMocks.searchMetaAdvertisers).not.toHaveBeenCalled()
    })

    it("502 lookup_error with a FIXED message when the provider fails (the detail is logged, never shown)", async () => {
      advertiserMocks.searchMetaAdvertisers.mockRejectedValueOnce(new Error("timeout: actor run still RUNNING after 60s"))
      const app = await buildTestApp()
      const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape/advertisers", payload: { query: "OpenArt AI" } })
      expect(res.statusCode).toBe(502)
      expect(res.json().error.code).toBe("lookup_error")
      expect(res.json().error.message).not.toMatch(/actor|RUNNING/)
    })
  })

  it("skips commit/refund entirely when nothing was reserved (community edition)", async () => {
    creditMocks.reserveCreditsForJob.mockResolvedValueOnce(undefined)
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    const { commitReservedCreditsForJob } = await import("../../lib/credits-job-lifecycle.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [] } as never)
    const app = await buildTestApp()
    const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: { mode: "search", query: "nike" } })
    expect(res.statusCode).toBe(200)
    expect(commitReservedCreditsForJob).not.toHaveBeenCalled()
  })

  // A run that copies every video and analyses every ad outlasts the ~100 s edge
  // timeout: held open, the browser is cut off with a 524 while the job finishes
  // server-side and is charged. Same two reply modes as web-scrape.
  describe("job id first (respondAsync)", () => {
    async function heldProvider() {
      const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
      let release: (v: { json: unknown }) => void = () => {}
      let fail: (e: Error) => void = () => {}
      vi.mocked(runMetaAdsScrape).mockImplementation(
        () => new Promise((resolve, reject) => { release = resolve as never; fail = reject }) as never,
      )
      return { release: (v: { json: unknown }) => release(v), fail: (e: Error) => fail(e) }
    }

    it("answers with the job id while the scrape is still running, then settles when it lands", async () => {
      const { commitReservedCreditsForJob } = await import("../../lib/credits-job-lifecycle.js")
      const provider = await heldProvider()
      const app = await buildTestApp()
      const res = await app.inject({
        method: "POST", url: "/v1/meta-ads-scrape",
        payload: { mode: "search", query: "nike", respondAsync: true },
      })

      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ jobId: "job-1", status: "pending" })
      expect(jobMocks.markJobCompleted).not.toHaveBeenCalled()
      expect(commitReservedCreditsForJob).not.toHaveBeenCalled()

      provider.release({ json: [AD] })
      await vi.waitFor(() => expect(commitReservedCreditsForJob).toHaveBeenCalledWith("job-1"))
      expect(jobMocks.markJobCompleted).toHaveBeenCalledWith("job-1", expect.objectContaining({
        output_data: expect.objectContaining({ json: [AD_OUT] }),
      }))
    })

    it("a scrape that fails after the response marks the job failed and refunds", async () => {
      const { refundReservedCreditsForJob } = await import("../../lib/credits-job-lifecycle.js")
      const provider = await heldProvider()
      const app = await buildTestApp()
      await app.inject({
        method: "POST", url: "/v1/meta-ads-scrape",
        payload: { mode: "search", query: "nike", respondAsync: true },
      })

      provider.fail(new Error("Actor run timed out"))
      await vi.waitFor(() => expect(refundReservedCreditsForJob).toHaveBeenCalledWith("job-1"))
      expect(jobMocks.markJobFailed).toHaveBeenCalledWith("job-1", {
        error_message: "Actor run timed out",
        extra: { output_data: { error: "Actor run timed out" } },
      })
    })

    it("never lets a rejection escape the detached run — not even from the failure write", async () => {
      jobMocks.markJobFailed.mockRejectedValue(new Error("connection reset"))
      const provider = await heldProvider()
      const escaped: unknown[] = []
      const onEscape = (reason: unknown) => escaped.push(reason)
      process.on("unhandledRejection", onEscape)
      try {
        const app = await buildTestApp()
        await app.inject({
          method: "POST", url: "/v1/meta-ads-scrape",
          payload: { mode: "search", query: "nike", respondAsync: true },
        })
        provider.fail(new Error("Actor run timed out"))
        await vi.waitFor(() => expect(jobMocks.markJobFailed).toHaveBeenCalled())
        await new Promise((resolve) => setImmediate(resolve))
      } finally {
        process.off("unhandledRejection", onEscape)
      }
      expect(escaped).toEqual([])
    })

    it("still holds the request and answers with the ads when the flag is absent", async () => {
      const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
      vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [AD] } as never)
      const app = await buildTestApp()
      const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: { mode: "search", query: "nike" } })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ jobId: "job-1", json: [AD_OUT] })
    })

    it("a commit that fails AFTER completion still answers with the stored ads — never a 502, never a failed job", async () => {
      const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
      const { commitReservedCreditsForJob, refundReservedCreditsForJob } = await import("../../lib/credits-job-lifecycle.js")
      vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [AD] } as never)
      vi.mocked(commitReservedCreditsForJob).mockRejectedValueOnce(new Error("statement timeout"))
      const app = await buildTestApp()
      const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: { mode: "search", query: "nike" } })
      expect(res.statusCode).toBe(200)
      expect(res.json().json).toEqual([AD_OUT])
      expect(jobMocks.markJobFailed).not.toHaveBeenCalled()
      expect(refundReservedCreditsForJob).not.toHaveBeenCalled()
    })
  })
})
