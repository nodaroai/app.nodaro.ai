import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { Readable } from "node:stream"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADMIN_UUID = "00000000-0000-4000-8000-000000000002"
const USER_UUID = "00000000-0000-4000-8000-000000000001"
const JOB_ID = "00000000-0000-4000-8000-0000000000aa"
const ADMIN_EMAIL = "ops@nodaro.example"

// ---------------------------------------------------------------------------
// Mocks — hoisted before the route import
// ---------------------------------------------------------------------------

const mockFrom = vi.fn()

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}))

vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async (
    req: { userId?: string },
    reply: { status: (code: number) => { send: (body: unknown) => void } },
  ) => {
    if (req.userId !== ADMIN_UUID) {
      reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
    }
  },
}))

const resolveHeldJob = vi.fn()
vi.mock("@/lib/job-policy-review.js", () => ({
  resolveHeldJob: (...args: unknown[]) => resolveHeldJob(...args),
}))

const streamR2Object = vi.fn()
vi.mock("@/lib/storage.js", () => ({
  streamR2Object: (...args: unknown[]) => streamR2Object(...args),
  // Not used by the route (`admin-review-guard.test.ts` fails the build if it
  // ever is) — declared because `lib/job-policy-outputs.js`, which the route
  // imports for `isOwnedObjectKey`, imports it from this module, and a mocked
  // module throws on an export it does not declare.
  r2KeyFromOurUrl: vi.fn(() => null),
}))

// `lib/job-finalize.ts` imports `workers/shared.js`, which constructs IORedis at
// import time (`lib/queue.ts:5`). Only the three classification arrays are used
// here; `lib/__tests__/job-finalize-types.test.ts` owns their real contents.
vi.mock("@/lib/job-finalize.js", () => ({
  IMAGE_JOB_TYPES: ["generate-image", "edit-image"] as const,
  VIDEO_JOB_TYPES: ["image-to-video", "text-to-video"] as const,
  AUDIO_JOB_TYPES: ["text-to-speech"] as const,
}))

import { adminReviewRoutes } from "../admin-review.js"

// ---------------------------------------------------------------------------
// A fluent supabase chain, dispatched by table name
// ---------------------------------------------------------------------------

interface ChainResult { data: unknown; error?: unknown; count?: number | null }

type Chain = Record<string, ReturnType<typeof vi.fn>> & { calls: [string, unknown[]][] }

const queued: Record<string, ChainResult[]> = {}
const lastChain: Record<string, Chain> = {}
/** Every chain built for a table, in order. The queue route asks
 *  `job_policy_decisions` TWICE when `?policyId=` is set — once to narrow the
 *  job ids, once to decorate the page — and only the first one is the filter,
 *  so `lastChain` cannot see it. */
const chains: Record<string, Chain[]> = {}

function makeChain(table: string, result: ChainResult): Chain {
  const c = { calls: [] as [string, unknown[]][] } as Chain
  const self = () => c
  for (const m of ["select", "eq", "in", "order", "range", "limit", "not", "gte", "lte", "lt", "gt", "is"]) {
    c[m] = vi.fn((...args: unknown[]) => {
      c.calls.push([m, args])
      return self()
    })
  }
  const settled = { data: result.data, error: result.error ?? null, count: result.count ?? null }
  c.single = vi.fn(async () => settled)
  c.maybeSingle = vi.fn(async () => settled)
  ;(c as unknown as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve(settled)
  lastChain[table] = c
  ;(chains[table] ??= []).push(c)
  return c
}

/** The arguments of every `m` call on a chain, e.g. every `eq` pair. */
function argsOf(chain: Chain, m: string): unknown[][] {
  return chain.calls.filter(([name]) => name === m).map(([, a]) => a)
}

function setTable(table: string, ...results: ChainResult[]) {
  queued[table] = results
}

mockFrom.mockImplementation((table: string) => {
  const q = queued[table]
  const next = q && q.length > 1 ? q.shift()! : (q?.[0] ?? { data: null, error: null })
  return makeChain(table, next)
})

/** Every string anywhere in a JSON value — the leak walk. */
function stringsIn(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v)
  else if (Array.isArray(v)) for (const x of v) stringsIn(x, out)
  else if (v && typeof v === "object") for (const x of Object.values(v)) stringsIn(x, out)
  return out
}

// ---------------------------------------------------------------------------
// Fixtures — deliberately BAITED: every one of these rows carries the withheld
// payload and a live URL, so a `select("*")`, a spread in `toWire` or a
// forgotten field fails the leak assertions instead of passing vacuously.
// ---------------------------------------------------------------------------

const HELD_AT = new Date(Date.now() - 73 * 60_000).toISOString()

const HELD_JOB_ROW = {
  id: JOB_ID,
  user_id: USER_UUID,
  job_type: "image-to-video",
  status: "pending_review",
  credits: 40,
  source: "app",
  source_detail: null,
  created_at: new Date(Date.now() - 80 * 60_000).toISOString(),
  held_at: HELD_AT,
  // Real key SHAPES, because the preview route now re-checks ownership by key
  // family (`isOwnedObjectKey`): `<prefix>/<jobId>.<ext>` and the variant stem
  // `<jobId>-v<i>`. A fixture with an arbitrary stem would make every preview
  // test pass through a 404 instead of through the stream.
  held_objects: [
    { key: `generated/videos/${JOB_ID}.mp4`, kind: "video", index: 0, sizeBytes: 4096 },
    { key: `generated/videos/${JOB_ID}-v1.mp4`, kind: "video", index: 1, sizeBytes: 2048 },
  ],
  // bait
  output_data: { videoUrl: "https://cdn.example.com/leaked-output.mp4" },
  held_output_data: { videoUrl: "https://cdn.example.com/leaked-held.mp4" },
  input_data: { imageUrl: "https://cdn.example.com/leaked-input.png", prompt: "a cat" },
}

const HOLD_DECISION_ROW = {
  id: "00000000-0000-4000-8000-0000000000d1",
  job_id: JOB_ID,
  hook_point: "result",
  policy_id: "sai-moderation",
  verdict: "hold",
  reason: "nudity: 0.94",
  resolver_email: null,
  created_at: HELD_AT,
  // bait
  withheld_output: { url: "https://cdn.example.com/leaked-decision.mp4" },
  labels: ["nudity"],
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  for (const k of Object.keys(queued)) delete queued[k]
  for (const k of Object.keys(lastChain)) delete lastChain[k]
  for (const k of Object.keys(chains)) delete chains[k]
  setTable("profiles", { data: { email: ADMIN_EMAIL } })
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const userId = req.headers["x-user-id"]
    if (typeof userId === "string") req.userId = userId
  })
  await app.register(async (instance) => {
    await adminReviewRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function inject(
  method: "GET" | "POST",
  url: string,
  opts: { userId?: string; payload?: Record<string, unknown>; headers?: Record<string, string> } = {},
) {
  return app.inject({
    method,
    url,
    headers: { "x-user-id": opts.userId ?? ADMIN_UUID, ...(opts.headers ?? {}) },
    payload: opts.payload,
  })
}

const ALL_SIX: [("GET" | "POST"), string][] = [
  ["GET", "/v1/admin/review/jobs"],
  ["GET", `/v1/admin/review/jobs/${JOB_ID}`],
  ["GET", `/v1/admin/review/jobs/${JOB_ID}/output/0`],
  ["POST", `/v1/admin/review/jobs/${JOB_ID}/approve`],
  ["POST", `/v1/admin/review/jobs/${JOB_ID}/reject`],
  ["GET", "/v1/admin/review/decisions"],
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("admin review — authz", () => {
  it("403s a non-admin on all six routes", async () => {
    for (const [method, url] of ALL_SIX) {
      const res = await inject(method, url, { userId: USER_UUID, payload: method === "POST" ? { reason: "no" } : undefined })
      expect(res.statusCode, `${method} ${url}`).toBe(403)
    }
    expect(resolveHeldJob).not.toHaveBeenCalled()
  })
})

describe("GET /v1/admin/review/jobs", () => {
  beforeEach(() => {
    setTable("jobs", { data: [HELD_JOB_ROW], count: 1 })
    setTable("job_policy_decisions", { data: [HOLD_DECISION_ROW], count: 1 })
  })

  it("lists only jobs whose status is still pending_review", async () => {
    const res = await inject("GET", "/v1/admin/review/jobs")
    expect(res.statusCode).toBe(200)
    // The STATUS is the authority: a job cancelled out from under its hold
    // must not render as reviewable, however stale the decision row is.
    const eqCalls = lastChain.jobs.calls.filter(([m]) => m === "eq").map(([, a]) => a)
    expect(eqCalls).toContainEqual(["status", "pending_review"])
    const body = res.json()
    expect(body.data).toHaveLength(1)
    expect(body.data[0].jobId).toBe(JOB_ID)
    expect(body.data[0].policyId).toBe("sai-moderation")
    expect(body.data[0].reason).toBe("nudity: 0.94")
    expect(body.data[0].mediaKind).toBe("video")
    expect(body.data[0].outputCount).toBe(2)
    expect(body.data[0].heldForMinutes).toBeGreaterThanOrEqual(72)
    expect(body.total).toBe(1)
  })

  it("never returns a URL, the held payload, or our provider cost", async () => {
    const res = await inject("GET", "/v1/admin/review/jobs")
    const body = res.json()
    // THE assertion this whole surface exists for.
    for (const s of stringsIn(body)) expect(s, `leaked: ${s}`).not.toMatch(/^https?:/)
    const raw = res.body
    expect(raw).not.toContain("held_objects")
    expect(raw).not.toContain("heldObjects")
    expect(raw).not.toContain("held_output_data")
    // Q11: our USD unit cost is not the customer-admin's business.
    expect(raw).not.toContain("providerCost")
    expect(raw).not.toContain("provider_cost")
    // The list is a 25-row render; input_data can carry the prompt (detail only).
    expect(raw).not.toContain("inputData")
  })

  it("rejects an out-of-range pageSize", async () => {
    const res = await inject("GET", "/v1/admin/review/jobs?pageSize=101")
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})

describe("GET /v1/admin/review/jobs?policyId= — the filter is bound to OPEN holds", () => {
  beforeEach(() => {
    setTable("jobs", { data: [HELD_JOB_ROW], count: 1 })
  })

  /**
   * `job_policy_decisions` is append-only: approve/reject/withdraw INSERT a new
   * `review` row and never touch the `hold` row, so every hold a policy ever
   * emitted lives forever. Keying the filter on "the N most recent holds by
   * this policy" is therefore a LIFETIME window that resolved holds keep
   * consuming — and the entries it drops are the OLDEST, i.e. the head of a
   * queue whose whole contract (`order("held_at", ascending)`) is oldest-first.
   * They vanish from `total` too, because the jobs query carries
   * `count: "exact"`. The fix is to bound the set by the OPEN queue instead.
   */
  it("narrows through an inner join on jobs.status, not through a window of recent decisions", async () => {
    setTable("job_policy_decisions", { data: [{ job_id: JOB_ID, jobs: { status: "pending_review" } }] })
    const res = await inject("GET", "/v1/admin/review/jobs?policyId=sai-moderation")
    expect(res.statusCode).toBe(200)

    const filter = chains.job_policy_decisions[0]
    const selected = String(argsOf(filter, "select")[0]?.[0] ?? "")
    expect(selected, "the decisions filter must embed jobs so the DB does the narrowing").toContain("jobs!inner")
    expect(argsOf(filter, "eq")).toContainEqual(["jobs.status", "pending_review"])
    expect(argsOf(filter, "eq")).toContainEqual(["policy_id", "sai-moderation"])
    expect(argsOf(filter, "eq")).toContainEqual(["hook_point", "result"])
    expect(argsOf(filter, "eq")).toContainEqual(["verdict", "hold"])

    // If the safety cap ever bites it must truncate the TAIL of the FIFO, so
    // any ordering on the filter is oldest-first — never `descending`, which is
    // what dropped the head.
    for (const [, opts] of argsOf(filter, "order")) {
      expect(opts, "the policy filter must not order newest-first").not.toMatchObject({ ascending: false })
    }

    // ...and the narrowed ids reach the jobs query.
    expect(argsOf(lastChain.jobs, "in")).toContainEqual(["id", [JOB_ID]])
  })

  it("sends an empty page when the policy has no OPEN holds", async () => {
    setTable("job_policy_decisions", { data: [] })
    const res = await inject("GET", "/v1/admin/review/jobs?policyId=retired-policy")
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: [], total: 0, page: 0, pageSize: 25 })
  })

  it("500s when the decisions filter itself fails rather than reporting an empty queue", async () => {
    // A silent `[]` here reads to the operator as "nothing is awaiting review
    // under that policy" — the most dangerous wrong answer this page can give.
    setTable("job_policy_decisions", { data: null, error: { message: "could not find a relationship" } })
    const res = await inject("GET", "/v1/admin/review/jobs?policyId=sai-moderation")
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })
})

describe("GET /v1/admin/review/jobs/:jobId", () => {
  it("returns the detail row with raw inputData and the output manifest", async () => {
    setTable("jobs", { data: HELD_JOB_ROW })
    setTable("job_policy_decisions", { data: [HOLD_DECISION_ROW] })
    const res = await inject("GET", `/v1/admin/review/jobs/${JOB_ID}`)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.data.inputData).toEqual(HELD_JOB_ROW.input_data)
    expect(body.data.outputs).toEqual([
      { index: 0, mediaKind: "video", filename: `${JOB_ID}.mp4`, sizeBytes: 4096 },
      { index: 1, mediaKind: "video", filename: `${JOB_ID}-v1.mp4`, sizeBytes: 2048 },
    ])
    // The manifest names the file, never the key or a URL.
    expect(res.body).not.toContain("generated/videos")
    expect(res.body).not.toContain("videos/")
  })

  it("404s a job that is no longer pending_review", async () => {
    setTable("jobs", { data: { ...HELD_JOB_ROW, status: "cancelled" } })
    const res = await inject("GET", `/v1/admin/review/jobs/${JOB_ID}`)
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })
})

describe("GET /v1/admin/review/jobs/:jobId/output/:index", () => {
  beforeEach(() => {
    setTable("jobs", { data: HELD_JOB_ROW })
    streamR2Object.mockResolvedValue({
      body: Readable.from([Buffer.from("held-bytes")]),
      contentType: "video/mp4",
      contentLength: 10,
    })
  })

  it("reads the key server-side out of held_objects[index] and ignores client input", async () => {
    const res = await inject(
      "GET",
      `/v1/admin/review/jobs/${JOB_ID}/output/1?key=secrets/other-tenant.mp4&url=https://evil.example/x`,
    )
    expect(res.statusCode).toBe(200)
    expect(streamR2Object).toHaveBeenCalledTimes(1)
    expect(streamR2Object.mock.calls[0][0]).toBe(`generated/videos/${JOB_ID}-v1.mp4`)
  })

  it("404s a held_objects key outside this job's own key family", async () => {
    // `held_objects` is written by the gate, but the gate is not the only thing
    // that can put a row in `pending_review` — migration 377's widened CHECK
    // made that status reachable from PostgREST until 377 also narrowed the
    // INSERT policy, and a planted array is the shape of the escalation. The
    // preview route re-checks ownership exactly as `deleteOwnedObjects` does,
    // so it can never become an authenticated read-anything proxy over the
    // bucket, whatever wrote the row.
    setTable("jobs", {
      data: {
        ...HELD_JOB_ROW,
        held_objects: [{ key: "generated/videos/00000000-0000-4000-8000-0000000000bb.mp4", kind: "video", index: 0 }],
      },
    })
    const res = await inject("GET", `/v1/admin/review/jobs/${JOB_ID}/output/0`)
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(streamR2Object).not.toHaveBeenCalled()
  })

  it("re-reads the status inside the handler and 404s a job no longer held", async () => {
    setTable("jobs", { data: { ...HELD_JOB_ROW, status: "completed" } })
    const res = await inject("GET", `/v1/admin/review/jobs/${JOB_ID}/output/0`)
    expect(res.statusCode).toBe(404)
    expect(streamR2Object).not.toHaveBeenCalled()
  })

  it("404s an index past the end of held_objects", async () => {
    const res = await inject("GET", `/v1/admin/review/jobs/${JOB_ID}/output/5`)
    expect(res.statusCode).toBe(404)
    expect(streamR2Object).not.toHaveBeenCalled()
  })

  it("400s a non-numeric index and an index above the bound", async () => {
    for (const bad of ["abc", "17", "-1"]) {
      const res = await inject("GET", `/v1/admin/review/jobs/${JOB_ID}/output/${bad}`)
      expect(res.statusCode, `index=${bad}`).toBe(400)
    }
    expect(streamR2Object).not.toHaveBeenCalled()
  })

  it("sets the no-store headers and the object's own content type", async () => {
    const res = await inject("GET", `/v1/admin/review/jobs/${JOB_ID}/output/0`)
    expect(res.headers["cache-control"]).toBe("private, no-store")
    expect(res.headers["x-content-type-options"]).toBe("nosniff")
    expect(res.headers["content-disposition"]).toBe("inline")
    expect(res.headers["accept-ranges"]).toBe("bytes")
    expect(String(res.headers["content-type"])).toContain("video/mp4")
    expect(res.body).toBe("held-bytes")
  })

  it("answers 206 with Content-Range when the store served a range", async () => {
    streamR2Object.mockResolvedValue({
      body: Readable.from([Buffer.from("held")]),
      contentType: "video/mp4",
      contentLength: 4,
      contentRange: "bytes 0-3/10",
    })
    const res = await inject("GET", `/v1/admin/review/jobs/${JOB_ID}/output/0`, {
      headers: { range: "bytes=0-3" },
    })
    expect(res.statusCode).toBe(206)
    expect(res.headers["content-range"]).toBe("bytes 0-3/10")
    expect(streamR2Object.mock.calls[0][1]).toEqual({ range: "bytes=0-3" })
  })

  it("404s when the object is gone from the store", async () => {
    streamR2Object.mockResolvedValue(null)
    const res = await inject("GET", `/v1/admin/review/jobs/${JOB_ID}/output/0`)
    expect(res.statusCode).toBe(404)
  })
})

describe("POST approve / reject", () => {
  it("approves, and passes the resolver's id AND email through", async () => {
    resolveHeldJob.mockResolvedValue({ ok: true })
    const res = await inject("POST", `/v1/admin/review/jobs/${JOB_ID}/approve`, { payload: { note: "looks fine" } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, jobId: JOB_ID, status: "completed" })
    expect(resolveHeldJob).toHaveBeenCalledWith(JOB_ID, {
      action: "approve",
      resolver: { userId: ADMIN_UUID, email: ADMIN_EMAIL },
      note: "looks fine",
    })
  })

  it("rejects with the reviewer's words and reports the refund", async () => {
    resolveHeldJob.mockResolvedValue({ ok: true })
    const res = await inject("POST", `/v1/admin/review/jobs/${JOB_ID}/reject`, {
      payload: { reason: "  shows a real person  " },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, jobId: JOB_ID, status: "failed" })
    expect(resolveHeldJob).toHaveBeenCalledWith(JOB_ID, {
      action: "reject",
      resolver: { userId: ADMIN_UUID, email: ADMIN_EMAIL },
      reason: "shows a real person",
    })
  })

  it("still resolves when the admin's email cannot be read (logged, not swallowed)", async () => {
    setTable("profiles", { data: null, error: { message: "boom" } })
    resolveHeldJob.mockResolvedValue({ ok: true })
    const res = await inject("POST", `/v1/admin/review/jobs/${JOB_ID}/approve`, { payload: {} })
    expect(res.statusCode).toBe(200)
    expect(resolveHeldJob.mock.calls[0][1].resolver).toEqual({ userId: ADMIN_UUID, email: null })
  })

  it("400s an empty reason", async () => {
    const res = await inject("POST", `/v1/admin/review/jobs/${JOB_ID}/reject`, { payload: { reason: "   " } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(resolveHeldJob).not.toHaveBeenCalled()
  })

  it("400s a 501-character reason", async () => {
    const res = await inject("POST", `/v1/admin/review/jobs/${JOB_ID}/reject`, { payload: { reason: "x".repeat(501) } })
    expect(res.statusCode).toBe(400)
    expect(resolveHeldJob).not.toHaveBeenCalled()
  })

  it("404s when the job id names nothing", async () => {
    resolveHeldJob.mockResolvedValue({ ok: false, reason: "not_found" })
    const res = await inject("POST", `/v1/admin/review/jobs/${JOB_ID}/approve`, { payload: {} })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("409s a second approve, carrying the row's current status", async () => {
    resolveHeldJob.mockResolvedValue({ ok: false, reason: "already_resolved", status: "completed" })
    const res = await inject("POST", `/v1/admin/review/jobs/${JOB_ID}/approve`, { payload: {} })
    expect(res.statusCode).toBe(409)
    const body = res.json()
    expect(body.error.code).toBe("review_already_resolved")
    expect(body.error.status).toBe("completed")
  })

  it("502s a finalize failure and does NOT report the job resolved", async () => {
    resolveHeldJob.mockResolvedValue({ ok: false, reason: "finalize_failed" })
    const res = await inject("POST", `/v1/admin/review/jobs/${JOB_ID}/approve`, { payload: {} })
    expect(res.statusCode).toBe(502)
    const body = res.json()
    expect(body.error.code).toBe("finalize_failed")
    expect(body.ok).toBeUndefined()
    // The job stays awaiting review — a half-completed hold is worse than an
    // unresolved one.
    expect(JSON.stringify(body)).not.toContain("completed")
  })
})

describe("GET /v1/admin/review/decisions", () => {
  beforeEach(() => {
    setTable("job_policy_decisions", {
      data: [
        HOLD_DECISION_ROW,
        {
          ...HOLD_DECISION_ROW,
          id: "00000000-0000-4000-8000-0000000000d2",
          hook_point: "review",
          verdict: "reject",
          reason: "rejected by ops@nodaro.example: shows a real person",
          resolver_email: ADMIN_EMAIL,
        },
      ],
      count: 2,
    })
  })

  it("returns the log with the resolver on the review row", async () => {
    const res = await inject("GET", "/v1/admin/review/decisions")
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBe(2)
    expect(body.data[1]).toEqual({
      id: "00000000-0000-4000-8000-0000000000d2",
      jobId: JOB_ID,
      hookPoint: "review",
      policyId: "sai-moderation",
      verdict: "reject",
      reason: "rejected by ops@nodaro.example: shows a real person",
      resolverEmail: ADMIN_EMAIL,
      createdAt: HELD_AT,
    })
  })

  it("never returns the withheld payload or any URL", async () => {
    const res = await inject("GET", "/v1/admin/review/decisions")
    for (const s of stringsIn(res.json())) expect(s, `leaked: ${s}`).not.toMatch(/^https?:/)
    expect(res.body).not.toContain("withheld")
  })

  it("400s an unknown verdict filter", async () => {
    const res = await inject("GET", "/v1/admin/review/decisions?verdict=maybe")
    expect(res.statusCode).toBe(400)
  })
})
