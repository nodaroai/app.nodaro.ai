// @test-reads-none an in-memory database double and a fake lane gate; reads no repo file
/**
 * The video director's clocks and its children's place in line (concurrency
 * lanes, decided 2026-10-30: nothing fails for waiting).
 *
 *   - a child's wait (`_waitForJob`, 10 min) counts from the child's START: the
 *     time it waits for a slot (`queued`) is left out, and credited to the
 *     director's own row (`lane_wait_ms`, which the stuck-orchestrator sweep
 *     leaves out);
 *   - its children (speech, alignment, render) carry the lane-only marker, so
 *     each enters its lane ahead of jobs that have not started — and stay
 *     ordinary jobs: no `parent_job_id`, so they are listed, readable by id and
 *     fire their webhooks;
 *   - with nothing queued, nothing changes: the same timeout, no write.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { makeSweepDb, type SweepDb } from "../../../lib/concurrency-lanes/__tests__/fake-sweep-db.js"
import { makeFakeLaneClient, makeFakeLaneStore } from "../../../lib/concurrency-lanes/__tests__/fake-lane-redis.js"
import { ConcurrencyGate } from "../../../lib/concurrency-lanes/gate.js"
import type { LaneSizes } from "../../../lib/concurrency-lanes/types.js"

const h = vi.hoisted(() => ({
  db: null as unknown as { client: { from(t: string): unknown; rpc(fn: string, args?: unknown): unknown } },
  queued: [] as Array<{ name: string; data: Record<string, unknown> }>,
  gate: null as unknown,
  sizes: { provider: 1, llm: 2, local: 1, run: 1 } as LaneSizes,
}))

vi.mock("@/services/shot-sequence/baker.js", () => ({ bakeShotSequence: vi.fn() }))
vi.mock("../../../lib/supabase.js", () => ({
  supabase: { from: (t: string) => h.db.client.from(t), rpc: (fn: string, args?: unknown) => h.db.client.rpc(fn, args) },
}))
vi.mock("../../../lib/queue.js", () => ({
  videoQueue: { add: vi.fn(async (name: string, data: Record<string, unknown>) => { h.queued.push({ name, data }); return { id: "bull-1" } }) },
  redis: {},
}))
vi.mock("../../../middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn(async () => ({ usageLogId: "usage-1", creditsReserved: 1, watermark: false })),
}))
vi.mock("../../../lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn(async () => false) }))
vi.mock("../../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/config.js")>()),
  config: {
    ...(await importOriginal<typeof import("../../../lib/config.js")>()).config,
    EDITION: "cloud",
    INTERNAL_ORCHESTRATOR_SECRET: "x".repeat(40),
  },
  hasCredits: () => false,
  speechLengthPricingEnabled: () => false,
}))
vi.mock("../../../lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})
// The lane gate, on its JS twin.
vi.mock("../../../lib/concurrency-lanes/instance.js", () => ({ concurrencyGate: () => h.gate }))
vi.mock("../../../lib/concurrency-lanes/sizes.js", () => ({ laneSizesFor: async () => h.sizes }))
vi.mock("../../../lib/concurrency-lanes/provider-of.js", () => ({ primaryProviderOfJob: () => "elevenlabs" }))

const { defaultDirectorDeps } = await import("../orchestrate.js")
const { textToSpeechRoutes } = await import("../../../routes/text-to-speech.js")
const { admitWorkerJob } = await import("../../../lib/concurrency-lanes/worker-admit.js")
const { runHolding } = await import("../../../lib/concurrency-lanes/hold.js")
const { flushCoordinatorWaitForTests } = await import("../../../lib/concurrency-lanes/coordinator-wait.js")
const { LANE_PARENT_HEADER } = await import("../../../lib/concurrency-lanes/lane-parent.js")
type ConcurrencyHold = import("../../../lib/concurrency-lanes/hold.js").ConcurrencyHold

const MIN = 60_000
/** The bound cases poll a day of fake time: slower than the default 5 s on a loaded runner. */
const BOUND_CASE_TIMEOUT_MS = 60_000
const USER = "00000000-0000-4000-8000-0000000000a1"
const DIRECTOR = "00000000-0000-4000-8000-0000000000d1"
const CHILD = "00000000-0000-4000-8000-0000000000c1"
const SECRET = "x".repeat(40)

let db: SweepDb

/** The director's hold, as its worker admits it (worker-admit.ts: the director queue keeps its wait on `jobs`). */
const directorHold: ConcurrencyHold = {
  role: "run", lane: "run", userId: USER, payer: `user:${USER}`, tier: "pro", jobId: DIRECTOR, leaseId: null, waitTable: "jobs",
}

beforeEach(() => {
  db = makeSweepDb()
  h.db = db
  h.queued.length = 0
  db.rows("jobs").push({ id: DIRECTOR, user_id: USER, status: "processing", lane_wait_ms: 0, job_type: "video-director" })
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  vi.spyOn(console, "log").mockImplementation(() => undefined)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ------------------------------------------------------------- child waits

describe("the director's wait on a child job", () => {
  /** The child job; becomes `then` after `forMs`. */
  function child(status: string, forMs: number, then = "completed"): void {
    const row = { id: CHILD, user_id: USER, status, output_data: { audioUrl: "https://cdn.example/a.mp3" }, job_type: "text-to-speech", created_at: new Date().toISOString() }
    db.rows("jobs").push(row)
    setTimeout(() => { row.status = then }, forMs)
  }

  it("a director child queued 20 min does not time out", async () => {
    vi.useFakeTimers()
    child("queued", 20 * MIN)
    const deps = defaultDirectorDeps({ inject: vi.fn() } as never, { directorJobId: DIRECTOR })
    const done = runHolding(directorHold, async () => {
      const out = await deps.waitForJob(CHILD)
      await flushCoordinatorWaitForTests()
      return out
    })
    await vi.advanceTimersByTimeAsync(25 * MIN)
    await expect(done).resolves.toEqual({ output: { audioUrl: "https://cdn.example/a.mp3" } })
    // The 20 minutes are the director's own wait: its row carries them for its stuck sweep.
    const waited = Number(db.row("jobs", DIRECTOR)?.lane_wait_ms)
    expect(waited).toBeGreaterThanOrEqual(19 * MIN)
    expect(waited).toBeLessThanOrEqual(21 * MIN)
  })

  it("a child that never queues keeps today's 10-minute limit, and nothing is written (with enforcement off nothing queues)", async () => {
    vi.useFakeTimers()
    child("processing", 20 * MIN)
    const deps = defaultDirectorDeps({ inject: vi.fn() } as never, { directorJobId: DIRECTOR })
    const done = runHolding(directorHold, () => deps.waitForJob(CHILD))
    const settled = done.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(11 * MIN)
    const err = await settled
    expect(String(err)).toMatch(/ended with status "timeout"/)
    expect(db.writes.filter((w) => w.table === "jobs")).toEqual([])
  })

  it("a child stuck in `queued` past the queue timeout's bound no longer holds the clock", async () => {
    vi.useFakeTimers()
    child("queued", 40 * 60 * MIN)
    const deps = defaultDirectorDeps({ inject: vi.fn() } as never, { directorJobId: DIRECTOR })
    const settled = runHolding(directorHold, () => deps.waitForJob(CHILD)).catch((e: unknown) => e)
    // 24.5 hours of credit + the 10-minute limit, then a timeout — never an endless wait.
    await vi.advanceTimersByTimeAsync((24 * 60 + 30 + 11) * MIN)
    expect(String(await settled)).toMatch(/ended with status "timeout"/)
  }, BOUND_CASE_TIMEOUT_MS)
})

// ------------------------------------------------- children: marker, visibility

describe("the director's children", () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = Fastify({ logger: false })
    // The auth hook's internal lane (middleware/auth.ts): the orchestrator secret makes the request internal.
    app.addHook("preHandler", async (req) => {
      if (req.headers["x-internal-orchestrator-secret"] === SECRET) req.authKind = "internal"
      else req.authKind = "jwt"
      const body = req.body as Record<string, unknown> | undefined
      if (typeof body?.userId === "string") req.userId = body.userId
    })
    await app.register(async (instance) => { await textToSpeechRoutes(instance) })
    await app.ready()
  })
  afterEach(async () => { await app.close() })

  it("a director's speech job enters its lane ahead of a fresh fan-out", async () => {
    // The director makes its speech job through the real route; its queue payload carries the marker.
    const { jobId } = await defaultDirectorDeps(app, { directorJobId: DIRECTOR }).createSpeechJob("Voice-over line.", USER)
    const payload = h.queued.at(-1)!.data
    expect(payload.laneParent).toEqual({ kind: "director", id: DIRECTOR })

    // The user's provider line is full, and a fresh fan-out of three jobs already waits in it.
    const store = makeFakeLaneStore()
    const gate = new ConcurrencyGate({ client: () => makeFakeLaneClient(store) })
    h.gate = gate
    await gate.setEnforced(true)
    const meta = (id: string) => ({
      jobId: id, userId: USER, payer: `user:${USER}` as const, lane: "provider" as const, provider: "elevenlabs", source: null,
      sourceDetail: null, jobType: "generate-image", model: null, queue: "video-generation" as const, bullJobId: id,
    })
    expect((await gate.acquire({ meta: meta("running"), size: 1, mode: "fresh", leaseTtlMs: 3_600_000 })).granted).toBe(true)
    for (const id of ["fan-1", "fan-2", "fan-3"]) {
      expect((await gate.acquire({ meta: meta(id), size: 1, mode: "fresh", leaseTtlMs: 3_600_000 })).granted).toBe(false)
    }
    const row = {
      id: jobId, user_id: USER, status: "pending", started_at: null, parent_job_id: null, workflow_execution_id: null,
      pipeline_id: null, workspace_id: null, org_id: null, source: "api", source_detail: null, mcp_client: null,
    }
    const speech = await admitWorkerJob({ job: { id: "bull-speech", name: "text-to-speech", data: payload }, queue: "video-generation", row })
    expect(speech.admitted).toBe(false)
    if (!speech.admitted) expect(speech.wait.position).toBe(1)

    // Control: the same job made without the director's name waits behind the fan-out.
    await defaultDirectorDeps(app).createSpeechJob("Voice-over line.", USER)
    const plain = h.queued.at(-1)!.data
    expect(plain).not.toHaveProperty("laneParent")
    const fresh = await admitWorkerJob({ job: { id: "bull-plain", name: "text-to-speech", data: plain }, queue: "video-generation", row: { ...row, id: "plain-job" } })
    if (!fresh.admitted) expect(fresh.wait.position).toBe(5)
    else throw new Error("expected a wait")
  })

  it("a director's child job stays visible in the jobs list and fires its webhook", async () => {
    const { jobId } = await defaultDirectorDeps(app, { directorJobId: DIRECTOR }).createSpeechJob("Voice-over line.", USER)
    const stored = db.row("jobs", jobId)!
    // The marker rides the queue payload only — never the row users read.
    expect(JSON.stringify(stored)).not.toContain("laneParent")
    expect(JSON.stringify(stored)).not.toContain(DIRECTOR)
    // Control: a hidden child job (`parent_job_id`), which is what the marker deliberately is not.
    const HIDDEN = "00000000-0000-4000-8000-0000000000e9"
    db.rows("jobs").push({ ...stored, id: HIDDEN, parent_job_id: DIRECTOR })

    // The jobs list (GET /v1/jobs, MCP list_jobs) — its real filter, as the database applies it.
    const { applyJobListFilters } = await import("../../../lib/job-list-filters.js")
    const listed = (await applyJobListFilters(db.client.from("jobs") as never, {}, USER)) as unknown as { data: Array<{ id: string }> }
    // (the double answers the filtered rows as a `select`; nothing else narrows them here)
    const ids = (listed.data ?? []).map((r) => r.id)
    expect(ids).toContain(jobId)
    expect(ids).not.toContain(HIDDEN)

    // Its webhook: the delivery path's own child-job check (a kept body is sent again only for a non-child job).
    const { eventBodyFor } = await import("../../../lib/webhooks/event.js")
    const delivery = (id: string) => ({
      deliveryId: "d1", webhookId: "w1", userId: USER, jobId: id, event: "job.completed" as const, payload: '{"kept":true}',
      attempts: 2, createdAt: new Date().toISOString(), url: "https://hooks.example/x", secretCiphertext: "s", previousSecretCiphertext: null, runtimeEnv: "test",
    })
    await expect(eventBodyFor(delivery(jobId))).resolves.toEqual({ kind: "body", body: '{"kept":true}', fresh: false })
    await expect(eventBodyFor(delivery(HIDDEN))).resolves.toEqual({ kind: "missing" })
  })

  it("the marker is believed only from the internal lane", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/text-to-speech",
      headers: { authorization: "Bearer user-token", [LANE_PARENT_HEADER]: `director:${DIRECTOR}` },
      payload: { text: "Hi.", userId: USER },
    })
    expect(res.statusCode).toBe(200)
    expect(h.queued.at(-1)!.data).not.toHaveProperty("laneParent")
  })
})
