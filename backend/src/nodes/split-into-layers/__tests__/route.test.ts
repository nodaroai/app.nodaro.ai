/**
 * POST /v1/split-into-layers (the unit's route.ts): validates the body BEFORE
 * the credit guard (a malformed request hears its 400, never a 402), needs a
 * user, holds the row of its settings at the guard and at the reservation —
 * the size's tier at Max layers + 1 — inserts the job and queues it on the
 * video queue under the node's type, with the provider model named for the
 * pickup's safety check. A retry with the Idempotency-Key of a run already
 * started gets that run back at any age, before the price is resolved or any
 * credit check runs (quote.ts, the guard's `beforePricing` step).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify"

const m = vi.hoisted(() => ({
  resolved: [] as string[],
  reserveIds: [] as string[],
  insertJob: vi.fn(),
  queueAdd: vi.fn(),
  /** The guard's balance check refuses (402), as for a payer the first run's hold left short. */
  balanceShort: false,
  /** The jobs table the key lookup reads: it applies every `.eq` it is given. */
  jobs: [] as Array<Record<string, unknown>>,
  jobReads: 0,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => {
      m.jobReads++
      const filters: Array<[string, unknown]> = []
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => (filters.push([col, v]), q),
        limit: () => q,
        maybeSingle: async () => ({ data: m.jobs.find((r) => filters.every(([c, v]) => r[c] === v)) ?? null, error: null }),
      }
      return q
    },
  },
}))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
vi.mock("@/lib/insert-job.js", () => ({ insertJobIdempotent: m.insertJob }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: m.queueAdd }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", async () => ({
  // In the real guard's order: it keeps the request's Idempotency-Key, runs the
  // route's `beforePricing` step (which may answer the request: the guard then
  // stops), and only then resolves the price and checks the balance.
  creditGuard: (
    resolver: (req: FastifyRequest) => string,
    opts?: { beforePricing?: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown> },
  ) => async (req: FastifyRequest, reply: FastifyReply) => {
    // As the real guard keeps a request's Idempotency-Key for the route's insert:
    // trimmed, and only from its minimum length (a shorter key dedups nothing).
    const { MIN_IDEMPOTENCY_KEY_LENGTH } = await import("@/lib/dedup-fingerprint.js")
    const raw = req.headers["idempotency-key"]
    const key = typeof raw === "string" ? raw.trim() : ""
    if (key.length >= MIN_IDEMPOTENCY_KEY_LENGTH) req.idempotencyKey = key
    if (opts?.beforePricing) {
      await opts.beforePricing(req, reply)
      if (reply.sent) return
    }
    m.resolved.push(resolver(req))
    if (m.balanceShort) return reply.code(402).send({ error: { code: "insufficient_credits", message: "Not enough credits" } })
  },
  reserveCreditsForJob: async (_req: unknown, _reply: unknown, _jobId: string, id: string) => {
    m.reserveIds.push(id)
    return { usageLogId: "ul-1", creditsReserved: 1, watermark: false }
  },
}))

import { route } from "../route.js"
import { quote } from "../quote.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002"
const URL = "/v1/split-into-layers"
const IMAGE = "https://media.test/poster.png"
/** One press's Idempotency-Key, re-sent when the press may have reached the server. */
const KEY = "poster-1-layers"
/** The run that press started, two minutes ago: past the guard's own 10 s lookup. */
const firstRun = (over: Record<string, unknown> = {}) => ({
  id: "job-first",
  user_id: USER_ID,
  idempotency_key: KEY,
  provider: "kie",
  job_type: "split-into-layers",
  run_type: "split-into-layers",
  status: "processing",
  created_at: new Date(Date.now() - 120_000).toISOString(),
  ...over,
})

async function makeApp(userId: string | null = USER_ID): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = userId ?? undefined
  })
  await app.register(route)
  await app.ready()
  return app
}

beforeEach(() => {
  m.resolved = []
  m.reserveIds = []
  m.balanceShort = false
  m.jobs = []
  m.jobReads = 0
  m.insertJob.mockReset().mockResolvedValue({ row: { id: "job-1" }, created: true })
  m.queueAdd.mockReset().mockResolvedValue({ id: "q-1" })
})

describe("POST /v1/split-into-layers", () => {
  it("queues the job with the defaults (9 layers, 1K), holding the default row", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL, payload: { imageUrl: IMAGE } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(m.resolved).toEqual(["split-into-layers:1k:10"])
    expect(m.reserveIds).toEqual(["split-into-layers:1k:10"])
    expect(m.queueAdd).toHaveBeenCalledWith("split-into-layers", {
      jobId: "job-1", imageUrl: IMAGE, maxLayers: 9, size: "1K", model: "seedream-5-5-layer-decomposition", usageLogId: "ul-1",
    })
    expect(m.insertJob.mock.calls[0]![1]).toMatchObject({ user_id: USER_ID, status: "pending", input_data: expect.objectContaining({ imageUrl: IMAGE, maxLayers: 9, size: "1K" }) })
  })

  it("holds the size's tier at Max layers + 1 and sends a trimmed description", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL, payload: { imageUrl: IMAGE, maxLayers: 3, size: "auto", prompt: "  the title and the parrot  " } })
    expect(res.statusCode).toBe(200)
    expect(m.reserveIds).toEqual(["split-into-layers:2k:4"])
    expect(m.queueAdd.mock.calls[0]![1]).toMatchObject({ maxLayers: 3, size: "auto", prompt: "the title and the parrot" })
  })

  it("a direct run keeps the node's own 1-99 range (the app's 1-20 slider is not the route's), at every declared size", async () => {
    for (const size of ["auto", "1K", "1.5K", "2K"]) {
      const app = await makeApp()
      const res = await app.inject({ method: "POST", url: URL, payload: { imageUrl: IMAGE, maxLayers: 99, size } })
      expect(res.statusCode, size).toBe(200)
    }
    expect(m.reserveIds).toContain("split-into-layers:2k:100")
    expect(m.reserveIds).toContain("split-into-layers:1k:100")
  })

  it("an empty description is not sent (the model finds the main elements)", async () => {
    const app = await makeApp()
    await app.inject({ method: "POST", url: URL, payload: { imageUrl: IMAGE, prompt: "   " } })
    expect(m.queueAdd.mock.calls[0]![1]).not.toHaveProperty("prompt")
  })

  it.each([
    ["no image", {}],
    ["Max layers 0", { imageUrl: IMAGE, maxLayers: 0 }],
    ["Max layers 100", { imageUrl: IMAGE, maxLayers: 100 }],
    ["Max layers 2.5", { imageUrl: IMAGE, maxLayers: 2.5 }],
    ["an unknown size", { imageUrl: IMAGE, size: "4K" }],
    ["a description over 2,000 characters", { imageUrl: IMAGE, prompt: "x".repeat(2001) }],
  ])("%s: 400 validation_error before the guard holds anything", async (_name, payload) => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL, payload })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(m.resolved).toEqual([])
    expect(m.insertJob).not.toHaveBeenCalled()
  })

  it("files the row under the request's Idempotency-Key, and answers a repeat with the job it already started", async () => {
    const app = await makeApp()
    m.insertJob.mockResolvedValueOnce({ row: { id: "job-1" }, created: false })
    const res = await app.inject({ method: "POST", url: URL, payload: { imageUrl: IMAGE }, headers: { "idempotency-key": "poster-1-layers" } })
    expect(m.insertJob.mock.calls[0]![2]).toBe("poster-1-layers")
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1", deduped: true })
    expect(res.headers["x-dedup-hit"]).toBe("1")
    // A repeat holds nothing and queues nothing.
    expect(m.reserveIds).toEqual([])
    expect(m.queueAdd).not.toHaveBeenCalled()
  })

  it("a key shorter than the guard's minimum is no key: the row is inserted without one and the run starts", async () => {
    const app = await makeApp()
    const res = await app.inject({ method: "POST", url: URL, payload: { imageUrl: IMAGE }, headers: { "idempotency-key": "short" } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(m.insertJob.mock.calls[0]![2]).toBeUndefined()
    expect(m.reserveIds).toEqual(["split-into-layers:1k:10"])
  })

  it("needs a user", async () => {
    const app = await makeApp(null)
    const res = await app.inject({ method: "POST", url: URL, payload: { imageUrl: IMAGE } })
    expect(res.statusCode).toBe(401)
    expect(m.queueAdd).not.toHaveBeenCalled()
  })
})

describe("POST /v1/split-into-layers: a retry with the key of a run already started", () => {
  const post = (app: FastifyInstance, key: string = KEY) =>
    app.inject({ method: "POST", url: URL, payload: { imageUrl: IMAGE }, headers: { "idempotency-key": key } })

  it("is answered with that run however long after, before any credit check, even one that would refuse it", async () => {
    m.jobs = [firstRun()]
    m.balanceShort = true
    const app = await makeApp()
    const res = await post(app)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-first", deduped: true })
    expect(res.headers["x-dedup-hit"]).toBe("1")
    // Nothing priced, checked, inserted, held or queued.
    expect(m.resolved).toEqual([])
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.reserveIds).toEqual([])
    expect(m.queueAdd).not.toHaveBeenCalled()
  })

  it("a run that has ended is still the one answered (the insert would answer it too)", async () => {
    m.jobs = [firstRun({ status: "completed", created_at: new Date(Date.now() - 86_400_000).toISOString() })]
    const app = await makeApp()
    const res = await post(app)
    expect(res.json()).toEqual({ jobId: "job-first", deduped: true })
    expect(m.insertJob).not.toHaveBeenCalled()
  })

  it("a fresh key still goes through every check: refused when the balance is short, started when it is not", async () => {
    m.jobs = [firstRun()]
    m.balanceShort = true
    const app = await makeApp()
    const refused = await post(app, "poster-2-layers")
    expect(refused.statusCode).toBe(402)
    expect(refused.json().error.code).toBe("insufficient_credits")
    expect(m.insertJob).not.toHaveBeenCalled()

    m.balanceShort = false
    const started = await post(app, "poster-2-layers")
    expect(started.statusCode).toBe(200)
    expect(started.json()).toEqual({ jobId: "job-1" })
    expect(m.resolved).toEqual(["split-into-layers:1k:10", "split-into-layers:1k:10"])
    expect(m.insertJob.mock.calls[0]![2]).toBe("poster-2-layers")
    expect(m.reserveIds).toEqual(["split-into-layers:1k:10"])
    expect(m.queueAdd).toHaveBeenCalledTimes(1)
  })

  it("another user's run under the same key is never answered: the caller's request is checked and run as their own", async () => {
    m.jobs = [firstRun({ user_id: OTHER_USER_ID })]
    m.balanceShort = true
    const app = await makeApp()
    const refused = await post(app)
    expect(refused.statusCode).toBe(402)
    expect(JSON.stringify(refused.json())).not.toContain("job-first")

    m.balanceShort = false
    const started = await post(app)
    expect(started.json()).toEqual({ jobId: "job-1" })
    expect(m.insertJob.mock.calls[0]![1]).toMatchObject({ user_id: USER_ID })
    expect(m.insertJob.mock.calls[0]![2]).toBe(KEY)
  })

  it("another kind of job under the key is not answered here: the request goes on to the checks and the insert, as before", async () => {
    m.jobs = [firstRun({ id: "job-image", provider: "kie", job_type: "generate-image", run_type: "generate-image" })]
    m.insertJob.mockResolvedValueOnce({ row: { id: "job-image" }, created: false })
    const app = await makeApp()
    const res = await post(app)
    expect(m.resolved).toEqual(["split-into-layers:1k:10"])
    expect(m.insertJob).toHaveBeenCalledTimes(1)
    expect(res.json()).toEqual({ jobId: "job-image", deduped: true })
    expect(m.reserveIds).toEqual([])
  })

  it("a request without a key the guard kept (a quote, or a key under the minimum) looks nothing up", async () => {
    m.jobs = [firstRun({ idempotency_key: "short" })]
    const app = await makeApp()
    const res = await post(app, "short")
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(m.jobReads).toBe(0)

    // POST /v1/quote runs the same step on a request no guard has kept a key on.
    const sent: unknown[] = []
    const reply = { sent: false, header: () => reply, code: () => reply, status: () => reply, send: (b: unknown) => (sent.push(b), reply) }
    const quoteReq = { userId: USER_ID, headers: { "idempotency-key": KEY }, body: { imageUrl: IMAGE } } as unknown as FastifyRequest
    m.jobs = [firstRun()]
    await quote.pricing.opts!.beforePricing!(quoteReq, reply as unknown as FastifyReply)
    expect(sent).toEqual([])
    expect(m.jobReads).toBe(0)
  })
})
