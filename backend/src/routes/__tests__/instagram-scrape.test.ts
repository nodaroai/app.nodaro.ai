import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"

vi.mock("../../providers/apify/instagram.js", () => ({ runInstagramScrape: vi.fn() }))
const mediaMocks = vi.hoisted(() => ({
  classifyAndStoreInstagramMedia: vi.fn(async (posts: Array<Record<string, unknown>>) => ({
    posts: posts.map((p) => ({ ...p, format: "unknown", creatives: [] })),
    stats: { classified: 0, stored: 0, videosStored: 0, kept: posts.length, filteredOut: 0 },
  })),
}))
vi.mock("../../lib/instagram-media.js", () => ({
  classifyAndStoreInstagramMedia: mediaMocks.classifyAndStoreInstagramMedia,
  instagramWithoutMedia: (posts: Array<Record<string, unknown>>) => posts.map((p) => ({ ...p, format: "unknown", creatives: [] })),
}))
const analysisMocks = vi.hoisted(() => ({ analyzeInstagramPosts: vi.fn() }))
vi.mock("../../lib/instagram-analysis.js", () => ({ analyzeInstagramPosts: analysisMocks.analyzeInstagramPosts }))
const creditMocks = vi.hoisted(() => ({ reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "u-1" }), guardIds: [] as string[] }))
vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: (resolve: (req: unknown) => string) => async (req: unknown) => { creditMocks.guardIds.push(resolve(req)) },
  reserveCreditsForJob: creditMocks.reserveCreditsForJob,
}))
vi.mock("../../lib/credits-job-lifecycle.js", () => ({ commitReservedCreditsForJob: vi.fn(), refundReservedCreditsForJob: vi.fn() }))
vi.mock("../../lib/credit-base-cost.js", () => ({ baseCreditCostFor: vi.fn(async (id: string) => (id.includes("analysis") ? 1 : 20)) }))
const jobMocks = vi.hoisted(() => ({ markJobCompleted: vi.fn(async () => true), markJobFailed: vi.fn(async () => true), commitJobCredits: vi.fn() }))
vi.mock("../../workers/shared.js", () => ({ markJobCompleted: jobMocks.markJobCompleted, commitJobCredits: jobMocks.commitJobCredits }))
vi.mock("../../lib/job-failure.js", () => ({ markJobFailed: jobMocks.markJobFailed }))
const cloudMocks = vi.hoisted(() => ({ shouldRunOnCloud: vi.fn(async () => false), createCloudJob: vi.fn(), waitForCloudJob: vi.fn() }))
vi.mock("../../providers/nodaro/run-on-cloud.js", () => ({ shouldRunOnCloud: cloudMocks.shouldRunOnCloud }))
vi.mock("../../providers/nodaro/client.js", () => ({ createCloudJob: cloudMocks.createCloudJob, waitForCloudJob: cloudMocks.waitForCloudJob }))
// Give the analysis-key guard a key so the local-analysis path is testable in
// any environment (CI has no LLM keys); everything else stays the real config.
vi.mock("../../lib/config.js", async (importActual) => {
  const actual = await importActual<typeof import("../../lib/config.js")>()
  return { ...actual, config: { ...actual.config, KIE_API_KEY: "test-key" } }
})
vi.mock("../../lib/supabase.js", () => ({
  supabase: { from: () => ({ insert: () => ({ select: () => ({ single: () => ({ data: { id: "job-1" }, error: null }) }) }) }) },
}))

async function buildTestApp() {
  const { instagramScrapeRoutes } = await import("../instagram-scrape.js")
  const app = Fastify()
  app.addHook("preHandler", async (req, reply) => {
    req.raw.setTimeout = (() => {}) as never
    reply.raw.setTimeout = (() => {}) as never
    ;(req as unknown as { userId: string }).userId = "u1"
  })
  await app.register(instagramScrapeRoutes)
  return app
}

const POST = { postId: "1", shortCode: "AbC", caption: "just do it", images: ["https://cdn/i.jpg"], videos: [], videoPreviews: [] }
const POST_OUT = { ...POST, format: "unknown", creatives: [] }

/** The 2nd arg (`{ output_data, ... }`) of the last markJobCompleted call. */
function lastCompletion(): Record<string, unknown> {
  const calls = jobMocks.markJobCompleted.mock.calls as unknown as unknown[][]
  return calls[calls.length - 1][1] as Record<string, unknown>
}

describe("POST /v1/instagram-scrape", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    creditMocks.guardIds.length = 0
    cloudMocks.shouldRunOnCloud.mockResolvedValue(false)
    jobMocks.markJobCompleted.mockResolvedValue(true)
    jobMocks.markJobFailed.mockResolvedValue(true)
  })

  it("profile happy path: jobId returned, provider called, json + featured text settled, tier billed by count × sources", async () => {
    const { runInstagramScrape } = await import("../../providers/apify/instagram.js")
    vi.mocked(runInstagramScrape).mockResolvedValue({ json: [POST] } as never)
    const app = await buildTestApp()
    const res = await app.inject({ method: "POST", url: "/v1/instagram-scrape", payload: { mode: "profile", targets: ["nike", "adidas"], count: 30 } })
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-1")
    expect(creditMocks.guardIds).toEqual(["instagram-scrape:100"]) // 30 × 2 → 100 tier
    expect(creditMocks.reserveCreditsForJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", "instagram-scrape:100")
    // The scrape finishes in the background after the response.
    await vi.waitFor(() => expect(jobMocks.markJobCompleted).toHaveBeenCalled())
    expect(runInstagramScrape).toHaveBeenCalledWith(expect.objectContaining({ mode: "profile", targets: ["nike", "adidas"], count: 30, period: "30d" }))
    const out = lastCompletion().output_data as Record<string, unknown>
    expect(out.json).toEqual([POST_OUT])
    expect(out.text).toBe("just do it")
  })

  it("returns the jobId BEFORE the scrape finishes (the Cloudflare-524 fix), then settles in the background", async () => {
    const { runInstagramScrape } = await import("../../providers/apify/instagram.js")
    let resolveScrape!: (v: unknown) => void
    vi.mocked(runInstagramScrape).mockReturnValue(new Promise((r) => { resolveScrape = r }) as never)
    const app = await buildTestApp()
    const res = await app.inject({ method: "POST", url: "/v1/instagram-scrape", payload: { mode: "profile", targets: ["nike"], count: 20 } })
    // The HTTP response comes back while the actor is still running — this is
    // what keeps the browser under the ~100s edge timeout.
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1", status: "pending" })
    expect(jobMocks.markJobCompleted).not.toHaveBeenCalled()
    resolveScrape({ json: [POST] })
    await vi.waitFor(() => expect(jobMocks.markJobCompleted).toHaveBeenCalled())
  })

  it("dedupes duplicate targets so a hand-crafted body bills unique sources", async () => {
    const { runInstagramScrape } = await import("../../providers/apify/instagram.js")
    vi.mocked(runInstagramScrape).mockResolvedValue({ json: [POST] } as never)
    const app = await buildTestApp()
    const res = await app.inject({ method: "POST", url: "/v1/instagram-scrape", payload: { mode: "profile", targets: ["nike", "NIKE", "@nike"], count: 20 } })
    expect(res.statusCode).toBe(200)
    expect(creditMocks.guardIds).toEqual(["instagram-scrape:20"]) // 3 duplicate targets → 1 source → 20 × 1 tier
    await vi.waitFor(() => expect(runInstagramScrape).toHaveBeenCalledWith(expect.objectContaining({ targets: ["nike"] })))
  })

  it("forwards analysis and settles per analysed post (count-based commit)", async () => {
    const { runInstagramScrape } = await import("../../providers/apify/instagram.js")
    vi.mocked(runInstagramScrape).mockResolvedValue({ json: [POST] } as never)
    analysisMocks.analyzeInstagramPosts.mockResolvedValue({
      posts: [{ ...POST_OUT, analysis: { summary: "ok" } }],
      stats: { requested: 1, analyzed: 1, failed: 0, skipped: 0, providerCostUsd: 0.001, usageComplete: true },
    })
    const app = await buildTestApp()
    const res = await app.inject({ method: "POST", url: "/v1/instagram-scrape", payload: { mode: "profile", targets: ["nike"], count: 20, analyze: true } })
    expect(res.statusCode).toBe(200)
    expect(creditMocks.guardIds).toEqual(["instagram-scrape:20:analysis:economy"])
    await vi.waitFor(() => expect(jobMocks.commitJobCredits).toHaveBeenCalledWith("u-1", "job-1", null, 21, true)) // 20 scrape + 1×1 analysed
    expect(analysisMocks.analyzeInstagramPosts).toHaveBeenCalled()
  })

  it("relays to the nodaro.ai connection on a keyless install (creates + polls the cloud job)", async () => {
    cloudMocks.shouldRunOnCloud.mockResolvedValue(true)
    cloudMocks.createCloudJob.mockResolvedValue("cloud-9")
    cloudMocks.waitForCloudJob.mockResolvedValue({ status: "completed", output_data: { json: [POST_OUT], text: "just do it" } })
    const { runInstagramScrape } = await import("../../providers/apify/instagram.js")
    const app = await buildTestApp()
    const res = await app.inject({ method: "POST", url: "/v1/instagram-scrape", payload: { mode: "hashtag", targets: ["running"] } })
    expect(res.statusCode).toBe(200)
    expect(res.json().jobId).toBe("job-1")
    await vi.waitFor(() => expect(jobMocks.markJobCompleted).toHaveBeenCalled())
    expect(cloudMocks.createCloudJob).toHaveBeenCalledWith("/v1/instagram-scrape", expect.objectContaining({ mode: "hashtag" }))
    expect(runInstagramScrape).not.toHaveBeenCalled()
  })

  it("post mode: canonical links, one post per link billed, count / formats ignored, and the settlement agrees", async () => {
    const { runInstagramScrape } = await import("../../providers/apify/instagram.js")
    vi.mocked(runInstagramScrape).mockResolvedValue({ json: [POST] } as never)
    analysisMocks.analyzeInstagramPosts.mockResolvedValue({
      posts: [{ ...POST_OUT, analysis: { summary: "ok" } }],
      stats: { requested: 1, analyzed: 1, failed: 0, skipped: 0, providerCostUsd: 0.001, usageComplete: true },
    })
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/instagram-scrape",
      payload: {
        mode: "post",
        targets: ["https://instagram.com/p/AbC123/?igsh=xyz", "https://www.instagram.com/p/AbC123/", "https://www.instagram.com/reel/Zz9/"],
        count: 80,
        formats: ["square"],
        analyze: true,
      },
    })
    expect(res.statusCode).toBe(200)
    // 2 unique links → 2 requested posts → the 10 tier (not 80 × 2 → 200).
    expect(creditMocks.guardIds).toEqual(["instagram-scrape:10:analysis:economy"])
    expect(creditMocks.reserveCreditsForJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", "instagram-scrape:10:analysis:economy")
    await vi.waitFor(() => expect(jobMocks.commitJobCredits).toHaveBeenCalled())
    expect(runInstagramScrape).toHaveBeenCalledWith(expect.objectContaining({
      mode: "post",
      targets: ["https://www.instagram.com/p/AbC123/", "https://www.instagram.com/reel/Zz9/"],
    }))
    // A post link names one post: the format filter never reaches the media step.
    expect(mediaMocks.classifyAndStoreInstagramMedia).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ formats: undefined }))
    // Settlement re-derives the scrape base from the SAME requested count (the mock prices the scrape id at 20).
    const { baseCreditCostFor } = await import("../../lib/credit-base-cost.js")
    expect(baseCreditCostFor).toHaveBeenCalledWith("instagram-scrape:10")
  })

  it("post mode: 400 with a clear message when nothing is a post link", async () => {
    const app = await buildTestApp()
    const res = await app.inject({ method: "POST", url: "/v1/instagram-scrape", payload: { mode: "post", targets: ["nike", "https://www.instagram.com/nike/"] } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toMatch(/post links/)
  })

  it("400 on empty / too many targets", async () => {
    const app = await buildTestApp()
    expect((await app.inject({ method: "POST", url: "/v1/instagram-scrape", payload: { mode: "profile", targets: [] } })).statusCode).toBe(400)
    expect((await app.inject({ method: "POST", url: "/v1/instagram-scrape", payload: { mode: "profile", targets: ["a", "b", "c", "d", "e", "f"] } })).statusCode).toBe(400)
  })

  it("marks the job failed and refunds on a provider error (surfaced via the job row, not the HTTP response)", async () => {
    const { runInstagramScrape } = await import("../../providers/apify/instagram.js")
    const { refundReservedCreditsForJob } = await import("../../lib/credits-job-lifecycle.js")
    vi.mocked(runInstagramScrape).mockRejectedValue(new Error("blocked"))
    const app = await buildTestApp()
    const res = await app.inject({ method: "POST", url: "/v1/instagram-scrape", payload: { mode: "profile", targets: ["nike"] } })
    expect(res.statusCode).toBe(200) // the jobId already came back; the failure lives on the job row
    await vi.waitFor(() => expect(jobMocks.markJobFailed).toHaveBeenCalled())
    expect(refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
  })
})
