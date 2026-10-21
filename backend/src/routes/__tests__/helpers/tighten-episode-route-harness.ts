// @test-units-by-name passes the real price table through the credits mock (the MCP verbs' hint reads it); prices only the use-case types its tests name
/**
 * The shared harness of the POST /v1/tighten-episode route tests: the module
 * mocks, the in-memory state they read (`m`) and the app. Imported FIRST by
 * each test file, so its mocks are registered before anything they replace
 * loads; the route itself is loaded on first use.
 */
import { vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify"
import { TIGHTEN_EPISODE_DEFAULTS, buildTightenEpisodeGraph } from "@nodaro/render-rules"
export const USER = "00000000-0000-4000-8000-000000000001"
export const graph = buildTightenEpisodeGraph(TIGHTEN_EPISODE_DEFAULTS, { media: { url: "https://r2/ep.mp4", kind: "video", durationSec: 3600 } })
export const m = {
  credits: true,
  denied: false,
  deniedTypes: [] as string[],
  absent: false,
  authKind: "jwt" as "jwt" | "internal" | "api_token",
  prepared: null as unknown,
  preflight: null as unknown,
  cover: { ok: true } as { ok: boolean; balance?: number },
  coverArgs: [] as unknown[],
  estimateCalls: 0,
  estimatedTypes: [] as Array<string | undefined>,
  /** An error the estimate throws (an unpriced metered LLM model, R49); null: it answers. */
  estimateThrows: null as Error | null,
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
  // A whole-clip render's measurement (Speaker Layout): the cache read, the download and the start limit.
  peek: vi.fn(),
  measure: vi.fn(),
  limited: false,
  limitCalls: 0,
}
vi.mock("@/lib/dedup-fingerprint.js", async (orig) => ({
  ...(await orig<typeof import("@/lib/dedup-fingerprint.js")>()),
  findJobByIdempotencyKey: async (...a: unknown[]) => {
    m.keyLookups.push(a)
    return m.existingByKey
  },
}))
vi.mock("@/lib/config.js", async (orig) => ({ ...(await orig<typeof import("@/lib/config.js")>()), hasCredits: () => m.credits }))
vi.mock("@/lib/availability-viewer.js", () => ({ isNodeDeniedForUser: async (type: string) => m.denied || m.deniedTypes.includes(type) }))
vi.mock("@/lib/execution-inline-graph.js", () => ({ ensureInlineGraphColumns: async () => !m.absent }))
vi.mock("@/lib/use-case/request.js", async (orig) => ({
  ...(await orig<typeof import("@/lib/use-case/request.js")>()),
  prepareUseCase: (...a: unknown[]) => m.prepare(...a),
}))
vi.mock("@/lib/clip-measure.js", async (orig) => ({
  ...(await orig<typeof import("@/lib/clip-measure.js")>()),
  peekClip: (...a: unknown[]) => m.peek(...a),
  measureClip: (...a: unknown[]) => m.measure(...a),
}))
// Created once at the route's load: it reads `m.limited` per call, and answers as the real limiter does.
vi.mock("@/lib/clip-measure-limit.js", () => ({
  clipMeasureStartLimiter: () => async (_req: unknown, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) => {
    m.limitCalls++
    if (m.limited) return reply.status(429).send({ error: { code: "rate_limit_exceeded", message: "Too many requests. Limit: 20 per 60s. Try again later." } })
  },
}))
vi.mock("@/lib/use-case/preflight.js", () => ({ usecasePreflight: async () => m.preflight }))
vi.mock("@/ee/billing/use-case-estimate.js", () => ({
  estimateUseCaseCredits: async (graph: { nodeType?: string }) => {
    m.estimateCalls++
    m.estimatedTypes.push(graph?.nodeType)
    if (m.estimateThrows) throw m.estimateThrows
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

export const routeConfigs: Array<{ url: string; config: unknown }> = []
export async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("onRoute", (r) => {
    routeConfigs.push({ url: r.url, config: r.config })
  })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
    req.authKind = m.authKind
    if (m.payer) req.billingContext = m.payer as never
  })
  // Loaded on first use, once the state the mocks read exists.
  const { usecaseRunRoutes } = await import("../../use-case-run.js")
  await app.register(usecaseRunRoutes)
  await app.ready()
  return app
}
export const media = { url: "https://r2/ep.mp4", kind: "video", durationSec: 3600 }
export const ok = () => ({ ok: true, settings: TIGHTEN_EPISODE_DEFAULTS, sources: { media }, graph })
export const post = (app: FastifyInstance, payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url: "/v1/tighten-episode", payload, headers })

beforeEach(() => {
  Object.assign(m, {
    credits: true, denied: false, deniedTypes: [], absent: false, authKind: "jwt", prepared: ok(), preflight: null, cover: { ok: true },
    coverArgs: [], estimateCalls: 0, estimatedTypes: [], estimateThrows: null, reserveSeen: [], existingByKey: null, keyLookups: [], payer: undefined, stampThrows: false, guard: "pass", guardCalls: 0,
    limited: false, limitCalls: 0,
  })
  m.peek.mockReset().mockResolvedValue(null)
  m.measure.mockReset().mockResolvedValue({ durationMs: 3_600_000, width: 1920, height: 1080 })
  m.insertJob.mockReset().mockResolvedValue({ data: { id: "job-1" }, error: null })
  m.insertIdem.mockReset().mockResolvedValue({ created: true, row: { id: "job-1" } })
  m.reserve.mockReset().mockResolvedValue({ usageLogId: "ul-1", creditsReserved: 10, watermark: false })
  m.execute.mockReset().mockResolvedValue({ executionId: "exec-1", deduped: false })
  m.prepare.mockReset().mockImplementation(async () => m.prepared)
  for (const f of [m.stamp, m.failed, m.refund]) f.mockClear()
})

