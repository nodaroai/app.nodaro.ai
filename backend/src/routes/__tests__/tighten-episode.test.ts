/**
 * POST /v1/tighten-episode and /estimate.
 *
 * What this pins:
 *  - every refusal (deny, depth, the snapshot columns, connection, media,
 *    balance, review with nobody to review) comes before any row or hold;
 *  - one wrapper per idempotency key: a double submit starts nothing twice;
 *  - the fee held is the figure the quote prices (one function for both);
 *  - the wrapper points at its run only through its input — never by
 *    `workflow_execution_id`;
 *  - a run that cannot start unwinds: wrapper failed, fee refunded.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"
import {
  EPISODE_CHAPTERS_DEFAULTS,
  TIGHTEN_EPISODE_DEFAULTS,
  buildEpisodeChaptersGraph,
  buildTightenEpisodeGraph,
  usecaseDescriptor,
  type UseCaseNodeType,
} from "@nodaro/render-rules"

const USER = "00000000-0000-4000-8000-000000000001"
const graph = buildTightenEpisodeGraph(TIGHTEN_EPISODE_DEFAULTS, { media: { url: "https://r2/ep.mp4", kind: "video", durationSec: 3600 } })
const m = vi.hoisted(() => ({
  credits: true,
  denied: false,
  absent: false,
  authKind: "jwt" as "jwt" | "internal" | "api_token",
  prepared: null as unknown,
  preflight: null as unknown,
  cover: { ok: true } as { ok: boolean; balance?: number },
  coverArgs: [] as unknown[],
  estimateCalls: 0,
  estimatedTypes: [] as Array<string | undefined>,
  reserveSeen: [] as Array<{ billingContext: unknown; creditOverride: unknown }>,
  insertJob: vi.fn(),
  insertIdem: vi.fn(),
  reserve: vi.fn(),
  execute: vi.fn(),
  stamp: vi.fn(),
  failed: vi.fn(async (..._a: unknown[]) => true),
  refund: vi.fn(async (..._a: unknown[]) => 1),
  prepare: vi.fn(),
  existingByKey: null as { id: string; provider?: string | null; jobType?: string | null } | null,
  keyLookups: [] as unknown[][],
  payer: undefined as unknown,
  stampThrows: false,
  guard: "pass" as "pass" | 402 | 413,
  guardCalls: 0,
}))
vi.mock("@/lib/dedup-fingerprint.js", async (orig) => ({
  ...(await orig<typeof import("@/lib/dedup-fingerprint.js")>()),
  findJobByIdempotencyKey: async (...a: unknown[]) => {
    m.keyLookups.push(a)
    return m.existingByKey
  },
}))
vi.mock("@/lib/config.js", async (orig) => ({ ...(await orig<typeof import("@/lib/config.js")>()), hasCredits: () => m.credits }))
vi.mock("@/lib/availability-viewer.js", () => ({ isNodeDeniedForUser: async () => m.denied }))
vi.mock("@/lib/execution-inline-graph.js", () => ({ ensureInlineGraphColumns: async () => !m.absent }))
vi.mock("@/lib/use-case/request.js", async (orig) => ({
  ...(await orig<typeof import("@/lib/use-case/request.js")>()),
  prepareUseCase: (...a: unknown[]) => m.prepare(...a),
}))
vi.mock("@/lib/use-case/preflight.js", () => ({ usecasePreflight: async () => m.preflight }))
vi.mock("@/ee/billing/use-case-estimate.js", () => ({
  estimateUseCaseCredits: async (graph: { nodeType?: string }) => {
    m.estimateCalls++
    m.estimatedTypes.push(graph?.nodeType)
    return { stepsCredits: 922, feeCredits: 10, totalCredits: 932 }
  },
}))
vi.mock("@/ee/billing/credits.js", async (orig) => ({
  // The price table and the charged-price rule the MCP verbs' credit hint reads (statedPrices).
  STATIC_CREDIT_COSTS: (await orig<typeof import("@/ee/billing/credits.js")>()).STATIC_CREDIT_COSTS,
  chargedPriceTableFrom: (await orig<typeof import("@/ee/billing/credits.js")>()).chargedPriceTableFrom,
  chargedCredits: (await orig<typeof import("@/ee/billing/credits.js")>()).chargedCredits,
  DEPLOYMENT_OUT_OF_CREDITS: "This deployment is out of credits. Contact your administrator.",
  CreditsService: {
    checkBalanceCovers: async (...a: unknown[]) => {
      m.coverArgs = a
      return m.cover
    },
  },
}))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: m.insertJob, insertJobIdempotent: m.insertIdem, billingPairColumns: () => ({}) }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async (_req: unknown, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) => {
    m.guardCalls++
    if (m.guard === 402) return reply.status(402).send({ error: { code: "insufficient_credits", message: "Insufficient credits" } })
    if (m.guard === 413) return reply.status(413).send({ error: { code: "storage_limit_exceeded", message: "Storage limit reached" } })
  },
  reserveCreditsForJob: (req: FastifyRequest, ...rest: unknown[]) => {
    m.reserveSeen.push({ billingContext: req.billingContext, creditOverride: req.creditReservation?.creditOverride })
    return m.reserve(req, ...rest)
  },
  resolveWebSurfaceFlag: async () => false,
}))
vi.mock("@/services/use-case-execution.js", async (orig) => ({
  ...(await orig<typeof import("@/services/use-case-execution.js")>()),
  executeInlineGraph: m.execute,
}))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      update: (row: unknown) => ({
        eq: () => ({
          // The stamp is filtered by the wrapper's owner as well as its id.
          eq: async (col: string) => {
            if (m.stampThrows) throw new Error("socket hang up")
            if (col === "user_id") m.stamp(row)
            return { error: null }
          },
        }),
      }),
    }),
  },
}))
vi.mock("@/lib/job-failure.js", () => ({ markJobFailed: m.failed }))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: m.refund }))
import { usecaseRunRoutes } from "../use-case-run.js"
import { InlineGraphUnavailableError } from "@/services/use-case-execution.js"

const routeConfigs: Array<{ url: string; config: unknown }> = []
async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("onRoute", (r) => {
    routeConfigs.push({ url: r.url, config: r.config })
  })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
    req.authKind = m.authKind
    if (m.payer) req.billingContext = m.payer as never
  })
  await app.register(usecaseRunRoutes)
  await app.ready()
  return app
}
const media = { url: "https://r2/ep.mp4", kind: "video", durationSec: 3600 }
const ok = () => ({ ok: true, settings: TIGHTEN_EPISODE_DEFAULTS, sources: { media }, graph })
const post = (app: FastifyInstance, payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url: "/v1/tighten-episode", payload, headers })

beforeEach(() => {
  Object.assign(m, {
    credits: true, denied: false, absent: false, authKind: "jwt", prepared: ok(), preflight: null, cover: { ok: true },
    coverArgs: [], estimateCalls: 0, estimatedTypes: [], reserveSeen: [], existingByKey: null, keyLookups: [], payer: undefined, stampThrows: false, guard: "pass", guardCalls: 0,
  })
  m.insertJob.mockReset().mockResolvedValue({ data: { id: "job-1" }, error: null })
  m.insertIdem.mockReset().mockResolvedValue({ created: true, row: { id: "job-1" } })
  m.reserve.mockReset().mockResolvedValue({ usageLogId: "ul-1", creditsReserved: 10, watermark: false })
  m.execute.mockReset().mockResolvedValue({ executionId: "exec-1", deduped: false })
  m.prepare.mockReset().mockImplementation(async () => m.prepared)
  for (const f of [m.stamp, m.failed, m.refund]) f.mockClear()
})

describe("POST /v1/tighten-episode", () => {
  it("starts the run: wrapper (use-case, processing), fee reserved, inline run, stamped, 202", async () => {
    const res = await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"] })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ jobId: "job-1", executionId: "exec-1" })
    const row = m.insertJob.mock.calls[0]![1]
    expect(row).toMatchObject({
      user_id: USER, provider: "use-case", job_type: "tighten-episode", status: "processing",
      input_data: expect.objectContaining({ type: "tighten-episode", mode: "run", mediaUrl: "https://r2/ep.mp4", durationSec: 3600, _feeCredits: 10 }),
    })
    expect(m.reserve).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", "use-case-fee:tighten-episode")
    expect(m.execute).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER, wrapperJobId: "job-1", reviewerPresent: false, idempotencyKey: "uc-exec-job-1",
      graph: expect.objectContaining({ version: 1, hash: expect.any(String), settings: TIGHTEN_EPISODE_DEFAULTS }),
    }))
    expect(m.stamp).toHaveBeenCalledWith({ input_data: expect.objectContaining({ _executionId: "exec-1", _feeCredits: 10 }) })
  })

  it("the wrapper never carries an execution id as workflow_execution_id (inner or outer); it points at its run through its input only", async () => {
    m.authKind = "internal"
    await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"], userId: USER, workflowId: "00000000-0000-4000-8000-0000000000aa", nodeId: "t1" })
    const row = m.insertJob.mock.calls[0]![1] as Record<string, unknown>
    expect(row).not.toHaveProperty("workflow_execution_id")
    expect(row).toMatchObject({ workflow_id: "00000000-0000-4000-8000-0000000000aa", node_id: "t1" })
    const stamp = m.stamp.mock.calls[0]![0] as Record<string, unknown>
    expect(Object.keys(stamp)).toEqual(["input_data"])
  })

  it("the fee held is the quoted fee: the reservation is pinned to the estimate's figure", async () => {
    await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"] })
    expect(m.estimateCalls).toBe(1)
    expect(m.reserveSeen[0]!.creditOverride).toBe(10)
    expect(m.coverArgs[1]).toBe(932)
  })

  it("dedupe: the same idempotency key answers the same wrapper and starts nothing", async () => {
    m.insertIdem.mockResolvedValue({ created: false, row: { id: "job-0", provider: "use-case", job_type: "tighten-episode" } })
    const res = await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"] }, { "idempotency-key": "client-key-123" })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ jobId: "job-0", deduped: true })
    expect(m.insertIdem.mock.calls[0]![2]).toBe("client-key-123")
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.reserve).not.toHaveBeenCalled()
    expect(m.execute).not.toHaveBeenCalled()
  })

  for (const [name, setup, status, code] of [
    ["denied in this deployment", () => { m.denied = true }, 403, "node_not_available"],
    ["the snapshot columns are not on this database", () => { m.absent = true }, 503, "use_case_unavailable"],
    ["unreadable media", () => { m.prepared = { ok: false, status: 400, code: "media_unreadable", message: "x" } }, 400, "media_unreadable"],
    ["over 180 minutes", () => { m.prepared = { ok: false, status: 400, code: "media_too_long", message: "x" } }, 400, "media_too_long"],
    ["no audio", () => { m.prepared = { ok: false, status: 400, code: "media_has_no_audio", message: "x" } }, 400, "media_has_no_audio"],
    ["unconnected self-host", () => { m.preflight = { status: 503, code: "nodaro_connection_required", message: "x" } }, 503, "nodaro_connection_required"],
    ["balance below the estimate", () => { m.cover = { ok: false, balance: 100 } }, 402, "insufficient_credits"],
  ] as const) {
    it(`${name}: refused ${status} before any row or hold`, async () => {
      setup()
      const res = await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"] })
      expect(res.statusCode).toBe(status)
      expect(res.json().error.code).toBe(code)
      expect(m.insertJob).not.toHaveBeenCalled()
      expect(m.insertIdem).not.toHaveBeenCalled()
      expect(m.reserve).not.toHaveBeenCalled()
      expect(m.execute).not.toHaveBeenCalled()
    })
  }

  it("the snapshot columns: refused while missing, runs once they appear", async () => {
    const app = await makeApp()
    m.absent = true
    expect((await post(app, { mediaUrls: ["https://r2/ep.mp4"] })).statusCode).toBe(503)
    expect(m.prepare).not.toHaveBeenCalled()
    m.absent = false
    expect((await post(app, { mediaUrls: ["https://r2/ep.mp4"] })).statusCode).toBe(202)
  })

  it("an unconnected self-host is refused before the recording is even fetched (no probe)", async () => {
    m.preflight = { status: 503, code: "nodaro_connection_required", message: "x" }
    await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"] })
    expect(m.prepare).not.toHaveBeenCalled()
  })

  it("a bad body: 400 validation_error", async () => {
    const res = await post(await makeApp(), { mediaUrls: "nope" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("review on from a caller outside any run: runs only up to the proxy render, as the reviewer", async () => {
    const review = buildTightenEpisodeGraph({ ...TIGHTEN_EPISODE_DEFAULTS, reviewBeforeRender: true }, { media: { url: "https://r2/ep.mp4", kind: "video", durationSec: 3600 } })
    m.prepared = { ...ok(), settings: { ...TIGHTEN_EPISODE_DEFAULTS, reviewBeforeRender: true }, graph: review }
    await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"], reviewBeforeRender: true })
    expect(m.execute.mock.calls[0]![0]).toMatchObject({ reviewerPresent: true, nodeIds: ["uc-source", "uc-transcribe", "uc-silence", "uc-plan", "uc-render"] })
  })

  it("review off: the whole graph runs (no subset), and a forged reviewerPresent from outside a run is ignored", async () => {
    await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"], reviewerPresent: true })
    expect(m.execute.mock.calls[0]![0]).not.toHaveProperty("nodeIds")
    expect(m.execute.mock.calls[0]![0]).toMatchObject({ reviewerPresent: false })
  })

  it("internal lane: review on with no reviewer in the parent run is refused (409) before the recording is probed", async () => {
    m.authKind = "internal"
    const refused = await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"], reviewBeforeRender: true, userId: USER })
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error.code).toBe("preview_review_required")
    expect(m.prepare).not.toHaveBeenCalled()
    expect(m.insertJob).not.toHaveBeenCalled()
  })

  it("internal lane: the parent's reviewer, depth and component ids ride the run", async () => {
    m.authKind = "internal"
    m.prepared = { ...ok(), settings: { ...TIGHTEN_EPISODE_DEFAULTS, reviewBeforeRender: true } }
    await post(await makeApp(), {
      mediaUrls: ["https://r2/ep.mp4"], reviewBeforeRender: true, reviewerPresent: true, componentDepth: 2,
      executingComponentIds: ["c1"], previewStopRule: false, userId: USER,
    })
    expect(m.execute.mock.calls[0]![0]).toMatchObject({ reviewerPresent: true, componentDepth: 2, executingComponentIds: ["c1"], previewStopRule: false })
  })

  it("outside a run, the internal-lane fields are ignored", async () => {
    await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"], componentDepth: 4, executingComponentIds: ["c1"], previewStopRule: false })
    const p = m.execute.mock.calls[0]![0] as Record<string, unknown>
    expect(p).toMatchObject({ componentDepth: 0, executingComponentIds: [] })
    expect(p).not.toHaveProperty("previewStopRule")
  })

  it("internal lane: depth 5 is refused", async () => {
    m.authKind = "internal"
    const deep = await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"], componentDepth: 5, userId: USER })
    expect(deep.statusCode).toBe(400)
    expect(deep.json().error.code).toBe("nesting_too_deep")
    expect(m.insertJob).not.toHaveBeenCalled()
  })

  it("internal lane: the parent's payer is the one the fee check and the fee hold read", async () => {
    m.authKind = "internal"
    const payer = { userId: USER, payer: "user" }
    await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"], billingContext: payer, userId: USER })
    expect(m.reserveSeen[0]!.billingContext).toEqual(payer)
    expect(m.coverArgs[2]).toEqual(payer)
    expect(m.execute.mock.calls[0]![0]).toMatchObject({ billingContext: payer })
  })

  it("a payer sent by a caller outside a run, or naming another user, is ignored", async () => {
    await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"], billingContext: { userId: USER, payer: "user" } })
    expect(m.reserveSeen[0]!.billingContext).toBeUndefined()
    m.authKind = "internal"
    await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"], billingContext: { userId: "someone-else", payer: "user" }, userId: USER })
    expect(m.reserveSeen[1]!.billingContext).toBeUndefined()
  })

  it("the fee hold is refused: no run starts", async () => {
    m.reserve.mockImplementation(async (_req: unknown, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) => {
      reply.status(402).send({ error: { code: "insufficient_credits", message: "x" } })
      return undefined
    })
    const res = await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"] })
    expect(res.statusCode).toBe(402)
    expect(m.execute).not.toHaveBeenCalled()
    expect(m.failed).toHaveBeenCalledWith("job-1", expect.objectContaining({ from: ["processing"] }))
  })

  it("a keyed retry long after the guard's window gets its live run back — no re-probe, no balance check, nothing new", async () => {
    // +11 s: the media link has expired and the balance is drained by the run itself.
    m.existingByKey = { id: "job-live", provider: "use-case", jobType: "tighten-episode" }
    m.prepared = { ok: false, status: 400, code: "media_unreadable", message: "x" }
    m.cover = { ok: false, balance: 0 }
    const res = await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"] }, { "idempotency-key": "client-key-123" })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ jobId: "job-live", deduped: true })
    expect(res.headers["x-dedup-hit"]).toBe("1")
    // Only a use-case wrapper answers a keyed retry: a key reused on another job type never does.
    expect(m.keyLookups).toEqual([[USER, "client-key-123"]])
    expect(m.prepare).not.toHaveBeenCalled()
    expect(m.estimateCalls).toBe(0)
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.insertIdem).not.toHaveBeenCalled()
    expect(m.reserve).not.toHaveBeenCalled()
    expect(m.execute).not.toHaveBeenCalled()
  })

  for (const answer of [402, 413] as const) {
    it(`a keyed retry is answered before the credit guard (which would now answer ${answer}): its run back, nothing new`, async () => {
      m.guard = answer
      m.existingByKey = { id: "job-live", provider: "use-case", jobType: "tighten-episode" }
      const res = await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"] }, { "idempotency-key": "client-key-123" })
      expect(res.statusCode).toBe(202)
      expect(res.json()).toEqual({ jobId: "job-live", deduped: true })
      expect(m.guardCalls).toBe(0)
      expect(m.prepare).not.toHaveBeenCalled()
      expect(m.insertJob).not.toHaveBeenCalled()
      expect(m.insertIdem).not.toHaveBeenCalled()
      expect(m.reserve).not.toHaveBeenCalled()
      expect(m.execute).not.toHaveBeenCalled()
    })

    it(`no key, a short key, or a key with no run yet: the credit guard answers (${answer}) as before`, async () => {
      m.guard = answer
      const keyed: Array<Record<string, string>> = [{}, { "idempotency-key": "short" }, { "idempotency-key": "client-key-new" }]
      for (const headers of keyed) {
        const res = await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"] }, headers)
        expect(res.statusCode).toBe(answer)
      }
      expect(m.guardCalls).toBe(3)
      expect(m.keyLookups).toEqual([[USER, "client-key-new"]])
      expect(m.insertJob).not.toHaveBeenCalled()
      expect(m.reserve).not.toHaveBeenCalled()
    })
  }

  it("a key already used for another use-case type is refused, and nothing is created", async () => {
    m.existingByKey = { id: "job-other", provider: "use-case", jobType: "episode-chapters" }
    const res = await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"] }, { "idempotency-key": "k-reused-0123456789" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toEqual({
      code: "idempotency_key_reused",
      message: "This Idempotency-Key was already used for another kind of run. Send a new key.",
    })
    expect(m.guardCalls).toBe(0)
    expect(m.prepare).not.toHaveBeenCalled()
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.insertIdem).not.toHaveBeenCalled()
    expect(m.reserve).not.toHaveBeenCalled()
    expect(m.execute).not.toHaveBeenCalled()
  })

  it("a key another type's first request won while this one was checked: refused 409, nothing held or run", async () => {
    // Another type's first request won the key while this one was checked.
    m.insertIdem.mockResolvedValue({ created: false, row: { id: "job-other", provider: "use-case", job_type: "episode-chapters", run_type: "episode-chapters" } })
    const res = await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"] }, { "idempotency-key": "k-reused-0123456789" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("idempotency_key_reused")
    expect(m.reserve).not.toHaveBeenCalled()
    expect(m.execute).not.toHaveBeenCalled()
    // The row the insert found under the key is judged by its kind and type, read with them.
    expect(m.insertIdem.mock.calls[0]![3]).toBe("id, provider, job_type, run_type:input_data->>type")
  })

  it("a key already used on another kind of job (an image generation) is refused, and nothing is created", async () => {
    m.existingByKey = { id: "job-img", provider: "kie", jobType: "generate-image" }
    const res = await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"] }, { "idempotency-key": "k-image-0123456789" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("idempotency_key_reused")
    expect(res.body).not.toContain("job-img")
    // Asked of every job of the caller's under the key, not only use-case runs.
    expect(m.keyLookups).toEqual([[USER, "k-image-0123456789"]])
    expect(m.guardCalls).toBe(0)
    expect(m.prepare).not.toHaveBeenCalled()
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.insertIdem).not.toHaveBeenCalled()
    expect(m.reserve).not.toHaveBeenCalled()
    expect(m.execute).not.toHaveBeenCalled()
  })

  it("a key another kind of job holds, found only by the insert: refused 409, never answered with that job", async () => {
    m.insertIdem.mockResolvedValue({ created: false, row: { id: "job-img", provider: "kie", job_type: "generate-image", run_type: null } })
    const res = await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"] }, { "idempotency-key": "k-image-0123456789" })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("idempotency_key_reused")
    expect(res.body).not.toContain("job-img")
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.reserve).not.toHaveBeenCalled()
    expect(m.execute).not.toHaveBeenCalled()
  })

  it("the same type's keyed run is its own: answered with it, as before", async () => {
    m.existingByKey = { id: "job-live", provider: "use-case", jobType: "tighten-episode" }
    const res = await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"] }, { "idempotency-key": "client-key-123" })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ jobId: "job-live", deduped: true })
  })

  it("no key (or one too short to be a key): no lookup", async () => {
    await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"] }, { "idempotency-key": "short" })
    expect(m.keyLookups).toEqual([])
    expect(m.insertJob).toHaveBeenCalledTimes(1)
  })

  it("the estimate never answers with another run", async () => {
    m.existingByKey = { id: "job-live", provider: "use-case", jobType: "tighten-episode" }
    const res = await (await makeApp()).inject({ method: "POST", url: "/v1/tighten-episode/estimate", payload: { mediaUrls: ["https://r2/ep.mp4"] }, headers: { "idempotency-key": "client-key-123" } })
    expect(res.json().data.totalCredits).toBe(932)
    expect(m.keyLookups).toEqual([])
  })

  it("a deployment payer below the estimate: the operator's words, never the pool's balance", async () => {
    m.payer = { userId: USER, payer: "deployment", payerId: "00000000-0000-4000-8000-0000000000dd" }
    m.cover = { ok: false, balance: 123456 }
    const res = await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"] })
    expect(res.statusCode).toBe(402)
    expect(res.json().error).toEqual({ code: "insufficient_credits", message: "This deployment is out of credits. Contact your administrator." })
    expect(res.body).not.toContain("123456")
  })

  it("a personal payer below the estimate is told the estimate and their balance", async () => {
    m.cover = { ok: false, balance: 100 }
    const res = await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"] })
    expect(res.json().error.message).toBe("This episode is estimated at about 932 credits; your balance is 100.")
  })

  it("a stamp that throws after the run started never fails the wrapper or refunds the fee", async () => {
    m.stampThrows = true
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const res = await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"] })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ jobId: "job-1", executionId: "exec-1" })
    expect(m.failed).not.toHaveBeenCalled()
    expect(m.refund).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not stamped"))
    warn.mockRestore()
  })

  it("the run cannot start: wrapper failed, fee refunded, honest status", async () => {
    m.execute.mockRejectedValue(new InlineGraphUnavailableError())
    const res = await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"] })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("use_case_unavailable")
    expect(m.failed).toHaveBeenCalledWith("job-1", expect.objectContaining({ from: ["processing"] }))
    expect(m.refund).toHaveBeenCalledWith("job-1")
  })

  it("community (no credits): no estimate, no balance check, still runs", async () => {
    m.credits = false
    const res = await post(await makeApp(), { mediaUrls: ["https://r2/ep.mp4"] })
    expect(res.statusCode).toBe(202)
    expect(m.estimateCalls).toBe(0)
    expect(m.insertJob.mock.calls[0]![1].input_data._feeCredits).toBe(0)
  })

  it("a personal key limited to some workflows stays refused: neither route declares a workflow scope", async () => {
    routeConfigs.length = 0
    await makeApp()
    const ours = routeConfigs.filter((r) => r.url.startsWith("/v1/tighten-episode"))
    expect(ours.map((r) => r.url).sort()).toEqual(["/v1/tighten-episode", "/v1/tighten-episode/estimate"])
    for (const r of ours) expect((r.config as { workflowScope?: unknown } | undefined)?.workflowScope).toBeUndefined()
  })
})

describe("POST /v1/tighten-episode/estimate", () => {
  const estimate = async (payload: Record<string, unknown> = { mediaUrls: ["https://r2/ep.mp4"] }) =>
    (await makeApp()).inject({ method: "POST", url: "/v1/tighten-episode/estimate", payload })

  it("the built graph's estimate plus the fee, and the probed length; nothing written", async () => {
    const res = await estimate()
    expect(res.json()).toEqual({ data: { totalCredits: 932, stepsCredits: 922, feeCredits: 10, durationSec: 3600 } })
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.reserve).not.toHaveBeenCalled()
  })
  it("refuses what the run would refuse (media, deny)", async () => {
    m.prepared = { ok: false, status: 400, code: "media_unreadable", message: "x" }
    expect((await estimate()).json().error.code).toBe("media_unreadable")
    m.denied = true
    expect((await estimate()).statusCode).toBe(403)
  })
  it("community: zero, with the length", async () => {
    m.credits = false
    expect((await estimate()).json()).toEqual({ data: { totalCredits: 0, stepsCredits: 0, feeCredits: 0, durationSec: 3600 } })
  })
})

describe("Chapters through the same factory", () => {
  const chaptersGraph = buildEpisodeChaptersGraph(EPISODE_CHAPTERS_DEFAULTS, { media: { url: "https://r2/ep.mp4", kind: "video", durationSec: 3600 } })
  const chaptersOk = () => ({ ok: true, settings: EPISODE_CHAPTERS_DEFAULTS, sources: { media }, graph: chaptersGraph })
  const postChapters = async (payload: Record<string, unknown>) =>
    (await makeApp()).inject({ method: "POST", url: "/v1/episode-chapters", payload })
  beforeEach(() => {
    m.prepared = chaptersOk()
  })

  it("starts the run: a Chapters wrapper (use-case, processing), its own fee held, its graph run, 202", async () => {
    const res = await postChapters({ mediaUrls: ["https://r2/ep.mp4"] })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toEqual({ jobId: "job-1", executionId: "exec-1" })
    expect(m.prepare.mock.calls[0]![0]).toBe("episode-chapters")
    expect(m.insertJob.mock.calls[0]![1]).toMatchObject({
      user_id: USER, provider: "use-case", job_type: "episode-chapters", status: "processing",
      input_data: expect.objectContaining({ type: "episode-chapters", mode: "run", mediaUrl: "https://r2/ep.mp4", _feeCredits: 10 }),
    })
    expect(m.reserve).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", "use-case-fee:episode-chapters")
    expect(m.estimatedTypes).toEqual(["episode-chapters"])
    // Nothing renders, so there is no preview subset: the whole graph runs.
    expect(m.execute.mock.calls[0]![0]).not.toHaveProperty("nodeIds")
    expect(m.execute.mock.calls[0]![0]).toMatchObject({ graph: expect.objectContaining({ nodeType: "episode-chapters", settings: EPISODE_CHAPTERS_DEFAULTS }) })
  })

  it("a key Chapters does not have (another type's setting) is stripped, and the run starts", async () => {
    const res = await postChapters({ mediaUrls: ["https://r2/ep.mp4"], captions: "yes", framing: { aspect: "9:16", layout: "stacked" } })
    expect(res.statusCode).toBe(202)
    const body = m.prepare.mock.calls[0]![1] as Record<string, unknown>
    expect(body).not.toHaveProperty("captions")
    expect(body).not.toHaveProperty("framing")
    expect(m.insertJob).toHaveBeenCalledTimes(1)
  })

  it("its own settings are checked: an unknown plan tier is a 400 before any row", async () => {
    const res = await postChapters({ mediaUrls: ["https://r2/ep.mp4"], planTier: "ultra" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(m.insertJob).not.toHaveBeenCalled()
  })

  it("POST /v1/episode-chapters/estimate: the built graph's estimate plus its fee, and the probed length", async () => {
    const res = await (await makeApp()).inject({ method: "POST", url: "/v1/episode-chapters/estimate", payload: { mediaUrls: ["https://r2/ep.mp4"] } })
    expect(res.statusCode).toBe(200)
    // Priced on Chapters' own graph (the figures are this file's mocked estimate).
    expect(m.estimatedTypes).toEqual(["episode-chapters"])
    expect(res.json()).toEqual({ data: { totalCredits: 932, stepsCredits: 922, feeCredits: 10, durationSec: 3600 } })
    expect(m.insertJob).not.toHaveBeenCalled()
  })
})

describe("Trailer through the same factory", () => {
  const postTrailer = async (payload: Record<string, unknown>) =>
    (await makeApp()).inject({ method: "POST", url: "/v1/episode-trailer", payload })
  // The probe's verdicts are prepareUseCase's (request.test.ts); here the
  // route hands its answer on and writes nothing.
  const refusedWith = (code: string, message: string) => () => {
    m.prepared = { ok: false, status: 400, code, message }
  }
  beforeEach(() => {
    // The real settings and graph, as prepareUseCase would build them for a video recording.
    m.prepare.mockImplementation(async (type: UseCaseNodeType, body: Record<string, unknown>) => {
      if (m.prepared && (m.prepared as { ok?: boolean }).ok === false) return m.prepared
      const d = usecaseDescriptor(type)
      const settings = d.resolveSettings(body, "video")
      const sources = { media, ...(typeof body.introCardUrl === "string" ? { introCard: { url: body.introCardUrl } } : {}) }
      return { ok: true, settings, sources, graph: d.build(settings, sources as never) }
    })
  })

  it("an audio-only recording: 400 media_needs_video, no row", async () => {
    refusedWith("media_needs_video", "Trailer needs a video recording.")()
    const res = await postTrailer({ mediaUrls: ["https://r2/ep.mp3"] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code: "media_needs_video", message: "Trailer needs a video recording." })
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.reserve).not.toHaveBeenCalled()
  })

  it("formats: [] is a 400 naming the reason, before anything is probed or written", async () => {
    const res = await postTrailer({ mediaUrls: ["https://r2/ep.mp4"], formats: [] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(JSON.stringify(res.json().error)).toContain("Choose at least one format")
    expect(m.prepare).not.toHaveBeenCalled()
    expect(m.insertJob).not.toHaveBeenCalled()
  })

  it("an intro card that probes without video: 400 intro_card_unreadable, no row", async () => {
    refusedWith("intro_card_unreadable", "The intro card could not be read as a video.")()
    const res = await postTrailer({ mediaUrls: ["https://r2/ep.mp4"], introCardUrl: "https://r2/card.png" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("intro_card_unreadable")
    expect(m.prepare.mock.calls[0]![1]).toMatchObject({ introCardUrl: "https://r2/card.png" })
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.reserve).not.toHaveBeenCalled()
  })

  it("an intro card over 15 seconds: 400 intro_card_too_long, nothing written or held", async () => {
    refusedWith("intro_card_too_long", "The intro card is too long. Use a card of 15 seconds or less.")()
    const res = await postTrailer({ mediaUrls: ["https://r2/ep.mp4"], introCardUrl: "https://r2/long-card.mp4" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({ code: "intro_card_too_long", message: "The intro card is too long. Use a card of 15 seconds or less." })
    expect(m.insertJob).not.toHaveBeenCalled()
    expect(m.insertIdem).not.toHaveBeenCalled()
    expect(m.reserve).not.toHaveBeenCalled()
    expect(m.execute).not.toHaveBeenCalled()
  })

  it("a run with formats [16:9, 9:16] stores its settings with the formats in delivery order; its own fee", async () => {
    const res = await postTrailer({ mediaUrls: ["https://r2/ep.mp4"], formats: ["16:9", "9:16"] })
    expect(res.statusCode).toBe(202)
    expect(m.insertJob.mock.calls[0]![1]).toMatchObject({ job_type: "episode-trailer", input_data: expect.objectContaining({ type: "episode-trailer" }) })
    expect(m.reserve).toHaveBeenCalledWith(expect.anything(), expect.anything(), "job-1", "use-case-fee:episode-trailer")
    const run = m.execute.mock.calls[0]![0] as { graph: { nodeType: string; settings: { formats: string[] }; outputMap: { formats: Array<{ format: string }> } } }
    expect(run.graph.nodeType).toBe("episode-trailer")
    expect(run.graph.settings.formats).toEqual(["9:16", "16:9"])
    expect(run.graph.outputMap.formats.map((f) => f.format)).toEqual(["9:16", "16:9"])
  })
})

// The MCP lane (decided 2026-10-14): an MCP verb is injected on the INTERNAL
// lane (`mcpInject` sends the orchestrator secret), where the route counts a
// reviewer only when one is forwarded. The agent that asks for a review is
// its reviewer, so the verb forwards it — through the REAL route here, never
// a mocked reply.
describe("MCP tighten_episode through the real route", () => {
  async function mcpApp() {
    const app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      req.userId = USER
      // As the auth hook decides it: the orchestrator secret is the internal lane.
      req.authKind = req.headers["x-internal-orchestrator-secret"] !== undefined ? "internal" : "jwt"
    })
    await app.register(usecaseRunRoutes)
    await app.ready()
    const { registerUseCaseVerbs } = await import("@/lib/mcp/tools/verbs-use-case.js")
    const { buildServer } = await import("@/lib/mcp/tools/__tests__/_helpers.js")
    const { newSession } = await import("@/lib/mcp/session.js")
    const server = buildServer()
    const session = newSession({ userId: USER, scopes: ["workflows:execute"] as never, clientName: "Claude" })
    registerUseCaseVerbs({ server, session, fastify: app })
    return server
  }

  it("review_before_render: the run starts, its hidden run told a reviewer is present (no 409)", async () => {
    m.prepared = { ...ok(), settings: { ...TIGHTEN_EPISODE_DEFAULTS, reviewBeforeRender: true } }
    const { callTool } = await import("@/lib/mcp/tools/__tests__/_helpers.js")
    const res = await callTool(await mcpApp(), "tighten_episode", { media_url: "https://r2/ep.mp4", review_before_render: true })
    expect(JSON.stringify(res.content)).not.toMatch(/preview_review_required/)
    expect(m.execute).toHaveBeenCalledTimes(1)
    expect(m.execute.mock.calls[0]![0]).toMatchObject({ reviewerPresent: true })
  })

  it("review off: nothing forwarded, and no reviewer on the hidden run", async () => {
    const { callTool } = await import("@/lib/mcp/tools/__tests__/_helpers.js")
    await callTool(await mcpApp(), "tighten_episode", { media_url: "https://r2/ep.mp4" })
    expect(m.execute).toHaveBeenCalledTimes(1)
    expect(m.execute.mock.calls[0]![0]).toMatchObject({ reviewerPresent: false })
  })
})

