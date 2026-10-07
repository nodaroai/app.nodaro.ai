import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: vi.fn(async () => undefined) }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "community", SUPABASE_URL: "https://t.co", SUPABASE_SERVICE_ROLE_KEY: "k", COLLECTIONS_MAX_RECORDS_PER_COLLECTION: 5 },
  isCloud: () => false,
  hasCredits: () => false,
  isCommunity: () => true,
  isBusiness: () => false,
  hasAdmin: () => false,
}))
// The guard reserves nothing for these free nodes; the install is what the check-only guard test pins.
vi.mock("@/middleware/credit-guard.js", () => ({ creditGuard: () => async () => undefined }))
const JOB = "00000000-0000-4000-8000-00000000000a"
vi.mock("@/lib/insert-job.js", () => ({ insertJob: vi.fn(async () => ({ data: { id: JOB }, error: null })) }))

import { collectionNodeRoutes } from "../collection-nodes.js"
import { supabase } from "../../lib/supabase.js"
import { insertJob } from "../../lib/insert-job.js"

const USER = "00000000-0000-4000-8000-000000000001"
const COLL = "00000000-0000-4000-8000-0000000000c1"
const REC = "00000000-0000-4000-8000-0000000000e1"
const WF = "00000000-0000-4000-8000-0000000000f1"

type Result = { data?: unknown; error?: { code?: string; message?: string } | null; count?: number | null }

function makeQB(result: Result = {}) {
  const resolved = { data: result.data ?? null, error: result.error ?? null, count: result.count ?? null }
  const qb: Record<string, unknown> = {}
  for (const name of ["select", "insert", "update", "delete", "eq", "gte", "in", "or", "order", "limit", "range"]) {
    qb[name] = vi.fn(() => qb)
  }
  qb.single = vi.fn(() => Promise.resolve({ data: resolved.data, error: resolved.error }))
  qb.maybeSingle = vi.fn(() => Promise.resolve({ data: resolved.data, error: resolved.error }))
  qb.then = (resolve: (v: unknown) => unknown) => resolve(resolved)
  return qb
}
type QB = ReturnType<typeof makeQB>
const fromMock = supabase.from as ReturnType<typeof vi.fn>
const insertJobMock = insertJob as ReturnType<typeof vi.fn>

function tables(queues: Record<string, QB[]>): Record<string, QB[]> {
  const used: Record<string, QB[]> = {}
  fromMock.mockImplementation((table: string) => {
    const queue = queues[table]
    if (!queue || queue.length === 0) {
      const empty = makeQB()
      ;(used[table] ??= []).push(empty)
      return empty
    }
    const next = queue.length > 1 ? queue.shift()! : queue[0]!
    ;(used[table] ??= []).push(next)
    return next
  })
  return used
}

const owned = () => makeQB({ data: { id: COLL, name: "News" } })

function recordRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REC,
    collection_id: COLL,
    title: "Telegram turns ten",
    text: "The body.",
    url: "https://t.me/telegram/441",
    media: [],
    fields: {},
    dedupe_key: "https://t.me/telegram/441",
    source: { via: "node", nodeType: "collection-write" },
    created_at: "2026-10-06T09:00:00.000+00:00",
    ...overrides,
  }
}

async function buildApp(appScopes?: readonly string[]): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook("preHandler", async (req) => {
    ;(req as { userId?: string }).userId = USER
    // An OAuth app token: the route must ask the same scope the Collections API asks.
    if (appScopes) (req as { appAuthorization?: unknown }).appAuthorization = { appId: "app1", authorizationId: "auth1", scopes: [...appScopes] }
  })
  await app.register(collectionNodeRoutes)
  return app
}

/** The jobs row's last update, from the single `jobs` builder the route used. */
function jobUpdate(used: Record<string, QB[]>): Record<string, unknown> {
  const jobs = used.jobs ?? []
  const last = jobs[jobs.length - 1]!
  return (last.update as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>
}

beforeEach(() => {
  vi.resetAllMocks()
  insertJobMock.mockResolvedValue({ data: { id: JOB }, error: null })
})

describe("an OAuth app token needs the Collections scopes, as the Collections API asks", () => {
  it("refuses a token without assets:write / assets:read before any ownership read or job row", async () => {
    const app = await buildApp(["workflows:execute", "workflows:read"])
    const used = tables({})
    expect((await app.inject({ method: "POST", url: "/v1/collection-write", payload: { collectionId: COLL, text: "x" } })).statusCode).toBe(403)
    expect((await app.inject({ method: "POST", url: "/v1/collection-read", payload: { collectionId: COLL } })).statusCode).toBe(403)
    expect(insertJobMock).not.toHaveBeenCalled()
    expect(used.collections).toBeUndefined()
  })

  it("a token with the scopes goes through; a run's internal call carries no app token and is never asked", async () => {
    const scoped = await buildApp(["assets:read", "assets:write"])
    tables({ collections: [owned()], collection_records: [makeQB({ data: [] })], jobs: [makeQB()] })
    expect((await scoped.inject({ method: "POST", url: "/v1/collection-read", payload: { collectionId: COLL } })).statusCode).toBe(200)
    const internal = await buildApp()
    tables({ collections: [owned()], collection_records: [makeQB({ data: [] })], jobs: [makeQB()] })
    expect((await internal.inject({ method: "POST", url: "/v1/collection-read", payload: { collectionId: COLL } })).statusCode).toBe(200)
  })
})

describe("POST /v1/collection-write (Save to Collection)", () => {
  it("saves the item from a json wire as a record, the node's title winning, with the run's provenance and the idempotency key", async () => {
    const insert = makeQB({ data: recordRow() })
    const used = tables({ collections: [owned()], collection_records: [insert, makeQB({ count: 1 })], jobs: [makeQB()] })
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/collection-write",
      headers: { "idempotency-key": "wf-exec1-node1-2" },
      payload: {
        collectionId: COLL,
        item: JSON.stringify({ postUrl: "https://t.me/telegram/441", text: "Telegram turns ten.", channel: "telegram" }),
        title: "Telegram turns ten",
        media: [{ type: "image", url: "https://cdn.example.com/a.jpg" }],
        executionId: "exec1",
        workflowId: WF,
        nodeId: "node1",
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ jobId: JOB, outcome: "inserted", evicted: 0, record: { id: REC }, collection: { id: COLL, name: "News" } })
    expect(insert.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        collection_id: COLL,
        user_id: USER,
        idempotency_key: "wf-exec1-node1-2",
        dedupe_key: "https://t.me/telegram/441",
        title: "Telegram turns ten",
        text: "Telegram turns ten.",
        url: "https://t.me/telegram/441",
        media: [{ type: "image", url: "https://cdn.example.com/a.jpg" }],
        fields: { channel: "telegram" },
        source: { via: "node", nodeType: "collection-write", workflowId: WF, executionId: "exec1", nodeId: "node1" },
      }),
    )
    expect(insertJobMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ user_id: USER, workflow_id: WF, node_id: "node1", job_type: "collection-write", status: "processing" }),
    )
    const update = jobUpdate(used)
    expect(update.status).toBe("completed")
    expect(update.output_data).toMatchObject({ json: { id: REC }, text: "Telegram turns ten", generatedText: "Telegram turns ten", recordId: REC, outcome: "inserted", collectionName: "News" })
  })

  it("a duplicate and a replay complete the job with the record already there — never a failure", async () => {
    const dup = tables({
      collections: [owned()],
      collection_records: [makeQB({ error: { code: "23505", message: 'violates unique constraint "uq_collection_records_dedupe"' } }), makeQB({ data: recordRow() })],
      jobs: [makeQB()],
    })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/collection-write", payload: { collectionId: COLL, link: "https://t.me/telegram/441" } })
    expect(res.statusCode).toBe(200)
    expect(res.json().outcome).toBe("duplicate")
    expect(jobUpdate(dup).status).toBe("completed")

    tables({
      collections: [owned()],
      collection_records: [makeQB({ error: { code: "23505", message: 'violates unique constraint "uq_collection_records_idempotency"' } }), makeQB({ data: recordRow() })],
      jobs: [makeQB()],
    })
    const replay = await app.inject({ method: "POST", url: "/v1/collection-write", headers: { "idempotency-key": "wf-x" }, payload: { collectionId: COLL, text: "x" } })
    expect(replay.json().outcome).toBe("replayed")
  })

  it("evicts past the self-host ceiling and reports it", async () => {
    tables({
      collections: [owned()],
      collection_records: [
        makeQB({ data: recordRow() }),
        makeQB({ count: 7 }),
        makeQB({ data: { created_at: "2026-10-06T07:00:00.000+00:00", id: "00000000-0000-4000-8000-0000000000a5" } }),
        // The oldest records past the boundary (a bounded id list), then their deletion.
        makeQB({ data: [{ id: "00000000-0000-4000-8000-0000000000a1" }, { id: "00000000-0000-4000-8000-0000000000a2" }] }),
        makeQB({ count: 2 }),
      ],
      jobs: [makeQB()],
    })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/collection-write", payload: { collectionId: COLL, text: "Seventh" } })
    expect(res.json()).toMatchObject({ outcome: "inserted", evicted: 2 })
  })

  it("fails the job with a plain message for a collection that is not the caller's, an empty record, and a server without collections", async () => {
    const app = await buildApp()
    const foreign = tables({ collections: [makeQB({ data: null })] })
    const res = await app.inject({ method: "POST", url: "/v1/collection-write", payload: { collectionId: COLL, text: "x" } })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.message).toContain("Pick a collection")
    // Ownership is checked before anything else: a probe of someone else's collection id leaves no job row.
    expect(insertJobMock).not.toHaveBeenCalled()
    expect(foreign.jobs).toBeUndefined()

    const empty = tables({ collections: [owned()], jobs: [makeQB()] })
    const nothing = await app.inject({ method: "POST", url: "/v1/collection-write", payload: { collectionId: COLL, item: { nothing: null } } })
    expect(nothing.statusCode).toBe(400)
    expect(nothing.json().error.code).toBe("empty_record")
    expect(jobUpdate(empty).status).toBe("failed")

    tables({ collections: [makeQB({ error: { code: "42P01" } })], jobs: [makeQB()] })
    const missing = await app.inject({ method: "POST", url: "/v1/collection-write", payload: { collectionId: COLL, text: "x" } })
    expect(missing.statusCode).toBe(503)
    expect(missing.json().error.code).toBe("not_available")
  })

  it("refuses a body without a collection id, before any job", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/collection-write", payload: { text: "x" } })
    expect(res.statusCode).toBe(400)
    expect(insertJobMock).not.toHaveBeenCalled()
  })
})

describe("POST /v1/collection-read (Read Collection)", () => {
  it("reads the window newest first, up to the limit, and answers the records, one per list item, with the digest", async () => {
    const records = makeQB({ data: [recordRow(), recordRow({ id: "00000000-0000-4000-8000-0000000000e2", title: "Second", url: null, created_at: "2026-10-06T08:00:00.000+00:00" })] })
    const used = tables({ collections: [owned()], collection_records: [records], jobs: [makeQB()] })
    const app = await buildApp()
    const before = Date.now()
    const res = await app.inject({
      method: "POST",
      url: "/v1/collection-read",
      payload: { collectionId: COLL, windowAmount: 2, windowUnit: "days", limit: 10, order: "newest", textFormat: "headlines", workflowId: WF, nodeId: "n2" },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.count).toBe(2)
    expect(body.text).toBe("- Telegram turns ten · 2026-10-06 · https://t.me/telegram/441\n- Second · 2026-10-06")
    expect(body.collection).toEqual({ id: COLL, name: "News" })
    expect(before - Date.parse(body.since)).toBeGreaterThanOrEqual(48 * 3_600_000 - 1_000)
    expect(records.gte).toHaveBeenCalledWith("created_at", body.since)
    expect(records.order).toHaveBeenCalledWith("created_at", { ascending: false })
    expect(records.limit).toHaveBeenCalledWith(10)
    expect(records.eq).toHaveBeenCalledWith("user_id", USER)
    const update = jobUpdate(used)
    expect(update.status).toBe("completed")
    expect(update.output_data).toMatchObject({ count: 2, generatedText: body.text, collectionName: "News" })
    // The per-item list is derived from `json` by the job-row reader, never stored a third time.
    expect(update.output_data).not.toHaveProperty("listResults")
  })

  it("an empty window completes with empty text (the nothing-new path), oldest first and the full format on request", async () => {
    const records = makeQB({ data: [] })
    const used = tables({ collections: [owned()], collection_records: [records], jobs: [makeQB()] })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/collection-read", payload: { collectionId: COLL, windowAmount: 6, order: "oldest", textFormat: "full" } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ count: 0, text: "", records: [] })
    expect(records.order).toHaveBeenCalledWith("created_at", { ascending: true })
    expect(jobUpdate(used).output_data).toMatchObject({ text: "", generatedText: "", count: 0, json: [] })
  })

  it("holds the window to 30 days and the limit to 200", async () => {
    const app = await buildApp()
    expect((await app.inject({ method: "POST", url: "/v1/collection-read", payload: { collectionId: COLL, windowAmount: 800 } })).statusCode).toBe(400)
    expect((await app.inject({ method: "POST", url: "/v1/collection-read", payload: { collectionId: COLL, limit: 500 } })).statusCode).toBe(400)
    // 31+ days is refused, not clamped: the person asked for a window the node cannot give.
    expect((await app.inject({ method: "POST", url: "/v1/collection-read", payload: { collectionId: COLL, windowAmount: 60, windowUnit: "days" } })).statusCode).toBe(400)
    const records = makeQB({ data: [] })
    tables({ collections: [owned()], collection_records: [records], jobs: [makeQB()] })
    const res = await app.inject({ method: "POST", url: "/v1/collection-read", payload: { collectionId: COLL, windowAmount: 30, windowUnit: "days" } })
    expect(res.statusCode).toBe(200)
    expect(Date.now() - Date.parse(res.json().since)).toBeLessThan(720 * 3_600_000 + 60_000)
    expect(Date.now() - Date.parse(res.json().since)).toBeGreaterThan(720 * 3_600_000 - 60_000)
  })

  it("fails the job plainly for another person's collection and for a server without collections", async () => {
    const app = await buildApp()
    const foreign = tables({ collections: [makeQB({ data: null })] })
    const res = await app.inject({ method: "POST", url: "/v1/collection-read", payload: { collectionId: COLL } })
    expect(res.statusCode).toBe(404)
    // Ownership first: no job row for a collection that is not the caller's.
    expect(insertJobMock).not.toHaveBeenCalled()
    expect(foreign.jobs).toBeUndefined()
    tables({ collections: [makeQB({ error: { code: "PGRST205" } })], jobs: [makeQB()] })
    expect((await app.inject({ method: "POST", url: "/v1/collection-read", payload: { collectionId: COLL } })).statusCode).toBe(503)
  })
})
