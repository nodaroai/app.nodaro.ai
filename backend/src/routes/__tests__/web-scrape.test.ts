import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"

vi.mock("../../providers/apify/scraper.js", () => ({
  runScraper: vi.fn(),
}))
vi.mock("../../providers/rss/parser.js", () => ({
  fetchRssItems: vi.fn(),
}))
vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1" }),
}))
vi.mock("../../ee/billing/credits.js", () => ({
  CreditsService: { commitCredits: vi.fn(), refundCredits: vi.fn() },
}))
// The connection branch (no Apify token + live nodaro.ai connection): the
// route relays the scrape to the cloud's identical route. Default: a keyed
// install (local scraper); the connection tests flip it.
const cloudMocks = vi.hoisted(() => ({
  shouldRunOnCloud: vi.fn(async () => false),
  callCloudRoute: vi.fn(),
}))
vi.mock("../../providers/nodaro/run-on-cloud.js", () => ({ shouldRunOnCloud: cloudMocks.shouldRunOnCloud }))
vi.mock("../../providers/nodaro/client.js", () => ({ callCloudRoute: cloudMocks.callCloudRoute }))
vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      insert: () => ({ select: () => ({ single: () => ({ data: { id: "job-1" }, error: null }) }) }),
      update: () => ({ eq: () => ({ error: null }) }),
    }),
  },
}))

async function buildTestApp() {
  const { webScrapeRoutes } = await import("../web-scrape.js")
  const app = Fastify()
  app.addHook("preHandler", async (req, reply) => {
    // Stub Node socket timeouts that Fastify inject() doesn't populate; matches
    // the pattern used by ai-writer.test.ts and five other sibling route tests.
    req.raw.setTimeout = (() => {}) as never
    reply.raw.setTimeout = (() => {}) as never
    ;(req as unknown as { userId: string }).userId = "u1"
  })
  await app.register(webScrapeRoutes)
  return app
}

describe("POST /v1/web-scrape", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cloudMocks.shouldRunOnCloud.mockResolvedValue(false)
  })

  it("runs the scrape on the nodaro.ai connection when the install has no Apify token and is connected — same shape, local job id", async () => {
    cloudMocks.shouldRunOnCloud.mockResolvedValue(true)
    cloudMocks.callCloudRoute.mockResolvedValue({ jobId: "cloud-job-9", json: [{ title: "T", url: "u" }] })
    const { runScraper } = await import("../../providers/apify/scraper.js")
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/web-scrape",
      payload: { actor: "google-search", query: "ai" },
    })
    expect(res.statusCode).toBe(200)
    expect(cloudMocks.callCloudRoute).toHaveBeenCalledWith("/v1/web-scrape", expect.objectContaining({ actor: "google-search", query: "ai" }))
    expect(runScraper).not.toHaveBeenCalled()
    const body = res.json()
    expect(body.jobId).toBe("job-1") // THIS install's job row, not the cloud's
    expect(body.json).toEqual([{ title: "T", url: "u" }])
  })

  it("never sends an RSS fetch to the connection — RSS needs no Apify", async () => {
    cloudMocks.shouldRunOnCloud.mockResolvedValue(true)
    const { fetchRssItems } = await import("../../providers/rss/parser.js")
    vi.mocked(fetchRssItems).mockResolvedValue([] as never)
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/web-scrape",
      payload: { actor: "rss", url: "https://example.com/feed.xml" },
    })
    expect(res.statusCode).toBe(200)
    expect(cloudMocks.callCloudRoute).not.toHaveBeenCalled()
    expect(fetchRssItems).toHaveBeenCalled()
  })

  it("502 with the cloud's own message when the connection refuses the scrape", async () => {
    cloudMocks.shouldRunOnCloud.mockResolvedValue(true)
    cloudMocks.callCloudRoute.mockRejectedValue(new Error("nodaro.ai: Insufficient nodaro.ai credits — top up or upgrade your connected account."))
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/web-scrape",
      payload: { actor: "google-search", query: "ai" },
    })
    expect(res.statusCode).toBe(502)
    expect(res.json().error.message).toMatch(/Insufficient nodaro.ai credits/)
  })

  it("400 on missing required fields", async () => {
    const app = await buildTestApp()
    const res = await app.inject({ method: "POST", url: "/v1/web-scrape", payload: {} })
    expect(res.statusCode).toBe(400)
  })

  it("400 on unknown actor", async () => {
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/web-scrape",
      payload: { actor: "bogus", query: "x" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("200 with json output for google-search happy path", async () => {
    const { runScraper } = await import("../../providers/apify/scraper.js")
    vi.mocked(runScraper).mockResolvedValue({ json: [] })
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/web-scrape",
      payload: { actor: "google-search", query: "ai" },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-1")
    expect(body.json).toEqual([])
  })

  it("200 with json output for rss happy path", async () => {
    const { fetchRssItems } = await import("../../providers/rss/parser.js")
    vi.mocked(fetchRssItems).mockResolvedValue([
      {
        title: "First post",
        url: "https://example.com/first",
        description: "Hello world",
        pubDate: "2026-04-20T00:00:00.000Z",
        guid: "guid-1",
      },
    ])

    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/web-scrape",
      payload: { actor: "rss", url: "https://feeds.feedburner.com/TechCrunch" },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.jobId).toBe("job-1")
    expect(body.json).toEqual([
      {
        title: "First post",
        url: "https://example.com/first",
        description: "Hello world",
        pubDate: "2026-04-20T00:00:00.000Z",
        guid: "guid-1",
      },
    ])
  })

  it("content-crawler requires url", async () => {
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/web-scrape",
      payload: { actor: "content-crawler" },
    })
    expect(res.statusCode).toBe(400)
  })

  it("502 on scraper error", async () => {
    const { runScraper } = await import("../../providers/apify/scraper.js")
    vi.mocked(runScraper).mockRejectedValue(Object.assign(new Error("Too many requests"), { name: "ApifyError" }))
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/web-scrape",
      payload: { actor: "google-search", query: "ai" },
    })
    expect(res.statusCode).toBe(502)
  })

  it("502 on rss fetch error", async () => {
    const { fetchRssItems } = await import("../../providers/rss/parser.js")
    vi.mocked(fetchRssItems).mockRejectedValue(new Error("connect ENETUNREACH"))

    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/web-scrape",
      payload: { actor: "rss", url: "https://feeds.feedburner.com/TechCrunch" },
    })

    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe("scrape_error")
  })
})
