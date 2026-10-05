import Fastify from "fastify"
import { beforeEach, describe, expect, it, vi } from "vitest"

// The reply shape the idempotency test's reserve stub answers through. The stub is typed with
// it (not `(...a: unknown[])`), or strictFunctionTypes rejects that test's mockImplementation.
type CaptureReply = { code(n: number): { send(b: unknown): void } }

const h = vi.hoisted(() => ({
  token: "apify-key",
  storage: true,
  redisDown: false,
  guardCalls: 0,
  order: [] as string[],
  inserted: [] as Array<Record<string, unknown>>,
  reserve: vi.fn<(req: unknown, reply: CaptureReply) => Promise<{ usageLogId: string } | undefined>>(async () => ({ usageLogId: "usage-1" })),
  completed: vi.fn(async (..._a: unknown[]) => "completed"),
  failed: vi.fn(async (..._a: unknown[]) => true),
  commit: vi.fn(async (..._a: unknown[]) => undefined),
  refund: vi.fn(async (..._a: unknown[]) => 0),
  onCloud: vi.fn(async () => false),
  createCloudJob: vi.fn(),
  waitForCloudJob: vi.fn(),
  cloudFetch: vi.fn(),
  run: vi.fn(),
  storeLocal: vi.fn(),
  restoreRelay: vi.fn(),
  deleteAssets: vi.fn(async (..._a: unknown[]) => undefined),
  checkRobots: vi.fn(async (..._a: unknown[]) => "allowed"),
}))

vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: () => async () => { h.guardCalls++ },
  reserveCreditsForJob: h.reserve,
}))
vi.mock("../../lib/queue.js", () => ({
  redis: {
    incr: async () => { if (h.redisDown) throw new Error("redis down"); return 1 },
    expire: async () => 1,
    ttl: async () => 60,
  },
}))
vi.mock("../../workers/shared.js", () => ({ markJobCompletedDetailed: h.completed }))
vi.mock("../../lib/job-failure.js", () => ({ markJobFailed: h.failed }))
vi.mock("../../lib/credits-job-lifecycle.js", () => ({ commitReservedCreditsForJob: h.commit, refundReservedCreditsForJob: h.refund }))
vi.mock("../../providers/nodaro/run-on-cloud.js", () => ({ shouldRunOnCloud: h.onCloud }))
vi.mock("../../providers/nodaro/client.js", () => {
  class NodaroCloudError extends Error {
    constructor(message: string, readonly statusCode?: number, readonly code?: string) {
      super(message)
      this.name = "NodaroCloudError"
    }
  }
  return { NodaroCloudError, createCloudJob: h.createCloudJob, waitForCloudJob: h.waitForCloudJob }
})
vi.mock("../../lib/nodaro-connect.js", () => ({ nodaroCloudFetch: h.cloudFetch }))
vi.mock("../../providers/apify/site-capture.js", () => {
  class SiteCaptureError extends Error {
    constructor(readonly code: string, readonly publicMessage: string, readonly internalDetails: string, readonly providerRunId?: string) {
      super(publicMessage)
      this.name = "SiteCaptureError"
    }
  }
  return { SiteCaptureError, runSiteCapture: h.run }
})
vi.mock("../../lib/site-capture-store.js", () => {
  class CaptureStorageFullError extends Error {}
  return { CaptureStorageFullError, storeLocalCapture: h.storeLocal, restoreRelayCapture: h.restoreRelay, deleteCaptureAssets: h.deleteAssets }
})
vi.mock("../../lib/site-capture-robots.js", () => ({ checkRobots: async (...a: unknown[]) => { h.order.push("robots"); return h.checkRobots(...a) } }))
vi.mock("../../lib/storage.js", () => ({ isStorageConfigured: () => h.storage }))
vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/config.js")>()
  return { ...actual, config: new Proxy(actual.config, { get: (t, p, r) => (p === "APIFY_API_TOKEN" ? h.token : Reflect.get(t, p, r)) }) }
})
vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        h.order.push("insert")
        h.inserted.push(row)
        return { select: () => ({ single: () => ({ data: { id: "job-1" }, error: null }) }) }
      },
      update: () => ({ eq: () => ({ error: null }) }),
    }),
  },
}))

const { siteCaptureRoutes, SITE_CAPTURE_RELAY_BUDGET_MS } = await import("../site-capture.js")
const { SiteCaptureError } = await import("../../providers/apify/site-capture.js")
const { CaptureStorageFullError } = await import("../../lib/site-capture-store.js")
const { NodaroCloudError } = await import("../../providers/nodaro/client.js")
const { MissingProviderKeyError } = await import("../../providers/provider-keys.js")

const OUTPUT = { pageUrl: "https://example.com/", stills: [], warnings: ["sections_below_minimum"], usableStills: 2 }

async function app() {
  const a = Fastify()
  a.addHook("preHandler", async (req) => { (req as unknown as { userId: string }).userId = "u1" })
  await a.register(siteCaptureRoutes)
  return a
}
const post = async (payload: unknown) => (await app()).inject({ method: "POST", url: "/v1/site-capture", payload: payload as object })

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(h, { token: "apify-key", storage: true, redisDown: false, guardCalls: 0 })
  h.order.length = 0
  h.inserted.length = 0
  h.onCloud.mockResolvedValue(false)
  h.checkRobots.mockResolvedValue("allowed")
  h.reserve.mockResolvedValue({ usageLogId: "usage-1" })
  h.completed.mockResolvedValue("completed")
  h.failed.mockResolvedValue(true)
  h.run.mockResolvedValue({ providerRunId: "run-1" })
  h.storeLocal.mockResolvedValue({ output: OUTPUT, assetIds: ["a1", "a2"] })
  h.restoreRelay.mockResolvedValue({ output: { ...OUTPUT, source: "relay" }, assetIds: ["r1"] })
})

describe("POST /v1/site-capture — validation and order", () => {
  it("400 for a non-http(s) scheme or a bad address", async () => {
    expect((await post({ url: "ftp://example.com/" })).statusCode).toBe(400)
    expect((await post({ url: "not a url at all" })).statusCode).toBe(400)
    expect((await post({ url: "https://example.com/", maxStills: 9 })).statusCode).toBe(400)
  })

  it("normalises example.com and stores only { url, maxStills } as the job input", async () => {
    const res = await post({ url: "example.com", respondAsync: false, workflowId: "11111111-1111-4111-8111-111111111111" })
    expect(res.json()).toEqual({ jobId: "job-1", status: "pending" })
    expect(h.inserted[0]!.input_data).toEqual({ url: "https://example.com", maxStills: 8, type: "site-capture" })
    expect(h.inserted[0]).not.toHaveProperty("relay_job_id")
  })

  it("the rate limiter runs first and fails closed when Redis is down", async () => {
    h.redisDown = true
    const res = await post({ url: "https://example.com/" })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("rate_limit_unavailable")
    expect(h.guardCalls).toBe(0)
  })
})

describe("runners and the keyed pre-flight", () => {
  it("none: no robots read, no storage check, and the job fails with the key message", async () => {
    h.token = ""
    h.storage = false
    h.run.mockRejectedValue(new MissingProviderKeyError("APIFY_API_TOKEN"))
    const res = await post({ url: "https://example.com/" })
    expect(res.json()).toEqual({ jobId: "job-1", status: "pending" })
    await vi.waitFor(() => expect(h.failed).toHaveBeenCalled())
    expect(h.checkRobots).not.toHaveBeenCalled()
    const [, input] = h.failed.mock.calls[0] as [string, { error_message: string; extra: { output_data: { error: { code: string } } } }]
    expect(input.extra.output_data.error.code).toBe("capture_failed")
    expect(input.error_message).toMatch(/APIFY_API_TOKEN/)
  })

  it("relay: no local robots read; the cloud gets { url, maxStills, respondAsync } only and a 200 s budget", async () => {
    h.onCloud.mockResolvedValue(true)
    h.createCloudJob.mockResolvedValue("cloud-9")
    h.waitForCloudJob.mockResolvedValue({ id: "cloud-9", status: "completed", output_data: { stills: [] } })
    await post({ url: "https://example.com/", maxStills: 5 })
    await vi.waitFor(() => expect(h.restoreRelay).toHaveBeenCalled())
    expect(h.checkRobots).not.toHaveBeenCalled()
    expect(h.createCloudJob).toHaveBeenCalledWith("/v1/site-capture", { url: "https://example.com/", maxStills: 5, respondAsync: true })
    expect(h.waitForCloudJob).toHaveBeenCalledWith("cloud-9", undefined, { budgetMs: SITE_CAPTURE_RELAY_BUDGET_MS })
    expect(h.restoreRelay).toHaveBeenCalledWith({ stills: [] }, { userId: "u1", jobId: "job-1", pageUrl: "https://example.com/" })
  })

  it("keyed: robots runs before the job is created", async () => {
    await post({ url: "https://example.com/" })
    expect(h.order.slice(0, 2)).toEqual(["robots", "insert"])
  })

  it.each([
    ["storage", "storage_not_configured"],
    ["disallowed", "robots_disallowed"],
    ["unreachable", "robots_unreachable"],
    ["site_unreachable", "site_unreachable"],
    ["refused_address", "validation_error"],
  ])("keyed pre-flight %s → 422 %s with no job and no reservation", async (cause, code) => {
    if (cause === "storage") h.storage = false
    else h.checkRobots.mockResolvedValue(cause)
    const res = await post({ url: "https://example.com/" })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe(code)
    expect(h.inserted).toHaveLength(0)
    expect(h.reserve).not.toHaveBeenCalled()
    if (code === "validation_error") expect(res.json().error.message).toBe("This address can't be captured.")
  })
})

describe("always job-id-first, and idempotency", () => {
  it.each([[{}], [{ respondAsync: true }], [{ respondAsync: false }]])("answers { jobId, status: pending } for %j", async (extra) => {
    const res = await post({ url: "https://example.com/", ...extra })
    expect(res.json()).toEqual({ jobId: "job-1", status: "pending" })
    await vi.waitFor(() => expect(h.run).toHaveBeenCalledWith({ url: "https://example.com/", maxStills: 8 }, expect.anything()))
  })

  it("a repeated idempotency key returns the first job and runs nothing", async () => {
    h.reserve.mockImplementation(async (_req: unknown, reply: CaptureReply) => {
      reply.code(200).send({ jobId: "winner", deduped: true })
      return undefined
    })
    const res = await post({ url: "https://example.com/" })
    expect(res.json()).toEqual({ jobId: "winner", deduped: true })
    await new Promise((r) => setTimeout(r, 20))
    expect(h.run).not.toHaveBeenCalled()
  })
})

describe("settlement", () => {
  it("completed: output_data is the stored output; the reservation is committed", async () => {
    await post({ url: "https://example.com/" })
    await vi.waitFor(() => expect(h.commit).toHaveBeenCalledWith("job-1"))
    expect(h.completed).toHaveBeenCalledWith("job-1", { output_data: OUTPUT })
    expect(h.refund).not.toHaveBeenCalled()
  })

  it.each([
    ["site_blocked"],
    ["site_empty"],
    ["site_unreachable"],
  ] as const)("%s fails the job with its providerRunId and refunds", async (code) => {
    h.run.mockRejectedValue(new SiteCaptureError(code, `message for ${code}`, "details", "run-9"))
    await post({ url: "https://example.com/" })
    await vi.waitFor(() => expect(h.refund).toHaveBeenCalledWith("job-1"))
    expect(h.failed).toHaveBeenCalledWith("job-1", {
      error_message: `message for ${code}`,
      extra: { output_data: { error: { code, message: `message for ${code}`, providerRunId: "run-9" } } },
    })
  })

  it("storage full fails storage_limit_exceeded and refunds", async () => {
    h.storeLocal.mockRejectedValue(new CaptureStorageFullError("Storage limit exceeded"))
    await post({ url: "https://example.com/" })
    await vi.waitFor(() => expect(h.refund).toHaveBeenCalled())
    expect((h.failed.mock.calls[0]![1] as { extra: { output_data: { error: { code: string } } } }).extra.output_data.error.code).toBe("storage_limit_exceeded")
  })

  it("lost_race deletes the stills and settles nothing", async () => {
    h.completed.mockResolvedValue("lost_race")
    await post({ url: "https://example.com/" })
    await vi.waitFor(() => expect(h.deleteAssets).toHaveBeenCalledWith("u1", ["a1", "a2"]))
    expect(h.commit).not.toHaveBeenCalled()
    expect(h.refund).not.toHaveBeenCalled()
  })

  it("held keeps the stills and the reservation", async () => {
    h.completed.mockResolvedValue("held")
    await post({ url: "https://example.com/" })
    await vi.waitFor(() => expect(h.completed).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(h.deleteAssets).not.toHaveBeenCalled()
    expect(h.commit).not.toHaveBeenCalled()
    expect(h.refund).not.toHaveBeenCalled()
  })

  it("blocked by a result policy deletes the stills and refunds nothing more", async () => {
    h.completed.mockResolvedValue("blocked")
    await post({ url: "https://example.com/" })
    await vi.waitFor(() => expect(h.deleteAssets).toHaveBeenCalledWith("u1", ["a1", "a2"]))
    expect(h.refund).not.toHaveBeenCalled()
  })

  it("a failed commit is logged, never refunded", async () => {
    h.commit.mockRejectedValue(new Error("db down"))
    await post({ url: "https://example.com/" })
    await vi.waitFor(() => expect(h.commit).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(h.refund).not.toHaveBeenCalled()
    expect(h.failed).not.toHaveBeenCalled()
  })
})

describe("relay failures", () => {
  beforeEach(() => {
    h.onCloud.mockResolvedValue(true)
    h.createCloudJob.mockResolvedValue("cloud-9")
  })
  const errorCode = () => (h.failed.mock.calls[0]![1] as { extra: { output_data: { error: { code: string } } } }).extra.output_data.error.code

  it("a cloud pre-flight refusal keeps the cloud's code", async () => {
    h.createCloudJob.mockRejectedValue(new NodaroCloudError("nodaro.ai: This site asks automated tools not to load this page (robots.txt).", 422, "robots_disallowed"))
    await post({ url: "https://example.com/" })
    await vi.waitFor(() => expect(h.failed).toHaveBeenCalled())
    expect(errorCode()).toBe("robots_disallowed")
  })

  it("a failed cloud job's own code is read back", async () => {
    h.waitForCloudJob.mockRejectedValue(new NodaroCloudError("nodaro.ai: The site blocked the capture"))
    h.cloudFetch.mockResolvedValue(new Response(JSON.stringify({ data: { output_data: { error: { code: "site_blocked" } } } }), { status: 200 }))
    await post({ url: "https://example.com/" })
    await vi.waitFor(() => expect(h.failed).toHaveBeenCalled())
    expect(h.cloudFetch).toHaveBeenCalledWith("/v1/jobs/cloud-9")
    expect(errorCode()).toBe("site_blocked")
  })

  it("an unknown cloud code becomes capture_failed", async () => {
    h.waitForCloudJob.mockRejectedValue(new NodaroCloudError("nodaro.ai: something"))
    h.cloudFetch.mockResolvedValue(new Response(JSON.stringify({ data: { output_data: { error: { code: "weird" } } } }), { status: 200 }))
    await post({ url: "https://example.com/" })
    await vi.waitFor(() => expect(h.failed).toHaveBeenCalled())
    expect(errorCode()).toBe("capture_failed")
  })

  it("the relay budget running out is capture_timeout", async () => {
    h.waitForCloudJob.mockRejectedValue(new NodaroCloudError("nodaro.ai: job cloud-9 did not finish within 15 minutes"))
    await post({ url: "https://example.com/" })
    await vi.waitFor(() => expect(h.failed).toHaveBeenCalled())
    expect(errorCode()).toBe("capture_timeout")
  })
})
