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
// Settlement goes through the core funnels: the completion / failure CAS and
// the job-keyed commit / refund. `markJobCompleted` answers false when the job
// left `pending` under the route (cancelled mid-scrape).
const settle = vi.hoisted(() => ({
  markJobCompleted: vi.fn(async () => true),
  markJobFailed: vi.fn(async () => true),
  commit: vi.fn(async () => {}),
  refund: vi.fn(async () => 0),
}))
vi.mock("../../workers/shared.js", () => ({ markJobCompleted: settle.markJobCompleted }))
vi.mock("../../lib/job-failure.js", () => ({ markJobFailed: settle.markJobFailed }))
vi.mock("../../lib/credits-job-lifecycle.js", () => ({
  commitReservedCreditsForJob: settle.commit,
  refundReservedCreditsForJob: settle.refund,
}))
// The connection branch (no Apify token + live nodaro.ai connection): the
// route relays the scrape to the cloud's identical route. Default: a keyed
// install (local scraper); the connection tests flip it.
const cloudMocks = vi.hoisted(() => ({
  shouldRunOnCloud: vi.fn(async () => false),
  createCloudJob: vi.fn(),
  waitForCloudJob: vi.fn(),
}))
vi.mock("../../providers/nodaro/run-on-cloud.js", () => ({ shouldRunOnCloud: cloudMocks.shouldRunOnCloud }))
vi.mock("../../providers/nodaro/client.js", () => ({
  createCloudJob: cloudMocks.createCloudJob,
  waitForCloudJob: cloudMocks.waitForCloudJob,
}))
// Every row the route inserts, so a test can read what reached `jobs`.
const insertedRows = vi.hoisted(() => [] as Array<Record<string, unknown>>)
// The video queue: the route enqueues the scrape's worker job, and this
// stand-in runs the real handler at once, as the worker does with lanes off.
vi.mock("../../lib/queue.js", async () => ({ videoQueue: (await import("./helpers/inline-scrape-worker.js")).inlineScrapeQueue }))
vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        insertedRows.push(row)
        return { select: () => ({ single: () => ({ data: { id: "job-1" }, error: null }) }) }
      },
      update: () => {
        // The relay saves its cloud job (a CAS: .eq().is().in().select()); any other write awaits .eq().
        const c: Record<string, unknown> = { eq: () => c, is: () => c, in: () => c, select: async () => ({ data: [{ id: "job-1" }], error: null }), then: (ok: (v: unknown) => unknown) => ok({ error: null }) }
        return c
      },
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
    settle.markJobCompleted.mockResolvedValue(true)
    settle.markJobFailed.mockResolvedValue(true)
  })

  it("runs the scrape on the nodaro.ai connection when the install has no Apify token and is connected — same shape, local job id", async () => {
    cloudMocks.shouldRunOnCloud.mockResolvedValue(true)
    cloudMocks.createCloudJob.mockResolvedValue("cloud-job-9")
    cloudMocks.waitForCloudJob.mockResolvedValue({ id: "cloud-job-9", status: "completed", output_data: { json: [{ title: "T", url: "u" }] } })
    const { runScraper } = await import("../../providers/apify/scraper.js")
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/web-scrape",
      payload: { actor: "google-search", query: "ai" },
    })
    expect(res.statusCode).toBe(200)
    // The relay asks the cloud for the job id first and polls it: the cloud
    // sits behind the same ~100 s edge timeout a browser does.
    expect(cloudMocks.createCloudJob).toHaveBeenCalledWith(
      "/v1/web-scrape",
      expect.objectContaining({ actor: "google-search", query: "ai", respondAsync: true }), { idempotencyKey: "scrape-relay:job-1" })
    expect(cloudMocks.waitForCloudJob).toHaveBeenCalledWith("cloud-job-9")
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
    expect(cloudMocks.createCloudJob).not.toHaveBeenCalled()
    expect(fetchRssItems).toHaveBeenCalled()
  })

  it("502 with the cloud's own message when the connection refuses the scrape", async () => {
    cloudMocks.shouldRunOnCloud.mockResolvedValue(true)
    cloudMocks.createCloudJob.mockRejectedValue(new Error("nodaro.ai: Insufficient nodaro.ai credits — top up or upgrade your connected account."))
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
    // Whatever the feed fetch throws — the network, a status, or "this is not
    // a feed" — is a failed job with its reservation handed back, never a
    // completed (= charged) one. The real parser is exercised end to end in
    // web-scrape-rss-billing.test.ts.
    expect(settle.markJobFailed).toHaveBeenCalledTimes(1)
    expect(settle.refund).toHaveBeenCalledTimes(1)
    expect(settle.commit).not.toHaveBeenCalled()
    expect(settle.markJobCompleted).not.toHaveBeenCalled()
  })
})

/**
 * A site crawl of 20 pages measured 252 s; the edge in front of this route cuts
 * a held request at ~100 s. The browser got a 524 — "Web scrape failed" on the
 * node — while the job finished server-side and the credits were committed. A
 * caller that can poll now asks for the job id first.
 */
describe("POST /v1/web-scrape — job id first (respondAsync)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cloudMocks.shouldRunOnCloud.mockResolvedValue(false)
    settle.markJobCompleted.mockResolvedValue(true)
    settle.markJobFailed.mockResolvedValue(true)
  })

  /** A scraper whose answer the test releases by hand. */
  async function heldScraper() {
    const { runScraper } = await import("../../providers/apify/scraper.js")
    let release: (v: { json: unknown }) => void = () => {}
    let fail: (e: Error) => void = () => {}
    vi.mocked(runScraper).mockImplementation(
      () => new Promise((resolve, reject) => { release = resolve as never; fail = reject }) as never,
    )
    return { runScraper, release: (v: { json: unknown }) => release(v), fail: (e: Error) => fail(e) }
  }

  it("answers with the job id while the crawl is still running, then settles when it lands", async () => {
    const scraper = await heldScraper()
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/web-scrape",
      payload: { actor: "content-crawler", url: "https://owalalife.com/", mode: "site", respondAsync: true },
    })

    // The response is back and NOTHING is settled — the crawl has not answered.
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1", status: "pending" })
    expect(settle.markJobCompleted).not.toHaveBeenCalled()
    expect(settle.commit).not.toHaveBeenCalled()

    scraper.release({ json: { pages: [{ url: "https://owalalife.com/", markdown: "# Owala" }] } })
    await vi.waitFor(() => expect(settle.commit).toHaveBeenCalledWith("job-1"))
    expect(settle.markJobCompleted).toHaveBeenCalledWith("job-1", {
      output_data: { json: { pages: [{ url: "https://owalalife.com/", markdown: "# Owala" }] } },
    })
    expect(settle.refund).not.toHaveBeenCalled()
  })

  it("a crawl that fails after the response marks the job failed and refunds — and never throws", async () => {
    const scraper = await heldScraper()
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/web-scrape",
      payload: { actor: "content-crawler", url: "https://owalalife.com/", mode: "site", respondAsync: true },
    })
    expect(res.json()).toEqual({ jobId: "job-1", status: "pending" })

    scraper.fail(new Error("Actor run timed out"))
    await vi.waitFor(() => expect(settle.refund).toHaveBeenCalledWith("job-1"))
    expect(settle.markJobFailed).toHaveBeenCalledWith("job-1", {
      error_message: "Actor run timed out",
      extra: { output_data: { error: "Actor run timed out" } },
    })
    expect(settle.commit).not.toHaveBeenCalled()
  })

  it("does not settle a job that was cancelled mid-crawl — the cancel path owns that refund", async () => {
    settle.markJobCompleted.mockResolvedValue(false)
    const scraper = await heldScraper()
    const app = await buildTestApp()
    await app.inject({
      method: "POST", url: "/v1/web-scrape",
      payload: { actor: "google-search", query: "ai", respondAsync: true },
    })

    scraper.release({ json: [] })
    await vi.waitFor(() => expect(settle.markJobCompleted).toHaveBeenCalled())
    expect(settle.commit).not.toHaveBeenCalled()
    expect(settle.refund).not.toHaveBeenCalled()
    expect(settle.markJobFailed).not.toHaveBeenCalled()
  })

  it("never lets a rejection escape the detached run — not even from the failure write", async () => {
    settle.markJobFailed.mockRejectedValue(new Error("connection reset"))
    const scraper = await heldScraper()
    const escaped: unknown[] = []
    const onEscape = (reason: unknown) => escaped.push(reason)
    process.on("unhandledRejection", onEscape)
    try {
      const app = await buildTestApp()
      await app.inject({
        method: "POST", url: "/v1/web-scrape",
        payload: { actor: "google-search", query: "ai", respondAsync: true },
      })
      scraper.fail(new Error("Actor run timed out"))
      await vi.waitFor(() => expect(settle.markJobFailed).toHaveBeenCalled())
      await new Promise((resolve) => setImmediate(resolve))
    } finally {
      process.off("unhandledRejection", onEscape)
    }
    expect(escaped).toEqual([])
  })

  it("a commit that fails AFTER completion still answers with the stored result — never a 502, never a failed job", async () => {
    // The job is completed and the pages are on it. Falling into the failure
    // path from here would miss markJobFailed's CAS, refund nothing, and tell a
    // held caller the scrape failed.
    settle.commit.mockRejectedValueOnce(new Error("statement timeout"))
    const { runScraper } = await import("../../providers/apify/scraper.js")
    vi.mocked(runScraper).mockResolvedValue({ json: [{ title: "T" }] } as never)
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/web-scrape",
      payload: { actor: "google-search", query: "ai" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1", json: [{ title: "T" }] })
    expect(settle.markJobFailed).not.toHaveBeenCalled()
    expect(settle.refund).not.toHaveBeenCalled()
  })

  it("keeps the transport flag out of the scrape itself and out of the stored job input", async () => {
    insertedRows.length = 0
    const { runScraper } = await import("../../providers/apify/scraper.js")
    vi.mocked(runScraper).mockResolvedValue({ json: [] } as never)
    const app = await buildTestApp()
    await app.inject({
      method: "POST", url: "/v1/web-scrape",
      payload: { actor: "google-search", query: "ai", respondAsync: true },
    })
    await vi.waitFor(() => expect(runScraper).toHaveBeenCalled())
    expect(vi.mocked(runScraper).mock.calls[0]![0]).not.toHaveProperty("respondAsync")
    // `input_data` is what run history, reconcile and a relay replay read: a
    // transport preference has no business in it.
    const jobRow = insertedRows.find((row) => row.input_data !== undefined)
    expect(jobRow?.input_data).toMatchObject({ type: "web-scrape", actor: "google-search", query: "ai" })
    expect(jobRow?.input_data).not.toHaveProperty("respondAsync")
  })

  it.each([
    ["absent", {}],
    ["false", { respondAsync: false }],
    ["a truthy non-boolean", { respondAsync: "true" }],
  ])("still holds the request and answers with the result when the flag is %s", async (_label, flag) => {
    // Every community install already in the field relays through this route
    // and reads `json` off the response; so does a direct API caller.
    const { runScraper } = await import("../../providers/apify/scraper.js")
    vi.mocked(runScraper).mockResolvedValue({ json: [{ title: "T" }] } as never)
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/web-scrape",
      payload: { actor: "google-search", query: "ai", ...flag },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1", json: [{ title: "T" }] })
    expect(settle.commit).toHaveBeenCalledWith("job-1")
  })

  it("held open, a cancelled job answers 409 instead of handing back a free scrape", async () => {
    settle.markJobCompleted.mockResolvedValue(false)
    const { runScraper } = await import("../../providers/apify/scraper.js")
    vi.mocked(runScraper).mockResolvedValue({ json: [{ title: "T" }] } as never)
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/web-scrape",
      payload: { actor: "google-search", query: "ai" },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("job_cancelled")
    expect(settle.commit).not.toHaveBeenCalled()
  })

  it("held open, a failed scrape refunds exactly once", async () => {
    const { runScraper } = await import("../../providers/apify/scraper.js")
    vi.mocked(runScraper).mockRejectedValue(new Error("Too many requests"))
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/web-scrape",
      payload: { actor: "google-search", query: "ai" },
    })
    expect(res.statusCode).toBe(502)
    expect(res.json().error).toEqual({ code: "scrape_error", message: "Too many requests" })
    expect(settle.refund).toHaveBeenCalledTimes(1)
    expect(settle.commit).not.toHaveBeenCalled()
  })

  it("does not refund a failure on a row the cancel path already took", async () => {
    settle.markJobFailed.mockResolvedValue(false)
    const { runScraper } = await import("../../providers/apify/scraper.js")
    vi.mocked(runScraper).mockRejectedValue(new Error("Too many requests"))
    const app = await buildTestApp()
    await app.inject({
      method: "POST", url: "/v1/web-scrape",
      payload: { actor: "google-search", query: "ai" },
    })
    expect(settle.refund).not.toHaveBeenCalled()
  })
})

describe("POST /v1/web-scrape — address spelling", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cloudMocks.shouldRunOnCloud.mockResolvedValue(false)
  })

  it.each([
    ["pletor.ai", "https://pletor.ai"],
    ["www.pletor.ai/products", "https://www.pletor.ai/products"],
    ["  http://pletor.ai  ", "http://pletor.ai"],
  ])("runs a content crawl typed as %s (the scraper gets %s)", async (typed, expected) => {
    const { runScraper } = await import("../../providers/apify/scraper.js")
    vi.mocked(runScraper).mockResolvedValue({ json: [{ url: expected }] } as never)
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/web-scrape",
      payload: { actor: "content-crawler", url: typed, mode: "page" },
    })
    expect(res.statusCode).toBe(200)
    expect(vi.mocked(runScraper)).toHaveBeenCalledWith(expect.objectContaining({ url: expected }), expect.anything())
  })

  it("runs an Instagram target typed without a scheme", async () => {
    const { runScraper } = await import("../../providers/apify/scraper.js")
    vi.mocked(runScraper).mockResolvedValue({ json: [] } as never)
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/web-scrape",
      payload: { actor: "instagram", target: "instagram.com/nike" },
    })
    expect(res.statusCode).toBe(200)
    expect(vi.mocked(runScraper)).toHaveBeenCalledWith(expect.objectContaining({ target: "https://instagram.com/nike" }), expect.anything())
  })

  it("still refuses a value that is not an address at all", async () => {
    const { runScraper } = await import("../../providers/apify/scraper.js")
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/web-scrape",
      payload: { actor: "content-crawler", url: "not a website", mode: "page" },
    })
    expect(res.statusCode).toBe(400)
    expect(vi.mocked(runScraper)).not.toHaveBeenCalled()
  })
})
