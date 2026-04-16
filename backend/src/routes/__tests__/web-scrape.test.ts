import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"

vi.mock("../../providers/apify/scraper.js", () => ({
  runScraper: vi.fn(),
}))
vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1" }),
}))
vi.mock("../../billing/credits.js", () => ({
  CreditsService: { commitCredits: vi.fn(), refundCredits: vi.fn() },
}))
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
  beforeEach(() => { vi.clearAllMocks() })

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
})
