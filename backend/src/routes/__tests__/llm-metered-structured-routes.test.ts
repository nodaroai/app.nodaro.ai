// @test-units-by-name names no node type: it settles the structured + picker routes' usage logs through CreditsService
/**
 * Task 9 — the structured + picker routes bill METERED (D1): POST /v1/llm/structured
 * (sync), POST /v1/llm/structured/jobs (D5's video bound), POST /v1/text-to-picker
 * (one hold per parallel batch) and POST /v1/describe-to-picker (the Gemini
 * fallback collected at settle). Claude Fable 5 — Studio Director's default — is
 * offered on all of them again.
 *
 * The hold math and the settle are REAL (`lib/llm-billing.ts`, `ee/billing/llm-metered.ts`,
 * `ee/billing/llm-billing-impl.ts`); only the edges are stubbed: the reservation
 * RPC (`reserveCreditsForJob`), the commit/refund RPCs (`CreditsService`), the
 * LLM client, the DB and the 10% global markup.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { z } from "zod"

const h = vi.hoisted(() => ({
  state: { rollback: false },
  insertJob: vi.fn(),
  guard: vi.fn(),
  reserve: vi.fn(),
  commitTier: vi.fn(),
  commitTierAtPrice: vi.fn(),
  refundTier: vi.fn(),
  markProviderCallStart: vi.fn(),
  llmCompleteStructured: vi.fn(),
  llmStreamStructured: vi.fn(),
  prefetchAsBase64: vi.fn(),
  queueAdd: vi.fn(),
  readOwnAnalysisChild: vi.fn(),
  stampAnalysisChild: vi.fn(),
  discardUnstartedJob: vi.fn(),
  /** Every DB write, in order: `{ table, op, row }`. */
  writes: [] as Array<{ table: string; op: string; row?: Record<string, unknown> }>,
}))

vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/config.js")>()
  return {
    ...actual,
    config: { ...actual.config, EDITION: "cloud", ANTHROPIC_API_KEY: "test-key", KIE_API_KEY: "test-kie" },
    hasCredits: () => true,
    isCloud: () => true,
    isCommunity: () => false,
    isBusiness: () => false,
    hasAdmin: () => true,
    llmMeteredPricing: () => !h.state.rollback,
  }
})
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: vi.fn(async () => ({ ai_provider: "kie", cost_markup_percent: 10 })) }))
vi.mock("@/lib/cloud-llm-proxy.js", () => ({ maybeProxyLlmRouteToCloud: vi.fn(async () => false), shouldProxyLlmToCloud: vi.fn(async () => false) }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: h.insertJob, insertSyncJob: h.insertJob }))
vi.mock("@/middleware/credit-guard.js", () => ({
  // Runs the route's resolver AND its metered pre-check, records both, lets the request through.
  creditGuard: (resolve: (req: unknown) => string, opts?: { computeCredits?: (body: unknown, req: unknown) => unknown }) =>
    async (req: { body: unknown }) => { h.guard(resolve(req), await opts?.computeCredits?.(req.body, req)) },
  reserveCreditsForJob: h.reserve,
}))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({
  commitReservedCreditsForJob: h.commitTier,
  commitReservedCreditsForJobAtPrice: h.commitTierAtPrice,
  refundReservedCreditsForJob: h.refundTier,
}))
vi.mock("@/lib/reconcile/persistence.js", () => ({
  markProviderCallStart: h.markProviderCallStart,
  // R38: the metered sync stamp is a CAS — a live row here (the same spy records it).
  markProviderCallStartIfLive: async (...a: unknown[]) => (await (h.markProviderCallStart as (...x: unknown[]) => Promise<unknown>)(...a), "started"),
}))
vi.mock("@/lib/llm-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/llm-client.js")>()),
  llmCompleteStructured: h.llmCompleteStructured,
  llmStreamStructured: h.llmStreamStructured,
}))
vi.mock("@/lib/anthropic-image.js", () => ({ prefetchAsBase64: h.prefetchAsBase64 }))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: vi.fn(async () => {}) }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: h.queueAdd }, tryRemoveFromQueue: vi.fn(), redis: {} }))
vi.mock("@/lib/llm-structured-job-row.js", () => ({
  readOwnAnalysisChild: h.readOwnAnalysisChild,
  stampAnalysisChild: h.stampAnalysisChild,
  discardUnstartedJob: h.discardUnstartedJob,
}))
vi.mock("@/lib/supabase.js", () => {
  /** A chain whose every link returns itself and which resolves to `result`. */
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {}
    for (const m of ["eq", "in", "is", "neq", "select", "order", "limit", "maybeSingle", "single"]) c[m] = () => c
    c.then = (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) => Promise.resolve(result).then(ok, err)
    return c
  }
  return {
    supabase: {
      from: (table: string) => ({
        update: (row: Record<string, unknown>) => { h.writes.push({ table, op: "update", row }); return chain({ data: [{ id: "job-1" }], error: null }) },
        select: () => chain({ data: table === "jobs" ? { output_data: {} } : null, error: null }),
        delete: () => { h.writes.push({ table, op: "delete" }); return chain({ data: null, error: null }) },
      }),
      rpc: vi.fn(async () => ({ data: null, error: null })),
    },
  }
})

import { PICKER_ANALYZER_FAMILIES, type PickerType } from "@nodaro/prompts/picker-catalogs"
import { CreditsService } from "../../ee/billing/credits.js"
import { llmHoldBaseCredits } from "../../ee/billing/llm-metered.js"
import { StructuredLlmError, structuredJsonSchema } from "../../lib/llm/structured.js"
import { LlmContentRefusalError } from "../../lib/llm-errors.js"
import {
  LLM_ANALYSIS_CHARS_PER_SECOND,
  composeStructuredAnalysisInput,
  llmStructuredVideoBound,
  plannedStructuredCall,
} from "../../lib/llm-structured-request.js"
import { composeAnalysisInput } from "../../workers/handlers/llm-structured.js"
import { chargedFailureMessage, llmPrecheckBody, llmTextChars } from "../../lib/llm-metered-route.js"
import { llmStructuredRoutes } from "../llm-structured.js"
import { llmStructuredJobsRoutes } from "../llm-structured-jobs.js"
import { batchTargetPickers, textToPickerRoutes } from "../text-to-picker.js"
import { EMPTY_PICKER_READ_MESSAGE, describeToPickerRoutes, emptyPickerReadChargedMessage } from "../describe-to-picker.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"
const LOG = "log-1"
const SCHEMA = { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false }
const INPUT = "A rainy chase through Rome."
/** The schema exactly as the forced-tool call renders it — counted in the hold. */
const RENDERED_SCHEMA_CHARS = JSON.stringify(structuredJsonSchema(z.fromJSONSchema(SCHEMA as Parameters<typeof z.fromJSONSchema>[0]))).length
/** A system prompt that makes system + input + rendered schema exactly 30,000 ASCII characters (H3). */
const SYSTEM_30K = "a".repeat(30_000 - INPUT.length - RENDERED_SCHEMA_CHARS)
/** Studio Director's draft: Fable 5, a legend-sized prompt, asked 16,384 tokens. */
const DIRECTOR = { system: SYSTEM_30K, input: INPUT, jsonSchema: SCHEMA, llmModel: "claude-fable-5", maxTokens: 16384, userId: USER_ID }

/** One structured answer whose single attempt states KIE's charge (`creditsUsd`, rule 1). */
function answer(output: unknown, modelId: string, creditsUsd: number) {
  return {
    output, inputTokens: 10, outputTokens: 500, providerCost: creditsUsd, lane: "kie" as const, usageComplete: true,
    attempts: [{ lane: "kie" as const, modelId, requestChars: 1000, inputTokens: 10, outputTokens: 500, creditsUsd }],
  }
}

/** A failed structured call that billed `creditsUsd` on KIE (its answers never validated). */
function billedFailure(modelId: string, creditsUsd: number) {
  return new StructuredLlmError("The answer never matched the schema", {
    inputTokens: 10, outputTokens: 500, providerCost: creditsUsd, complete: true,
    attempts: [{ lane: "kie", modelId, requestChars: 1000, inputTokens: 10, outputTokens: 500, creditsUsd }],
  }, { lane: "kie" })
}

const commit = vi.spyOn(CreditsService, "commitCredits")
const refund = vi.spyOn(CreditsService, "refundCredits")

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  h.writes.length = 0
  h.state.rollback = false
  h.insertJob.mockResolvedValue({ data: { id: "job-1" }, error: null })
  h.reserve.mockResolvedValue({ usageLogId: LOG, creditsReserved: 1, watermark: false })
  h.markProviderCallStart.mockResolvedValue(undefined)
  h.queueAdd.mockResolvedValue({ id: "bull-1" })
  h.prefetchAsBase64.mockResolvedValue({ type: "image_base64", mediaType: "image/jpeg", data: "AAAA" })
  commit.mockImplementation(async (_log: string, credits?: number) => ({ charged: credits ?? 0, shortfall: 0 }) as never)
  refund.mockResolvedValue(undefined as never)

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  app.post("/v1/video-analysis", async () => ({ jobId: "child-1" }))
  await app.register(async (i) => {
    await llmStructuredRoutes(i)
    await llmStructuredJobsRoutes(i)
    await textToPickerRoutes(i)
    await describeToPickerRoutes(i)
  })
  await app.ready()
})
afterEach(async () => { await app.close() })

const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url, payload })

/** The reservation the route made: `[jobId, creditId, options]`. */
const reserved = () => h.reserve.mock.calls.map((c) => [c[2], c[3], c[4]])
const statusWrites = () => h.writes.filter((w) => w.table === "jobs" && w.row && "status" in w.row).map((w) => w.row!.status)

describe("POST /v1/llm/structured — metered", () => {
  it("accepts claude-fable-5 on /v1/llm/structured (Studio Director default) and holds 383", async () => {
    // H3: 30,000 chars → 10,000 input tokens; output 32,768 (Fable's effective cap);
    // KIE: 0.04 + 0.65536 = 0.69536 USD → 348 base → ceil(382.8) = 383 charged.
    const planned = plannedStructuredCall(
      { modelId: "claude-fable-5", system: SYSTEM_30K, messages: [{ role: "user", content: INPUT }], maxTokens: 16384, timeoutMs: 240_000 },
      z.fromJSONSchema(SCHEMA as Parameters<typeof z.fromJSONSchema>[0]),
    )
    expect(llmHoldBaseCredits("claude-fable-5", planned)).toBe(348)
    h.llmCompleteStructured.mockResolvedValue(answer({ title: "Rain in Rome" }, "claude-fable-5", 0.048))

    const res = await post("/v1/llm/structured", DIRECTOR)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ jobId: "job-1", output: { title: "Rain in Rome" } })
    expect(reserved()).toEqual([["job-1", "llm-structured:claude-fable-5", { holdCredits: 383 }]])
    // The guard pre-checked a metered figure (base credits), not the tier row.
    expect(typeof h.guard.mock.calls[0][1]).toBe("number")
    // Settled at the actual: 0.048 → 24 base → ceil(26.4) = 27, collecting over the hold if needed.
    expect(commit).toHaveBeenCalledWith(LOG, 27, { collectOverHold: true })
    expect(h.commitTier).not.toHaveBeenCalled()
    expect(statusWrites()).toEqual(["completed"])
    // The settle records the charge, and its ledger in the server-only column —
    // never in output_data, which the job's owner can read.
    const chargeWrite = h.writes.findIndex((w) => w.row && "credits_actual" in w.row)
    expect(h.writes[chargeWrite].row).toMatchObject({ credits_actual: 27 })
    expect(h.writes.find((w) => w.row && "llm_billing" in w.row)?.row).toMatchObject({ llm_billing: { calls: 1, lanes: ["kie"] } })
    expect(h.writes.some((w) => w.row && "output_data" in w.row && "__billing" in (w.row.output_data as Record<string, unknown>))).toBe(false)
    expect(h.writes.some((w) => w.row && "output_data" in w.row && "billing" in (w.row.output_data as Record<string, unknown>))).toBe(false)
  })

  it("a billed failure is charged its usage, and the message says so", async () => {
    h.llmCompleteStructured.mockRejectedValue(billedFailure("claude-fable-5", 0.01))
    const res = await post("/v1/llm/structured", DIRECTOR)
    expect(res.statusCode).toBe(502)
    // 0.01 → 5 base → ceil(5.5) = 6
    expect(commit).toHaveBeenCalledWith(LOG, 6, { collectOverHold: true })
    expect(refund).not.toHaveBeenCalled()
    expect(res.json().error.message).toContain("Charged 6 credits")
    expect(statusWrites()).toEqual(["failed"])
  })

  it("an unbilled failure (a transport error) is refunded", async () => {
    h.llmCompleteStructured.mockRejectedValue(Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" }))
    const res = await post("/v1/llm/structured", DIRECTOR)
    expect(res.statusCode).toBe(502)
    expect(refund).toHaveBeenCalledWith(LOG)
    expect(commit).not.toHaveBeenCalled()
    expect(res.json().error.message).not.toContain("Charged")
  })

  it("an unsettled commit leaves the row non-terminal for the sweep, and still answers", async () => {
    commit.mockResolvedValue(undefined as never)
    h.llmCompleteStructured.mockResolvedValue(answer({ title: "x" }, "claude-fable-5", 0.048))
    const res = await post("/v1/llm/structured", DIRECTOR)
    expect(res.statusCode).toBe(200)
    expect(h.markProviderCallStart).toHaveBeenCalledWith("job-1", "anthropic-sync")
    expect(statusWrites()).toEqual([])
  })
})

describe("POST /v1/llm/structured/jobs — metered, the D5 video bound", () => {
  it("a story run holds the call alone", async () => {
    const res = await post("/v1/llm/structured/jobs", DIRECTOR)
    expect(res.statusCode).toBe(200)
    expect(reserved()).toEqual([["job-1", "llm-structured:claude-fable-5", { holdCredits: 383 }]])
    expect(h.queueAdd.mock.calls[0][1]).toMatchObject({ jobId: "job-1", usageLogId: LOG })
  })

  it("llm-structured jobs + videoUrl holds the 600 s analysis bound: 427", async () => {
    // 30000 + 600×100 = 90000 chars → 30000 tokens; 30000×4e-6 + 32768×20e-6 =
    // 0.12 + 0.65536 = 0.77536 → 387.68 → 388 base → ceil(426.8) = 427
    expect(llmStructuredVideoBound({ input: INPUT, videoUrl: "https://r2.example/clip.mp4" })).toEqual({ extraChars: 600 * LLM_ANALYSIS_CHARS_PER_SECOND })
    const res = await post("/v1/llm/structured/jobs", { ...DIRECTOR, videoUrl: "https://r2.example/clip.mp4" })
    expect(res.statusCode).toBe(200)
    expect(reserved()).toEqual([["job-1", "llm-structured:claude-fable-5", { holdCredits: 427 }]])
    // The hold exists BEFORE the child (spec D16), and the child keeps its own price.
    expect(h.reserve.mock.invocationCallOrder[0]).toBeLessThan(h.stampAnalysisChild.mock.invocationCallOrder[0])
  })

  it("llm-structured jobs + analysisJobId bounds by the analysis's own chars", async () => {
    const analysis = {
      meta: { durationSec: 12, width: 1920, height: 1080, aspectRatio: "16:9", title: "Clip" },
      slots: [],
      scenes: [{ startSec: 0, endSec: 4, label: "Hook", shotType: "Medium Close-Up", camera: "push-in", visual: "waves ".repeat(2000), audio: [], sceneNumber: 1, visualResolved: "waves", slotRefs: [] }],
      warnings: [],
    }
    h.readOwnAnalysisChild.mockResolvedValue({ id: "a1", job_type: "video-analysis", status: "completed", output_data: { json: analysis }, credits: 60, user_id: USER_ID })
    // The hold reads exactly what the worker will draft from.
    expect(composeStructuredAnalysisInput(INPUT, analysis as never)).toBe(composeAnalysisInput(INPUT, analysis as never))
    const extra = llmStructuredVideoBound({ input: INPUT, analysisJobId: "00000000-0000-4000-8000-00000000a001" }, analysis as never).extraChars
    expect(extra).toBe(composeAnalysisInput(INPUT, analysis as never).length - INPUT.length)

    const res = await post("/v1/llm/structured/jobs", { ...DIRECTOR, analysisJobId: "00000000-0000-4000-8000-00000000a001" })
    expect(res.statusCode).toBe(200)
    // 30,000 + extra chars at 3 per token; output 32,768; KIE rates; 10% markup.
    const inTokens = Math.ceil((30_000 + extra) / 3)
    const base = Math.ceil(Math.round(((inTokens * 4e-6 + 32768 * 20e-6) / 0.002) * 1000) / 1000)
    const hold = reserved()[0][2] as { holdCredits: number }
    expect(hold.holdCredits).toBe(Math.ceil(base * 1.1))
    // Far below the 600 s bound: a 12 s analysis is not held as a 10-minute one.
    expect(hold.holdCredits).toBeLessThan(427)
  })
})

describe("POST /v1/text-to-picker — metered", () => {
  /** Three families, together above the batching threshold, so the run is exactly three batches. */
  const families = Object.values(PICKER_ANALYZER_FAMILIES).slice(0, 3) as PickerType[][]
  const targetPickers = families.flat()

  it("text-to-picker: three batches each held once, settled as their sum", async () => {
    const batches = batchTargetPickers(targetPickers)
    expect(batches).toHaveLength(3)
    h.llmCompleteStructured
      .mockResolvedValueOnce(answer({}, "gemini-3.8-flash", 0.01))
      .mockResolvedValueOnce(answer({}, "gemini-3.8-flash", 0.02))
      .mockResolvedValueOnce(answer({}, "gemini-3.8-flash", 0.03))

    const res = await post("/v1/text-to-picker", { text: "A neon alley at night.", targetPickers, userId: USER_ID })

    expect(res.statusCode).toBe(200)
    // One reservation, holding the SUM of three 1-attempt holds — each batch's own request.
    const sent = h.llmCompleteStructured.mock.calls.map((c) => plannedStructuredCall(c[0], c[1], c[2]?.schemaName))
    const sum = sent.reduce((s, call) => s + llmHoldBaseCredits("gemini-3.8-flash", call), 0)
    expect(reserved()).toEqual([["job-1", "text-to-picker:gemini-3.8-flash", { holdCredits: Math.ceil(sum * 1.1) }]])
    expect(sum).toBeGreaterThan(llmHoldBaseCredits("gemini-3.8-flash", sent[0]))
    // Settled as their sum: 0.06 → 30 base → 33.
    expect(commit).toHaveBeenCalledWith(LOG, 33, { collectOverHold: true })
    expect(statusWrites()).toEqual(["completed"])
  })

  it("a batch that failed after others answered: every billed batch is charged", async () => {
    h.llmCompleteStructured
      .mockResolvedValueOnce(answer({}, "gemini-3.8-flash", 0.01))
      .mockRejectedValueOnce(billedFailure("gemini-3.8-flash", 0.02))
      .mockResolvedValueOnce(answer({}, "gemini-3.8-flash", 0.03))
    const res = await post("/v1/text-to-picker", { text: "A neon alley at night.", targetPickers, userId: USER_ID })
    expect(res.statusCode).toBe(502)
    expect(commit).toHaveBeenCalledWith(LOG, 33, { collectOverHold: true })
    expect(statusWrites()).toEqual(["failed"])
  })

  it("accepts claude-fable-5", async () => {
    h.llmCompleteStructured.mockResolvedValue(answer({}, "claude-fable-5", 0.01))
    const res = await post("/v1/text-to-picker", { text: "x", targetPickers: ["person"], llmModel: "claude-fable-5", userId: USER_ID })
    expect(res.statusCode).toBe(200)
    expect(reserved()[0][1]).toBe("text-to-picker:claude-fable-5")
  })
})

describe("POST /v1/describe-to-picker — metered", () => {
  const BODY = { imageUrl: "https://r2.example/p.jpg", targetPickers: ["person"], userId: USER_ID }

  it("holds the requested model's read only — the image counted as one image, never its bytes", async () => {
    h.llmCompleteStructured.mockResolvedValue(answer({ person: { age: "age-early-20s" } }, "gemini-3.8-flash", 0.004))
    const res = await post("/v1/describe-to-picker", BODY)
    expect(res.statusCode).toBe(200)
    expect(reserved()[0][1]).toBe("describe-to-picker:gemini-3.8-flash")
    // 0.004 → 2 base → ceil(2.2) = 3
    expect(commit).toHaveBeenCalledWith(LOG, 3, { collectOverHold: true })
    expect(h.commitTierAtPrice).not.toHaveBeenCalled()
  })

  it("describe-to-picker: a paid Claude failure + Gemini fallback settles both reads (30)", async () => {
    // Opus 5.5's KIE answers never validated (billed 0.05) → the Gemini fallback answers (0.004):
    // 0.054 → 27 base → ceil(29.7) = 30, under the requested model's charge id.
    h.llmCompleteStructured
      .mockRejectedValueOnce(billedFailure("claude-opus-5.5", 0.05))
      .mockResolvedValueOnce(answer({ person: { age: "age-early-20s" } }, "gemini-3.8-flash", 0.004))
    const res = await post("/v1/describe-to-picker", { ...BODY, llmModel: "claude-opus-5.5" })
    expect(res.statusCode).toBe(200)
    expect(h.llmCompleteStructured).toHaveBeenCalledTimes(2)
    // The hold is the Claude read alone: the fallback is collected at settle (D1).
    expect(h.reserve).toHaveBeenCalledTimes(1)
    expect(reserved()[0][1]).toBe("describe-to-picker:claude-opus-5.5")
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith(LOG, 30, { collectOverHold: true })
    expect(h.commitTierAtPrice).not.toHaveBeenCalled()
  })

  it("a billed content refusal is charged its usage", async () => {
    h.llmCompleteStructured.mockRejectedValue(new LlmContentRefusalError("refused", { inputTokens: 10, outputTokens: 5, creditsUsd: 0.01, complete: true }, "kie"))
    const res = await post("/v1/describe-to-picker", { ...BODY, llmModel: "claude-opus-5.5" })
    expect(res.statusCode).toBe(502)
    expect(commit).toHaveBeenCalledWith(LOG, 6, { collectOverHold: true })
  })

  it("an empty read the vendor billed is charged its usage (§8.1), and the message says so", async () => {
    h.llmCompleteStructured.mockResolvedValue(answer({ person: {} }, "gemini-3.8-flash", 0.004))
    const res = await post("/v1/describe-to-picker", BODY)
    expect(res.statusCode).toBe(502)
    // 0.004 → 2 base → ceil(2.2) = 3
    expect(commit).toHaveBeenCalledWith(LOG, 3, { collectOverHold: true })
    expect(refund).not.toHaveBeenCalled()
    expect(res.json().error.message).toBe(
      "We couldn't read anything in this photo — try a clearer photo of one person. You were charged 3 credits for the model's attempt.")
    expect(res.json().error.message).toBe(emptyPickerReadChargedMessage(3))
    expect(h.writes.find((w) => w.row?.status === "failed")?.row?.error_message).toBe(emptyPickerReadChargedMessage(3))
    // The settle recorded what the read cost (provider_cost) with its ledger.
    expect(h.writes.some((w) => w.row?.provider_cost === 0.004)).toBe(true)
  })

  it("an empty read the vendor billed NOTHING for is refunded with today's message", async () => {
    h.llmCompleteStructured.mockResolvedValue({
      output: { person: {} }, inputTokens: 0, outputTokens: 0, lane: "kie", usageComplete: true,
      attempts: [{ lane: "kie", modelId: "gemini-3.8-flash", requestChars: 1000, inputTokens: 0, outputTokens: 0 }],
    })
    const res = await post("/v1/describe-to-picker", BODY)
    expect(res.statusCode).toBe(502)
    expect(res.json().error.message).toBe(EMPTY_PICKER_READ_MESSAGE)
    expect(refund).toHaveBeenCalledWith(LOG)
    expect(commit).not.toHaveBeenCalled()
  })

  it("accepts claude-fable-5", async () => {
    h.llmCompleteStructured.mockResolvedValue(answer({ person: { age: "age-early-20s" } }, "claude-fable-5", 0.02))
    const res = await post("/v1/describe-to-picker", { ...BODY, llmModel: "claude-fable-5" })
    expect(res.statusCode).toBe(200)
    expect(reserved()[0][1]).toBe("describe-to-picker:claude-fable-5")
  })
})

describe("rollback (LLM_TIER_PRICING_ROLLBACK)", () => {
  it("rollback: structured routes reserve the tier id as before", async () => {
    h.state.rollback = true
    h.llmCompleteStructured.mockResolvedValue(answer({ title: "x", person: { age: "age-early-20s" } }, "claude-fable-5", 0.048))

    await post("/v1/llm/structured", DIRECTOR)
    await post("/v1/llm/structured/jobs", DIRECTOR)
    await post("/v1/text-to-picker", { text: "x", targetPickers: ["person"], llmModel: "claude-fable-5", userId: USER_ID })
    await post("/v1/describe-to-picker", { imageUrl: "https://r2.example/p.jpg", targetPickers: ["person"], llmModel: "claude-fable-5", userId: USER_ID })

    // Fable is offered under the rollback too, on the post-#2403 premium rung (C8).
    expect(reserved()).toEqual([
      ["job-1", "llm-structured:premium", undefined],
      ["job-1", "llm-structured:premium", undefined],
      ["job-1", "text-to-picker:premium", undefined],
      ["job-1", "describe-to-picker:premium", undefined],
    ])
    // The guard pre-check is the tier row's (no metered figure), and nothing settles metered.
    expect(h.guard.mock.calls.every((c) => c[1] === undefined)).toBe(true)
    expect(h.commitTier).toHaveBeenCalledTimes(3)
    expect(commit).not.toHaveBeenCalled()
  })
})

describe("the shared pieces", () => {
  it("a planned structured call carries the rendered schema and the refusal flag the call sends", () => {
    const schema = z.fromJSONSchema(SCHEMA as Parameters<typeof z.fromJSONSchema>[0])
    const call = plannedStructuredCall({ modelId: "claude-fable-5", system: "s", messages: [] }, schema, "plan")
    expect(call.modelId).toBe("claude-fable-5")
    expect(call.request).toMatchObject({ failOnRefusal: true, jsonSchema: { name: "plan", schema: structuredJsonSchema(schema) } })
  })

  it("the guard's pre-check reads a raw body defensively: an unknown model is the handler's 400, media never counts", () => {
    expect(llmPrecheckBody({ llmModel: "no-such-model" })).toBeUndefined()
    expect(llmPrecheckBody({ llmModel: "claude-fable-5", maxTokens: "9", reasoningEffort: 3, advancedMode: "yes" })).toEqual({ llmModel: "claude-fable-5" })
    expect(llmTextChars("abc", { a: 1 }, undefined, 42)).toBe(3 + JSON.stringify({ a: 1 }).length)
  })

  it("a charged failure says it was charged and why; a refund or an unsettled hold says nothing", () => {
    expect(chargedFailureMessage("It failed.", { outcome: "charged", charged: 6, shortfall: 0 })).toBe("It failed. Charged 6 credits: the model did billed work before it failed.")
    expect(chargedFailureMessage("It failed.", { outcome: "refunded" })).toBe("It failed.")
    expect(chargedFailureMessage("It failed.", { outcome: "unsettled" })).toBe("It failed.")
  })
})
