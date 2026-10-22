// @test-units-by-name names no node type: it prices the metered LLM and scrape credit ids it names (CreditsService mocked)
/**
 * Task 10 — the creative / analysis routes, the D3 helpers and the scrapes'
 * per-item analysis bill METERED (D1/D3): a 1-attempt hold sized from the
 * request as it is sent, settled at what the call cost (a billed failure
 * charged, an unbilled one refunded), in the contract's order — the route's
 * result first (non-terminal), then the settle, then the terminal write.
 *
 * The reserve and the settle run the REAL contract (`lib/llm-billing.ts` →
 * `ee/billing/llm-billing-impl.ts`); only the credit-guard's reservation,
 * the CreditsService RPCs, the LLM client and the database are mocked.
 * Every figure is at a 10% markup, CREDIT_BASE_USD = 0.002:
 *   stated 0.048 → 24 base → ceil(26.4) = 27 charged
 *   stated 0.01  → 5 base  → ceil(5.5)  = 6 charged
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { LLM_FEATURE_DEFAULTS, buildLlmCreditIdentifier } from "@nodaro/shared/llm-models"

const JOB = "11111111-1111-4111-8111-111111111111"
const LOG = "22222222-2222-4222-8222-222222222222"
const USER = "00000000-0000-4000-8000-000000000001"
const ENTITY = "33333333-3333-4333-8333-333333333333"
const CANDIDATE = "44444444-4444-4444-8444-444444444444"

const h = vi.hoisted(() => {
  const tableResponses = new Map<string, { data: unknown; error: unknown }>()
  const order: string[] = []
  const ops: Array<{ table: string; op: "update" | "delete" | "insert"; values?: unknown; filters: Array<[string, unknown]> }> = []
  function createChain(table: string) {
    const response = tableResponses.get(table) ?? { data: null, error: null }
    let current: (typeof ops)[number] | null = null
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "neq", "order", "limit", "gte", "range", "is"]) chain[m] = vi.fn(() => chain)
    chain.in = vi.fn((col: string, val: unknown) => {
      current?.filters.push([`in:${col}`, val])
      return chain
    })
    chain.eq = vi.fn((col: string, val: unknown) => {
      current?.filters.push([col, val])
      return chain
    })
    chain.single = vi.fn(async () => response)
    chain.maybeSingle = vi.fn(async () => response)
    for (const op of ["update", "delete", "insert"] as const) {
      chain[op] = vi.fn((values?: unknown) => {
        current = { table, op, values, filters: [] }
        ops.push(current)
        const v = values as { status?: unknown; output_data?: unknown } | undefined
        if (table === "jobs" && op === "update") {
          if (typeof v?.status === "string") order.push(`job:${v.status}`)
          // The settle's own charge write (`provider_cost`, `credits_actual`); its ledger
          // (`llm_billing`, server-only) is a separate write.
          else if (v && typeof v === "object" && "llm_billing" in v) order.push("job:ledger")
          else if (v && typeof v === "object" && ("credits_actual" in v || "provider_cost" in v)) order.push("job:billing")
          else if (v?.output_data !== undefined) order.push("job:output")
        }
        return chain
      })
    }
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
      // The scrapes' call-start marker: a ledger write CAS'd on a live row
      // answers the row while the job is live (`jobLive`), none once cancelled.
      const cas = current?.table === "jobs" && current.op === "update" && current.filters.some(([c]) => c === "in:status")
      return Promise.resolve(cas ? { data: jobLive.value ? [{ id: "job" }] : [], error: null } : { data: null, error: null }).then(resolve, reject)
    }
    return chain
  }
  const jobLive = { value: true }
  return {
    jobLive,
    /** The cancel's after-flip rule the scrape runs once its calls end (lib/cancel-job.ts). */
    afterFlip: vi.fn(async (_jobId: string) => "settled" as "kept" | "settled" | "refund"),
    tableResponses,
    order,
    ops,
    rollback: { value: false },
    settings: { ai_provider: "kie", cost_markup_percent: 10 } as Record<string, unknown>,
    guardChecks: [] as Array<number | undefined>,
    /** What the (mocked) guard does besides its pre-check: stamp the spend surface, refuse. */
    guardStamp: false,
    guardRefusal: undefined as { status: number; body: unknown } | undefined,
    /** `req.webFreeMode` as each reservation saw it. */
    reserveSurface: [] as Array<boolean | undefined>,
    from: vi.fn((table: string) => createChain(table)),
    llmComplete: vi.fn(),
    llmCompleteStructured: vi.fn(),
    reserveCreditsForJob: vi.fn(),
    commitCredits: vi.fn(),
    refundCredits: vi.fn(),
    markJobFailed: vi.fn(),
    markJobCompleted: vi.fn(),
    commitReserved: vi.fn(),
    refundReserved: vi.fn(),
  }
})

vi.mock("../../lib/supabase.js", () => ({ supabase: { from: h.from, rpc: vi.fn(), auth: { getUser: vi.fn() } } }))
vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/config.js")>()
  return {
    ...actual,
    config: { ...actual.config, EDITION: "cloud", KIE_API_KEY: "kie", ANTHROPIC_API_KEY: "anthropic" },
    hasCredits: () => true,
    isCloud: () => true,
    isCommunity: () => false,
    isBusiness: () => false,
    hasAdmin: () => true,
    llmMeteredPricing: () => !h.rollback.value,
  }
})
vi.mock("../../lib/llm/anthropic-availability.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/llm/anthropic-availability.js")>()),
  claudeLaneConfigured: () => true,
}))
vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: (_resolver: unknown, opts?: { computeCredits?: (body: unknown, req: unknown) => unknown }) =>
    async (req: { body: unknown; webFreeMode?: boolean }, reply: { status(c: number): { send(b: unknown): unknown } }) => {
      h.guardChecks.push(opts?.computeCredits ? ((await opts.computeCredits(req.body, req)) as number | undefined) : undefined)
      // The real guard stamps the spend surface (credit-guard-impl Step 0) and
      // may refuse (Step 0b instance cap, balance) — both, on demand.
      if (h.guardStamp) req.webFreeMode = true
      if (h.guardRefusal) reply.status(h.guardRefusal.status).send(h.guardRefusal.body)
    },
  reserveCreditsForJob: h.reserveCreditsForJob,
}))
vi.mock("../../middleware/rate-limit.js", () => ({ rateLimiter: () => async () => {} }))
vi.mock("../../lib/scope-prehandler.js", () => ({ requireAppScope: () => async () => {} }))
vi.mock("../../lib/cloud-llm-proxy.js", () => ({ maybeProxyLlmRouteToCloud: vi.fn(async () => false) }))
vi.mock("../../lib/app-settings.js", () => ({
  getAppSettings: vi.fn(async () => h.settings),
}))
vi.mock("../../lib/insert-job.js", () => ({ insertSyncJob: vi.fn(async () => ({ data: { id: JOB }, error: null })) }))
vi.mock("../../lib/reconcile/persistence.js", () => ({
  markProviderCallStart: vi.fn(async () => {}),
  // R38: the metered sync stamp is a CAS — a live row here.
  markProviderCallStartIfLive: vi.fn(async () => "started"),
}))
vi.mock("../../lib/job-failure.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/job-failure.js")>()),
  markJobFailed: h.markJobFailed,
}))
vi.mock("../../workers/shared.js", () => ({ markJobCompleted: h.markJobCompleted, commitJobCredits: vi.fn() }))
vi.mock("../../lib/cancel-job.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/cancel-job.js")>()),
  settleMeteredHoldAfterFlip: h.afterFlip,
}))
vi.mock("../../lib/credits-job-lifecycle.js", () => ({
  commitReservedCreditsForJob: h.commitReserved,
  refundReservedCreditsForJob: h.refundReserved,
}))
vi.mock("../../ee/billing/credits.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ee/billing/credits.js")>()),
  CreditsService: { commitCredits: h.commitCredits, refundCredits: h.refundCredits },
}))
vi.mock("../../ee/services/credits.js", () => ({
  CreditsService: { commitCredits: h.commitCredits, refundCredits: h.refundCredits },
}))
vi.mock("../../lib/llm-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/llm-client.js")>()),
  llmComplete: h.llmComplete,
  llmCompleteStructured: h.llmCompleteStructured,
}))
vi.mock("../../lib/safe-fetch.js", () => ({ safeFetch: vi.fn(async () => { throw new Error("offline") }) }))
vi.mock("../../lib/anthropic-image.js", () => ({
  prefetchAsBase64: vi.fn(async (url: string) => ({ type: "image", url })),
}))
vi.mock("../../providers/nodaro/run-on-cloud.js", () => ({ shouldRunOnCloud: vi.fn(async () => false) }))
vi.mock("../../providers/apify/meta-ads.js", () => ({ runMetaAdsScrape: vi.fn() }))
vi.mock("../../lib/meta-ads-media.js", () => ({
  classifyAndStoreMetaAdsMedia: vi.fn(async (ads: Array<Record<string, unknown>>) => ({
    ads: ads.map((ad) => ({ ...ad, format: "unknown", creatives: [] })),
    stats: { classified: 0, stored: 0, videosStored: 0, kept: ads.length, filteredOut: 0 },
  })),
  metaAdsWithoutMedia: (ads: Array<Record<string, unknown>>) => ads.map((ad) => ({ ...ad, format: "unknown", creatives: [] })),
}))
vi.mock("../../providers/apify/instagram.js", () => ({ runInstagramScrape: vi.fn() }))
vi.mock("../../lib/instagram-media.js", () => ({
  classifyAndStoreInstagramMedia: vi.fn(async (posts: Array<Record<string, unknown>>) => ({
    posts: posts.map((p) => ({ ...p, format: "unknown", creatives: [] })),
    stats: { classified: 0, stored: 0, videosStored: 0, kept: posts.length, filteredOut: 0 },
  })),
  instagramWithoutMedia: (posts: Array<Record<string, unknown>>) => posts.map((p) => ({ ...p, format: "unknown", creatives: [] })),
}))
vi.mock("../../lib/scene-graph-validator.js", () => ({
  validateSceneGraph: () => ({ valid: true, sceneGraph: { tracks: [] }, errors: [], autoFixed: [] }),
}))
vi.mock("../../lib/after-effects-validator.js", () => ({
  validateAfterEffectsPlan: () => ({ valid: true, plan: { effects: [] }, errors: [], autoFixed: [] }),
}))
vi.mock("../../lib/lottie-overlay-validator.js", () => ({
  validateLottieOverlayPlan: () => ({ valid: true, plan: { overlays: [] }, errors: [], autoFixed: [] }),
}))
vi.mock("../../lib/three-d-title-validator.js", () => ({
  validateThreeDTitlePlan: () => ({ valid: true, plan: { title: "t" }, errors: [], autoFixed: [] }),
}))

const { llmHoldBaseCredits, llmEstimateBaseCredits } = await import("../../ee/billing/llm-metered.js")
const { applyMarkupPercent } = await import("../../ee/billing/service-margin.js")
const { LlmContentRefusalError } = await import("../../lib/llm-errors.js")
type LlmRequest = import("../../lib/llm/types.js").LlmRequest

/** The charged hold of one call as the contract sizes it: max(1, base) at a 10% markup. */
function heldFor(modelId: string, request: LlmRequest): number {
  return applyMarkupPercent(Math.max(1, llmHoldBaseCredits(modelId, { request })), 10)
}

function answer(text: string, creditsUsd = 0.048) {
  return { text, usage: { inputTokens: 1000, outputTokens: 500 }, lane: "kie", creditsUsd, providerCost: creditsUsd }
}

const BILLED_REFUSAL = () => new LlmContentRefusalError("The model declined.", { inputTokens: 10, outputTokens: 5, creditsUsd: 0.01, providerCost: 0.01, complete: true }, "kie")

interface RouteSpec {
  name: string
  feature: string
  url: string
  payload: Record<string, unknown>
  structured?: boolean
  okText: string
  register: (app: FastifyInstance) => Promise<void>
  /** The tier id the route reserved before metering (the rollback's). */
  tierId: string
}

const CREATIVE: RouteSpec[] = [
  {
    name: "scene-graph-ai", feature: "scene-graph-ai", url: "/v1/scene-graph/generate", okText: "{}",
    payload: { prompt: "a montage", assets: [{ id: "a", type: "image", url: "https://e.com/i.jpg" }], durationSeconds: 10, userId: USER },
    register: async (app) => (await import("../scene-graph-ai.js")).sceneGraphAIRoutes(app),
    tierId: buildLlmCreditIdentifier("scene-graph-ai", LLM_FEATURE_DEFAULTS["scene-graph-ai"]),
  },
  {
    name: "after-effects-ai", feature: "after-effects", url: "/v1/after-effects/generate", okText: "{}",
    payload: { prompt: "warm grade", inputVideoUrl: "https://e.com/v.mp4", durationSeconds: 10, userId: USER },
    register: async (app) => (await import("../after-effects-ai.js")).afterEffectsAIRoutes(app),
    tierId: buildLlmCreditIdentifier("after-effects", LLM_FEATURE_DEFAULTS["after-effects"]),
  },
  {
    name: "lottie-overlay-ai", feature: "lottie-overlay", url: "/v1/lottie-overlay/generate", okText: "{}",
    payload: { prompt: "confetti", inputVideoUrl: "https://e.com/v.mp4", durationSeconds: 10, userId: USER },
    register: async (app) => (await import("../lottie-overlay-ai.js")).lottieOverlayAIRoutes(app),
    tierId: buildLlmCreditIdentifier("lottie-overlay", LLM_FEATURE_DEFAULTS["lottie-overlay"]),
  },
  {
    name: "three-d-title-ai", feature: "3d-title", url: "/v1/3d-title/generate", okText: "{}",
    payload: { prompt: "NODARO", durationSeconds: 5, userId: USER },
    register: async (app) => (await import("../three-d-title-ai.js")).threeDTitleAIRoutes(app),
    tierId: buildLlmCreditIdentifier("3d-title", LLM_FEATURE_DEFAULTS["3d-title"]),
  },
  {
    name: "qa-check", feature: "qa-check", url: "/v1/qa-check", okText: '{"score":0.9,"approved":true,"reason":"ok"}',
    payload: { content: "a paragraph to check", userId: USER },
    register: async (app) => (await import("../qa-check.js")).qaCheckRoutes(app),
    tierId: buildLlmCreditIdentifier("qa-check", LLM_FEATURE_DEFAULTS["qa-check"]),
  },
  {
    name: "image-critic", feature: "image-critic", url: "/v1/image-critic", okText: '{"score":0.9,"feedback":"Sharpen the eyes."}',
    payload: { imageUrl: "https://e.com/i.jpg", mode: "realism", userId: USER },
    register: async (app) => (await import("../image-critic.js")).imageCriticRoutes(app),
    tierId: buildLlmCreditIdentifier("image-critic", LLM_FEATURE_DEFAULTS["image-critic"]),
  },
  {
    name: "image-to-text", feature: "image-to-text", url: "/v1/image-to-text/describe", okText: "A cat on a mat.",
    payload: { imageUrl: "https://e.com/i.jpg", userId: USER },
    register: async (app) => (await import("../image-to-text.js")).imageToTextRoutes(app),
    tierId: buildLlmCreditIdentifier("image-to-text", LLM_FEATURE_DEFAULTS["image-to-text"]),
  },
  {
    name: "image-overlay-placement", feature: "image-to-text", url: "/v1/image-overlay/suggest-placement", okText: "", structured: true,
    payload: { imageUrl: "https://e.com/i.jpg", userId: USER },
    register: async (app) => (await import("../image-overlay-placement.js")).imageOverlayPlacementRoutes(app),
    tierId: buildLlmCreditIdentifier("image-to-text", LLM_FEATURE_DEFAULTS["image-to-text"]),
  },
]

let app: FastifyInstance

async function build(register: (app: FastifyInstance) => Promise<void>): Promise<FastifyInstance> {
  const a = Fastify({ logger: false })
  a.addHook("preHandler", async (req, reply) => {
    req.raw.setTimeout = (() => {}) as never
    reply.raw.setTimeout = (() => {}) as never
    req.userId = USER
  })
  await a.register(async (instance) => { await register(instance) })
  await a.ready()
  return a
}

const PLACEMENT = { anchor: "top-left", x: 4, y: 4, width: 12, reason: "Calm corner." }

function structuredAnswer(modelId: string, creditsUsd = 0.048) {
  return {
    output: PLACEMENT, inputTokens: 1000, outputTokens: 500, providerCost: creditsUsd, lane: "kie",
    attempts: [{ lane: "kie", modelId, requestChars: 400, inputTokens: 1000, outputTokens: 500, providerCost: creditsUsd, creditsUsd }],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.rollback.value = false
  h.settings = { ai_provider: "kie", cost_markup_percent: 10 }
  h.order.length = 0
  h.ops.length = 0
  h.jobLive.value = true
  h.guardChecks.length = 0
  h.tableResponses.clear()
  h.guardStamp = false
  h.guardRefusal = undefined
  h.reserveSurface.length = 0
  h.reserveCreditsForJob.mockImplementation(async (req: { webFreeMode?: boolean }) => {
    h.reserveSurface.push(req.webFreeMode)
    return { usageLogId: LOG }
  })
  h.commitCredits.mockImplementation(async (_log: string, credits?: number) => {
    h.order.push("commit")
    return credits === undefined ? undefined : { charged: credits, shortfall: 0 }
  })
  h.refundCredits.mockImplementation(async () => { h.order.push("refund") })
  h.markJobFailed.mockImplementation(async () => { h.order.push("job:failed"); return true })
  h.markJobCompleted.mockImplementation(async () => { h.order.push("job:completed"); return true })
  h.commitReserved.mockImplementation(async () => { h.order.push("commit") })
  h.refundReserved.mockImplementation(async () => { h.order.push("refund") })
})
afterEach(async () => { await app?.close() })

function sentRequest(spec: RouteSpec): LlmRequest {
  const mock = spec.structured ? h.llmCompleteStructured : h.llmComplete
  return mock.mock.calls[0]![0] as LlmRequest
}

describe.each(CREATIVE)("$name bills metered", (spec) => {
  const model = spec.feature === "image-to-text" ? LLM_FEATURE_DEFAULTS["image-to-text"] : LLM_FEATURE_DEFAULTS[spec.feature as keyof typeof LLM_FEATURE_DEFAULTS]

  function succeed(creditsUsd = 0.048) {
    if (spec.structured) h.llmCompleteStructured.mockResolvedValue(structuredAnswer(model, creditsUsd))
    else h.llmComplete.mockResolvedValue(answer(spec.okText, creditsUsd))
  }
  function fail(err: unknown) {
    if (spec.structured) h.llmCompleteStructured.mockRejectedValue(err)
    else h.llmComplete.mockRejectedValue(err)
  }

  it("the guard pre-checks from the metered hold (text only), and the reserve holds the call as sent", async () => {
    succeed()
    app = await build(spec.register)
    const res = await app.inject({ method: "POST", url: spec.url, payload: spec.payload })
    expect(res.statusCode, res.body).toBe(200)
    expect(h.guardChecks[0]).toBeGreaterThan(0)
    expect(h.reserveCreditsForJob).toHaveBeenCalledTimes(1)
    expect(h.reserveCreditsForJob.mock.calls[0]!.slice(2)).toEqual([
      JOB,
      `${spec.feature}:${model}`,
      { holdCredits: heldFor(model, sentRequest(spec)) },
    ])
  })

  it("a completed call commits what it cost (27 for a stated 0.048) through the metered commit, before the terminal write", async () => {
    succeed()
    app = await build(spec.register)
    const res = await app.inject({ method: "POST", url: spec.url, payload: spec.payload })
    expect(res.statusCode, res.body).toBe(200)
    expect(h.commitCredits).toHaveBeenCalledWith(LOG, 27, { collectOverHold: true })
    expect(h.refundCredits).not.toHaveBeenCalled()
    expect(h.order).toEqual(["job:output", "commit", "job:billing", "job:ledger", "job:completed"])
    // The settle's ledger goes in the server-only column — never in output_data, which the job's owner reads.
    const ledgerWrite = h.ops.find((o) => o.table === "jobs" && o.op === "update" && "llm_billing" in (o.values as object))
    expect((ledgerWrite?.values as { llm_billing: { costUsd: number } }).llm_billing.costUsd).toBeCloseTo(0.048)
    expect(h.ops.some((o) => o.table === "jobs" && "billing" in (((o.values as { output_data?: object } | undefined)?.output_data) ?? {}))).toBe(false)
  })

  it("a billed failure is CHARGED its usage (6 for 0.01) and the failure says so", async () => {
    fail(BILLED_REFUSAL())
    app = await build(spec.register)
    const res = await app.inject({ method: "POST", url: spec.url, payload: spec.payload })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(h.commitCredits).toHaveBeenCalledWith(LOG, 6, { collectOverHold: true })
    expect(h.refundCredits).not.toHaveBeenCalled()
    expect(h.order).toEqual(["job:output", "commit", "job:billing", "job:ledger", "job:failed"])
    expect(h.markJobFailed.mock.calls[0]![1].error_message).toMatch(/6 credits were charged/)
  })

  it("a failure the provider never billed is REFUNDED", async () => {
    fail(new Error("socket hang up"))
    app = await build(spec.register)
    const res = await app.inject({ method: "POST", url: spec.url, payload: spec.payload })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    expect(h.refundCredits).toHaveBeenCalledWith(LOG)
    expect(h.commitCredits).not.toHaveBeenCalled()
    expect(h.markJobFailed.mock.calls[0]![1].error_message).not.toMatch(/charged/)
  })

  it("rollback: reserves the tier id exactly as before and commits it whole", async () => {
    h.rollback.value = true
    succeed()
    app = await build(spec.register)
    const res = await app.inject({ method: "POST", url: spec.url, payload: spec.payload })
    expect(res.statusCode, res.body).toBe(200)
    expect(h.guardChecks[0]).toBeUndefined()
    expect(h.reserveCreditsForJob).toHaveBeenCalledTimes(1)
    expect(h.reserveCreditsForJob.mock.calls[0]!.slice(2)).toEqual([JOB, spec.tierId])
    expect(h.commitCredits.mock.calls.every((c) => c.length === 1)).toBe(true)
    expect(h.order).toContain("commit")
    expect(h.order).not.toContain("job:output")
  })
})

it("an answer that fails AFTER it was billed (invalid JSON) is charged, not refunded", async () => {
  h.llmComplete.mockResolvedValue(answer("not json at all", 0.01))
  app = await build(CREATIVE[5]!.register) // image-critic
  const res = await app.inject({ method: "POST", url: CREATIVE[5]!.url, payload: CREATIVE[5]!.payload })
  expect(res.statusCode).toBe(502)
  expect(h.commitCredits).toHaveBeenCalledWith(LOG, 6, { collectOverHold: true })
  expect(h.refundCredits).not.toHaveBeenCalled()
})

// ── D3 helpers: metered under prompt-helper:<model> ──

const SONNET = "claude-sonnet-4.6"

describe("llm-suggest-description", () => {
  const register = async (a: FastifyInstance) => (await import("../llm-suggest-description.js")).llmSuggestDescriptionRoutes(a)
  const payload = { kind: "seed-prompt", context: { dimensions: { age: "30s" } } }

  it("reserves prompt-helper:claude-sonnet-4.6 at the call's hold and settles its cost", async () => {
    h.llmComplete.mockResolvedValue(answer("A tall woman."))
    app = await build(register)
    const res = await app.inject({ method: "POST", url: "/v1/llm-suggest-description", payload })
    expect(res.statusCode, res.body).toBe(200)
    expect(h.guardChecks[0]).toBeGreaterThan(0)
    const sent = h.llmComplete.mock.calls[0]![0] as LlmRequest
    expect(h.reserveCreditsForJob.mock.calls[0]!.slice(2)).toEqual([JOB, `prompt-helper:${SONNET}`, { holdCredits: heldFor(SONNET, sent) }])
    expect(h.commitCredits).toHaveBeenCalledWith(LOG, 27, { collectOverHold: true })
    expect(h.order).toEqual(["job:output", "commit", "job:billing", "job:ledger", "job:completed"])
  })

  it("an empty answer the provider billed is charged, not refunded", async () => {
    h.llmComplete.mockResolvedValue(answer("   ", 0.01))
    app = await build(register)
    const res = await app.inject({ method: "POST", url: "/v1/llm-suggest-description", payload })
    expect(res.statusCode).toBe(502)
    expect(h.commitCredits).toHaveBeenCalledWith(LOG, 6, { collectOverHold: true })
  })

  it("rollback: helpers bill prompt-helper flat as before", async () => {
    h.rollback.value = true
    h.llmComplete.mockResolvedValue(answer("A tall woman."))
    app = await build(register)
    const res = await app.inject({ method: "POST", url: "/v1/llm-suggest-description", payload })
    expect(res.statusCode).toBe(200)
    expect(h.reserveCreditsForJob.mock.calls[0]!.slice(2)).toEqual([JOB, "prompt-helper"])
    expect(h.commitCredits).toHaveBeenCalledWith(LOG)
  })
})

interface EntitySpec {
  kind: "creature" | "location" | "object"
  table: string
  register: (a: FastifyInstance) => Promise<void>
  approve: (a: FastifyInstance) => Promise<void>
}
const ENTITIES: EntitySpec[] = [
  {
    kind: "creature", table: "creatures",
    register: async (a) => (await import("../creature-llm-caption.js")).creatureLlmCaptionRoutes(a),
    approve: async (a) => (await import("../creature-main-image-approval.js")).creatureMainImageApprovalRoutes(a),
  },
  {
    kind: "location", table: "locations",
    register: async (a) => (await import("../location-llm-caption.js")).locationLlmCaptionRoutes(a),
    approve: async (a) => (await import("../location-main-image-approval.js")).locationMainImageApprovalRoutes(a),
  },
  {
    kind: "object", table: "objects",
    register: async (a) => (await import("../object-llm-caption.js")).objectLlmCaptionRoutes(a),
    approve: async (a) => (await import("../object-main-image-approval.js")).objectMainImageApprovalRoutes(a),
  },
]

/** The next reservation is refused the way the guard refuses a short balance: a 402 sent on the reply. */
function refuseNextHold() {
  h.reserveCreditsForJob.mockImplementationOnce(async (_req: unknown, reply: { status(c: number): { send(b: unknown): unknown } }) => {
    reply.status(402).send({ error: { code: "insufficient_credits", message: "Needs up to 9 credits" } })
    return undefined
  })
}

function seedEntity(table: string) {
  h.tableResponses.set(table, {
    data: { id: ENTITY, source_image_url: "https://e.com/main.jpg", canonical_description: "desc", updated_at: "t" },
    error: null,
  })
  h.tableResponses.set("jobs", {
    data: { id: CANDIDATE, status: "completed", output_data: { imageUrl: "https://e.com/cand.jpg" }, input_data: {} },
    error: null,
  })
}

describe.each(ENTITIES)("$kind caption + main-image approval", (spec) => {
  it(`${spec.kind} llm-caption reserves prompt-helper:<model> and settles the caption's cost`, async () => {
    seedEntity(spec.table)
    h.llmComplete.mockResolvedValue(answer("A grey stone hall."))
    app = await build(spec.register)
    const res = await app.inject({ method: "POST", url: `/v1/${spec.table}/${ENTITY}/llm-caption` })
    expect(res.statusCode, res.body).toBe(200)
    expect(h.guardChecks[0]).toBeGreaterThan(0)
    const sent = h.llmComplete.mock.calls[0]![0] as LlmRequest
    expect(h.reserveCreditsForJob.mock.calls[0]!.slice(2)).toEqual([JOB, `prompt-helper:${SONNET}`, { holdCredits: heldFor(SONNET, sent) }])
    expect(h.commitCredits).toHaveBeenCalledWith(LOG, 27, { collectOverHold: true })
  })

  it("caption helper swallow-to-null still settles a billed call", async () => {
    seedEntity(spec.table)
    h.llmComplete.mockRejectedValue(BILLED_REFUSAL())
    app = await build(spec.register)
    const res = await app.inject({ method: "POST", url: `/v1/${spec.table}/${ENTITY}/llm-caption` })
    expect(res.statusCode).toBe(502)
    expect(h.commitCredits).toHaveBeenCalledWith(LOG, 6, { collectOverHold: true })
    expect(h.refundCredits).not.toHaveBeenCalled()
  })

  it(`${spec.kind} main-image approval now reserves under prompt-helper:<model> and settles the caption's cost`, async () => {
    seedEntity(spec.table)
    h.llmComplete.mockResolvedValue(answer("A grey stone hall."))
    app = await build(spec.approve)
    const res = await app.inject({ method: "POST", url: `/v1/${spec.table}/${ENTITY}/approve-main-image`, payload: { candidateJobId: CANDIDATE } })
    expect(res.statusCode, res.body).toBe(200)
    const sent = h.llmComplete.mock.calls[0]![0] as LlmRequest
    expect(h.reserveCreditsForJob.mock.calls[0]!.slice(2)).toEqual([JOB, `prompt-helper:${SONNET}`, { holdCredits: heldFor(SONNET, sent) }])
    expect(h.commitCredits).toHaveBeenCalledWith(LOG, 27, { collectOverHold: true })
  })

  it(`${spec.kind} main-image approval with an unbilled caption failure still approves and refunds`, async () => {
    seedEntity(spec.table)
    h.llmComplete.mockRejectedValue(new Error("socket hang up"))
    app = await build(spec.approve)
    const res = await app.inject({ method: "POST", url: `/v1/${spec.table}/${ENTITY}/approve-main-image`, payload: { candidateJobId: CANDIDATE } })
    expect(res.statusCode, res.body).toBe(200)
    expect(h.refundCredits).toHaveBeenCalledWith(LOG)
    expect(h.commitCredits).not.toHaveBeenCalled()
  })

  it(`${spec.kind} main-image approval is never blocked by credits: a refused caption hold approves and skips the caption`, async () => {
    seedEntity(spec.table)
    refuseNextHold()
    app = await build(spec.approve)
    const res = await app.inject({ method: "POST", url: `/v1/${spec.table}/${ENTITY}/approve-main-image`, payload: { candidateJobId: CANDIDATE } })
    expect(res.statusCode, res.body).toBe(200)
    expect(h.llmComplete).not.toHaveBeenCalled()
    const write = h.ops.find((o) => o.table === spec.table && o.op === "update")
    expect(write?.values).toMatchObject({ source_image_url: "https://e.com/cand.jpg", canonical_description: null })
    expect(h.commitCredits).not.toHaveBeenCalled()
  })

  it(`${spec.kind} main-image approval runs the caption's guard inline: the spend surface is stamped before the reserve`, async () => {
    seedEntity(spec.table)
    h.guardStamp = true
    h.llmComplete.mockResolvedValue(answer("A grey stone hall."))
    app = await build(spec.approve)
    const res = await app.inject({ method: "POST", url: `/v1/${spec.table}/${ENTITY}/approve-main-image`, payload: { candidateJobId: CANDIDATE } })
    expect(res.statusCode, res.body).toBe(200)
    expect(h.guardChecks[0]).toBeGreaterThan(0)
    expect(h.reserveSurface).toEqual([true])
  })

  it(`${spec.kind} main-image approval: a guard refusal (the instance's monthly cap) skips the caption, never the approval`, async () => {
    seedEntity(spec.table)
    h.guardRefusal = { status: 402, body: { error: { code: "instance_cap_reached", message: "cap" } } }
    app = await build(spec.approve)
    const res = await app.inject({ method: "POST", url: `/v1/${spec.table}/${ENTITY}/approve-main-image`, payload: { candidateJobId: CANDIDATE } })
    expect(res.statusCode, res.body).toBe(200)
    expect(h.reserveCreditsForJob).not.toHaveBeenCalled()
    expect(h.llmComplete).not.toHaveBeenCalled()
  })

  it(`${spec.kind} main-image approval: a billing error that throws skips the caption, never the approval`, async () => {
    seedEntity(spec.table)
    h.reserveCreditsForJob.mockRejectedValueOnce(new Error("rpc down"))
    app = await build(spec.approve)
    const res = await app.inject({ method: "POST", url: `/v1/${spec.table}/${ENTITY}/approve-main-image`, payload: { candidateJobId: CANDIDATE } })
    expect(res.statusCode, res.body).toBe(200)
    expect(h.llmComplete).not.toHaveBeenCalled()
  })

  it(`rollback: ${spec.kind} main-image approval stays free (no guard check, no reservation)`, async () => {
    h.rollback.value = true
    seedEntity(spec.table)
    h.llmComplete.mockResolvedValue(answer("A grey stone hall."))
    app = await build(spec.approve)
    const res = await app.inject({ method: "POST", url: `/v1/${spec.table}/${ENTITY}/approve-main-image`, payload: { candidateJobId: CANDIDATE } })
    expect(res.statusCode, res.body).toBe(200)
    expect(h.guardChecks.every((c) => c === undefined)).toBe(true)
    expect(h.reserveCreditsForJob).not.toHaveBeenCalled()
    expect(h.commitCredits).not.toHaveBeenCalled()
  })

  it(`rollback: ${spec.kind} llm-caption bills prompt-helper flat as before`, async () => {
    h.rollback.value = true
    seedEntity(spec.table)
    h.llmComplete.mockResolvedValue(answer("A grey stone hall."))
    app = await build(spec.register)
    const res = await app.inject({ method: "POST", url: `/v1/${spec.table}/${ENTITY}/llm-caption` })
    expect(res.statusCode).toBe(200)
    expect(h.reserveCreditsForJob.mock.calls[0]!.slice(2)).toEqual([JOB, "prompt-helper"])
    expect(h.commitCredits).toHaveBeenCalledWith(LOG)
  })
})

describe("character portrait approval + llm-caption", () => {
  const register = async (a: FastifyInstance) => (await import("../character-portrait-approval.js")).characterPortraitApprovalRoutes(a)

  it("approve-portrait now reserves under prompt-helper:<model> and settles the caption's cost", async () => {
    seedEntity("characters")
    h.llmComplete.mockResolvedValue(answer("A woman in her 30s."))
    app = await build(register)
    const res = await app.inject({ method: "POST", url: `/v1/characters/${ENTITY}/approve-portrait`, payload: { candidateJobId: CANDIDATE } })
    expect(res.statusCode, res.body).toBe(200)
    const sent = h.llmComplete.mock.calls[0]![0] as LlmRequest
    expect(h.reserveCreditsForJob.mock.calls[0]!.slice(2)).toEqual([JOB, `prompt-helper:${SONNET}`, { holdCredits: heldFor(SONNET, sent) }])
    expect(h.commitCredits).toHaveBeenCalledWith(LOG, 27, { collectOverHold: true })
  })

  it("approve-portrait is never blocked by credits: a refused caption hold approves with no caption", async () => {
    seedEntity("characters")
    refuseNextHold()
    app = await build(register)
    const res = await app.inject({ method: "POST", url: `/v1/characters/${ENTITY}/approve-portrait`, payload: { candidateJobId: CANDIDATE } })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toEqual({ portraitUrl: "https://e.com/cand.jpg", canonicalDescription: null })
    expect(h.llmComplete).not.toHaveBeenCalled()
    expect(h.commitCredits).not.toHaveBeenCalled()
  })

  it("approve-portrait stamps the spend surface before the reserve and skips the caption on a guard refusal", async () => {
    seedEntity("characters")
    h.guardStamp = true
    h.llmComplete.mockResolvedValue(answer("A woman in her 30s."))
    app = await build(register)
    const ok = await app.inject({ method: "POST", url: `/v1/characters/${ENTITY}/approve-portrait`, payload: { candidateJobId: CANDIDATE } })
    expect(ok.statusCode, ok.body).toBe(200)
    expect(h.reserveSurface).toEqual([true])

    h.guardRefusal = { status: 402, body: { error: { code: "instance_cap_reached", message: "cap" } } }
    h.llmComplete.mockClear()
    const skipped = await app.inject({ method: "POST", url: `/v1/characters/${ENTITY}/approve-portrait`, payload: { candidateJobId: CANDIDATE } })
    expect(skipped.statusCode, skipped.body).toBe(200)
    expect(skipped.json().canonicalDescription).toBeNull()
    expect(h.llmComplete).not.toHaveBeenCalled()
  })

  it("llm-caption: a billed refusal is charged", async () => {
    seedEntity("characters")
    h.llmComplete.mockRejectedValue(BILLED_REFUSAL())
    app = await build(register)
    const res = await app.inject({ method: "POST", url: `/v1/characters/${ENTITY}/llm-caption` })
    expect(res.statusCode).toBe(502)
    expect(h.commitCredits).toHaveBeenCalledWith(LOG, 6, { collectOverHold: true })
  })

  it("rollback: approve-portrait stays free; llm-caption bills prompt-helper flat", async () => {
    h.rollback.value = true
    seedEntity("characters")
    h.llmComplete.mockResolvedValue(answer("A woman in her 30s."))
    app = await build(register)
    const approve = await app.inject({ method: "POST", url: `/v1/characters/${ENTITY}/approve-portrait`, payload: { candidateJobId: CANDIDATE } })
    expect(approve.statusCode, approve.body).toBe(200)
    expect(h.reserveCreditsForJob).not.toHaveBeenCalled()
    const caption = await app.inject({ method: "POST", url: `/v1/characters/${ENTITY}/llm-caption` })
    expect(caption.statusCode).toBe(200)
    expect(h.reserveCreditsForJob.mock.calls[0]!.slice(2)).toEqual([JOB, "prompt-helper"])
  })
})

// ── Reduce: the AI judge (pick-best-llm) bills metered under reduce:pick-best-llm ──

describe("reduce pick-best-llm", () => {
  const register = async (a: FastifyInstance) => (await import("../reduce.js")).reduceRoutes(a)
  const JUDGE = LLM_FEATURE_DEFAULTS["pick-best-llm"]
  const payload = { strategyId: "pick-best-llm", strategyConfig: { criteria: "sharpest", inputKind: "text" }, inputs: ["alpha", "", "gamma"] }

  it("reduce pick-best-llm holds ONE judge call carrying every candidate, and settles what it cost", async () => {
    h.llmComplete.mockResolvedValue(answer(`{"chosen_index": 2, "reasoning": "sharper"}`))
    app = await build(register)
    const res = await app.inject({ method: "POST", url: "/v1/reduce", payload })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json().output).toBe("gamma")
    expect(h.guardChecks[0]).toBeGreaterThan(0)
    // The judge makes one call over all survivors — that one call is the hold.
    expect(h.llmComplete).toHaveBeenCalledTimes(1)
    const sent = h.llmComplete.mock.calls[0]![0] as LlmRequest
    expect(JSON.stringify(sent.messages)).toContain("alpha")
    expect(JSON.stringify(sent.messages)).toContain("gamma")
    expect(h.reserveCreditsForJob.mock.calls[0]!.slice(2)).toEqual([JOB, `reduce:pick-best-llm:${JUDGE}`, { holdCredits: heldFor(JUDGE, sent) }])
    expect(h.commitCredits).toHaveBeenCalledWith(LOG, 27, { collectOverHold: true })
    expect(h.order).toEqual(["job:output", "commit", "job:billing", "job:ledger", "job:completed"])
  })

  it("a verdict cut off at its cap keeps the fallback pick AND is charged its billed usage", async () => {
    const { LlmOutputTruncatedError } = await import("../../lib/llm-errors.js")
    h.llmComplete.mockRejectedValue(new LlmOutputTruncatedError("cut off", { inputTokens: 10, outputTokens: 400, creditsUsd: 0.01, complete: false }, "kie"))
    app = await build(register)
    const res = await app.inject({ method: "POST", url: "/v1/reduce", payload })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json().output).toBe("alpha")
    expect(h.commitCredits).toHaveBeenCalledWith(LOG, 6, { collectOverHold: true })
    expect(h.refundCredits).not.toHaveBeenCalled()
  })

  it("a judge failure the provider never billed is refunded", async () => {
    h.llmComplete.mockRejectedValue(new Error("socket hang up"))
    app = await build(register)
    const res = await app.inject({ method: "POST", url: "/v1/reduce", payload })
    expect(res.statusCode).toBe(500)
    expect(h.refundCredits).toHaveBeenCalledWith(LOG)
    expect(h.commitCredits).not.toHaveBeenCalled()
  })

  it("a strategy that makes no LLM call reserves its row as before (metered or not)", async () => {
    app = await build(register)
    const res = await app.inject({ method: "POST", url: "/v1/reduce", payload: { strategyId: "concat", inputs: ["a", "b"] } })
    expect(res.statusCode, res.body).toBe(200)
    expect(h.guardChecks[0]).toBeUndefined()
    expect(h.reserveCreditsForJob.mock.calls[0]!.slice(2)).toEqual([JOB, "reduce:concat"])
  })

  it("rollback: the judge reserves its tier id exactly as before", async () => {
    h.rollback.value = true
    h.llmComplete.mockResolvedValue(answer(`{"chosen_index": 1, "reasoning": "ok"}`))
    app = await build(register)
    const res = await app.inject({ method: "POST", url: "/v1/reduce", payload })
    expect(res.statusCode, res.body).toBe(200)
    expect(h.reserveCreditsForJob.mock.calls[0]!.slice(2)).toEqual([JOB, buildLlmCreditIdentifier("reduce:pick-best-llm", undefined)])
    expect(h.commitReserved).toHaveBeenCalledWith(JOB)
  })
})

// ── Scrapes (B5): a fixed scrape price + metered per-item analysis in ONE reservation ──

describe("scrape analysis bills metered", () => {
  const ANALYST = LLM_FEATURE_DEFAULTS["meta-ads-analysis"]
  const AD = (id: string) => ({ adArchiveId: id, pageName: "Nike", title: "Air Max", text: "Just do it.", images: ["https://img/1.jpg"], videos: [], videoPreviews: [] })
  const ANALYSIS = { assetType: "static", format: "square", visualHooks: [], audiences: [], graphicIdentity: "", copywritingHooks: [], usps: [], cta: "Shop", summary: "ok" }
  function analysisAnswer(creditsUsd: number) {
    return {
      output: ANALYSIS, inputTokens: 1000, outputTokens: 300, providerCost: creditsUsd, lane: "kie",
      attempts: [{ lane: "kie", modelId: ANALYST, requestChars: 900, inputTokens: 1000, outputTokens: 300, providerCost: creditsUsd, creditsUsd }],
    }
  }

  async function chargedOf(id: string): Promise<number> {
    const { getModelCreditCostFromDB } = await import("../../ee/billing/credits.js")
    return (await getModelCreditCostFromDB(id)).creditCost
  }

  it("meta-ads scrape: fixed scrape price + metered analyses, each at its own markup", async () => {
    // The analysis carries its own 50% margin; the scrape the global 10%.
    h.settings = { ai_provider: "kie", cost_markup_percent: 10, service_margin_percent: { "meta-ads-analysis": 50 } }
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [AD("1"), AD("2")] } as never)
    h.llmCompleteStructured.mockResolvedValue(analysisAnswer(0.048))
    app = await build(async (a) => (await import("../meta-ads-scrape.js")).metaAdsScrapeRoutes(a))
    const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: { mode: "search", query: "running shoes", count: 2, analyze: true } })
    expect(res.statusCode, res.body).toBe(200)

    const scrapeId = "meta-ads-scrape:10"
    const scrapeCharged = await chargedOf(scrapeId)
    expect(scrapeCharged).toBeGreaterThan(0)
    // D12 hold: the scrape's charged price + the TYPICAL per-ad cost × the ads
    // requested, at the analysis markup — not the reasoning-floor cap per ad.
    const perAdTypical = llmEstimateBaseCredits("meta-ads-analysis", ANALYST)
    expect(perAdTypical).toBeLessThan(llmHoldBaseCredits(ANALYST, { request: h.llmCompleteStructured.mock.calls[0]![0] as LlmRequest }))
    expect(h.reserveCreditsForJob.mock.calls[0]!.slice(2)).toEqual([JOB, scrapeId, { holdCredits: scrapeCharged + applyMarkupPercent(2 * perAdTypical, 50) }])
    // Settle: the scrape + Σ analysis cost (2 × 0.048 = 0.096 → 48 base → ×1.5 = 72), one metered commit.
    expect(h.llmCompleteStructured).toHaveBeenCalledTimes(2)
    expect(h.commitCredits).toHaveBeenCalledWith(LOG, scrapeCharged + 72, { collectOverHold: true })
    expect(h.commitCredits).toHaveBeenCalledTimes(1)
    // The receipt is recorded on the job AFTER its completion (a cancel that
    // lands first is never charged): credits_actual and provider_cost, then the
    // ledger (with its chargeId) in the server-only column.
    // (Before it: one running-ledger write per analysed ad, flushed before the completion.)
    // (Before it: per analysed ad, the call-start marker (CAS on the live row) and the record — flushed before the completion.)
    expect(h.order).toEqual(["job:ledger", "job:ledger", "job:ledger", "job:ledger", "job:completed", "commit", "job:billing", "job:ledger"])
    const jobOps = h.ops.filter((o) => o.table === "jobs" && o.op === "update")
    const settle = jobOps.find((o) => (o.values as { credits_actual?: unknown }).credits_actual !== undefined)
    expect(settle!.values).toEqual({ credits_actual: scrapeCharged + 72, provider_cost: expect.closeTo(0.096) })
    const ledger = (jobOps.filter((o) => "llm_billing" in (o.values as object)).at(-1)!.values as { llm_billing: { calls: number; chargeId: string } }).llm_billing
    expect(ledger.calls).toBe(2)
    expect(ledger.chargeId).toBe(`meta-ads-analysis:${ANALYST}`)
    expect(jobOps.some((o) => "billing" in (((o.values as { output_data?: object }).output_data) ?? {}))).toBe(false)
  })

  it("the running ledger lands in the server-only column after each item: a cancel after 2 of 5 analyses finds those 2 billed", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: ["1", "2", "3", "4", "5"].map(AD) } as never)
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    let n = 0
    h.llmCompleteStructured.mockImplementation(async () => {
      n += 1
      if (n <= 2) return analysisAnswer(0.048)
      await gate
      throw new Error("socket hang up") // never billed
    })
    // The user cancels mid-run: the completion write then misses its CAS.
    h.markJobCompleted.mockResolvedValueOnce(false)
    app = await build(async (a) => (await import("../meta-ads-scrape.js")).metaAdsScrapeRoutes(a))
    const pending = app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: { mode: "search", query: "running shoes", count: 5, analyze: true } })

    const billingWrites = () => h.ops
      .filter((o) => o.table === "jobs" && o.op === "update")
      .map((o) => (o.values as { llm_billing?: { calls: number; costUsd: number; chargeId: string } }).llm_billing)
      .filter((b): b is { calls: number; costUsd: number; chargeId: string } => b !== undefined)
    // While three analyses are still in flight, the job already records the two billed ones.
    await vi.waitFor(() => expect(billingWrites().at(-1)?.calls).toBe(2))
    expect(billingWrites().at(-1)).toMatchObject({ calls: 2, chargeId: `meta-ads-analysis:${ANALYST}` })
    expect(billingWrites().at(-1)!.costUsd).toBeCloseTo(0.096)
    expect(h.commitCredits).not.toHaveBeenCalled()

    // The three still in flight are on the record (the call-start marker): a cancel now keeps the hold.
    expect(billingWrites().at(-1)).toMatchObject({ inFlight: 3 })

    release()
    const res = await pending
    expect(res.statusCode).toBe(409)
    // Once every call has ended (in flight 0, the record still 2 billed), the scrape runs the
    // cancel's own after-flip rule: the billed analyses charged, the fixed part released.
    expect(billingWrites().at(-1)).toMatchObject({ calls: 2, inFlight: 0 })
    expect(h.afterFlip).toHaveBeenCalledWith(JOB)
    const lastLedger = h.ops.map((o, i) => ("llm_billing" in ((o.values as object) ?? {}) ? i : -1)).filter((i) => i >= 0).at(-1)!
    expect(h.afterFlip.mock.invocationCallOrder[0]).toBeGreaterThan(h.from.mock.invocationCallOrder[lastLedger] ?? 0)
    // Never in the user's answer.
    expect(res.body).not.toContain("billing")
  })

  it("N1 for the scrapes: once the row is cancelled no further analysis call is sent (the call-start CAS)", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: ["1", "2", "3", "4", "5", "6", "7", "8"].map(AD) } as never)
    h.llmCompleteStructured.mockImplementation(async () => {
      // The user cancels while the first calls run: every later start finds the row cancelled.
      h.jobLive.value = false
      return analysisAnswer(0.048)
    })
    h.markJobCompleted.mockResolvedValueOnce(false)
    app = await build(async (a) => (await import("../meta-ads-scrape.js")).metaAdsScrapeRoutes(a))
    const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: { mode: "search", query: "running shoes", count: 8, analyze: true } })
    expect(res.statusCode).toBe(409)
    // Only the calls that started before the flip were sent (the pool's first wave), never all 8.
    const sent = h.llmCompleteStructured.mock.calls.length
    expect(sent).toBeGreaterThan(0)
    expect(sent).toBeLessThan(8)
    expect(h.afterFlip).toHaveBeenCalledWith(JOB)
  })

  it("a scrape cancelled before its completion write is never COMMITTED by its own settle — it runs the cancel's after-flip rule instead", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [AD("1")] } as never)
    h.llmCompleteStructured.mockResolvedValue(analysisAnswer(0.048))
    h.markJobCompleted.mockResolvedValueOnce(false)
    app = await build(async (a) => (await import("../meta-ads-scrape.js")).metaAdsScrapeRoutes(a))
    const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: { mode: "search", query: "running shoes", count: 2, analyze: true } })
    expect(res.statusCode).toBe(409)
    expect(h.commitCredits).not.toHaveBeenCalled()
    expect(h.refundCredits).not.toHaveBeenCalled()
    expect(h.afterFlip).toHaveBeenCalledWith(JOB)
  })

  it("an unconfirmed scrape settle alerts and files a credit_anomalies row (nothing sweeps it)", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [AD("1")] } as never)
    h.llmCompleteStructured.mockResolvedValue(analysisAnswer(0.048))
    h.commitCredits.mockResolvedValueOnce(undefined)
    const alert = vi.spyOn(console, "error").mockImplementation(() => {})
    app = await build(async (a) => (await import("../meta-ads-scrape.js")).metaAdsScrapeRoutes(a))
    const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: { mode: "search", query: "running shoes", count: 2, analyze: true } })
    expect(res.statusCode, res.body).toBe(200)
    expect(alert.mock.calls.some((c) => String(c[0]).startsWith("[llm-billing] ALERT"))).toBe(true)
    const anomaly = h.ops.find((o) => o.table === "credit_anomalies" && o.op === "insert")
    expect(anomaly?.values).toMatchObject({ job_id: JOB, usage_log_id: LOG, model_identifier: `meta-ads-analysis:${ANALYST}`, credits_actual: 0, status: "pending", anomaly_type: "metered_settle_unconfirmed" })
    expect(h.ops.some((o) => o.table === "jobs" && (o.values as { credits_actual?: unknown } | undefined)?.credits_actual !== undefined)).toBe(false)
    alert.mockRestore()
  })

  it("an ad whose analysis failed after billing is still charged; one that billed nothing is not", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [AD("1"), AD("2")] } as never)
    h.llmCompleteStructured
      .mockRejectedValueOnce(BILLED_REFUSAL())
      .mockRejectedValueOnce(new Error("socket hang up"))
    app = await build(async (a) => (await import("../meta-ads-scrape.js")).metaAdsScrapeRoutes(a))
    const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: { mode: "search", query: "running shoes", count: 2, analyze: true } })
    expect(res.statusCode, res.body).toBe(200)
    const scrapeCharged = await chargedOf("meta-ads-scrape:10")
    expect(h.commitCredits).toHaveBeenCalledWith(LOG, scrapeCharged + 6, { collectOverHold: true }) // 0.01 → 5 → 6
  })

  it("a scrape that fails refunds its fixed price; nothing billed → the whole hold is refunded", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    vi.mocked(runMetaAdsScrape).mockRejectedValue(new Error("actor failed"))
    app = await build(async (a) => (await import("../meta-ads-scrape.js")).metaAdsScrapeRoutes(a))
    const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: { mode: "search", query: "running shoes", count: 2, analyze: true } })
    expect(res.statusCode).toBe(502)
    expect(h.refundCredits).toHaveBeenCalledWith(LOG)
    expect(h.commitCredits).not.toHaveBeenCalled()
  })

  it("rollback: the scrape reserves its analysis tier id exactly as before", async () => {
    h.rollback.value = true
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [AD("1")] } as never)
    h.llmCompleteStructured.mockResolvedValue(analysisAnswer(0.048))
    app = await build(async (a) => (await import("../meta-ads-scrape.js")).metaAdsScrapeRoutes(a))
    const res = await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: { mode: "search", query: "running shoes", count: 2, analyze: true } })
    expect(res.statusCode, res.body).toBe(200)
    expect(h.reserveCreditsForJob.mock.calls[0]!.slice(2)).toEqual([JOB, "meta-ads-scrape:10:analysis:economy"])
    expect(h.commitCredits).not.toHaveBeenCalled()
  })

  it("instagram scrape: fixed scrape price + metered per-post analyses under meta-ads-analysis:<model>", async () => {
    const { runInstagramScrape } = await import("../../providers/apify/instagram.js")
    vi.mocked(runInstagramScrape).mockResolvedValue({ json: [{ postId: "p1", shortCode: "AbC", caption: "just do it", images: ["https://cdn/i.jpg"], videos: [], videoPreviews: [] }] } as never)
    h.llmCompleteStructured.mockResolvedValue(analysisAnswer(0.048))
    app = await build(async (a) => (await import("../instagram-scrape.js")).instagramScrapeRoutes(a))
    const res = await app.inject({ method: "POST", url: "/v1/instagram-scrape", payload: { mode: "profile", targets: ["nike"], count: 20, analyze: true } })
    expect(res.statusCode, res.body).toBe(200)
    const scrapeCharged = await chargedOf("instagram-scrape:20")
    await vi.waitFor(() => expect(h.commitCredits).toHaveBeenCalledWith(LOG, scrapeCharged + 27, { collectOverHold: true }))
    const reserved = h.reserveCreditsForJob.mock.calls[0]!
    expect(reserved[3]).toBe("instagram-scrape:20")
    expect((reserved[4] as { holdCredits: number }).holdCredits).toBeGreaterThan(scrapeCharged)
    expect(h.markJobCompleted).toHaveBeenCalled()
    await vi.waitFor(() => expect(h.ops.some((o) => o.table === "jobs" && (o.values as { credits_actual?: unknown }).credits_actual === scrapeCharged + 27)).toBe(true))
  })

  it("instagram scrape cancelled mid-run: its billed analyses are settled by the cancel's after-flip rule once its calls end", async () => {
    const { runInstagramScrape } = await import("../../providers/apify/instagram.js")
    vi.mocked(runInstagramScrape).mockResolvedValue({ json: [{ postId: "p1", shortCode: "AbC", caption: "just do it", images: ["https://cdn/i.jpg"], videos: [], videoPreviews: [] }] } as never)
    h.llmCompleteStructured.mockResolvedValue(analysisAnswer(0.048))
    h.markJobCompleted.mockResolvedValueOnce(false)
    app = await build(async (a) => (await import("../instagram-scrape.js")).instagramScrapeRoutes(a))
    await app.inject({ method: "POST", url: "/v1/instagram-scrape", payload: { mode: "profile", targets: ["nike"], count: 20, analyze: true } })
    await vi.waitFor(() => expect(h.afterFlip).toHaveBeenCalledWith(JOB))
    expect(h.commitCredits).not.toHaveBeenCalled()
  })

  it("cancelled with nothing billed: the after-flip rule answers refund and the hold is refunded", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [AD("1")] } as never)
    h.llmCompleteStructured.mockRejectedValue(new Error("socket hang up"))
    h.markJobCompleted.mockResolvedValueOnce(false)
    h.afterFlip.mockResolvedValueOnce("refund")
    app = await build(async (a) => (await import("../meta-ads-scrape.js")).metaAdsScrapeRoutes(a))
    await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: { mode: "search", query: "running shoes", count: 1, analyze: true } })
    expect(h.refundReserved).toHaveBeenCalledWith(JOB)
    // Nothing billed and nothing in flight: no ledger is left on the row.
    expect(h.ops.filter((o) => o.table === "jobs" && "llm_billing" in (o.values as object)).at(-1)?.values).toEqual({ llm_billing: null })
  })

  it("the call-start marker is written BEFORE the first call is sent — in flight 1 with nothing billed yet", async () => {
    const { runMetaAdsScrape } = await import("../../providers/apify/meta-ads.js")
    vi.mocked(runMetaAdsScrape).mockResolvedValue({ json: [AD("1")] } as never)
    let ledgerAtCall: unknown
    h.llmCompleteStructured.mockImplementation(async () => {
      ledgerAtCall = h.ops.filter((o) => o.table === "jobs" && o.op === "update" && "llm_billing" in (o.values as object)).at(-1)?.values
      return analysisAnswer(0.048)
    })
    app = await build(async (a) => (await import("../meta-ads-scrape.js")).metaAdsScrapeRoutes(a))
    await app.inject({ method: "POST", url: "/v1/meta-ads-scrape", payload: { mode: "search", query: "running shoes", count: 1, analyze: true } })
    expect(ledgerAtCall).toEqual({ llm_billing: { costUsd: 0, source: "floor", calls: 0, lanes: [], chargeId: `meta-ads-analysis:${ANALYST}`, inFlight: 1 } })
  })
})

it("finishMeteredSyncLlmJob runs ONCE per job: a second call settles nothing again", async () => {
  const { finishMeteredSyncLlmJob } = await import("../../lib/meter-sync-llm.js")
  const { LlmSpend } = await import("../../lib/llm-billing.js")
  const spend = new LlmSpend()
  spend.add(SONNET, { modelId: SONNET, system: "", messages: [{ role: "user", content: "x" }] }, { response: answer("ok") as never })
  const reserve = { metered: true as const, reservation: { usageLogId: LOG } as never, chargeId: `prompt-helper:${SONNET}`, holdCredits: 40 }
  const first = await finishMeteredSyncLlmJob(JOB, reserve, spend, { status: "completed", outputData: { text: "ok" } })
  const second = await finishMeteredSyncLlmJob(JOB, reserve, spend, { status: "failed", errorMessage: "boom" })
  expect(second).toEqual(first)
  expect(h.commitCredits).toHaveBeenCalledTimes(1)
  expect(h.markJobFailed).not.toHaveBeenCalled()
})
