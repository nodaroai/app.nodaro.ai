// @test-units-by-name looks up only the llm-chat, describe-to-picker, text-to-picker and prompt-helper credit rows it names
/**
 * The metered LLM billing contract (Task 5): the price-key resolver (A1), the
 * reserve (`reserveLlmCall`, A2), the spend ledger (`LlmSpend`,
 * `llmAttemptCostUsd`) and the settle (`settleLlmJob`). Every figure is at a
 * 10% markup and CREDIT_BASE_USD = 0.002:
 *   usdToCredits(usd) = ceil(round(usd / 0.002 × 1000) / 1000)
 *   charged          = ceil(base × 1.1)
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { FastifyReply, FastifyRequest } from "fastify"
import { llmPriceKey } from "@nodaro/shared/llm-models"

const JOB = "11111111-1111-4111-8111-111111111111"
const LOG = "22222222-2222-4222-8222-222222222222"

const h = vi.hoisted(() => {
  const tableResponses = new Map<string, { data: unknown; error: unknown }>()
  /** What an awaited (non-single) select on a table answers. */
  const listResponses = new Map<string, unknown[]>()
  /** R39: an awaited select answered from its own filters (wins over listResponses). */
  const listResponders = new Map<string, (filters: Array<[string, unknown]>) => unknown[]>()
  /** Every settlement write, in order (commit / refund / a terminal job write). */
  const order: string[] = []
  const ops: Array<{ table: string; op: "update" | "delete" | "insert"; values?: unknown; filters: Array<[string, unknown]> }> = []
  function createChain(table: string) {
    const response = tableResponses.get(table) ?? { data: null, error: { code: "PGRST116" } }
    let current: (typeof ops)[number] | null = null
    /** A plain select's own eq filters (R39: what the anomaly dedupe asks). */
    const selectFilters: Array<[string, unknown]> = []
    const chain: Record<string, unknown> = {}
    const passthrough = ["select", "neq", "order", "limit", "in", "gte", "range"]
    for (const m of passthrough) chain[m] = vi.fn(() => chain)
    chain.eq = vi.fn((col: string, val: unknown) => {
      if (current) current.filters.push([col, val])
      else selectFilters.push([col, val])
      return chain
    })
    chain.is = chain.eq
    chain.single = vi.fn(async () => response)
    chain.maybeSingle = vi.fn(async () => response)
    for (const op of ["update", "delete", "insert"] as const) {
      chain[op] = vi.fn((values?: unknown) => {
        current = { table, op, values, filters: [] }
        ops.push(current)
        const status = (values as { status?: unknown } | undefined)?.status
        if (table === "jobs" && op === "update" && typeof status === "string") order.push(`job:${status}`)
        return chain
      })
    }
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(
        current === null && listResponders.has(table)
          ? { data: listResponders.get(table)!(selectFilters), error: null }
          : current === null && listResponses.has(table) ? { data: listResponses.get(table), error: null }
          // R38: a jobs update answers its row (the metered sync stamp is a CAS that reads it).
          : current?.op === "update" && table === "jobs" ? { data: [{ id: "row" }], error: null } : { data: null, error: null },
      ).then(resolve, reject)
    return chain
  }
  return {
    tableResponses,
    listResponses,
    listResponders,
    order,
    ops,
    rollback: { value: false },
    from: vi.fn((table: string) => createChain(table)),
    rpc: vi.fn(),
    llmComplete: vi.fn(),
    meterSyncLlm: vi.fn(),
    insertSyncJob: vi.fn(),
  }
})

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: h.from, rpc: h.rpc, auth: { getUser: vi.fn() } } }))
vi.mock("@/lib/llm/router.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/llm/router.js")>()),
  llmComplete: h.llmComplete,
}))
vi.mock("@/lib/sync-llm-meter.js", () => ({ meterSyncLlm: h.meterSyncLlm }))
vi.mock("@/lib/insert-job.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/insert-job.js")>()),
  insertSyncJob: h.insertSyncJob,
}))
vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: vi.fn(async () => ({ ai_provider: "kie", cost_markup_percent: 10 })),
}))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/config.js")>()
  return {
    ...actual,
    hasCredits: () => true,
    isCloud: () => true,
    isCommunity: () => false,
    isBusiness: () => false,
    hasAdmin: () => true,
    llmMeteredPricing: () => !h.rollback.value,
  }
})
vi.mock("@/lib/access-blocks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/access-blocks.js")>()),
  refuseBlockedReservation: vi.fn(async () => {}),
}))
vi.mock("@/ee/lib/welcome-offer-config.js", () => ({ getWelcomeOfferConfig: vi.fn(async () => ({ enabled: false })) }))
vi.mock("@/ee/billing/credit-anomaly.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../credit-anomaly.js")>()),
  checkAndLogAnomaly: vi.fn(async () => {}),
}))

const {
  CreditsService,
  PriceNotConfiguredError,
  getModelCreditBaseCost,
  getModelCreditCostFromDB,
  chargedPriceTableFrom,
  chargedCredits,
  invalidateModelPricingCache,
  meteredLlmQuote,
} = await import("../credits.js")
const { checkAndLogAnomaly } = await import("../credit-anomaly.js")
const { creditGuardImpl } = await import("../../lib/credit-guard-impl.js")
const billing = await import("../../../lib/llm-billing.js")
const { LlmSpend, llmAttemptCostUsd, llmPrecheckBaseCredits, meterSyncLlmMetered, reserveLlmCall, settleLlmJob } = billing
const { LlmContentRefusalError, LlmStreamAbortedError, LlmStreamResponseError } = await import("../../../lib/llm-errors.js")
const { llmHoldBaseCredits } = await import("../llm-metered.js")
type LlmRequest = import("../../../lib/llm/types.js").LlmRequest
type LlmReserveResult = import("../../../lib/llm-billing.js").LlmReserveResult

/** A request whose text is exactly `chars` ASCII characters. */
function textReq(modelId: string, chars: number, maxTokens?: number): LlmRequest {
  return { modelId, system: "", messages: [{ role: "user", content: "a".repeat(chars) }], maxTokens }
}

/** H1: Fable, 8000 ASCII chars, asked 2000, KIE primary → 334 base → 368 charged. */
const H1 = textReq("claude-fable-5", 8000, 2000)

function fakeReply() {
  const reply = {
    sent: false,
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      reply.statusCode = code
      return reply
    },
    code(code: number) {
      reply.statusCode = code
      return reply
    },
    header() {
      return reply
    },
    send(body: unknown) {
      reply.body = body
      reply.sent = true
      return reply
    },
  }
  return reply
}

function fakeReq(body: unknown = {}): FastifyRequest {
  return { userId: "user-1", url: "/v1/llm-chat", headers: {}, body, routeOptions: { url: "/v1/llm-chat" } } as unknown as FastifyRequest
}

function profile(balance: number) {
  h.tableResponses.set("profiles", {
    data: {
      role: "user",
      tier: "pro",
      subscription_tier: "pro",
      lifetime_topup_credits: 0,
      subscription_credits: balance,
      topup_credits: 0,
      daily_spent_credits: 0,
      last_daily_reset: new Date().toISOString().slice(0, 10),
      storage_used_bytes: 0,
      storage_limit_bytes: 1e12,
    },
    error: null,
  })
}

const reserveCalls = () => h.rpc.mock.calls.filter(([fn]) => String(fn).startsWith("reserve_"))
const jobDeletes = () => h.ops.filter((o) => o.table === "jobs" && o.op === "delete")
const usageLogInserts = () => h.ops.filter((o) => o.table === "usage_logs" && o.op === "insert")

function meteredReserve(chargeId = "llm-chat:claude-fable-5", hold = 368): LlmReserveResult {
  return { metered: true, reservation: { usageLogId: LOG, creditsReserved: hold, watermark: false }, chargeId, holdCredits: hold }
}

const commitSpy = () => vi.spyOn(CreditsService, "commitCredits")

beforeEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  h.llmComplete.mockReset()
  h.tableResponses.clear()
  h.listResponses.clear()
  h.listResponders.clear()
  h.order.length = 0
  h.ops.length = 0
  h.rollback.value = false
  invalidateModelPricingCache()
  // The bare feature rows fall back to STATIC_CREDIT_COSTS (llm-chat = 2).
  profile(10_000)
  h.rpc.mockImplementation(async (fn: string) => (fn.startsWith("reserve_") ? { data: LOG, error: null } : { data: 0, error: null }))
})

describe("the metered price key (A1)", () => {
  it("every price lookup fails closed on a metered id — never a 0 price", async () => {
    const id = "describe-to-picker:claude-opus-5.5"
    // Refused outright, before any row read: even a stray row under the id would not price it.
    h.tableResponses.set("model_pricing", { data: { credit_cost: 0, is_enabled: true, tier_restriction: null }, error: null })
    await expect(getModelCreditBaseCost(id)).rejects.toBeInstanceOf(PriceNotConfiguredError)
    expect(h.from).not.toHaveBeenCalledWith("model_pricing")
    h.tableResponses.delete("model_pricing")
    await expect(getModelCreditCostFromDB(id)).rejects.toBeInstanceOf(PriceNotConfiguredError)
    // GET /v1/credits/model-cost and the deployment price list read this one.
    await expect(CreditsService.getModelCreditCost(id)).rejects.toBeInstanceOf(PriceNotConfiguredError)
    // lib/credit-base-cost.ts
    const { baseCreditCostFor } = await import("../../../lib/credit-base-cost.js")
    await expect(baseCreditCostFor(id)).rejects.toBeInstanceOf(PriceNotConfiguredError)
    // the POST /v1/quote fallbacks (single id and batch)
    const { reservedCreditsFor } = await import("../../lib/credit-guard-impl.js")
    await expect(reservedCreditsFor(fakeReq(), id, undefined)).rejects.toBeInstanceOf(PriceNotConfiguredError)
    await expect(reservedCreditsFor(fakeReq(), "llm-chat", { batchIdentifiers: () => [id] })).rejects.toBeInstanceOf(PriceNotConfiguredError)
  })

  it("GET /v1/credits/model-cost answers a metered id 503 price_not_configured", async () => {
    const { handlePriceNotConfigured } = await import("../../lib/credit-guard-impl.js")
    const err = await CreditsService.getModelCreditCost("llm-chat:claude-fable-5").catch((e: unknown) => e)
    const reply = fakeReply()
    expect(handlePriceNotConfigured(err, reply as unknown as FastifyReply, "GET /v1/credits/model-cost")).toBe(true)
    expect(reply.statusCode).toBe(503)
  })

  it("a settle at a charged price commits nothing at 0: commitAtChargedPrice refuses", async () => {
    const commit = commitSpy()
    vi.spyOn(CreditsService, "trySettleManagedCredits").mockResolvedValue(false)
    const { commitAtChargedPrice } = await import("../commit-at-charged-price.js")
    await expect(commitAtChargedPrice(LOG, JOB, "describe-to-picker:claude-opus-5.5")).rejects.toBeInstanceOf(PriceNotConfiguredError)
    expect(commit).not.toHaveBeenCalled()
  })

  it("describe-to-picker's at-price settle commits the hold WHOLE for a metered id, never 0", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const commit = commitSpy().mockResolvedValue(undefined)
    h.listResponses.set("usage_logs", [{ id: LOG, credits_used: 400 }])
    const { commitReservedCreditsForJobAtPrice } = await import("../../../lib/credits-job-lifecycle.js")
    await commitReservedCreditsForJobAtPrice(JOB, "describe-to-picker:claude-opus-5.5")
    expect(commit).toHaveBeenCalledWith(LOG, undefined)
  })

  it("only a POSITIVE hold resolves a metered id; the bare row's switches still apply", async () => {
    for (const bad of [0, -5, Number.NaN]) {
      await expect(CreditsService.reserveCredits("user-1", JOB, "llm-chat:claude-fable-5", 0, 0, { creditOverride: bad })).rejects.toBeInstanceOf(
        PriceNotConfiguredError,
      )
      await expect(CreditsService.checkCredits("user-1", "llm-chat:claude-fable-5", false, bad)).rejects.toBeInstanceOf(PriceNotConfiguredError)
    }
    expect(reserveCalls()).toHaveLength(0)
    expect(usageLogInserts()).toHaveLength(0)
    h.tableResponses.set("model_pricing", { data: { credit_cost: 2, is_enabled: false, tier_restriction: null }, error: null })
    invalidateModelPricingCache()
    expect(await CreditsService.checkCredits("user-1", "llm-chat:claude-fable-5", false, 368)).toMatchObject({
      allowed: false,
      error: "This model is currently disabled",
    })
  })

  it("reserveCredits under llm-chat:claude-fable-5 with an override succeeds; without one it refuses", async () => {
    const ok = await CreditsService.reserveCredits("user-1", JOB, "llm-chat:claude-fable-5", 0, 0, { creditOverride: 368 })
    expect(ok.usageLogId).toBe(LOG)
    expect(reserveCalls()).toHaveLength(1)
    expect(reserveCalls()[0]![1]).toMatchObject({ p_credits: 368, p_model_identifier: "llm-chat:claude-fable-5" })

    h.rpc.mockClear()
    await expect(CreditsService.reserveCredits("user-1", JOB, "llm-chat:claude-fable-5", 0, 0, {})).rejects.toBeInstanceOf(
      PriceNotConfiguredError,
    )
    expect(reserveCalls()).toHaveLength(0)
    expect(usageLogInserts()).toHaveLength(0)
  })

  it("checkCredits refuses a metered id with no override, and checks the override when given", async () => {
    await expect(CreditsService.checkCredits("user-1", "llm-chat:claude-fable-5")).rejects.toBeInstanceOf(PriceNotConfiguredError)
    expect(await CreditsService.checkCredits("user-1", "llm-chat:claude-fable-5", false, 368)).toMatchObject({ allowed: true, required: 368 })
  })

  it("meteredLlmQuote: the table's figure, flagged; unpriced → its error; any other id → null", () => {
    const table = chargedPriceTableFrom(new Map(), { cost_markup_percent: 10 } as never)
    expect(meteredLlmQuote(table, "llm-chat:claude-opus-5.5")).toEqual({ kind: "estimate", credits: 6 })
    expect(meteredLlmQuote(table, "llm-chat:claude-opus-5.5:direct")).toEqual({ kind: "estimate", credits: 14 })
    expect(meteredLlmQuote(table, "llm-chat:premium")).toBeNull()
    expect(meteredLlmQuote(table, "nano-banana")).toBeNull()
    h.rollback.value = true
    expect(meteredLlmQuote(table, "llm-chat:claude-opus-5.5")).toBeNull()
  })

  it("charged price table: llm-chat:claude-opus-5.5 = 6, :direct = 14", () => {
    // KIE 1k/1k 0.0096 → 4.8 → 5 base → ceil(5.5) = 6; direct 0.004 + 0.02 = 0.024 → 12 base → ceil(13.2) = 14
    const table = chargedPriceTableFrom(new Map(), { cost_markup_percent: 10 } as never)
    expect(table.base("llm-chat:claude-opus-5.5")).toBe(5)
    expect(chargedCredits(table, "llm-chat:claude-opus-5.5")).toBe(6)
    expect(table.base("llm-chat:claude-opus-5.5:direct")).toBe(12)
    expect(chargedCredits(table, "llm-chat:claude-opus-5.5:direct")).toBe(14)
  })

  it("the :direct id is marked up at its charge id, without :direct", () => {
    const settings = { cost_markup_percent: 10, service_margin_percent: { "llm-chat:claude-opus-5.5": 50 } } as never
    const table = chargedPriceTableFrom(new Map(), settings)
    expect(chargedCredits(table, "llm-chat:claude-opus-5.5:direct")).toBe(18) // ceil(12 × 1.5)
  })

  it("rollback: every metered id is unresolved", async () => {
    h.rollback.value = true
    await expect(getModelCreditBaseCost("llm-chat:claude-fable-5")).rejects.toBeInstanceOf(PriceNotConfiguredError)
    const table = chargedPriceTableFrom(new Map(), { cost_markup_percent: 10 } as never)
    expect(table.base("llm-chat:claude-opus-5.5")).toBeUndefined()
    expect(chargedCredits(table, "llm-chat:claude-opus-5.5:direct")).toBeUndefined()
    // a tier id is untouched
    expect(table.base("llm-chat:premium")).toBe(6)
  })
})

describe("reserveLlmCall", () => {
  it("reserveLlmCall holds 368 under llm-chat:claude-fable-5 (H1), and the hold wins over the guard's precheck override 50", async () => {
    expect(llmHoldBaseCredits("claude-fable-5", { request: H1 })).toBe(334)
    const req = fakeReq()
    req.creditReservation = { usageLogId: "", creditsReserved: 0, watermark: false, creditOverride: 50 }
    const reply = fakeReply()
    const result = await reserveLlmCall(req, reply as unknown as FastifyReply, JOB, {
      feature: "llm-chat",
      calls: [{ modelId: "claude-fable-5", request: H1 }],
    })
    expect(reply.sent).toBe(false)
    expect(result).toMatchObject({ metered: true, chargeId: "llm-chat:claude-fable-5", holdCredits: 368 })
    expect(reserveCalls()).toHaveLength(1)
    expect(reserveCalls()[0]![1]).toMatchObject({ p_credits: 368, p_model_identifier: "llm-chat:claude-fable-5" })
  })

  it("402 'Needs up to 368 credits' (required 368) when the balance is 200; no job row and no usage log left", async () => {
    profile(200)
    const reply = fakeReply()
    const result = await reserveLlmCall(fakeReq(), reply as unknown as FastifyReply, JOB, {
      feature: "llm-chat",
      calls: [{ modelId: "claude-fable-5", request: H1 }],
    })
    expect(result).toBeUndefined()
    expect(reply.statusCode).toBe(402)
    expect(reply.body).toMatchObject({ error: { code: "insufficient_credits", message: "Needs up to 368 credits" }, required: 368 })
    expect(reserveCalls()).toHaveLength(0)
    expect(usageLogInserts()).toHaveLength(0)
    expect(jobDeletes()).toEqual([expect.objectContaining({ filters: [["id", JOB]] })])
  })

  it("400 llm_model_unpriced from the guard preHandler: no job row, no reservation", async () => {
    const reply = fakeReply()
    const guard = creditGuardImpl(() => "llm-chat:claude-ghost-9", {
      computeCredits: (body) => llmPrecheckBaseCredits("llm-chat", body as { llmModel?: string }, 120),
    })
    await guard(fakeReq({ llmModel: "claude-ghost-9" }), reply as unknown as FastifyReply)
    expect(reply.statusCode).toBe(400)
    expect(reply.body).toMatchObject({ error: { code: "validation_error", reason: "llm_model_unpriced", modelId: "claude-ghost-9" } })
    expect(h.rpc).not.toHaveBeenCalled()
    expect(h.ops).toEqual([])
  })

  it("the guard precheck prices the body's model as the 1-attempt hold (base credits)", async () => {
    expect(await llmPrecheckBaseCredits("llm-chat", { llmModel: "claude-fable-5", maxTokens: 2000 }, 8000)).toBe(334)
    h.rollback.value = true
    expect(await llmPrecheckBaseCredits("llm-chat", { llmModel: "claude-fable-5", maxTokens: 2000 }, 8000)).toBeUndefined()
  })

  it("the precheck borrows defaults from the shared table: text-to-picker on Opus 5.5 holds direct, as llmPriceKey keys it", async () => {
    const body = { llmModel: "claude-opus-5.5", maxTokens: 2000 }
    // Text to Picker runs on Describe to Picker's recipe (Opus 5.5 at high → direct).
    expect(llmPriceKey("text-to-picker", "claude-opus-5.5")).toBe("text-to-picker:claude-opus-5.5:direct")
    const direct = await llmPrecheckBaseCredits("text-to-picker", { ...body, reasoningEffort: "high" }, 8000)
    expect(await llmPrecheckBaseCredits("text-to-picker", body, 8000)).toBe(direct)
    // Generate Structured borrows Generate Text's (no recipe effort): KIE, cheaper, and keyed bare.
    expect(llmPriceKey("llm-structured", "claude-opus-5.5")).toBe("llm-structured:claude-opus-5.5")
    expect(await llmPrecheckBaseCredits("llm-structured", body, 8000)).toBeLessThan(direct as number)
  })

  it("reserveLlmCall backstop: 400 llm_model_unpriced, the passed job row is deleted", async () => {
    const reply = fakeReply()
    const result = await reserveLlmCall(fakeReq(), reply as unknown as FastifyReply, JOB, {
      feature: "llm-chat",
      calls: [{ modelId: "claude-ghost-9", request: textReq("claude-ghost-9", 100) }],
    })
    expect(result).toBeUndefined()
    expect(reply.statusCode).toBe(400)
    expect(reply.body).toMatchObject({ error: { code: "validation_error", reason: "llm_model_unpriced", modelId: "claude-ghost-9" } })
    expect(reserveCalls()).toHaveLength(0)
    expect(jobDeletes()).toEqual([expect.objectContaining({ filters: [["id", JOB]] })])
  })

  it("text-to-picker: 3 parallel batches hold the sum of three 1-attempt holds", async () => {
    const batches = [30000, 20000, 9000].map((chars) => textReq("claude-opus-5.5", chars, 4000))
    const each = batches.map((request) => llmHoldBaseCredits("claude-opus-5.5", { request }))
    const reply = fakeReply()
    const result = await reserveLlmCall(fakeReq(), reply as unknown as FastifyReply, JOB, {
      feature: "text-to-picker",
      calls: [
        { modelId: "claude-opus-5.5", request: batches[0]! },
        { modelId: "claude-opus-5.5", request: batches[1]! },
        { modelId: "claude-opus-5.5", request: batches[2]! },
      ],
    })
    const sum = each[0]! + each[1]! + each[2]!
    expect(result).toMatchObject({ metered: true, chargeId: "text-to-picker:claude-opus-5.5", holdCredits: Math.ceil(sum * 1.1) })
    expect(reserveCalls()[0]![1]).toMatchObject({ p_credits: Math.ceil(sum * 1.1) })
  })

  it("rollback: reserveLlmCall returns { metered: false } and reserves nothing", async () => {
    h.rollback.value = true
    const reply = fakeReply()
    const result = await reserveLlmCall(fakeReq(), reply as unknown as FastifyReply, JOB, {
      feature: "llm-chat",
      calls: [{ modelId: "claude-fable-5", request: H1 }],
    })
    expect(result).toEqual({ metered: false })
    expect(reply.sent).toBe(false)
    expect(h.rpc).not.toHaveBeenCalled()
    expect(h.ops).toEqual([])
  })
})

describe("llmAttemptCostUsd", () => {
  it("GPT-6 KIE input 0 costs from request size", () =>
    // 10000×0.03e-6 + 1000×0.15e-6 (reported-only: 0.00015)
    expect(llmAttemptCostUsd({ lane: "kie", modelId: "gpt-6-luna", requestChars: 40000, inputTokens: 0, outputTokens: 1000 })).toBeCloseTo(0.00045, 8))

  it("a stated KIE charge wins; providerCost next; the lane rate last", () => {
    expect(llmAttemptCostUsd({ lane: "kie", modelId: "claude-opus-5.5", requestChars: 1, inputTokens: 1, outputTokens: 1, creditsUsd: 0.5 })).toBe(0.5)
    expect(llmAttemptCostUsd({ lane: "kie", modelId: "gemini-3.8-flash", requestChars: 1, inputTokens: 1, outputTokens: 1, providerCost: 0.25 })).toBe(0.25)
    // Fable direct: 1000×10e-6 + 1000×50e-6 = 0.06
    expect(llmAttemptCostUsd({ lane: "direct-anthropic", modelId: "claude-fable-5", requestChars: 1, inputTokens: 1000, outputTokens: 1000 })).toBeCloseTo(0.06, 10)
  })

  it("a missing rate throws, never 0", async () => {
    const { LlmRateMissingError } = await import("../../../lib/pricing/llm-cost.js")
    expect(() => llmAttemptCostUsd({ lane: "kie", modelId: "gemini-4-argon", requestChars: 1, inputTokens: 1, outputTokens: 1 })).toThrow(
      LlmRateMissingError,
    )
  })
})

describe("settleLlmJob", () => {
  function resp(lane: "kie" | "direct-gemini" | "direct-anthropic", fields: Record<string, unknown>) {
    return { text: "ok", model: "m", lane, ...fields }
  }

  it("settle: Fable KIE stated 0.048 USD → 27", async () => {
    // 24 base → ceil(26.4) = 27
    const commit = commitSpy().mockResolvedValue({ charged: 27, collectedOverHold: 0, shortfall: 0 })
    const spend = new LlmSpend()
    spend.add("claude-fable-5", H1, { response: resp("kie", { usage: { inputTokens: 3, outputTokens: 400 }, creditsUsd: 0.048, providerCost: 0.048 }) })
    expect(await settleLlmJob(JOB, meteredReserve(), spend)).toEqual({ outcome: "charged", charged: 27, shortfall: 0 })
    expect(commit).toHaveBeenCalledWith(LOG, 27, { collectOverHold: true })
  })

  it("KIE Claude with no stated charge settles from the size estimate", async () => {
    // Opus 5.5 KIE, requestChars 8000, answer 2000 chars, reported 12 in / 500 out
    // size estimate: 2000×1.6e-6 + 500×8e-6 = 0.0072 → 3.6 → 4 base → 5 charged (reported tokens: 0.0040192 → 3 → 4)
    const commit = commitSpy().mockResolvedValue({ charged: 5, collectedOverHold: 0, shortfall: 0 })
    const spend = new LlmSpend()
    spend.add("claude-opus-5.5", textReq("claude-opus-5.5", 8000), {
      response: resp("kie", { usage: { inputTokens: 12, outputTokens: 500 }, providerCost: 0.0040192 }),
    })
    expect(spend.costUsd).toBeCloseTo(0.0072, 10)
    expect(spend.record.source).toBe("kie-size-estimate")
    await settleLlmJob(JOB, meteredReserve("llm-chat:claude-opus-5.5"), spend)
    expect(commit).toHaveBeenCalledWith(LOG, 5, { collectOverHold: true })
  })

  it("billed failure is charged: direct-gemini refusal providerCost 0.01 → 6", async () => {
    // 5 base → ceil(5.5) = 6
    const commit = commitSpy().mockResolvedValue({ charged: 6, collectedOverHold: 0, shortfall: 0 })
    const spend = new LlmSpend()
    const refusal = new LlmContentRefusalError("refused", { inputTokens: 900, outputTokens: 0, providerCost: 0.01, complete: true }, "direct-gemini")
    spend.add("gemini-3.8-flash", textReq("gemini-3.8-flash", 3000), { error: refusal })
    expect(spend.billedAnything).toBe(true)
    expect(spend.attempts[0]!.lane).toBe("direct-gemini")
    expect(await settleLlmJob(JOB, meteredReserve("llm-chat:gemini-3.8-flash"), spend)).toMatchObject({ outcome: "charged", charged: 6 })
    expect(commit).toHaveBeenCalledWith(LOG, 6, { collectOverHold: true })
  })

  it("unbilled failure (ECONNRESET) is refunded", async () => {
    const commit = commitSpy()
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    const spend = new LlmSpend()
    spend.add("claude-fable-5", H1, { error: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) })
    // a usage-carrying class that reported no usage billed nothing either
    spend.add("claude-fable-5", H1, { error: new LlmStreamResponseError("cut", { inputTokens: 0, outputTokens: 0, complete: false }) })
    expect(spend.billedAnything).toBe(false)
    expect(await settleLlmJob(JOB, meteredReserve(), spend)).toEqual({ outcome: "refunded" })
    expect(refund).toHaveBeenCalledWith(LOG)
    expect(commit).not.toHaveBeenCalled()
  })

  it("a vendor call that computed 0 is charged the floor: 2", async () => {
    // CREDIT_BASE_USD → 1 base → applyMarkupPercent(1, 10) = 2
    const commit = commitSpy().mockResolvedValue({ charged: 2, collectedOverHold: 0, shortfall: 0 })
    const spend = new LlmSpend()
    spend.add("gemini-3.8-flash", textReq("gemini-3.8-flash", 10), { response: resp("kie", { usage: { inputTokens: 0, outputTokens: 0 }, providerCost: 0 }) })
    expect(spend.record).toMatchObject({ costUsd: 0, source: "floor", calls: 1 })
    await settleLlmJob(JOB, meteredReserve("llm-chat:gemini-3.8-flash"), spend)
    expect(commit).toHaveBeenCalledWith(LOG, 2, { collectOverHold: true })
  })

  it("describe-to-picker: billed Claude refusal 0.05 + Gemini fallback 0.004 → 30", async () => {
    // 0.054 → 27 → ceil(29.7) = 30. The refusal states KIE's charge, so rule 1 prices it.
    const commit = commitSpy().mockResolvedValue({ charged: 30, collectedOverHold: 0, shortfall: 0 })
    const spend = new LlmSpend()
    const ask = textReq("claude-opus-5.5", 20000)
    spend.add("claude-opus-5.5", ask, {
      error: new LlmContentRefusalError("refused", { inputTokens: 3, outputTokens: 40, providerCost: 0.05, creditsUsd: 0.05, complete: true }),
    })
    spend.add("gemini-3.8-flash", textReq("gemini-3.8-flash", 20000), {
      response: resp("kie", { usage: { inputTokens: 5000, outputTokens: 500 }, providerCost: 0.004 }),
    })
    expect(spend.costUsd).toBeCloseTo(0.054, 10)
    await settleLlmJob(JOB, meteredReserve("describe-to-picker:claude-opus-5.5", 400), spend)
    expect(commit).toHaveBeenCalledWith(LOG, 30, { collectOverHold: true })
  })

  it("a stopped stream is charged its estimate", () => {
    const spend = new LlmSpend()
    const aborted = new LlmStreamAbortedError("stopped", { inputTokens: 2000, outputTokens: 250, providerCost: 0.0052, complete: false, estimated: true }, "kie")
    spend.add("claude-opus-5.5", textReq("claude-opus-5.5", 8000), { error: aborted })
    expect(spend.attempts).toEqual([expect.objectContaining({ lane: "kie", estimated: true, inputTokens: 2000, outputTokens: 250 })])
    expect(spend.record.source).toBe("abort-estimate")
    // KIE Claude: the size estimate (8000 ÷ 4 in, 250 out) = 2000×1.6e-6 + 250×8e-6 = 0.0052
    expect(spend.costUsd).toBeCloseTo(0.0052, 10)
  })

  it("settles above the hold through commit_credits_metered", async () => {
    // hold 368; direct-anthropic answer 2667 in / 32768 out = 1.66507 USD → 833 base → 917
    const commit = commitSpy().mockResolvedValue({ charged: 917, collectedOverHold: 549, shortfall: 0 })
    const spend = new LlmSpend()
    spend.add("claude-fable-5", H1, { response: resp("direct-anthropic", { usage: { inputTokens: 2667, outputTokens: 32768 } }) })
    expect(spend.costUsd).toBeCloseTo(1.66507, 10)
    expect(await settleLlmJob(JOB, meteredReserve(), spend)).toEqual({ outcome: "charged", charged: 917, shortfall: 0 })
    expect(commit).toHaveBeenCalledWith(LOG, 917, { collectOverHold: true })
    expect(checkAndLogAnomaly).not.toHaveBeenCalled()
    const jobUpdate = h.ops.find((o) => o.table === "jobs" && o.op === "update")
    expect(jobUpdate?.values).toMatchObject({ credits_actual: 917 })
  })

  it("records provider_cost and the ledger { costUsd, source, calls, lanes, chargeId } in the server-only llm_billing column — never output_data", async () => {
    commitSpy().mockResolvedValue({ charged: 27, collectedOverHold: 0, shortfall: 0 })
    const spend = new LlmSpend()
    spend.add("claude-fable-5", H1, { response: resp("kie", { usage: { inputTokens: 3, outputTokens: 400 }, creditsUsd: 0.048 }) })
    await settleLlmJob(JOB, meteredReserve(), spend)
    const jobUpdates = h.ops.filter((o) => o.table === "jobs" && o.op === "update")
    expect(jobUpdates).toEqual([
      expect.objectContaining({ filters: [["id", JOB]], values: { provider_cost: 0.048, credits_actual: 27 } }),
      expect.objectContaining({ filters: [["id", JOB]], values: { llm_billing: { costUsd: 0.048, source: "kie-stated", calls: 1, lanes: ["kie"], chargeId: "llm-chat:claude-fable-5" } } }),
    ])
    // The ledger (provider $, lanes) never enters output_data, which the job's owner can read.
    expect(jobUpdates.some((u) => "output_data" in (u.values as Record<string, unknown>))).toBe(false)
  })

  it("an unconfirmed commit is unsettled: no credits_actual, the hold left to the sweep (C3)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    commitSpy().mockResolvedValue(undefined)
    const spend = new LlmSpend()
    spend.add("claude-fable-5", H1, { response: resp("kie", { usage: { inputTokens: 3, outputTokens: 400 }, creditsUsd: 0.048 }) })
    expect(await settleLlmJob(JOB, meteredReserve(), spend)).toEqual({ outcome: "unsettled" })
    const jobUpdate = h.ops.find((o) => o.table === "jobs" && o.op === "update")
    expect(jobUpdate?.values).not.toHaveProperty("credits_actual")
    expect(jobUpdate?.values).toMatchObject({ provider_cost: 0.048 })
  })

  describe("round 5: a usage log ALREADY COMMITTED (a worker re-run after a confirmed settle)", () => {
    const fable = () => {
      const spend = new LlmSpend()
      spend.add("claude-fable-5", H1, { response: resp("kie", { usage: { inputTokens: 3, outputTokens: 400 }, creditsUsd: 0.048 }) })
      return spend // 0.048 USD → 27 credits
    }
    const committedLog = (charged: number, metadata: Record<string, unknown> = {}) =>
      h.tableResponses.set("usage_logs", {
        data: { status: "committed", credits_charged: charged, credits_used: 10, user_id: "user-1", metadata },
        error: null,
      })

    it("is CHARGED at the log's credits_charged (credits_actual), never unsettled; what it would add is an uncollected_overrun anomaly", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {})
      commitSpy().mockResolvedValue(undefined) // commit_credits_metered: "Usage log not found" (not reserved)
      committedLog(20)
      expect(await settleLlmJob(JOB, meteredReserve(), fable())).toEqual({ outcome: "charged", charged: 20, shortfall: 7 })
      const jobUpdate = h.ops.find((o) => o.table === "jobs" && o.op === "update")
      expect(jobUpdate?.values).toMatchObject({ credits_actual: 20, provider_cost: 0.048 })
      const anomalies = h.ops.filter((o) => o.table === "credit_anomalies" && o.op === "insert")
      expect(anomalies).toHaveLength(1)
      expect(anomalies[0]!.values).toMatchObject({
        job_id: JOB,
        user_id: "user-1",
        usage_log_id: LOG,
        model_identifier: "llm-chat:claude-fable-5",
        credits_estimated: 10,
        credits_actual: 27,
        diff: 7,
        provider_cost_usd: 0.048,
        anomaly_type: "uncollected_overrun",
      })
    })

    it("the earlier settle's own shortfall (already logged by the RPC) is not counted again", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {})
      commitSpy().mockResolvedValue(undefined)
      committedLog(20, { overrun: { collected: 5, shortfall: 3 } })
      expect(await settleLlmJob(JOB, meteredReserve(), fable())).toEqual({ outcome: "charged", charged: 20, shortfall: 4 })
      const anomaly = h.ops.find((o) => o.table === "credit_anomalies" && o.op === "insert")
      expect(anomaly?.values).toMatchObject({ diff: 4 })
    })

    /** credit_anomalies answering the dedupe's filters: a row exists for this log × type × each [diff, credits_actual]. */
    const existingAnomalies = (...rows: Array<[number, number]>) =>
      h.listResponders.set("credit_anomalies", (filters) => {
        const f = new Map(filters)
        return f.get("usage_log_id") === LOG && f.get("anomaly_type") === "uncollected_overrun" &&
          rows.some(([diff, actual]) => f.get("diff") === diff && f.get("credits_actual") === actual)
          ? [{ id: "earlier-anomaly" }]
          : []
      })

    it("R39: an IDENTICAL repeat (same log × type × amount) is not logged again", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {})
      vi.spyOn(console, "warn").mockImplementation(() => {})
      commitSpy().mockResolvedValue(undefined)
      committedLog(20)
      existingAnomalies([7, 27])
      // Still charged at the committed figure; the uncollected part is already flagged.
      expect(await settleLlmJob(JOB, meteredReserve(), fable())).toEqual({ outcome: "charged", charged: 20, shortfall: 7 })
      expect(h.ops.some((o) => o.table === "credit_anomalies" && o.op === "insert")).toBe(false)
      // …and never an app report in its place (the existing row IS the record).
      const reports = h.ops.filter((o) => o.table === "app_reports" && o.op === "insert")
      expect(reports).toEqual([])
    })

    it("R39: a re-run's DIFFERENT shortfall is logged even though the log already has an uncollected_overrun (e.g. the RPC's own, at another amount)", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {})
      vi.spyOn(console, "warn").mockImplementation(() => {})
      commitSpy().mockResolvedValue(undefined)
      committedLog(20)
      existingAnomalies([3, 27])
      expect(await settleLlmJob(JOB, meteredReserve(), fable())).toEqual({ outcome: "charged", charged: 20, shortfall: 7 })
      const anomalies = h.ops.filter((o) => o.table === "credit_anomalies" && o.op === "insert")
      expect(anomalies).toHaveLength(1)
      expect(anomalies[0]!.values).toMatchObject({ usage_log_id: LOG, diff: 7, anomaly_type: "uncollected_overrun" })
    })

    it("m4: the same shortfall against a DIFFERENT actual is a new fact — logged", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {})
      vi.spyOn(console, "warn").mockImplementation(() => {})
      commitSpy().mockResolvedValue(undefined)
      committedLog(20)
      existingAnomalies([7, 30])
      await settleLlmJob(JOB, meteredReserve(), fable())
      expect(h.ops.filter((o) => o.table === "credit_anomalies" && o.op === "insert")).toHaveLength(1)
    })

    it("R39: the existence read failing still logs (never silent)", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {})
      commitSpy().mockResolvedValue(undefined)
      committedLog(20)
      h.listResponders.set("credit_anomalies", () => { throw new Error("read failed") })
      await settleLlmJob(JOB, meteredReserve(), fable())
      expect(h.ops.filter((o) => o.table === "credit_anomalies" && o.op === "insert")).toHaveLength(1)
    })

    it("nothing beyond the committed charge → charged, no anomaly", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {})
      commitSpy().mockResolvedValue(undefined)
      committedLog(27)
      expect(await settleLlmJob(JOB, meteredReserve(), fable())).toEqual({ outcome: "charged", charged: 27, shortfall: 0 })
      expect(h.ops.some((o) => o.table === "credit_anomalies")).toBe(false)
    })

    it("a log still RESERVED (a real RPC failure) stays unsettled, as before", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {})
      commitSpy().mockResolvedValue(undefined)
      h.tableResponses.set("usage_logs", { data: { status: "reserved", credits_charged: null, credits_used: 10, user_id: "user-1" }, error: null })
      expect(await settleLlmJob(JOB, meteredReserve(), fable())).toEqual({ outcome: "unsettled" })
      const jobUpdate = h.ops.find((o) => o.table === "jobs" && o.op === "update")
      expect(jobUpdate?.values).not.toHaveProperty("credits_actual")
      expect(h.ops.some((o) => o.table === "credit_anomalies")).toBe(false)
    })
  })

  it("a tier reservation is not settled here", async () => {
    const commit = commitSpy()
    expect(await settleLlmJob(JOB, { metered: false }, new LlmSpend())).toEqual({ outcome: "not-metered" })
    expect(await settleLlmJob(JOB, undefined, new LlmSpend())).toEqual({ outcome: "not-metered" })
    expect(commit).not.toHaveBeenCalled()
  })
})

describe("structured attempts", () => {
  it("structured: three attempts are each costed on their own lane and request size", async () => {
    const { z } = await import("zod")
    const llmComplete = h.llmComplete
      .mockResolvedValueOnce({ text: "not json", model: "claude-opus-5.5", lane: "kie", usage: { inputTokens: 5, outputTokens: 100 } })
      .mockResolvedValueOnce({ text: "{\"x\":\"nope\"}", model: "claude-opus-5.5", lane: "direct-anthropic", usage: { inputTokens: 3000, outputTokens: 50 } })
      .mockResolvedValueOnce({ text: "{\"x\":1}", model: "claude-opus-5.5", lane: "kie", usage: { inputTokens: 7, outputTokens: 20 }, creditsUsd: 0.01 })
    const { llmCompleteStructured } = await import("../../../lib/llm/structured.js")
    const request = textReq("claude-opus-5.5", 8000)
    const out = await llmCompleteStructured(request, z.object({ x: z.number() }))
    expect(llmComplete).toHaveBeenCalledTimes(3)
    expect(out.attempts.map((a) => a.lane)).toEqual(["kie", "direct-anthropic", "kie"])
    // Each re-ask's prompt carries the previous answer and the correction turn.
    const [a1, a2, a3] = out.attempts
    expect(a2!.requestChars).toBeGreaterThan(a1!.requestChars + "not json".length)
    expect(a3!.requestChars).toBeGreaterThan(a2!.requestChars + "{\"x\":\"nope\"}".length)

    const spend = new LlmSpend()
    spend.add("claude-opus-5.5", request, { output: out })
    const expected =
      llmAttemptCostUsd(a1!) + // KIE Claude: from its request size, not its 5 reported input tokens
      (3000 * 4 + 50 * 20) / 1e6 + // direct Opus 5.5 at the direct rate
      0.01 // KIE's stated charge
    expect(llmAttemptCostUsd(a1!)).toBeCloseTo(((Math.ceil(a1!.requestChars / 4)) * 1.6 + 100 * 8) / 1e6, 12)
    expect(spend.costUsd).toBeCloseTo(expected, 12)
    expect(spend.record).toMatchObject({ calls: 3, lanes: ["kie", "direct-anthropic", "kie"] })
  })

  it("a structured failure carries every attempt, the billed terminal one included", async () => {
    const { z } = await import("zod")
    h.llmComplete
      .mockResolvedValueOnce({ text: "not json", model: "claude-opus-5.5", lane: "kie", usage: { inputTokens: 5, outputTokens: 100 } })
      .mockRejectedValueOnce(new LlmContentRefusalError("refused", { inputTokens: 4, outputTokens: 9, providerCost: 0.001, complete: true }))
    const { llmCompleteStructured, StructuredLlmError } = await import("../../../lib/llm/structured.js")
    const request = textReq("claude-opus-5.5", 8000)
    const err = await llmCompleteStructured(request, z.object({ x: z.number() })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StructuredLlmError)
    const attempts = (err as InstanceType<typeof StructuredLlmError>).usage.attempts
    expect(attempts).toHaveLength(2)
    expect(attempts[1]).toMatchObject({ inputTokens: 4, outputTokens: 9, providerCost: 0.001 })
    const spend = new LlmSpend()
    spend.add("claude-opus-5.5", request, { error: err })
    expect(spend.record.calls).toBe(2)
  })
})

describe("meterSyncLlmMetered (D3 helpers)", () => {
  it("rollback: today's meterSyncLlm at prompt-helper, commit / refund exactly as before", async () => {
    h.rollback.value = true
    const meter = { commit: vi.fn(async () => {}), refund: vi.fn(async () => {}) }
    h.meterSyncLlm.mockResolvedValue(meter)
    const req = fakeReq()
    const reply = fakeReply() as unknown as FastifyReply
    const m = await meterSyncLlmMetered(req, reply, "object-llm-caption", { feature: "prompt-helper", calls: [{ modelId: "claude-fable-5", request: H1 }] })
    expect(h.meterSyncLlm).toHaveBeenCalledWith(req, reply, "object-llm-caption", "prompt-helper")
    await m!.settle("failed", "a message the rollback path never writes")
    expect(meter.refund).toHaveBeenCalledTimes(1)
    expect(meter.commit).not.toHaveBeenCalled()
    await m!.settle("completed")
    expect(meter.commit).toHaveBeenCalledTimes(1)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it("metered: creates the job, holds the call, and settles what it spent", async () => {
    h.insertSyncJob.mockResolvedValue({ data: { id: JOB }, error: null })
    const commit = commitSpy().mockResolvedValue({ charged: 27, collectedOverHold: 0, shortfall: 0 })
    const reply = fakeReply()
    const m = await meterSyncLlmMetered(fakeReq(), reply as unknown as FastifyReply, "object-llm-caption", {
      feature: "prompt-helper",
      calls: [{ modelId: "claude-fable-5", request: H1 }],
    })
    expect(h.meterSyncLlm).not.toHaveBeenCalled()
    expect(reserveCalls()[0]![1]).toMatchObject({ p_credits: 368, p_model_identifier: "prompt-helper:claude-fable-5" })
    m!.spend.add("claude-fable-5", H1, { response: { text: "ok", model: "m", lane: "kie", creditsUsd: 0.048 } })
    await m!.settle("completed")
    expect(commit).toHaveBeenCalledWith(LOG, 27, { collectOverHold: true })
    const jobUpdates = h.ops.filter((o) => o.table === "jobs" && o.op === "update").map((o) => o.values)
    expect(jobUpdates).toEqual(expect.arrayContaining([expect.objectContaining({ status: "completed" }), expect.objectContaining({ credits_actual: 27 })]))
  })
})

describe("fix round 1", () => {
  const kieResp = (fields: Record<string, unknown>) => ({ text: "ok", model: "m", lane: "kie" as const, ...fields })

  it("C3: meterSyncLlmMetered stamps the sweep anchor and settles BEFORE the terminal write", async () => {
    h.insertSyncJob.mockResolvedValue({ data: { id: JOB }, error: null })
    commitSpy().mockImplementation(async () => {
      h.order.push("commit")
      return { charged: 27, collectedOverHold: 0, shortfall: 0 }
    })
    const m = await meterSyncLlmMetered(fakeReq(), fakeReply() as unknown as FastifyReply, "object-llm-caption", {
      feature: "prompt-helper",
      calls: [{ modelId: "claude-fable-5", request: H1 }],
    })
    const stamp = h.ops.find((o) => o.table === "jobs" && o.op === "update" && (o.values as Record<string, unknown>).provider_kind)
    expect(stamp?.values).toMatchObject({ provider_kind: "anthropic-sync", provider_call_started_at: expect.any(String) })
    expect(stamp?.filters).toEqual([["id", JOB]])
    m!.spend.add("claude-fable-5", H1, { response: kieResp({ creditsUsd: 0.048 }) })
    await m!.settle("completed")
    expect(h.order).toEqual(["commit", "job:completed"])
  })

  it("C3: an unsettled settle leaves the job non-terminal, for the sweep", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    h.insertSyncJob.mockResolvedValue({ data: { id: JOB }, error: null })
    commitSpy().mockResolvedValue(undefined)
    const m = await meterSyncLlmMetered(fakeReq(), fakeReply() as unknown as FastifyReply, "object-llm-caption", {
      feature: "prompt-helper",
      calls: [{ modelId: "claude-fable-5", request: H1 }],
    })
    m!.spend.add("claude-fable-5", H1, { response: kieResp({ creditsUsd: 0.048 }) })
    await m!.settle("failed", "boom")
    expect(h.order.filter((o) => o.startsWith("job:"))).toEqual([])
  })

  it("rule 3: a 0 providerCost beside real tokens is recomputed, never free", () => {
    // Gemini 3.8 Flash KIE: 1000×0.225e-6 + 1000×1.125e-6 = 0.00135
    expect(llmAttemptCostUsd({ lane: "kie", modelId: "gemini-3.8-flash", requestChars: 1, inputTokens: 1000, outputTokens: 1000, providerCost: 0 })).toBeCloseTo(0.00135, 12)
    // a 0 with no tokens stays 0 (the floor then applies)
    expect(llmAttemptCostUsd({ lane: "kie", modelId: "gemini-3.8-flash", requestChars: 1, inputTokens: 0, outputTokens: 0, providerCost: 0 })).toBe(0)
  })

  it("a billed call whose cost cannot be computed commits the hold WHOLE through the metered commit, never refunds", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const commit = commitSpy().mockResolvedValue({ charged: 368, collectedOverHold: 0, shortfall: 0 })
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    const spend = new LlmSpend()
    // gemini-4-argon has no KIE rate: an answer on that lane cannot be costed.
    spend.add("gemini-4-argon", textReq("gemini-4-argon", 100), { response: kieResp({ usage: { inputTokens: 10, outputTokens: 10 } }) })
    expect(await settleLlmJob(JOB, meteredReserve("llm-chat:gemini-4-argon", 368), spend)).toEqual({ outcome: "charged", charged: 368, shortfall: 0 })
    expect(commit).toHaveBeenCalledWith(LOG, 368, { collectOverHold: true })
    expect(refund).not.toHaveBeenCalled()
    const jobUpdates = h.ops.filter((o) => o.table === "jobs" && o.op === "update").map((o) => o.values as Record<string, unknown>)
    expect(jobUpdates).toEqual([{ credits_actual: 368 }, { llm_billing: { costUsd: null, source: "uncomputable", calls: 1, lanes: ["kie"], chargeId: "llm-chat:gemini-4-argon" } }])
  })

  it("a whole-hold commit with no receipt is unsettled: no credits_actual, the ledger still marks the job billed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    commitSpy().mockResolvedValue(undefined)
    const spend = new LlmSpend()
    spend.add("gemini-4-argon", textReq("gemini-4-argon", 100), { response: kieResp({ usage: { inputTokens: 10, outputTokens: 10 } }) })
    expect(await settleLlmJob(JOB, meteredReserve("llm-chat:gemini-4-argon", 368), spend)).toEqual({ outcome: "unsettled" })
    const jobUpdates = h.ops.filter((o) => o.table === "jobs" && o.op === "update").map((o) => o.values as Record<string, unknown>)
    expect(jobUpdates.some((u) => "credits_actual" in u)).toBe(false)
    expect(jobUpdates).toEqual([{ llm_billing: { costUsd: null, source: "uncomputable", calls: 1, lanes: ["kie"], chargeId: "llm-chat:gemini-4-argon" } }])
  })

  it("an unreadable hold commits nothing and is unsettled (the sweep charges it)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const commit = commitSpy()
    const spend = new LlmSpend()
    spend.add("gemini-4-argon", textReq("gemini-4-argon", 100), { response: kieResp({ usage: { inputTokens: 10, outputTokens: 10 } }) })
    const { settleLlmUsageLog } = billing
    // no holdCredits, and usage_logs answers no row
    expect(await settleLlmUsageLog(LOG, JOB, "llm-chat:gemini-4-argon", spend)).toEqual({ outcome: "unsettled" })
    expect(commit).not.toHaveBeenCalled()
  })

  it("LlmSpend.add refuses a malformed outcome loudly (never a NaN charge)", () => {
    const spend = new LlmSpend()
    expect(() => spend.add("claude-fable-5", H1, { response: { text: "x", model: "m" } as never })).toThrow(TypeError)
    expect(() => spend.add("claude-fable-5", H1, { response: kieResp({ usage: { inputTokens: Number.NaN, outputTokens: 1 } }) })).toThrow(TypeError)
    expect(() => spend.add("claude-fable-5", H1, { output: { output: {}, inputTokens: 1, outputTokens: 1 } as never })).toThrow(TypeError)
    expect(() => spend.add("claude-fable-5", H1, { output: { attempts: [{ lane: "kie", modelId: "claude-fable-5", requestChars: 1, inputTokens: 1 }] } as never })).toThrow(TypeError)
    expect(() => spend.add("claude-fable-5", H1, {} as never)).toThrow(TypeError)
    expect(spend.billedAnything).toBe(false)
  })

  it("a billed failure is costed on the lane its adapter names (I4)", async () => {
    const { buildResponse } = await import("../../../lib/llm/response.js")
    const { getLlmModel } = await import("@nodaro/shared/llm-models")
    const opus = getLlmModel("claude-opus-5.5")!
    const refusal = (() => {
      try {
        buildResponse(opus, "", { stopReason: "refusal", cap: 1000, refusalFails: true }, { inputTokens: 1000, outputTokens: 50 }, undefined, "direct")
      } catch (err) {
        return err
      }
    })()
    expect(refusal).toBeInstanceOf(LlmContentRefusalError)
    expect((refusal as InstanceType<typeof LlmContentRefusalError>).lane).toBe("direct-anthropic")
    const truncated = (() => {
      try {
        buildResponse(opus, "partial", { stopReason: "max_tokens", cap: 1000 }, { inputTokens: 10, outputTokens: 1000 }, undefined, "kie")
      } catch (err) {
        return err
      }
    })()
    expect((truncated as { lane?: string }).lane).toBe("kie")

    // A KIE-primary Opus refused on the DIRECT fallback is billed at direct rates, not KIE's.
    const spend = new LlmSpend()
    spend.add("claude-opus-5.5", textReq("claude-opus-5.5", 4000), { error: refusal })
    expect(spend.attempts[0]!.lane).toBe("direct-anthropic")
    // direct Opus 5.5: 1000×4e-6 + 50×20e-6 = 0.005
    expect(spend.costUsd).toBeCloseTo(0.005, 12)
  })

  it("an unauthenticated metered reserve answers 401, never silence", async () => {
    const reply = fakeReply()
    const req = { ...fakeReq(), userId: undefined } as unknown as FastifyRequest
    expect(await reserveLlmCall(req, reply as unknown as FastifyReply, JOB, { feature: "llm-chat", calls: [{ modelId: "claude-fable-5", request: H1 }] })).toBeUndefined()
    expect(reply.statusCode).toBe(401)
    expect(reply.body).toMatchObject({ error: { code: "unauthorized" } })

    const reply2 = fakeReply()
    expect(await meterSyncLlmMetered(req, reply2 as unknown as FastifyReply, "object-llm-caption", { feature: "prompt-helper", calls: [{ modelId: "claude-fable-5", request: H1 }] })).toBeNull()
    expect(reply2.statusCode).toBe(401)
    expect(h.insertSyncJob).not.toHaveBeenCalled()
  })

  it("the precheck counts the body from its length (a 50M-char body builds no string)", async () => {
    const big = await llmPrecheckBaseCredits("llm-chat", { llmModel: "gemini-3.8-flash" }, 50_000_000)
    expect(big).toBeGreaterThan(await llmPrecheckBaseCredits("llm-chat", { llmModel: "gemini-3.8-flash" }, 1000) as number)
  })
})
