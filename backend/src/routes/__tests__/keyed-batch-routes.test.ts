/**
 * A batch route (generate-object `count` in full; generate-character and
 * video-sfx, wired most differently, for the made batch and its repeat;
 * -creature / -location share the lane) under an Idempotency-Key, over an
 * in-memory jobs table that enforces the real unique index
 * `(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`, and with the
 * REAL `reserveCreditsForJob` — whose dedup backfill writes the request's key
 * onto every job it reserves.
 *
 * What broke: the route reserved its N jobs with the request's bare key, so
 * job 2's backfill hit the index, read as a lost dedup race, deleted job 2 and
 * answered `{ jobId: job1, deduped: true }`; the rollback then refunded job 1
 * and deleted the rest, leaving job 1 pending, unqueued and holding the key.
 * Now job i is keyed `<key>:i` from its insert (`runJobBatch`), so:
 *   - a keyed batch of 3 is made, charged per job and queued once;
 *   - a repeat with the same key returns the same jobs and charges nothing;
 *   - a queue refusal that partly started the batch fails and refunds the
 *     rest, names the started job in `error.startedJobIds`, and a repeat with
 *     the same key returns that job and starts only the rest, priced for those.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify"

interface Row { [k: string]: unknown; id: string }

const h = vi.hoisted(() => ({
  tables: { jobs: [] as Row[], usage_logs: [] as Row[] } as Record<string, Row[]>,
  seq: 0,
  queued: [] as Array<{ name: string; data: Record<string, unknown>; opts?: Record<string, unknown> }>,
  addBulkImpl: null as null | ((entries: Array<{ name: string; data: Record<string, unknown> }>) => Promise<void>),
  /** Each request's pre-check: the credits its price reads (BASE × jobs to price). */
  checked: [] as number[],
  /** Every reservation: the job and the credits it reserved. */
  reserved: [] as Array<{ jobId: string; credits: number }>,
}))

// ── an in-memory PostgREST: filters, terminal reads, and the unique key index ──

type Filter = (r: Row) => boolean

function violatesKeyIndex(table: string, candidate: Row): boolean {
  if (table !== "jobs" || candidate.idempotency_key == null) return false
  return h.tables.jobs.some((r) => r.id !== candidate.id && r.user_id === candidate.user_id && r.idempotency_key === candidate.idempotency_key)
}

function query(table: string) {
  const filters: Filter[] = []
  let op: "select" | "update" | "delete" | "insert" = "select"
  let patch: Record<string, unknown> = {}
  let toInsert: Row[] = []
  let limit = Infinity
  const rows = () => (h.tables[table] ??= [])
  const run = (): { data: Row[] | null; error: { code?: string; message: string } | null } => {
    if (op === "insert") {
      for (const r of toInsert) {
        if (violatesKeyIndex(table, r)) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }
        rows().push(r)
      }
      return { data: toInsert.map((r) => ({ ...r })), error: null }
    }
    const hit = rows().filter((r) => filters.every((f) => f(r))).slice(0, limit)
    if (op === "update") {
      for (const r of hit) {
        if (violatesKeyIndex(table, { ...r, ...patch })) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }
      }
      for (const r of hit) Object.assign(r, patch)
      return { data: hit.map((r) => ({ ...r })), error: null }
    }
    if (op === "delete") {
      h.tables[table] = rows().filter((r) => !hit.includes(r))
      return { data: hit.map((r) => ({ ...r })), error: null }
    }
    return { data: hit.map((r) => ({ ...r })), error: null }
  }
  const b: Record<string, unknown> = {
    select: () => b,
    insert: (row: Row | Row[]) => {
      op = "insert"
      toInsert = (Array.isArray(row) ? row : [row]).map((r) => ({ ...r, id: (r.id as string | undefined) ?? `job-${++h.seq}` }))
      return b
    },
    update: (fields: Record<string, unknown>) => { op = "update"; patch = fields; return b },
    delete: () => { op = "delete"; return b },
    eq: (col: string, v: unknown) => { filters.push((r) => r[col] === v); return b },
    neq: (col: string, v: unknown) => { filters.push((r) => r[col] !== v); return b },
    in: (col: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[col])); return b },
    is: (col: string, v: unknown) => { filters.push((r) => (r[col] ?? null) === v); return b },
    gte: () => b,
    order: () => b,
    limit: (n: number) => { limit = n; return b },
    single: async () => {
      const res = run()
      if (res.error) return { data: null, error: res.error }
      return res.data && res.data.length > 0 ? { data: res.data[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } }
    },
    maybeSingle: async () => {
      const res = run()
      return { data: res.data?.[0] ?? null, error: res.error }
    },
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
  }
  return b
}

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: (table: string) => query(table) } }))

// The insert helpers, minus their request stamping: a plain insert, and the
// idempotent one (a key already held answers its row, `created: false`).
vi.mock("@/lib/insert-job.js", () => ({
  insertJob: async (_req: unknown, row: Record<string, unknown>) => {
    const res = await (query("jobs") as { insert: (r: unknown) => { select: () => { single: () => Promise<unknown> } } }).insert(row).select().single()
    return res
  },
  insertJobIdempotent: async (_req: unknown, row: Record<string, unknown>, key: string | null | undefined) => {
    if (key) {
      const existing = h.tables.jobs.find((r) => r.user_id === row.user_id && r.idempotency_key === key)
      if (existing) return { row: { ...existing }, created: false }
    }
    const r: Row = { id: `job-${++h.seq}`, ...row, ...(key ? { idempotency_key: key } : {}) }
    h.tables.jobs.push(r)
    return { row: { ...r }, created: true }
  },
}))

vi.mock("@/lib/queue.js", () => ({
  videoQueue: {
    add: async (name: string, data: Record<string, unknown>, opts?: Record<string, unknown>) => {
      h.queued.push({ name, data, opts })
      return { id: "q" }
    },
    addBulk: async (entries: Array<{ name: string; data: Record<string, unknown>; opts?: Record<string, unknown> }>) => {
      if (h.addBulkImpl) return h.addBulkImpl(entries)
      h.queued.push(...entries)
    },
  },
  redis: {},
}))

// One request at a time per batch: a claim that is always free (the claim's own rules are job-batch-claim's tests).
vi.mock("@/lib/job-batch-claim.js", () => ({
  batchClaimKey: (userId: string, key: string) => `claim:${userId}:${key}`,
  claimBatch: async () => ({ renew: async () => true, release: async () => undefined }),
}))

// The ledger: a reservation is a usage log held against its job.
vi.mock("@/lib/credits-job-lifecycle.js", () => {
  const live = (jobId: string) => h.tables.usage_logs.filter((l) => l.job_id === jobId && l.status === "reserved")
  return {
    jobCreditHolds: async (ids: readonly string[]) => {
      const out = new Map<string, Array<{ id: string; credits: number | null }>>()
      for (const l of h.tables.usage_logs) {
        if (ids.includes(l.job_id as string) && (l.status === "reserved" || l.status === "committed")) {
          out.set(l.job_id as string, [...(out.get(l.job_id as string) ?? []), { id: l.id, credits: l.credits_used as number }])
        }
      }
      return out
    },
    refundJobHoldsConfirmed: async (jobId: string) => {
      for (const l of live(jobId)) l.status = "refunded"
      return true
    },
    refundUsageLogConfirmed: async (logId: string) => {
      const l = h.tables.usage_logs.find((x) => x.id === logId)
      if (l) l.status = "refunded"
      return true
    },
  }
})

// The failure write: a compare-and-set from `from`, with `extra` in the same write.
vi.mock("@/lib/job-failure.js", () => ({
  markJobFailedDetailed: async (jobId: string, input: { error_message: string; from?: readonly string[]; extra?: Record<string, unknown> }) => {
    const r = h.tables.jobs.find((x) => x.id === jobId)
    if (!r || !(input.from ?? ["pending", "processing"]).includes(r.status as string)) return "missed"
    Object.assign(r, { status: "failed", error_message: input.error_message, ...(input.extra ?? {}) })
    return "flipped"
  },
}))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: async () => true }))

vi.mock("@/lib/config.js", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
}))

// The reservation itself (ee): a usage log at the request's override.
vi.mock("@/ee/lib/credit-guard-impl.js", () => ({
  reserveCreditsForJobImpl: async (req: FastifyRequest, _reply: FastifyReply, jobId: string) => {
    const credits = req.creditReservation?.creditOverride ?? 0
    const log: Row = { id: `log-${++h.seq}`, job_id: jobId, status: "reserved", credits_used: credits }
    h.tables.usage_logs.push(log)
    const job = h.tables.jobs.find((x) => x.id === jobId)
    if (job) Object.assign(job, { usage_log_id: log.id, credits })
    h.reserved.push({ jobId, credits })
    return { usageLogId: log.id, creditsReserved: credits, watermark: false }
  },
}))
vi.mock("@/ee/billing/credits.js", () => ({ getModelCreditBaseCost: async () => ({ creditCost: 10 }) }))
vi.mock("@/ee/billing/service-margin.js", () => ({ applyServiceMarkup: (base: number) => base }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => ({}) }))
vi.mock("@/ee/services/credits.js", () => ({ CreditsService: { refundCredits: async () => undefined } }))
// video-sfx measures its clip before pricing: a fixed 8 s, priced 10 a version.
vi.mock("@/lib/video-sfx-duration.js", () => ({ measureVideoSfxDuration: async () => ({ ok: true, durationSec: 8 }) }))
vi.mock("@/lib/credit-base-cost.js", () => ({ baseCreditCostFor: async () => 10 }))

// The credit guard's own door, reduced to what this lane reads: the request's
// key (≥ 8 chars), its fingerprint, and the price check — the route's
// `computeCredits`, recorded — leaving the reservation's override at that
// price. `reserveCreditsForJob` is the real one.
vi.mock("@/middleware/credit-guard.js", async (orig) => {
  const actual = await orig<Record<string, unknown>>()
  const { computeFingerprint } = await import("../../lib/dedup-fingerprint.js")
  return {
    ...actual,
    creditGuard: (_resolver: unknown, opts?: { computeCredits?: (body: unknown, req: FastifyRequest) => Promise<number | undefined> }) =>
      async (req: FastifyRequest) => {
        const raw = req.headers["idempotency-key"]
        const key = typeof raw === "string" ? raw.trim() : ""
        req.inputFingerprint = computeFingerprint(req.url, req.body)
        if (key.length >= 8) req.idempotencyKey = key
        const total = (await opts?.computeCredits?.(req.body, req)) ?? 0
        h.checked.push(total)
        req.creditReservation = { usageLogId: "", creditsReserved: 0, watermark: false, creditOverride: total }
      },
  }
})

import { generateObjectRoutes } from "../generate-object.js"
import { generateCharacterRoutes } from "../generate-character.js"
import videoSfxRoutes from "../video-sfx.js"

const USER = "00000000-0000-4000-8000-000000000001"
const KEY = "batch-key-0001"

let app: FastifyInstance

beforeEach(async () => {
  h.tables = { jobs: [], usage_logs: [] }
  h.seq = 0
  h.queued = []
  h.addBulkImpl = null
  h.checked = []
  h.reserved = []
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => { req.userId = USER })
  await app.register(generateObjectRoutes)
  await app.ready()
})
afterEach(async () => { await app.close() })

const post = (count: number, key: string | null = KEY) =>
  app.inject({
    method: "POST",
    url: "/v1/generate-object",
    headers: key ? { "idempotency-key": key } : {},
    payload: { name: "Ornate Goblet", count },
  })

const job = (id: string) => h.tables.jobs.find((r) => r.id === id)
const liveHolds = (jobId: string) => h.tables.usage_logs.filter((l) => l.job_id === jobId && l.status === "reserved")

describe("a keyed batch (count ≥ 2) under one Idempotency-Key", () => {
  it("a batch of 3 is made: each job keyed <key>:i, charged ONE job's price, all queued in one call", async () => {
    const res = await post(3)
    expect(res.statusCode).toBe(200)
    const { jobIds, deduped } = res.json() as { jobIds: string[]; deduped?: boolean }
    expect(jobIds).toHaveLength(3)
    expect(deduped).toBeUndefined()
    expect(jobIds.map((id) => job(id)?.idempotency_key)).toEqual([`${KEY}:0`, `${KEY}:1`, `${KEY}:2`])
    expect(jobIds.map((id) => job(id)?.status)).toEqual(["pending", "pending", "pending"])
    // The check is the whole batch; each job reserves its own price, never the batch's (no N² charge).
    expect(h.checked).toEqual([30])
    expect(h.reserved).toEqual(jobIds.map((jobId) => ({ jobId, credits: 10 })))
    expect(h.queued.map((q) => q.data.jobId)).toEqual(jobIds)
    expect(h.queued.map((q) => q.opts?.jobId)).toEqual(jobIds.map((id) => `generate-object-${id}`))
    expect(h.queued.map((q) => q.data.usageLogId)).toEqual(jobIds.map((id) => job(id)?.usage_log_id))
  })

  it("a repeat once its jobs run returns the same jobs before any check: deduped, nothing charged or queued", async () => {
    const first = (await post(3)).json() as { jobIds: string[] }
    for (const id of first.jobIds) job(id)!.status = "processing"
    h.queued = []
    h.reserved = []
    h.checked = []

    const res = await post(3)
    expect(res.statusCode).toBe(200)
    expect(res.headers["x-dedup-hit"]).toBe("1")
    expect(res.json()).toEqual({ jobIds: first.jobIds, deduped: true })
    expect(h.checked).toEqual([])
    expect(h.reserved).toEqual([])
    expect(h.queued).toEqual([])
    expect(h.tables.jobs).toHaveLength(3)
  })

  it("a repeat while its paid jobs still wait queues them again under their own queue ids, priced at nothing, charges nothing", async () => {
    const first = (await post(3)).json() as { jobIds: string[] }
    h.queued = []
    h.reserved = []
    h.checked = []

    const res = await post(3)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobIds: first.jobIds, deduped: true })
    expect(h.checked).toEqual([0])
    expect(h.reserved).toEqual([])
    // Queued again by the same ids: the queue ignores an entry still waiting.
    expect(h.queued.map((q) => q.opts?.jobId)).toEqual(first.jobIds.map((id) => `generate-object-${id}`))
    expect(first.jobIds.map((id) => liveHolds(id).length)).toEqual([1, 1, 1])
  })

  it("a queue refusal that partly started the batch: the started job runs, the rest are failed, refunded and removed; a same-key repeat starts only the rest", async () => {
    h.addBulkImpl = async () => {
      // The add was delivered with its answer lost, and a worker took the first job.
      h.tables.jobs.find((r) => r.idempotency_key === `${KEY}:0`)!.status = "processing"
      throw new Error("Connection is closed.")
    }
    const res = await post(3)
    expect(res.statusCode).toBe(500)
    const started = h.tables.jobs.find((r) => r.idempotency_key === `${KEY}:0`)!
    expect(res.json().error).toMatchObject({ code: "internal_error", startedJobIds: [started.id] })
    // The two that did not start: failed from `pending` (keys released), refunded confirmed, removed.
    expect(h.tables.jobs.map((r) => r.id)).toEqual([started.id])
    expect(h.tables.usage_logs.filter((l) => l.job_id !== started.id).map((l) => l.status)).toEqual(["refunded", "refunded"])
    expect(liveHolds(started.id)).toHaveLength(1)

    h.addBulkImpl = null
    h.checked = []
    h.reserved = []
    const retry = await post(3)
    expect(retry.statusCode).toBe(200)
    const { jobIds, deduped } = retry.json() as { jobIds: string[]; deduped?: boolean }
    expect(jobIds[0]).toBe(started.id)
    expect(jobIds).toHaveLength(3)
    expect(deduped).toBeUndefined()
    // Priced and charged for the two it makes, never the one that runs.
    expect(h.checked).toEqual([20])
    expect(h.reserved.map((r) => r.jobId)).toEqual(jobIds.slice(1))
    expect(h.queued.map((q) => q.data.jobId)).toEqual(jobIds.slice(1))
    expect(jobIds.map((id) => job(id)?.idempotency_key)).toEqual([`${KEY}:0`, `${KEY}:1`, `${KEY}:2`])
  })

  it("without a key, every request is a new batch", async () => {
    const a = (await post(2, null)).json() as { jobIds: string[] }
    const b = (await post(2, null)).json() as { jobIds: string[] }
    expect(a.jobIds).toHaveLength(2)
    expect(b.jobIds).toHaveLength(2)
    expect(new Set([...a.jobIds, ...b.jobIds]).size).toBe(4)
    expect(h.tables.jobs.every((r) => r.idempotency_key == null)).toBe(true)
  })

  it("count 1 keeps the bare key on its one job", async () => {
    const res = await post(1)
    expect(res.statusCode).toBe(200)
    const { jobId, jobIds } = res.json() as { jobId: string; jobIds: string[] }
    expect(jobIds).toEqual([jobId])
    expect(job(jobId)?.idempotency_key).toBe(KEY)
    expect(h.queued.map((q) => q.data.jobId)).toEqual([jobId])
  })
})

// The same lane on the two batch routes wired most differently from
// generate-object: generate-character (always `{ jobId, jobIds }`, a lane
// guard after the credit guard) and video-sfx (one row per version, `versions`
// read before the clip is probed, `{ jobIds }`).
describe.each([
  {
    route: "generate-character",
    register: generateCharacterRoutes,
    body: (n: number) => ({ name: "Kira", seedPrompt: "a calm portrait", count: n }),
    answer: (ids: string[]) => ({ jobId: ids[0], jobIds: ids }),
  },
  {
    route: "video-sfx",
    register: videoSfxRoutes,
    body: (n: number) => ({ videoUrl: "https://media.example/clip.mp4", prompt: "rain", versions: n }),
    answer: (ids: string[]) => ({ jobIds: ids }),
  },
])("/v1/$route under one Idempotency-Key", ({ route, register, body, answer }) => {
  let routeApp: FastifyInstance

  beforeEach(async () => {
    routeApp = Fastify({ logger: false })
    routeApp.addHook("preHandler", async (req) => { req.userId = USER })
    await routeApp.register(register)
    await routeApp.ready()
  })
  afterEach(async () => { await routeApp.close() })

  const send = (n: number) =>
    routeApp.inject({ method: "POST", url: `/v1/${route}`, headers: { "idempotency-key": KEY }, payload: body(n) })

  it("a batch of 3 is made: each job keyed <key>:i, charged one job's price, queued in one call", async () => {
    const res = await send(3)
    expect(res.statusCode).toBe(200)
    const ids = h.tables.jobs.map((r) => r.id)
    expect(res.json()).toEqual(answer(ids))
    expect(ids.map((id) => job(id)?.idempotency_key)).toEqual([`${KEY}:0`, `${KEY}:1`, `${KEY}:2`])
    expect(h.checked).toEqual([30])
    expect(h.reserved).toEqual(ids.map((jobId) => ({ jobId, credits: 10 })))
    expect(h.queued.map((q) => [q.name, q.data.jobId, q.opts?.jobId])).toEqual(ids.map((id) => [route, id, `${route}-${id}`]))
  })

  it("a repeat once its jobs run returns the same jobs before any check: deduped, nothing charged or queued", async () => {
    await send(3)
    const ids = h.tables.jobs.map((r) => r.id)
    for (const id of ids) job(id)!.status = "processing"
    h.queued = []
    h.reserved = []
    h.checked = []

    const res = await send(3)
    expect(res.statusCode).toBe(200)
    expect(res.headers["x-dedup-hit"]).toBe("1")
    expect(res.json()).toEqual({ ...answer(ids), deduped: true })
    expect(h.checked).toEqual([])
    expect(h.reserved).toEqual([])
    expect(h.queued).toEqual([])
    expect(h.tables.jobs).toHaveLength(3)
  })
})

// One Idempotency-Key is one request: a key reused on another route is refused,
// never answered with (or topped up beside) that route's jobs. Jobs are the
// caller's own: the same key under another user is another batch.
describe("an Idempotency-Key shared by two routes, or two users", () => {
  const OTHER_USER = "00000000-0000-4000-8000-000000000002"
  let shared: FastifyInstance

  beforeEach(async () => {
    shared = Fastify({ logger: false })
    shared.addHook("preHandler", async (req) => {
      const as = req.headers["x-test-user"]
      req.userId = typeof as === "string" ? as : USER
    })
    await shared.register(generateObjectRoutes)
    await shared.register(generateCharacterRoutes)
    await shared.register(videoSfxRoutes)
    await shared.ready()
  })
  afterEach(async () => { await shared.close() })

  const objectBatch = (n: number, headers: Record<string, string> = {}) =>
    shared.inject({ method: "POST", url: "/v1/generate-object", headers: { "idempotency-key": KEY, ...headers }, payload: { name: "Ornate Goblet", count: n } })
  const characterBatch = (n: number, headers: Record<string, string> = {}) =>
    shared.inject({ method: "POST", url: "/v1/generate-character", headers: { "idempotency-key": KEY, ...headers }, payload: { name: "Kira", seedPrompt: "a calm portrait", count: n } })
  const sfxBatch = (n: number) =>
    shared.inject({ method: "POST", url: "/v1/video-sfx", headers: { "idempotency-key": KEY }, payload: { videoUrl: "https://media.example/clip.mp4", prompt: "rain", versions: n } })

  const runAll = () => { for (const r of h.tables.jobs) r.status = "processing" }
  const reset = () => { h.queued = []; h.reserved = []; h.checked = [] }

  it("a character batch under an object batch's key: 422, the same count or a larger one, and no job is added", async () => {
    expect((await objectBatch(2)).statusCode).toBe(200)
    runAll()
    reset()
    for (const count of [2, 3]) {
      const res = await characterBatch(count)
      expect(res.statusCode).toBe(422)
      expect(res.json().error.code).toBe("idempotency_key_reused")
      expect(res.headers["x-dedup-hit"]).toBeUndefined()
    }
    expect(h.tables.jobs).toHaveLength(2)
    expect(h.reserved).toEqual([])
    expect(h.queued).toEqual([])
  })

  it("the refusal needs no prior replay: while the other route's jobs are still pending the answer is the same, and nothing is queued", async () => {
    expect((await objectBatch(2)).statusCode).toBe(200)
    reset()
    const res = await characterBatch(3)
    expect(res.statusCode).toBe(422)
    expect(h.tables.jobs).toHaveLength(2)
    expect(h.reserved).toEqual([])
    expect(h.queued).toEqual([])
  })

  it("a video-sfx batch under a character batch's key: 422", async () => {
    expect((await characterBatch(2)).statusCode).toBe(200)
    runAll()
    reset()
    const res = await sfxBatch(2)
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("idempotency_key_reused")
    expect(h.tables.jobs).toHaveLength(2)
  })

  it("the same key under another user is another batch: made, not replayed", async () => {
    expect((await objectBatch(2)).statusCode).toBe(200)
    runAll()
    reset()
    const res = await characterBatch(2, { "x-test-user": OTHER_USER })
    expect(res.statusCode).toBe(200)
    expect(res.headers["x-dedup-hit"]).toBeUndefined()
    expect(h.tables.jobs.filter((r) => r.user_id === OTHER_USER)).toHaveLength(2)
    expect(h.tables.jobs.filter((r) => r.user_id === USER)).toHaveLength(2)
  })
})
