/**
 * POST /v1/generate-image — several images in one call.
 *
 *  - `count` (1–4): N separate jobs of one model, one image each, each under
 *    its own idempotency key (`<key>:<i>`); a set `seed` gives image i `seed + i`.
 *  - `models` (2–4 distinct ids, instead of `provider`): the same request on
 *    each model, each model's levers snapped by the SAME catalog functions as a
 *    single call, corrections reported per model; with `count`, per model
 *    (models × count ≤ 8).
 *  - No `count` / `models` (or `count: 1`): exactly today's `{ jobId }`.
 *  - The batch is checked (the credit guard's `batchIdentifiers`), created,
 *    reserved and queued ALL OR NOTHING; every job carries one `batchId`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify"

const h = vi.hoisted(() => ({
  guardOpts: null as null | { batchIdentifiers?: (req: unknown) => readonly string[] | undefined },
  /** What the credit check was asked to price for the request (`batchIdentifiers`). */
  checkIds: undefined as readonly string[] | undefined,
  /** When set, the guard answers 402 for any batch, with the price it was asked to check. */
  refuseBatches: false,
  /** Keys whose job already exists: the idempotent insert answers it instead of inserting. */
  existing: new Map<string, { id: string; credits: number | null; status?: string; input_data?: Record<string, unknown>; input_fingerprint?: string }>(),
  /** Credit holds by job id: a job left `pending` with one is paid for. */
  holds: new Map<string, string>(),
  inserted: [] as Array<{ row: Record<string, unknown>; key: string | null | undefined }>,
  refunded: [] as string[],
  deleted: [] as string[][],
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      delete: () => ({ in: (_c: string, ids: string[]) => { h.deleted.push(ids); return { eq: () => Promise.resolve({ error: null }) } } }),
    })),
    auth: { getUser: vi.fn() },
  },
}))
vi.mock("@/lib/idempotent-insert.js", () => ({
  insertWithIdempotencyKey: vi.fn(async (_t: string, row: Record<string, unknown>, key: string | null | undefined) => {
    const prior = key ? h.existing.get(key) : undefined
    if (prior) return { row: prior, created: false }
    h.inserted.push({ row, key })
    return { row: { id: `job-${h.inserted.length}`, credits: null }, created: true }
  }),
}))
vi.mock("@/lib/access-blocks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/access-blocks.js")>()),
  isUserBlocked: vi.fn(async () => false),
}))
vi.mock("@/lib/job-policy-audit.js", () => ({ recordJobPolicyDecision: vi.fn(), hashGateSubject: vi.fn(() => "h") }))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({
  refundReservedCreditsForJob: vi.fn(async (jobId: string) => { h.refunded.push(jobId); return 1 }),
  refundJobHoldsConfirmed: vi.fn(async (jobId: string) => { h.refunded.push(jobId); return true }),
  jobCreditHolds: vi.fn(async (ids: readonly string[]) => new Map([...h.holds].filter(([id]) => ids.includes(id)).map(([id, log]) => [id, [{ id: log, credits: 60 }]]))),
  refundUsageLogConfirmed: vi.fn(async () => true),
}))
vi.mock("@/lib/job-batch-claim.js", () => ({
  batchClaimKey: (userId: string, key: string) => `claim:${userId}:${key}`,
  claimBatch: vi.fn(async () => ({ renew: async () => true, release: async () => {} })),
}))
vi.mock("@/lib/dedup-fingerprint.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/dedup-fingerprint.js")>()),
  findJobsByIdempotencyKeys: vi.fn(async (_userId: string, keys: readonly string[]) => {
    const found = new Map<string, { id: string; status: string | null; credits: number | null; input_data: Record<string, unknown> | null }>()
    for (const key of keys) {
      const row = h.existing.get(key)
      if (row) found.set(key, { id: row.id, status: row.status ?? null, credits: row.credits, input_data: row.input_data ?? null })
    }
    return found
  }),
}))
vi.mock("@/lib/queue.js", () => ({
  videoQueue: {
    add: vi.fn().mockResolvedValue({ id: "queue-job-1" }),
    addBulk: vi.fn().mockResolvedValue([]),
  },
  redis: {},
}))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: (_resolver: unknown, opts?: { batchIdentifiers?: (req: unknown) => readonly string[] | undefined }) => {
    h.guardOpts = opts ?? null
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const ids = opts?.batchIdentifiers?.(req)
      h.checkIds = ids
      // An empty batch costs 0, which any balance covers (as in the real guard).
      if (h.refuseBatches && ids && ids.length > 0) {
        return reply.code(402).send({ error: { code: "insufficient_credits", message: "Insufficient credits" }, required: ids.length * 60, balance: 10 })
      }
    }
  },
  reserveCreditsForJob: vi.fn(),
}))

/** The reservation every test starts from: each job reserved at its model's price. */
async function reserveAtPrice(_req: unknown, _reply: unknown, jobId: string, identifier: string) {
  return { usageLogId: `log-${jobId}`, creditsReserved: identifier.startsWith("flux-2") ? 90 : 60, watermark: false }
}
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test", CHARACTER_LORA_ROUTING_ENABLED: true },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

import { generateImageRoutes, resolveImageBatchCreditIdentifiers, resolveImageCreditIdentifier } from "../generate-image.js"
import { videoQueue } from "../../lib/queue.js"
import { reserveCreditsForJob } from "../../middleware/credit-guard.js"
import { presetCatalog } from "../../lib/presets/app-presets.js"
import { buildGenerateImagePresetBody } from "../../lib/presets/apply-image-preset.js"

const USER = "00000000-0000-4000-8000-000000000001"
const KEY = "client-key-0001"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(reserveCreditsForJob).mockImplementation(reserveAtPrice as never)
  h.refuseBatches = false
  h.checkIds = undefined
  h.existing.clear()
  h.holds.clear()
  h.inserted.length = 0
  h.refunded.length = 0
  h.deleted.length = 0
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
    // What the real guard does with the header: the route keys its jobs from it.
    const header = req.headers["idempotency-key"]
    if (typeof header === "string") req.idempotencyKey = header
  })
  await app.register(async (instance) => { await generateImageRoutes(instance) })
  await app.ready()
})
afterEach(async () => { await app.close() })

async function post(payload: Record<string, unknown>, key?: string) {
  return app.inject({
    method: "POST",
    url: "/v1/generate-image",
    payload: { userId: USER, ...payload },
    ...(key ? { headers: { "idempotency-key": key } } : {}),
  })
}

const rows = () => h.inserted.map((c) => c.row.input_data as Record<string, unknown>)
const bulk = () => (vi.mocked(videoQueue.addBulk).mock.calls[0]?.[0] ?? []) as Array<{ name: string; data: Record<string, unknown> }>

describe("one image: no count / models, or count 1 — exactly today's answer", () => {
  it("count 1 is the single-job call: `{ jobId }`, one key, no batch fields stored", async () => {
    const res = await post({ prompt: "a red car", provider: "gpt-image-2", aspectRatio: "16:9", count: 1 }, KEY)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1" })
    expect(h.inserted.map((c) => c.key)).toEqual([KEY])
    expect(rows()[0]).not.toHaveProperty("count")
    expect(rows()[0]).not.toHaveProperty("batchId")
    expect(videoQueue.add).toHaveBeenCalledTimes(1)
    expect(videoQueue.addBulk).not.toHaveBeenCalled()
  })

  it("the guard is told this is not a batch", () => {
    expect(resolveImageBatchCreditIdentifiers({ body: { prompt: "x", provider: "gpt-image-2" } } as FastifyRequest)).toBeUndefined()
    expect(resolveImageBatchCreditIdentifiers({ body: { prompt: "x", provider: "gpt-image-2", count: 1 } } as FastifyRequest)).toBeUndefined()
  })
})

describe("count — N images of one model", () => {
  it("creates N jobs with N keys, one image each, and queues them in one call", async () => {
    const res = await post({ prompt: "a red car", provider: "gpt-image-2", aspectRatio: "16:9", count: 3 }, KEY)
    expect(res.statusCode).toBe(200)
    expect(h.inserted.map((c) => c.key)).toEqual([`${KEY}:0`, `${KEY}:1`, `${KEY}:2`])
    expect(vi.mocked(reserveCreditsForJob).mock.calls.map((c) => c[2])).toEqual(["job-1", "job-2", "job-3"])
    expect(videoQueue.add).not.toHaveBeenCalled()
    expect(vi.mocked(videoQueue.addBulk)).toHaveBeenCalledTimes(1)
    expect(bulk().map((j) => [j.name, j.data.jobId, j.data.usageLogId])).toEqual([
      ["generate-image", "job-1", "log-job-1"],
      ["generate-image", "job-2", "log-job-2"],
      ["generate-image", "job-3", "log-job-3"],
    ])
  })

  it("answers every job id, grouped by model, with the credits charged", async () => {
    const res = await post({ prompt: "a red car", provider: "gpt-image-2", aspectRatio: "16:9", count: 2 }, KEY)
    const body = res.json()
    expect(body).toEqual({
      jobId: "job-1",
      jobIds: ["job-1", "job-2"],
      batchId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      groups: [{ model: "gpt-image-2", jobIds: ["job-1", "job-2"], credits: 120 }],
      totalCredits: 120,
    })
  })

  it("every job of the batch carries the same batchId, and its own position", async () => {
    const res = await post({ prompt: "a red car", provider: "gpt-image-2", count: 3 }, KEY)
    const { batchId } = res.json()
    expect(rows().map((r) => r.batchId)).toEqual([batchId, batchId, batchId])
    expect(rows().map((r) => r.batchIndex)).toEqual([0, 1, 2])
    // One image per job: nothing of the batch request is stored on a job.
    for (const r of rows()) {
      expect(r).not.toHaveProperty("count")
      expect(r).not.toHaveProperty("models")
    }
  })

  it("a set seed gives image i `seed + i` — on the job and on the provider call", async () => {
    await post({ prompt: "a red car", provider: "gpt-image-2", count: 3, seed: 41 }, KEY)
    expect(rows().map((r) => r.seed)).toEqual([41, 42, 43])
    expect(bulk().map((j) => j.data.seed)).toEqual([41, 42, 43])
  })

  it("no seed: none is invented", async () => {
    await post({ prompt: "a red car", provider: "gpt-image-2", count: 2 }, KEY)
    expect(rows().map((r) => r.seed)).toEqual([undefined, undefined])
  })

  it("the same key gives the same batchId; a different key, another", async () => {
    const a = (await post({ prompt: "a red car", provider: "gpt-image-2", count: 2 }, KEY)).json().batchId
    h.inserted.length = 0
    const b = (await post({ prompt: "a red car", provider: "gpt-image-2", count: 2 }, "client-key-0002")).json().batchId
    expect(a).not.toBe(b)
    h.inserted.length = 0
    expect((await post({ prompt: "a red car", provider: "gpt-image-2", count: 2 }, KEY)).json().batchId).toBe(a)
  })

  it("without a key: plain inserts and a fresh batchId each time", async () => {
    const a = (await post({ prompt: "a red car", provider: "gpt-image-2", count: 2 })).json().batchId
    expect(h.inserted.map((c) => c.key)).toEqual([undefined, undefined])
    const b = (await post({ prompt: "a red car", provider: "gpt-image-2", count: 2 })).json().batchId
    expect(a).not.toBe(b)
  })
})

describe("count — a replay with the same key", () => {
  it("returns the same N ids, deduped, and reserves and queues nothing", async () => {
    h.existing.set(`${KEY}:0`, { id: "job-a", credits: 60 })
    h.existing.set(`${KEY}:1`, { id: "job-b", credits: 60 })
    const res = await post({ prompt: "a red car", provider: "gpt-image-2", count: 2 }, KEY)
    expect(res.statusCode).toBe(200)
    expect(res.headers["x-dedup-hit"]).toBe("1")
    expect(res.json()).toMatchObject({ jobId: "job-a", jobIds: ["job-a", "job-b"], deduped: true, totalCredits: 120 })
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(videoQueue.addBulk).not.toHaveBeenCalled()
  })

  it("a partly-created batch completes: only the missing image is created, reserved and queued", async () => {
    h.existing.set(`${KEY}:0`, { id: "job-a", credits: 60 })
    const res = await post({ prompt: "a red car", provider: "gpt-image-2", count: 2, seed: 7 }, KEY)
    expect(res.json().jobIds).toEqual(["job-a", "job-1"])
    expect(res.json()).not.toHaveProperty("deduped")
    expect(h.inserted.map((c) => c.key)).toEqual([`${KEY}:1`])
    // The missing image is the SAME image it would have been: its own seed.
    expect(rows()[0].seed).toBe(8)
    expect(bulk().map((j) => j.data.jobId)).toEqual(["job-1"])
  })
})

describe("a repeat of a keyed batch is answered before the balance check", () => {
  it("every job exists: the batch's answer, with no balance check at all (a low balance cannot 402 it)", async () => {
    h.refuseBatches = true
    h.existing.set(`${KEY}:0`, { id: "job-a", credits: 60, status: "completed" })
    h.existing.set(`${KEY}:1`, { id: "job-b", credits: 60, status: "processing" })
    const res = await post({ prompt: "a red car", provider: "gpt-image-2", count: 2 }, KEY)
    expect(res.statusCode).toBe(200)
    expect(res.headers["x-dedup-hit"]).toBe("1")
    expect(res.json()).toEqual({
      jobId: "job-a",
      jobIds: ["job-a", "job-b"],
      batchId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      groups: [{ model: "gpt-image-2", jobIds: ["job-a", "job-b"], credits: 120 }],
      totalCredits: 120,
      deduped: true,
    })
    expect(h.checkIds).toBeUndefined()
    expect(h.inserted).toHaveLength(0)
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
  })

  it("the replay carries the same batchId as the request that made the jobs", async () => {
    const first = (await post({ prompt: "a red car", provider: "gpt-image-2", count: 2 }, KEY)).json()
    h.existing.set(`${KEY}:0`, { id: first.jobIds[0], credits: 60, status: "completed" })
    h.existing.set(`${KEY}:1`, { id: first.jobIds[1], credits: 60, status: "completed" })
    const again = (await post({ prompt: "a red car", provider: "gpt-image-2", count: 2 }, KEY)).json()
    expect(again.batchId).toBe(first.batchId)
    expect(again.jobIds).toEqual(first.jobIds)
  })

  it("a models batch replays grouped by its models", async () => {
    h.existing.set(`${KEY}:0`, { id: "job-a", credits: 60, status: "completed" })
    h.existing.set(`${KEY}:1`, { id: "job-b", credits: 90, status: "completed" })
    const res = await post({ prompt: "a lighthouse", models: ["gpt-image-2", "flux-2-max"] }, KEY)
    expect(res.json().groups).toEqual([
      { model: "gpt-image-2", jobIds: ["job-a"], credits: 60 },
      { model: "flux-2-max", jobIds: ["job-b"], credits: 90 },
    ])
  })

  it("a job paid for but still pending is queued again, charging nothing (it may never have reached the queue)", async () => {
    h.refuseBatches = true
    h.existing.set(`${KEY}:0`, { id: "job-a", credits: 60, status: "pending" })
    h.existing.set(`${KEY}:1`, { id: "job-b", credits: 60, status: "completed" })
    h.holds.set("job-a", "log-a")
    const res = await post({ prompt: "a red car", provider: "gpt-image-2", count: 2 }, KEY)
    // Nothing left to pay for: the guard is handed an empty batch, never one image.
    expect(h.checkIds).toEqual([])
    expect(res.statusCode).toBe(200)
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(bulk().map((j) => [j.data.jobId, j.data.usageLogId])).toEqual([["job-a", "log-a"]])
    expect(res.json()).toMatchObject({ jobIds: ["job-a", "job-b"], deduped: true })
    expect(res.headers["x-dedup-hit"]).toBe("1")
  })

  it("part of the batch exists: only the missing jobs are priced", async () => {
    h.existing.set(`${KEY}:0`, { id: "job-a", credits: 60, status: "completed" })
    h.refuseBatches = true
    const res = await post({ prompt: "a red car", provider: "gpt-image-2", count: 3 }, KEY)
    expect(res.statusCode).toBe(402)
    expect(h.checkIds).toHaveLength(2)
    expect(res.json().required).toBe(120)
  })

  it("a job left pending with nothing held is priced and taken over: reserved and queued", async () => {
    h.existing.set(`${KEY}:0`, { id: "job-a", credits: 60, status: "completed" })
    h.existing.set(`${KEY}:1`, { id: "job-b", credits: null, status: "pending" })
    const res = await post({ prompt: "a red car", provider: "gpt-image-2", count: 2 }, KEY)
    expect(res.statusCode).toBe(200)
    expect(h.checkIds).toHaveLength(1)
    expect(h.inserted).toHaveLength(0)
    expect(vi.mocked(reserveCreditsForJob).mock.calls.map((c) => c[2])).toEqual(["job-b"])
    expect(bulk().map((j) => j.data.jobId)).toEqual(["job-b"])
    expect(res.json()).toMatchObject({ jobIds: ["job-a", "job-b"], totalCredits: 120 })
    // This request charged for job-b: not a no-op repeat.
    expect(res.json()).not.toHaveProperty("deduped")
    expect(res.headers["x-dedup-hit"]).toBeUndefined()
  })

  it("the same key for a DIFFERENT request never runs the new body at the earlier charge: 422", async () => {
    h.existing.set(`${KEY}:0`, { id: "job-a", credits: null, status: "pending", input_fingerprint: "fingerprint-of-another-request" })
    const res = await post({ prompt: "a blue boat", provider: "gpt-image-2", count: 2 }, KEY)
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("idempotency_key_reused")
    expect(reserveCreditsForJob).not.toHaveBeenCalled()
    expect(videoQueue.addBulk).not.toHaveBeenCalled()
  })

  it("every batch job is queued under its own queue id, so a re-queue is a no-op while it waits", async () => {
    await post({ prompt: "a red car", provider: "gpt-image-2", count: 2 }, KEY)
    const calls = vi.mocked(videoQueue.addBulk).mock.calls[0]![0] as Array<{ opts?: { jobId?: string } }>
    expect(calls.map((c) => c.opts?.jobId)).toEqual(["generate-image-job-1", "generate-image-job-2"])
  })
})

describe("credits — all or nothing", () => {
  it("insufficient credits for the batch: 402 with the total, nothing created", async () => {
    h.refuseBatches = true
    const res = await post({ prompt: "a red car", provider: "gpt-image-2", count: 3 }, KEY)
    expect(res.statusCode).toBe(402)
    expect(res.json().required).toBe(180)
    expect(h.inserted).toHaveLength(0)
    expect(videoQueue.addBulk).not.toHaveBeenCalled()
  })

  it("a reservation that fails mid-batch refunds and removes the jobs already created; nothing is queued", async () => {
    vi.mocked(reserveCreditsForJob).mockImplementation(async (_req, reply, jobId) => {
      if (jobId === "job-2") {
        reply.status(402).send({ error: { code: "insufficient_credits", message: "Insufficient credits" } })
        return undefined
      }
      return { usageLogId: `log-${jobId}`, creditsReserved: 60, watermark: false }
    })
    const res = await post({ prompt: "a red car", provider: "gpt-image-2", count: 3 }, KEY)
    expect(res.statusCode).toBe(402)
    expect(h.refunded).toEqual(expect.arrayContaining(["job-1", "job-2"]))
    expect(h.deleted).toEqual([["job-1", "job-2", "job-3"]])
    expect(videoQueue.addBulk).not.toHaveBeenCalled()
  })

  it("a queue failure refunds and removes the whole batch and answers 500", async () => {
    vi.mocked(videoQueue.addBulk).mockRejectedValueOnce(new Error("redis down"))
    const res = await post({ prompt: "a red car", provider: "gpt-image-2", count: 2 }, KEY)
    expect(res.statusCode).toBe(500)
    expect(h.refunded).toEqual(["job-1", "job-2"])
    expect(h.deleted).toEqual([["job-1", "job-2"]])
  })
})

describe("models — one request, several models", () => {
  it("fans out to each model, snapping each one's levers like a single call, and reports corrections per model", async () => {
    const res = await post({ prompt: "a lighthouse", models: ["gpt-image-2", "nano-banana-2-1"], aspectRatio: "3:2", resolution: "4K" }, KEY)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.groups.map((g: { model: string }) => g.model)).toEqual(["gpt-image-2", "nano-banana-2-1"])
    expect(body.jobIds).toHaveLength(2)

    // gpt-image-2 has no 3:2: snapped, and said so on ITS group only.
    const gpt = body.groups[0]
    expect(gpt.adjustments?.map((a: { field: string }) => a.field)).toContain("aspectRatio")
    const gptRow = rows()[0]
    expect(gptRow.provider).toBe("gpt-image-2")
    expect(gptRow.aspectRatio).not.toBe("3:2")

    const nanoRow = rows()[1]
    expect(nanoRow.provider).toBe("nano-banana-2-1")
    // Each job is sent to its own model, with its own snapped levers.
    expect(bulk().map((j) => j.data.provider)).toEqual(["gpt-image-2", "nano-banana-2-1"])
    expect(bulk()[0]!.data.aspectRatio).toBe(gptRow.aspectRatio)
    expect(bulk()[1]!.data.aspectRatio).toBe(nanoRow.aspectRatio)
  })

  it("prices each model where the pre-flight priced it: CHECK === DEBIT, job by job", async () => {
    const payload = { prompt: "a lighthouse", models: ["gpt-image-2", "flux-2-max"], count: 2, resolution: "1K", userId: USER }
    const check = resolveImageBatchCreditIdentifiers({ body: payload } as FastifyRequest)
    await post(payload, KEY)
    const debit = vi.mocked(reserveCreditsForJob).mock.calls.map((c) => c[3])
    expect(check).toEqual(debit)
    expect(debit).toEqual(["gpt-image-2", "gpt-image-2", "flux-2-max:2MP:0ref", "flux-2-max:2MP:0ref"])
    // The single-job identifier the guard also gets is the first model's.
    expect(resolveImageCreditIdentifier({ body: payload } as FastifyRequest)).toBe("gpt-image-2")
  })

  it("with count, per model: models × count jobs, grouped, seeds counted within each model", async () => {
    const res = await post({ prompt: "a lighthouse", models: ["gpt-image-2", "nano-banana-2-1"], count: 2, seed: 10 }, KEY)
    const body = res.json()
    expect(body.groups.map((g: { jobIds: string[] }) => g.jobIds)).toEqual([["job-1", "job-2"], ["job-3", "job-4"]])
    expect(rows().map((r) => [r.provider, r.seed])).toEqual([
      ["gpt-image-2", 10], ["gpt-image-2", 11], ["nano-banana-2-1", 10], ["nano-banana-2-1", 11],
    ])
    expect(h.inserted.map((c) => c.key)).toEqual([`${KEY}:0`, `${KEY}:1`, `${KEY}:2`, `${KEY}:3`])
    expect(body.totalCredits).toBe(240)
  })

  it("the pre-flight is asked to check every job of the fan-out", async () => {
    h.refuseBatches = true
    const res = await post({ prompt: "a lighthouse", models: ["gpt-image-2", "nano-banana-2-1"], count: 2 }, KEY)
    expect(res.statusCode).toBe(402)
    expect(res.json().required).toBe(240)
    expect(h.inserted).toHaveLength(0)
  })
})

describe("validation — refused before anything is created", () => {
  it.each([
    ["count above 4", { count: 5, provider: "gpt-image-2" }],
    ["count 0", { count: 0, provider: "gpt-image-2" }],
    ["a fractional count", { count: 1.5, provider: "gpt-image-2" }],
    ["one model", { models: ["gpt-image-2"] }],
    ["five models", { models: ["gpt-image-2", "nano-banana-2-1", "flux-2-max", "flux-2-pro", "seedream-5-lite"] }],
    ["a repeated model", { models: ["gpt-image-2", "gpt-image-2"] }],
    ["an unknown model", { models: ["gpt-image-2", "no-such-model"] }],
    ["models with provider", { models: ["gpt-image-2", "nano-banana-2-1"], provider: "flux-2-max" }],
    ["more than 8 images", { models: ["gpt-image-2", "nano-banana-2-1", "flux-2-max"], count: 3 }],
  ])("%s → 400 validation_error", async (_label, extra) => {
    const res = await post({ prompt: "a red car", ...extra }, KEY)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(h.inserted).toHaveLength(0)
    // The guard is never told an invalid body is a batch.
    expect(resolveImageBatchCreditIdentifiers({ body: { prompt: "a red car", ...extra } } as FastifyRequest)).toBeUndefined()
  })

  it("models with the internal LoRA hint → 400", async () => {
    const res = await post({ prompt: "a red car", models: ["gpt-image-2", "nano-banana-2-1"], _internalLora: { characterId: "00000000-0000-4000-8000-0000000000bb" } }, KEY)
    expect(res.statusCode).toBe(400)
    expect(h.inserted).toHaveLength(0)
  })
})

// A preset combined with a batch is applied through the ONE application path
// (#2267's `buildGenerateImagePresetBody`, run by the route's preset hook) for
// every planned job — once for `count` (one model), once PER MODEL for
// `models` (that model as the explicit `provider` edit) — and each model's
// levers are then snapped by the route like any single call.
describe("presetId with count / models — the preset applied for every planned job", () => {
  const PRESET_ID = "generate-image/cinematic-still"
  const presetData = () => presetCatalog("generate-image").find((p) => p.id === PRESET_ID)!.data as Record<string, unknown>
  /** The editor's request for this preset on this model (the single application path). */
  const editorBody = (overrides: Record<string, unknown>) => buildGenerateImagePresetBody(presetData(), overrides)

  it("presetId + count: N jobs of the preset's request, each its own key and seed", async () => {
    const res = await post({ presetId: PRESET_ID, prompt: "a lighthouse at dusk", count: 2, seed: 5 }, KEY)
    expect(res.statusCode).toBe(200)
    const expected = editorBody({ prompt: "a lighthouse at dusk" })
    expect(rows().map((r) => r.provider)).toEqual([expected.provider, expected.provider])
    expect(rows().map((r) => r.prompt)).toEqual([expected.prompt, expected.prompt])
    expect(rows().map((r) => r.seed)).toEqual([5, 6])
    expect(h.inserted.map((c) => c.key)).toEqual([`${KEY}:0`, `${KEY}:1`])
    // Never stored on a job: the preset is applied, not recorded.
    for (const r of rows()) expect(r).not.toHaveProperty("presetId")
    expect(res.json().groups).toEqual([{ model: expected.provider, jobIds: ["job-1", "job-2"], credits: 120 }])
  })

  it("presetId + models: the preset applied once PER MODEL — each model gets the editor's request for it", async () => {
    // gpt-image-2 folds a negative prompt into the prompt ("Avoid: …"); imagen4
    // takes it natively — so one application shared by both would be wrong for one.
    const res = await post({ presetId: PRESET_ID, prompt: "a lighthouse at dusk", models: ["gpt-image-2", "imagen4"] }, KEY)
    expect(res.statusCode).toBe(200)
    const [gpt, imagen] = rows()
    const gptExpected = editorBody({ prompt: "a lighthouse at dusk", provider: "gpt-image-2" })
    const imagenExpected = editorBody({ prompt: "a lighthouse at dusk", provider: "imagen4" })
    expect(gpt!.provider).toBe("gpt-image-2")
    expect(gpt!.prompt).toBe(gptExpected.prompt)
    expect(gpt!.prompt).toContain("Avoid")
    expect(gpt!.negativePrompt).toBeUndefined()
    expect(imagen!.provider).toBe("imagen4")
    expect(imagen!.prompt).toBe(imagenExpected.prompt)
    expect(imagen!.prompt).not.toContain("Avoid")
    expect(imagen!.negativePrompt).toBe(imagenExpected.negativePrompt)
    expect(res.json().groups.map((g: { model: string }) => g.model)).toEqual(["gpt-image-2", "imagen4"])
  })

  it("presetId + models: the credit check prices each model's own preset request — CHECK === DEBIT", async () => {
    await post({ presetId: PRESET_ID, prompt: "a lighthouse", models: ["gpt-image-2", "flux-2-max"], count: 2, resolution: "1K" }, KEY)
    const debit = vi.mocked(reserveCreditsForJob).mock.calls.map((c) => c[3])
    expect(h.checkIds).toEqual(debit)
    expect(debit).toEqual(["gpt-image-2", "gpt-image-2", "flux-2-max:2MP:0ref", "flux-2-max:2MP:0ref"])
  })

  it("presetId + models + provider is refused like any models + provider", async () => {
    const res = await post({ presetId: PRESET_ID, prompt: "x", models: ["gpt-image-2", "imagen4"], provider: "flux-2-max" }, KEY)
    expect(res.statusCode).toBe(400)
    expect(h.inserted).toHaveLength(0)
  })
})

describe("origin and sessionId ride every job of a batch (the funnel stamps each)", () => {
  it("stamps origin on every job", async () => {
    await post({ prompt: "a red car", provider: "gpt-image-2", count: 2, origin: "create-image" }, KEY)
    expect(rows().map((r) => r.origin)).toEqual(["create-image", "create-image"])
  })
})
