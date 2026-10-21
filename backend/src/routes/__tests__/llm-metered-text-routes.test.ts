// @test-units-by-name spies CreditsService's commit/refund only; prices no node unit
/**
 * Generate Text (llm-chat, both paths), AI Writer (both paths) and Prompt
 * Helper bill METERED (Task 8): each holds one attempt of the call it builds
 * (`reserveLlmCall`), records every call in an `LlmSpend`, and settles
 * through `settleLlmJob` — a completed call and a vendor-billed failure are
 * charged what they cost (`collectOverHold`), an unbilled failure is refunded.
 * Under `LLM_TIER_PRICING_ROLLBACK` every route reserves and commits its tier
 * id exactly as before.
 *
 * Figures at a 10% markup, CREDIT_BASE_USD = 0.002:
 *   usdToCredits(usd) = ceil(round(usd / 0.002 × 1000) / 1000); charged = ceil(base × 1.1)
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify from "fastify"
import { resolveLlmCreditId } from "@nodaro/shared/llm-models"

const JOB = "11111111-1111-4111-8111-111111111111"
const LOG = "22222222-2222-4222-8222-222222222222"

const h = vi.hoisted(() => {
  type Op = { table: string; op: "update" | "insert" | "delete"; values: Record<string, unknown>; filters: Array<[string, unknown]> }
  const ops: Op[] = []
  /** throwOnTerminal: a terminal jobs write throws. realSse: the routes open the REAL SSE stream (a real socket test). */
  const flags = { throwOnTerminal: false, realSse: false }
  /** The jobs row's output_data as the writes so far left it (what `writeJobBilling` reads back). */
  const jobOutput: { value: unknown } = { value: undefined }
  function createChain(table: string) {
    let current: Op | null = null
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "neq", "order", "limit", "in", "gte", "range"]) chain[m] = vi.fn(() => chain)
    chain.eq = vi.fn((col: string, val: unknown) => {
      current?.filters.push([col, val])
      return chain
    })
    chain.is = chain.eq
    chain.maybeSingle = vi.fn(async () => (table === "jobs" ? { data: { output_data: jobOutput.value }, error: null } : { data: null, error: null }))
    chain.single = chain.maybeSingle
    for (const op of ["update", "insert", "delete"] as const) {
      chain[op] = vi.fn((values?: Record<string, unknown>) => {
        if (flags.throwOnTerminal && table === "jobs" && typeof values?.status === "string") throw new Error("terminal write failed")
        current = { table, op, values: values ?? {}, filters: [] }
        ops.push(current)
        if (table === "jobs" && op === "update" && values && "output_data" in values) jobOutput.value = values.output_data
        return chain
      })
    }
    // markJobFailed reads `{ data: [{ id }] }` as "we flipped the row".
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve({ data: current?.op === "update" ? [{ id: "x" }] : null, error: null }).then(resolve, reject)
    return chain
  }
  const sse = {
    events: [] as Array<{ type: string; data: unknown }>,
    isClosed: false,
    sendEvent(e: { type: string; data: unknown }) {
      sse.events.push(e)
    },
    sendComment() {},
    close() {
      sse.isClosed = true
    },
  }
  return {
    ops,
    flags,
    jobOutput,
    sse,
    rollback: { value: false },
    guards: [] as Array<{ url: string; opts?: { computeCredits?: (body: unknown, req: unknown) => unknown } }>,
    from: vi.fn((table: string) => createChain(table)),
    reserveCreditsForJob: vi.fn(),
    llmComplete: vi.fn(),
    llmStream: vi.fn(),
    llmCompleteStructured: vi.fn(),
    markProviderCallStart: vi.fn(async () => undefined),
    /** R38: what the metered sync stamp's CAS answers (`not-live`: the job was cancelled since its reserve). */
    callStart: { value: "started" as "started" | "not-live" | "error" },
  }
})

vi.mock("../../lib/supabase.js", () => ({ supabase: { from: h.from, rpc: vi.fn(async () => ({ data: null, error: null })) } }))
vi.mock("../../lib/insert-job.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/insert-job.js")>()),
  insertSyncJob: vi.fn(async () => ({ data: { id: JOB }, error: null })),
}))
vi.mock("../../lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/config.js")>()
  return {
    ...actual,
    config: { ...actual.config, KIE_API_KEY: "kie", ANTHROPIC_API_KEY: "ant", EDITION: "cloud" },
    hasCredits: () => true,
    isCloud: () => true,
    isCommunity: () => false,
    isBusiness: () => false,
    hasAdmin: () => true,
    llmMeteredPricing: () => !h.rollback.value,
  }
})
vi.mock("../../middleware/credit-guard.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../middleware/credit-guard.js")>()),
  // Capture each route's guard options; the guard itself has its own suites.
  creditGuard: vi.fn((_resolver: unknown, opts?: { computeCredits?: (body: unknown, req: unknown) => unknown }) => {
    h.guards.push({ url: "", opts })
    return async () => undefined
  }),
  reserveCreditsForJob: h.reserveCreditsForJob,
}))
vi.mock("../../lib/app-settings.js", () => ({
  getAppSettings: vi.fn(async () => ({ ai_provider: "kie", cost_markup_percent: 10 })),
}))
vi.mock("../../lib/llm-client.js", () => ({
  llmComplete: h.llmComplete,
  llmStream: h.llmStream,
  llmCompleteStructured: h.llmCompleteStructured,
}))
vi.mock("../../lib/sse.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/sse.js")>()
  return {
    createSSEStream: vi.fn(async (req: Parameters<typeof actual.createSSEStream>[0], reply: Parameters<typeof actual.createSSEStream>[1]) =>
      h.flags.realSse ? actual.createSSEStream(req, reply) : h.sse),
  }
})
vi.mock("../../lib/reconcile/persistence.js", () => ({
  markProviderCallStart: h.markProviderCallStart,
  // R38: the metered sync stamp is a CAS — a live row here (the same spy records it).
  markProviderCallStartIfLive: async (...a: unknown[]) => (await (h.markProviderCallStart as (...x: unknown[]) => Promise<unknown>)(...a), h.callStart.value),
}))
vi.mock("../../lib/cloud-llm-proxy.js", () => ({
  maybeProxyLlmRouteToCloud: vi.fn(async () => false),
  maybeProxyLlmStreamToCloud: vi.fn(async () => false),
}))

const { llmChatRoutes } = await import("../llm-chat.js")
const { aiWriterRoutes } = await import("../ai-writer.js")
const { promptHelperRoutes } = await import("../prompt-helper.js")
const { CreditsService } = await import("../../ee/billing/credits.js")
const { llmHoldBaseCredits } = await import("../../ee/billing/llm-metered.js")
const { applyServiceMarkup } = await import("../../ee/billing/service-margin.js")
const { llmPrecheckBaseCredits } = await import("../../lib/llm-billing.js")
const { LlmContentRefusalError, LlmOutputTruncatedError, LlmStreamAbortedError } = await import("../../lib/llm-errors.js")
const { StructuredLlmError } = await import("../../lib/llm/structured.js")
type LlmRequest = import("../../lib/llm/types.js").LlmRequest

const MARKUP = { cost_markup_percent: 10 } as Parameters<typeof applyServiceMarkup>[1]

async function buildApp() {
  const app = Fastify()
  app.addHook("onRequest", async (req, reply) => {
    ;(req.raw as { setTimeout: (ms: number) => void }).setTimeout = () => {}
    ;(reply.raw as { setTimeout: (ms: number) => void }).setTimeout = () => {}
  })
  app.addHook("preHandler", async (req) => {
    ;(req as { userId?: string }).userId = "user-1"
  })
  await app.register(llmChatRoutes)
  await app.register(aiWriterRoutes)
  await app.register(promptHelperRoutes)
  await app.ready()
  return app
}

const jobUpdates = () => h.ops.filter((o) => o.table === "jobs" && o.op === "update").map((o) => o.values)
const terminalWrites = () => jobUpdates().filter((v) => v.status === "completed" || v.status === "failed")
const billingWrite = () => jobUpdates().find((v) => "credits_actual" in v)
/** The billing ledger the job got — in the server-only column, never in output_data (R32). */
const ledgerWrite = () => jobUpdates().find((v) => "llm_billing" in v)?.llm_billing
const outputDataBilling = () => jobUpdates().some((v) => "billing" in ((v.output_data as object | undefined) ?? {}))
const outputWrite = () => jobUpdates().find((v) => v.output_data !== undefined)

function textBody(chars: number, extra: Record<string, unknown> = {}) {
  return { systemPrompt: "", userInput: "a".repeat(chars), ...extra }
}

/** A KIE answer for Fable whose stated charge is 0.048 USD → 24 base → 27 charged. */
function fableKieResponse(text = "the answer") {
  return { text, model: "claude-fable-5", lane: "kie", usage: { inputTokens: 3, outputTokens: 400 }, creditsUsd: 0.048, providerCost: 0.048 }
}

function commitReturns(charged: number) {
  return vi.spyOn(CreditsService, "commitCredits").mockResolvedValue({ charged, collectedOverHold: 0, shortfall: 0 } as never)
}

beforeEach(() => {
  vi.restoreAllMocks()
  h.ops.length = 0
  h.jobOutput.value = undefined
  h.sse.events.length = 0
  h.sse.isClosed = false
  h.rollback.value = false
  h.flags.throwOnTerminal = false
  h.flags.realSse = false
  h.llmComplete.mockReset()
  h.llmStream.mockReset()
  h.llmCompleteStructured.mockReset()
  h.markProviderCallStart.mockClear()
  h.callStart.value = "started"
  h.reserveCreditsForJob.mockReset()
  h.reserveCreditsForJob.mockImplementation(async (_req: unknown, _reply: unknown, _job: unknown, _id: unknown, opts?: { holdCredits?: number }) => ({
    usageLogId: LOG,
    creditsReserved: opts?.holdCredits ?? 6,
    watermark: false,
  }))
  vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined as never)
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

const SYNC_ROUTES = [
  { feature: "llm-chat", url: "/v1/llm-chat/generate" },
  { feature: "ai-writer", url: "/v1/ai-writer/generate" },
] as const

describe("Generate Text / AI Writer, synchronous — metered", () => {
  it("llm-chat sync: Fable 8000 chars asked 2000 holds 368 and settles 27 for a stated 0.048", async () => {
    const commit = commitReturns(27)
    h.llmComplete.mockResolvedValueOnce(fableKieResponse())
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: textBody(8000, { maxTokens: 2000, llmModel: "claude-fable-5" }) })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: JOB, generatedText: "the answer" })
    // (a) the hold is one attempt of the request the lane was sent, marked up at the charge id.
    const sent = h.llmComplete.mock.calls[0]![0] as LlmRequest
    expect(applyServiceMarkup(llmHoldBaseCredits("claude-fable-5", { request: sent }), MARKUP, "llm-chat:claude-fable-5")).toBe(368)
    expect(h.reserveCreditsForJob).toHaveBeenCalledTimes(1)
    expect(h.reserveCreditsForJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), JOB, "llm-chat:claude-fable-5", { holdCredits: 368 })
    expect(h.markProviderCallStart).toHaveBeenCalledWith(JOB, "anthropic-sync")
    // (b) the settle's figure, collecting any overrun.
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith(LOG, 27, { collectOverHold: true })
    expect(CreditsService.refundCredits).not.toHaveBeenCalled()
  })

  it.each(SYNC_ROUTES)("$feature: output is written before the settle, the terminal write after it carries no output_data or provider_cost", async ({ feature, url }) => {
    commitReturns(27)
    h.llmComplete.mockResolvedValueOnce(fableKieResponse())
    const app = await buildApp()
    await app.inject({ method: "POST", url, payload: textBody(8000, { maxTokens: 2000, llmModel: "claude-fable-5" }) })

    const updates = jobUpdates()
    const billingAt = updates.findIndex((v) => "credits_actual" in v)
    const terminalAt = updates.findIndex((v) => v.status === "completed")
    expect(billingAt).toBeGreaterThan(0)
    expect(terminalAt).toBeGreaterThan(billingAt)
    expect(updates[terminalAt]).not.toHaveProperty("output_data")
    expect(updates[terminalAt]).not.toHaveProperty("provider_cost")
    // The answer the route wrote first; the settle's charge, then its ledger in the server-only column.
    expect(updates[0]).toMatchObject({ output_data: { generatedText: "the answer", model: "claude-fable-5" } })
    expect(billingWrite()).toMatchObject({ credits_actual: 27, provider_cost: 0.048 })
    expect(ledgerWrite()).toMatchObject({ costUsd: 0.048, source: "kie-stated", calls: 1, lanes: ["kie"] })
    expect(outputDataBilling()).toBe(false)
    expect(h.reserveCreditsForJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), JOB, `${feature}:claude-fable-5`, { holdCredits: 368 })
  })

  it.each(SYNC_ROUTES)("$feature: a billed failure is charged its usage and says so", async ({ url }) => {
    // direct-gemini truncation, providerCost 0.03 → 15 base → ceil(16.5) = 17
    const commit = commitReturns(17)
    h.llmComplete.mockRejectedValueOnce(new LlmOutputTruncatedError(
      "The answer was cut off: the model reached its 1100-token output limit before finishing",
      { inputTokens: 900, outputTokens: 1100, providerCost: 0.03, complete: true },
      "direct-gemini",
    ))
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url, payload: textBody(200, { llmModel: "gemini-3.8-flash", maxTokens: 1100 }) })

    expect(res.statusCode).toBe(502)
    expect(res.json().error.message).toMatch(/cut off/)
    expect(res.json().error.message).toMatch(/charged for the text the model wrote before it was cut off/)
    expect(commit).toHaveBeenCalledWith(LOG, 17, { collectOverHold: true })
    expect(CreditsService.refundCredits).not.toHaveBeenCalled()
    const failed = terminalWrites()
    expect(failed).toEqual([expect.objectContaining({ status: "failed" })])
    expect(String(failed[0]!.error_message)).toMatch(/charged/)
    expect(failed[0]).not.toHaveProperty("output_data")
    expect(failed[0]).not.toHaveProperty("provider_cost")
    // Recorded before the settle: the provider's sentence and the billed evidence; the charge is stated once confirmed.
    expect(jobUpdates()[0]).toMatchObject({ provider_cost: 0.03, output_data: { error: expect.stringMatching(/cut off/) } })
    expect(billingWrite()).toMatchObject({ credits_actual: 17, provider_cost: 0.03 })
  })

  it.each(SYNC_ROUTES)("$feature: an unbilled failure is refunded, with today's message", async ({ url }) => {
    const commit = vi.spyOn(CreditsService, "commitCredits")
    h.llmComplete.mockRejectedValueOnce(new Error("socket hang up"))
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url, payload: textBody(200, { llmModel: "claude-fable-5" }) })

    expect(res.statusCode).toBe(502)
    expect(res.json().error.message).not.toMatch(/charged/)
    expect(CreditsService.refundCredits).toHaveBeenCalledWith(LOG)
    expect(commit).not.toHaveBeenCalled()
    expect(terminalWrites()).toEqual([expect.objectContaining({ status: "failed" })])
  })

  it("an unconfirmed settle leaves the job non-terminal for the reconcile sweep (C3), and still answers", async () => {
    vi.spyOn(CreditsService, "commitCredits").mockResolvedValue(undefined as never)
    h.llmComplete.mockResolvedValueOnce(fableKieResponse())
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: textBody(8000, { maxTokens: 2000, llmModel: "claude-fable-5" }) })

    expect(res.statusCode).toBe(200)
    expect(terminalWrites()).toEqual([])
    expect(h.markProviderCallStart).toHaveBeenCalledWith(JOB, "anthropic-sync")
  })

  it("a settle that crashes before its ledger still leaves the sweep the evidence the call was billed", async () => {
    // The answer's provider cost is recorded with it, BEFORE the settle: the
    // sweep reads provider_cost > 0 as billed and charges the hold (R20).
    vi.spyOn(CreditsService, "commitCredits").mockRejectedValue(new Error("rpc down"))
    h.llmComplete.mockResolvedValueOnce(fableKieResponse())
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: textBody(8000, { maxTokens: 2000, llmModel: "claude-fable-5" }) })

    expect(res.statusCode).toBe(200)
    expect(jobUpdates()[0]).toMatchObject({ provider_cost: 0.048, output_data: { generatedText: "the answer" } })
    expect(jobUpdates()[0]).not.toHaveProperty("status")
    expect(terminalWrites()).toEqual([])
  })

  it("a billed failure whose settle is not confirmed never claims a charge", async () => {
    vi.spyOn(CreditsService, "commitCredits").mockResolvedValue(undefined as never)
    h.llmComplete.mockRejectedValueOnce(new LlmOutputTruncatedError(
      "The answer was cut off",
      { inputTokens: 900, outputTokens: 1100, providerCost: 0.03, complete: true },
      "direct-gemini",
    ))
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: textBody(200, { llmModel: "gemini-3.8-flash" }) })

    expect(res.statusCode).toBe(502)
    expect(res.json().error.message).not.toMatch(/charged/)
    // Left to the reconcile sweep, with the billed evidence.
    expect(terminalWrites()).toEqual([])
    expect(jobUpdates()[0]).toMatchObject({ provider_cost: 0.03 })
  })

  it("an answer the spend cannot record is never settled (no refund): its evidence is left to the sweep", async () => {
    const commit = vi.spyOn(CreditsService, "commitCredits")
    // No lane: LlmSpend.add refuses it.
    h.llmComplete.mockResolvedValueOnce({ ...fableKieResponse(), lane: undefined })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: textBody(8000, { maxTokens: 2000, llmModel: "claude-fable-5" }) })

    expect(res.statusCode).toBe(200)
    expect(commit).not.toHaveBeenCalled()
    expect(CreditsService.refundCredits).not.toHaveBeenCalled()
    expect(terminalWrites()).toEqual([])
    // provider_cost > 0 AND a billing ledger with calls: the sweep charges the hold (R20).
    expect(jobUpdates()[0]).toMatchObject({ provider_cost: 0.048, output_data: { generatedText: "the answer" } })
    expect(ledgerWrite()).toMatchObject({ costUsd: null, source: "uncomputable", calls: 1 })
    expect(outputDataBilling()).toBe(false)
  })

  it("R38: cancelled between its reserve and its call's stamp → the provider is never called, nothing is charged (the hold is refunded), 409", async () => {
    h.callStart.value = "not-live"
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    const commit = vi.spyOn(CreditsService, "commitCredits")
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: textBody(8000, { maxTokens: 2000, llmModel: "claude-fable-5" }) })
    expect(res.statusCode).toBe(409)
    expect(h.llmComplete).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
    expect(refund).toHaveBeenCalledWith(LOG)
    // No terminal write over the cancelled row.
    expect(h.ops.filter((o) => o.table === "jobs" && o.op === "update" && o.values.status === "completed")).toEqual([])
  })

  it("R38: the same for the streaming route — no stream opened, no call, refunded", async () => {
    h.callStart.value = "not-live"
    const refund = vi.spyOn(CreditsService, "refundCredits").mockResolvedValue(undefined)
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate-stream", payload: textBody(8000, { maxTokens: 2000, llmModel: "claude-fable-5" }) })
    expect(res.statusCode).toBe(409)
    expect(h.llmStream).not.toHaveBeenCalled()
    expect(refund).toHaveBeenCalledWith(LOG)
  })

  it("a refused reserve (402) never calls the lane or stamps the job", async () => {
    // The reserve's backstop sends the 400 and answers undefined.
    h.reserveCreditsForJob.mockImplementationOnce(async (_req: unknown, reply: { status: (n: number) => { send: (b: unknown) => void } }) => {
      reply.status(402).send({ error: { code: "insufficient_credits", message: "Needs up to 368 credits" } })
      return undefined
    })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: textBody(8000, { maxTokens: 2000, llmModel: "claude-fable-5" }) })
    expect(res.statusCode).toBe(402)
    expect(h.llmComplete).not.toHaveBeenCalled()
    expect(h.markProviderCallStart).not.toHaveBeenCalled()
  })
})

describe("Generate Text / AI Writer, streaming — metered", () => {
  const STREAM_ROUTES = [
    { feature: "llm-chat", url: "/v1/llm-chat/generate-stream" },
    { feature: "ai-writer", url: "/v1/ai-writer/generate-stream" },
  ] as const

  it.each(STREAM_ROUTES)("$feature: a finished stream settles metered and sends done", async ({ feature, url }) => {
    const commit = commitReturns(27)
    h.llmStream.mockImplementationOnce(async (_req: LlmRequest, onChunk: (d: string) => void) => {
      onChunk("the ")
      onChunk("answer")
      return fableKieResponse()
    })
    const app = await buildApp()
    await app.inject({ method: "POST", url, payload: textBody(8000, { maxTokens: 2000, llmModel: "claude-fable-5" }) })

    expect(h.reserveCreditsForJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), JOB, `${feature}:claude-fable-5`, { holdCredits: 368 })
    expect(commit).toHaveBeenCalledWith(LOG, 27, { collectOverHold: true })
    expect(billingWrite()).toMatchObject({ credits_actual: 27 })
    expect(outputWrite()).toMatchObject({ output_data: { generatedText: "the answer" } })
    expect(ledgerWrite()).toMatchObject({ calls: 1, lanes: ["kie"] })
    expect(outputDataBilling()).toBe(false)
    expect(terminalWrites()).toEqual([expect.objectContaining({ status: "completed" })])
    expect(h.sse.events.map((e) => e.type)).toEqual(["metadata", "token", "token", "done"])
  })

  it("charges the estimated usage of a stopped stream", async () => {
    // Opus 5.5 on KIE, 4000 request chars, 1200 chars streamed: in 1000, out 300
    // → 1000×1.6e-6 + 300×8e-6 = 0.004 USD → 2 base → ceil(2.2) = 3
    const commit = commitReturns(3)
    h.llmStream.mockImplementationOnce(async (_req: LlmRequest, onChunk: (d: string) => void) => {
      onChunk("b".repeat(1200))
      h.sse.isClosed = true
      throw new LlmStreamAbortedError(
        "The stream was aborted by the client",
        { inputTokens: 1000, outputTokens: 300, providerCost: 0.004, complete: false, estimated: true },
        "kie",
      )
    })
    const app = await buildApp()
    await app.inject({ method: "POST", url: "/v1/llm-chat/generate-stream", payload: textBody(4000, { llmModel: "claude-opus-5.5" }) })

    expect(commit).toHaveBeenCalledWith(LOG, 3, { collectOverHold: true })
    expect(CreditsService.refundCredits).not.toHaveBeenCalled()
    const failed = terminalWrites()
    expect(failed).toEqual([expect.objectContaining({ status: "failed" })])
    expect(String(failed[0]!.error_message)).toMatch(/stopped — charged for the text generated so far/)
    expect(billingWrite()).toMatchObject({ credits_actual: 3 })
    expect(ledgerWrite()).toMatchObject({ source: "abort-estimate", lanes: ["kie"] })
    expect(outputDataBilling()).toBe(false)
  })

  it("a stream stopped before dispatch is refunded", async () => {
    const commit = vi.spyOn(CreditsService, "commitCredits")
    h.llmStream.mockImplementationOnce(async () => {
      h.sse.isClosed = true
      throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" })
    })
    const app = await buildApp()
    await app.inject({ method: "POST", url: "/v1/llm-chat/generate-stream", payload: textBody(4000, { llmModel: "claude-opus-5.5" }) })

    expect(CreditsService.refundCredits).toHaveBeenCalledWith(LOG)
    expect(commit).not.toHaveBeenCalled()
    expect(String(terminalWrites()[0]!.error_message)).not.toMatch(/charged/)
  })

  it.each(STREAM_ROUTES)("$feature: a failure whose settling throws still sends the error and closes the stream", async ({ url }) => {
    commitReturns(17)
    h.flags.throwOnTerminal = true
    h.llmStream.mockRejectedValueOnce(new LlmOutputTruncatedError(
      "The answer was cut off",
      { inputTokens: 900, outputTokens: 1100, providerCost: 0.03, complete: true },
      "direct-gemini",
    ))
    const app = await buildApp()
    await app.inject({ method: "POST", url, payload: textBody(200, { llmModel: "gemini-3.8-flash" }) })

    expect(h.sse.events.map((e) => e.type)).toEqual(["metadata", "error"])
    expect(h.sse.isClosed).toBe(true)
  })

  it("ai-writer early-complete path (:296-307) settles metered", async () => {
    // The answer finished, but the client had already gone.
    const commit = commitReturns(27)
    h.llmStream.mockImplementationOnce(async () => {
      h.sse.isClosed = true
      return fableKieResponse()
    })
    const app = await buildApp()
    await app.inject({ method: "POST", url: "/v1/ai-writer/generate-stream", payload: textBody(8000, { maxTokens: 2000, llmModel: "claude-fable-5" }) })

    expect(commit).toHaveBeenCalledWith(LOG, 27, { collectOverHold: true })
    expect(terminalWrites()).toEqual([expect.objectContaining({ status: "completed" })])
    expect(h.sse.events.map((e) => e.type)).toEqual(["metadata"])
  })
})

describe("a real client disconnect (real socket, real SSE stream)", () => {
  /**
   * Streams `url` over a real socket and a real `createSSEStream`. The mocked
   * lane emits one token, then waits on the abort signal it was given. With
   * `disconnect`, the client aborts its fetch after the first token; without,
   * the lane finishes and the client reads to the end.
   */
  async function stream(url: string, body: Record<string, unknown>, disconnect: boolean) {
    h.flags.realSse = true
    const seen: { signal?: AbortSignal } = {}
    h.llmStream.mockImplementationOnce(async (_req: LlmRequest, onChunk: (d: string) => void, signal: AbortSignal) => {
      seen.signal = signal
      onChunk("b".repeat(1200))
      if (disconnect) {
        await new Promise<void>((resolve) => {
          if (signal.aborted) return resolve()
          signal.addEventListener("abort", () => resolve(), { once: true })
          setTimeout(resolve, 5000)
        })
      }
      // What a lane does on an abort after dispatch (Task 7): the estimate of what it streamed.
      if (signal.aborted) {
        throw new LlmStreamAbortedError(
          "The stream was aborted by the client",
          { inputTokens: 1000, outputTokens: 300, providerCost: 0.004, complete: false, estimated: true },
          "kie",
        )
      }
      return fableKieResponse("b".repeat(1200))
    })
    const app = await buildApp()
    await app.listen({ port: 0, host: "127.0.0.1" })
    try {
      const { port } = app.server.address() as import("node:net").AddressInfo
      const ac = new AbortController()
      const res = await fetch(`http://127.0.0.1:${port}${url}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      })
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let got = ""
      try {
        for (;;) {
          const r = await reader.read()
          if (r.done) break
          got += decoder.decode(r.value)
          if (disconnect && got.includes('"type":"token"')) {
            ac.abort()
            break
          }
        }
      } catch {
        // the aborted read
      }
      await vi.waitFor(() => expect(terminalWrites().length).toBeGreaterThan(0), { timeout: 5000 })
      return { seen, got }
    } finally {
      await app.close()
    }
  }

  it.each([
    { feature: "llm-chat", url: "/v1/llm-chat/generate-stream" },
    { feature: "ai-writer", url: "/v1/ai-writer/generate-stream" },
  ] as const)("$feature: the client leaving mid-stream aborts the lane's signal and is charged the D2 estimate", async ({ url }) => {
    // Opus 5.5 on KIE, 4000 request chars, 1200 streamed: 0.004 USD → 2 base → 3 charged
    const commit = commitReturns(3)
    const { seen } = await stream(url, textBody(4000, { llmModel: "claude-opus-5.5" }), true)

    expect(seen.signal?.aborted).toBe(true)
    expect(commit).toHaveBeenCalledWith(LOG, 3, { collectOverHold: true })
    expect(terminalWrites()).toEqual([expect.objectContaining({ status: "failed" })])
    expect(String(terminalWrites()[0]!.error_message)).toMatch(/stopped — charged for the text generated so far/)
  })

  it.each([
    { feature: "llm-chat", url: "/v1/llm-chat/generate-stream" },
    { feature: "ai-writer", url: "/v1/ai-writer/generate-stream" },
  ] as const)("$feature: a stream that finishes is never aborted — the request body being read is no disconnect", async ({ url }) => {
    const commit = commitReturns(27)
    const { seen, got } = await stream(url, textBody(8000, { maxTokens: 2000, llmModel: "claude-fable-5" }), false)

    expect(seen.signal?.aborted).toBe(false)
    expect(commit).toHaveBeenCalledWith(LOG, 27, { collectOverHold: true })
    expect(terminalWrites()).toEqual([expect.objectContaining({ status: "completed" })])
    expect(got).toContain('"type":"done"')
  })
})

describe("Prompt Helper — metered", () => {
  const ANALYZE = { action: "analyze", nodeType: "generate-image", prompt: "a cat in the rain" }
  const QUESTIONS = { questions: [{ category: "mood", label: "Mood", options: [{ value: "calm", label: "Calm" }], selected: null, allowCustom: true }] }

  it("holds one attempt of the wizard request it builds, and settles what the structured call cost", async () => {
    const commit = commitReturns(27)
    h.llmCompleteStructured.mockImplementationOnce(async (req: LlmRequest) => ({
      output: QUESTIONS,
      inputTokens: 3,
      outputTokens: 400,
      providerCost: 0.048,
      lane: "kie",
      attempts: [{ lane: "kie", modelId: "claude-fable-5", requestChars: 100, inputTokens: 3, outputTokens: 400, providerCost: 0.048, creditsUsd: 0.048 }],
      _req: req,
    }))
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/prompt-helper/wizard", payload: { ...ANALYZE, llmModel: "claude-fable-5" } })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ jobId: JOB, questions: QUESTIONS.questions })
    const sent = h.llmCompleteStructured.mock.calls[0]![0] as LlmRequest
    const hold = applyServiceMarkup(llmHoldBaseCredits("claude-fable-5", { request: sent }), MARKUP, "prompt-helper:claude-fable-5")
    expect(h.reserveCreditsForJob).toHaveBeenCalledWith(expect.anything(), expect.anything(), JOB, "prompt-helper:claude-fable-5", { holdCredits: hold })
    // The sweep's anchor, which the tier path never had.
    expect(h.markProviderCallStart).toHaveBeenCalledWith(JOB, "anthropic-sync")
    expect(commit).toHaveBeenCalledWith(LOG, 27, { collectOverHold: true })
    expect(billingWrite()).toMatchObject({ credits_actual: 27 })
    expect(outputWrite()).toMatchObject({ output_data: { questions: QUESTIONS.questions } })
    expect(ledgerWrite()).toMatchObject({ calls: 1 })
    expect(outputDataBilling()).toBe(false)
    const done = terminalWrites()
    expect(done).toEqual([expect.objectContaining({ status: "completed" })])
    expect(done[0]).not.toHaveProperty("output_data")
  })

  it("prompt-helper billed refusal (:288) is charged its usage, not the hold", async () => {
    // direct-gemini refusal, providerCost 0.01 → 5 base → ceil(5.5) = 6
    const commit = commitReturns(6)
    const refusal = new LlmContentRefusalError("Content policy violation", { inputTokens: 900, outputTokens: 0, providerCost: 0.01, complete: true }, "direct-gemini")
    h.llmCompleteStructured.mockRejectedValueOnce(new Error(refusal.message, { cause: refusal }))
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/prompt-helper/wizard", payload: { ...ANALYZE, llmModel: "gemini-3.8-flash" } })

    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    const hold = (h.reserveCreditsForJob.mock.calls[0]![4] as { holdCredits: number }).holdCredits
    expect(hold).not.toBe(6)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith(LOG, 6, { collectOverHold: true })
    expect(CreditsService.refundCredits).not.toHaveBeenCalled()
    expect(String(terminalWrites()[0]!.error_message)).toMatch(/charged, because the provider billed the request it refused/)
    expect(res.json().error.message).toMatch(/charged, because the provider billed the request it refused/)
    expect(res.json().error.message).not.toMatch(/before it stopped/)
  })

  it("an answer that failed validation after its retries is charged for the attempts billed (it used to be refunded)", async () => {
    // Two billed attempts on direct-gemini, 0.005 each → 0.01 → 5 base → ceil(5.5) = 6
    const commit = commitReturns(6)
    const attempt = { lane: "direct-gemini" as const, modelId: "gemini-3.8-flash", requestChars: 900, inputTokens: 300, outputTokens: 200, providerCost: 0.005 }
    h.llmCompleteStructured.mockRejectedValueOnce(new StructuredLlmError(
      "llm-structured: output failed schema validation after 2 attempts",
      { inputTokens: 600, outputTokens: 400, providerCost: 0.01, complete: true, attempts: [attempt, attempt] },
    ))
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/prompt-helper/wizard", payload: { ...ANALYZE, llmModel: "gemini-3.8-flash" } })

    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe("malformed_response")
    expect(res.json().error.message).toMatch(/charged for the attempts the provider billed/)
    expect(commit).toHaveBeenCalledWith(LOG, 6, { collectOverHold: true })
    expect(CreditsService.refundCredits).not.toHaveBeenCalled()
  })

  it("an unbilled failure is refunded", async () => {
    const commit = vi.spyOn(CreditsService, "commitCredits")
    h.llmCompleteStructured.mockRejectedValueOnce(new Error("upstream 503"))
    const app = await buildApp()
    await app.inject({ method: "POST", url: "/v1/prompt-helper/wizard", payload: { ...ANALYZE, llmModel: "claude-fable-5" } })

    expect(CreditsService.refundCredits).toHaveBeenCalledWith(LOG)
    expect(commit).not.toHaveBeenCalled()
    expect(terminalWrites()).toEqual([expect.objectContaining({ status: "failed" })])
  })
})

describe("the guard's pre-check", () => {
  /** Every guard's computeCredits, in registration order: llm-chat ×2, ai-writer ×2, prompt-helper ×1. */
  async function prechecks() {
    h.guards.length = 0
    const app = await buildApp()
    expect(h.guards).toHaveLength(5)
    return { app, compute: h.guards.map((g) => g.opts!.computeCredits!) }
  }

  it.each([
    { i: 0, feature: "llm-chat", url: "/v1/llm-chat/generate" },
    { i: 2, feature: "ai-writer", url: "/v1/ai-writer/generate" },
  ] as const)("$feature: a body with no maxTokens pre-checks the hold of the request the route sends (its 8192 default, never the model's ceiling)", async ({ i, url }) => {
    // Sonnet 4.6: a 16384 ceiling and no thinking floor, so an unresolved cap would show (Fable's floor hides it).
    commitReturns(5)
    h.llmComplete.mockResolvedValueOnce({ text: "ok", model: "claude-sonnet-4.6", lane: "kie", usage: { inputTokens: 3, outputTokens: 40 }, providerCost: 0.001 })
    const { app, compute } = await prechecks()
    const body = textBody(8000, { llmModel: "claude-sonnet-4.6" })
    await app.inject({ method: "POST", url, payload: body })
    const sent = h.llmComplete.mock.calls[0]![0] as LlmRequest
    expect(sent.maxTokens).toBe(8192)
    // The body's text is the whole request, so the pre-check IS the hold's base.
    expect(await compute[i]!(body, {})).toBe(llmHoldBaseCredits("claude-sonnet-4.6", { request: sent }))
    expect(await compute[i + 1]!(body, {})).toBe(llmHoldBaseCredits("claude-sonnet-4.6", { request: sent }))
  })

  it("prompt-helper pre-checks at the cap it sends: a body's maxTokens without Advanced mode is ignored, as the route ignores it", async () => {
    commitReturns(5)
    h.llmCompleteStructured.mockResolvedValueOnce({
      output: { prompt: "p" }, inputTokens: 3, outputTokens: 40, providerCost: 0.001, lane: "kie",
      attempts: [{ lane: "kie", modelId: "claude-sonnet-4.6", requestChars: 100, inputTokens: 3, outputTokens: 40, creditsUsd: 0.001 }],
    })
    const { app, compute } = await prechecks()
    const body = { action: "enhance", nodeType: "generate-image", prompt: "p".repeat(4000), llmModel: "claude-sonnet-4.6", maxTokens: 32768 }
    const res = await app.inject({ method: "POST", url: "/v1/prompt-helper/wizard", payload: body })
    expect(res.statusCode).toBe(200)
    const sent = h.llmCompleteStructured.mock.calls[0]![0] as LlmRequest
    const pre = await compute[4]!(body, {}) as number
    expect(pre).toBe(await compute[4]!({ ...body, maxTokens: undefined }, {}))
    // Its system prompt is built on the server, so the pre-check is at most the hold.
    expect(pre).toBeLessThanOrEqual(llmHoldBaseCredits("claude-sonnet-4.6", { request: sent }))
    expect(sent.maxTokens).toBe(8192)
    expect(pre).toBe(await llmPrecheckBaseCredits("prompt-helper", { llmModel: "claude-sonnet-4.6", maxTokens: 8192 }, 4000))
  })

  it("counts TEXT only, refuses nothing Zod will refuse, and is silent under the rollback", async () => {
    const { compute } = await prechecks()
    const body = { systemPrompt: "s".repeat(500), userInput: "u".repeat(7500), llmModel: "claude-fable-5", maxTokens: 2000, referenceImageUrls: ["https://x/" + "y".repeat(5000)] }
    for (const c of compute.slice(0, 4)) {
      expect(await c(body, {})).toBe(await llmPrecheckBaseCredits("llm-chat", { llmModel: "claude-fable-5", maxTokens: 2000 }, 8000))
      // A model the body cannot name is Zod's 400, never llm_model_unpriced.
      expect(await c({ ...body, llmModel: "claude-ghost-9" }, {})).toBeUndefined()
      // A cap above the schema's 32768 is Zod's 400 too, never a 402 priced at it.
      expect(await c({ ...body, maxTokens: 40_000 }, {})).toBeUndefined()
    }
    const wizard = { action: "enhance", nodeType: "generate-image", prompt: "p", llmModel: "claude-fable-5" }
    expect(await compute[4]!({ ...wizard, advancedMode: true, maxTokens: 40_000 }, {})).toBeUndefined()
    expect(await compute[4]!({ ...wizard, prompt: "p".repeat(6000) }, {})).toBeUndefined()
    h.rollback.value = true
    for (const c of compute) expect(await c(body, {})).toBeUndefined()
  })
})

describe("rollback (LLM_TIER_PRICING_ROLLBACK)", () => {
  it("rollback reserves the tier id exactly as before", async () => {
    h.rollback.value = true
    const commit = vi.spyOn(CreditsService, "commitCredits").mockResolvedValue(undefined as never)
    h.llmComplete.mockResolvedValueOnce(fableKieResponse())
    const body = textBody(8000, { maxTokens: 2000, llmModel: "claude-fable-5" })
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/llm-chat/generate", payload: body })

    expect(res.statusCode).toBe(200)
    expect(h.reserveCreditsForJob).toHaveBeenCalledTimes(1)
    // The 4-argument call of today: the tier id, no hold.
    expect(h.reserveCreditsForJob.mock.calls[0]).toHaveLength(4)
    expect(h.reserveCreditsForJob.mock.calls[0]![3]).toBe(resolveLlmCreditId("llm-chat", body))
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit.mock.calls[0]).toEqual([LOG])
    // Today's single completion write: output, provider cost and status together.
    expect(jobUpdates()).toEqual([expect.objectContaining({ status: "completed", provider_cost: 0.048, output_data: expect.objectContaining({ generatedText: "the answer" }) })])
  })

  it.each([
    { feature: "ai-writer", url: "/v1/ai-writer/generate" },
    { feature: "llm-chat", url: "/v1/llm-chat/generate-stream" },
    { feature: "ai-writer", url: "/v1/ai-writer/generate-stream" },
  ] as const)("rollback: $url reserves its tier id and commits it plainly", async ({ feature, url }) => {
    h.rollback.value = true
    const commit = vi.spyOn(CreditsService, "commitCredits").mockResolvedValue(undefined as never)
    h.llmComplete.mockResolvedValueOnce(fableKieResponse())
    h.llmStream.mockResolvedValueOnce(fableKieResponse())
    const body = textBody(8000, { maxTokens: 2000, llmModel: "claude-fable-5" })
    const app = await buildApp()
    await app.inject({ method: "POST", url, payload: body })

    expect(h.reserveCreditsForJob.mock.calls[0]).toHaveLength(4)
    expect(h.reserveCreditsForJob.mock.calls[0]![3]).toBe(resolveLlmCreditId(feature, body))
    expect(commit.mock.calls).toEqual([[LOG]])
  })

  it("rollback: prompt-helper reserves its tier id, gains no sweep stamp, and refunds an unbilled failure plainly", async () => {
    h.rollback.value = true
    h.llmCompleteStructured.mockRejectedValueOnce(new Error("upstream 503"))
    const body = { action: "analyze", nodeType: "generate-image", prompt: "x", llmModel: "claude-fable-5" }
    const app = await buildApp()
    await app.inject({ method: "POST", url: "/v1/prompt-helper/wizard", payload: body })

    expect(h.reserveCreditsForJob.mock.calls[0]).toHaveLength(4)
    expect(h.reserveCreditsForJob.mock.calls[0]![3]).toBe(resolveLlmCreditId("prompt-helper", body))
    expect(h.markProviderCallStart).not.toHaveBeenCalled()
    expect(CreditsService.refundCredits).toHaveBeenCalledWith(LOG)
  })
})
