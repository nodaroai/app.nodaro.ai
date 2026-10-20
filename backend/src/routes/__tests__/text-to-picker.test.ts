import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const mocks = vi.hoisted(() => ({
  maybeProxyLlmRouteToCloud: vi.fn(),
  insertJob: vi.fn(),
  /** The credit id the guard's pre-check resolved for a request. */
  guardCreditId: vi.fn(),
  reserveCreditsForJob: vi.fn(),
  commitReservedCreditsForJob: vi.fn(),
  refundReservedCreditsForJob: vi.fn(),
  markProviderCallStart: vi.fn(),
  llmCompleteStructured: vi.fn(),
  jobUpdate: vi.fn(),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", ANTHROPIC_API_KEY: "test-key", KIE_API_KEY: "", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))
vi.mock("@/lib/cloud-llm-proxy.js", () => ({ maybeProxyLlmRouteToCloud: mocks.maybeProxyLlmRouteToCloud }))
// insertSyncJob shares the insertJob mock: same call shape, so the row assertions below read both.
vi.mock("@/lib/insert-job.js", () => ({ insertJob: mocks.insertJob, insertSyncJob: mocks.insertJob }))
vi.mock("@/middleware/credit-guard.js", () => ({
  // Records the id the pre-check would price, and lets every request through.
  creditGuard: (resolveCreditId: (req: unknown) => string) => async (req: unknown) => {
    mocks.guardCreditId(resolveCreditId(req))
  },
  reserveCreditsForJob: mocks.reserveCreditsForJob,
}))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({
  commitReservedCreditsForJob: mocks.commitReservedCreditsForJob,
  refundReservedCreditsForJob: mocks.refundReservedCreditsForJob,
}))
vi.mock("@/lib/reconcile/persistence.js", () => ({ markProviderCallStart: mocks.markProviderCallStart }))
vi.mock("@/lib/llm-client.js", () => ({ llmCompleteStructured: mocks.llmCompleteStructured, llmStreamStructured: vi.fn() }))
vi.mock("@/lib/supabase.js", () => {
  // .update({...}).eq("id", …).eq("user_id", …) — the exact chain the route uses.
  const second = vi.fn().mockResolvedValue({ data: null, error: null })
  // markJobFailed's CAS takes .eq("id", …).in("status", …).select("id") instead.
  const first = vi.fn(() => ({ eq: second, in: () => ({ select: () => Promise.resolve({ data: null, error: null }) }) }))
  return {
    supabase: {
      from: vi.fn(() => ({
        update: (row: Record<string, unknown>) => {
          mocks.jobUpdate(row)
          return { eq: first }
        },
      })),
      rpc: vi.fn().mockResolvedValue({ error: null }),
    },
  }
})

import { batchTargetPickers, mergeGaps, servedLanes, settledProviderCost, textToPickerRoutes } from "../text-to-picker.js"
import { StructuredLlmError } from "../../lib/llm/structured.js"
import { PICKER_TYPES, PICKER_ANALYZER_FAMILIES, type PickerType } from "@nodaro/prompts/picker-catalogs"

describe("batchTargetPickers", () => {
  it("small subsets stay a single batch (no fan-out below the threshold)", () => {
    const targets = ["person", "styling", "framing"] as PickerType[]
    expect(batchTargetPickers(targets)).toEqual([targets])
  })

  it("the full default (all 39) fans out per family, covering every requested picker exactly once", () => {
    const batches = batchTargetPickers([...PICKER_TYPES])
    expect(batches.length).toBe(Object.keys(PICKER_ANALYZER_FAMILIES).length)
    const flat = batches.flat()
    expect(flat.sort()).toEqual([...PICKER_TYPES].sort())
    expect(new Set(flat).size).toBe(flat.length)
  })

  it("a large cross-family subset batches by family and keeps only requested pickers", () => {
    const targets = [
      "setting", "atmosphere", "style", "mood", "framing",
      "lighting", "person", "animal", "music-genre", "voice-delivery",
    ] as PickerType[]
    const batches = batchTargetPickers(targets)
    expect(batches.flat().sort()).toEqual([...targets].sort())
    for (const batch of batches) {
      const families = Object.values(PICKER_ANALYZER_FAMILIES)
      expect(families.some((fam) => batch.every((t) => fam.includes(t)))).toBe(true)
    }
  })

  it("every family member is registered in the analyzer registry (partition totality)", () => {
    const inFamilies = Object.values(PICKER_ANALYZER_FAMILIES).flat()
    expect([...inFamilies].sort()).toEqual([...PICKER_TYPES].sort())
  })
})

describe("mergeGaps", () => {
  it("returns undefined when no batch produced gaps", () => {
    expect(mergeGaps([undefined, undefined])).toBeUndefined()
    expect(mergeGaps([{ missingItems: [], missingCategories: [] }])).toBeUndefined()
  })

  it("concatenates items and categories across batches", () => {
    const merged = mergeGaps([
      { missingItems: [{ picker: "setting", dimension: "setting", observed: "space station" }], missingCategories: [] },
      undefined,
      { missingItems: [], missingCategories: [{ picker: "lighting", suggestedDimension: "flicker", observed: "strobing" }] },
    ])
    expect(merged?.missingItems).toHaveLength(1)
    expect(merged?.missingCategories).toHaveLength(1)
  })
})

// Decided 2026-10-09: text-to-picker matches describe-to-picker's defaults —
// Gemini 3.8 Flash at Auto since 2026-10-20, and Opus 5.5's recipe effort
// "high" when it is chosen — resolved ONCE for the request, the reservation
// and the guard's pre-check alike. Since 2026-10-20 it bills its OWN feature
// id (`text-to-picker:*`, migration 546): a default run reads every picker.
describe("POST /v1/text-to-picker — the default model and reasoning effort", () => {
  const USER_ID = "00000000-0000-4000-8000-000000000001"
  const VALID = { text: "A woman in a red coat on a rainy street at dusk.", targetPickers: ["person"], userId: USER_ID }

  let app: FastifyInstance

  async function post(payload: Record<string, unknown>) {
    return app.inject({ method: "POST", url: "/v1/text-to-picker", payload })
  }
  /** The LLM request the analyzer sent, the credit id the job reserved, and
   *  the id the guard pre-checked before the job existed. */
  function sent() {
    const [request] = mocks.llmCompleteStructured.mock.calls[0] as [Record<string, unknown>]
    const [, , , creditId] = mocks.reserveCreditsForJob.mock.calls[0] as [unknown, unknown, string, string]
    const [guardId] = mocks.guardCreditId.mock.calls[0] as [string]
    return { request, creditId, guardId }
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.maybeProxyLlmRouteToCloud.mockResolvedValue(false)
    mocks.insertJob.mockResolvedValue({ data: { id: "job-1" }, error: null })
    mocks.reserveCreditsForJob.mockResolvedValue({ usageLogId: "usage-1" })
    mocks.commitReservedCreditsForJob.mockResolvedValue(undefined)
    mocks.refundReservedCreditsForJob.mockResolvedValue(0)
    mocks.markProviderCallStart.mockResolvedValue(undefined)
    mocks.llmCompleteStructured.mockResolvedValue({ output: { person: { age: "age-30s" } }, inputTokens: 1, outputTokens: 1, lane: "kie" })

    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const body = req.body as Record<string, unknown> | undefined
      if (typeof body?.userId === "string") req.userId = body.userId
    })
    await app.register(async (instance) => { await textToPickerRoutes(instance) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it("no model and no effort: Gemini 3.8 Flash at Auto, reserved — and pre-checked — on economy", async () => {
    expect((await post(VALID)).statusCode).toBe(200)
    const { request, creditId, guardId } = sent()
    expect(request.modelId).toBe("gemini-3.8-flash")
    expect(request.reasoningEffort).toBeUndefined()
    expect(creditId).toBe("text-to-picker:economy")
    expect(guardId).toBe(creditId)
  })

  it("Opus 5.5 with no effort runs at its recipe, high, reserved — and pre-checked — on premium-direct", async () => {
    expect((await post({ ...VALID, llmModel: "claude-opus-5.5" })).statusCode).toBe(200)
    const { request, creditId, guardId } = sent()
    expect(request).toMatchObject({ modelId: "claude-opus-5.5", reasoningEffort: "high" })
    expect(creditId).toBe("text-to-picker:premium-direct")
    expect(guardId).toBe(creditId)
  })

  it("another Claude model with no effort keeps its Auto: no effort sent, no direct bump", async () => {
    expect((await post({ ...VALID, llmModel: "claude-opus-5" })).statusCode).toBe(200)
    const { request, creditId, guardId } = sent()
    expect(request.modelId).toBe("claude-opus-5")
    expect(request.reasoningEffort).toBeUndefined()
    expect(creditId).toBe("text-to-picker:premium")
    expect(guardId).toBe(creditId)
  })

  it("a standard model bills the bare text-to-picker id", async () => {
    expect((await post({ ...VALID, llmModel: "claude-sonnet-5.5" })).statusCode).toBe(200)
    const { creditId, guardId } = sent()
    expect(creditId).toBe("text-to-picker")
    expect(guardId).toBe(creditId)
  })

  it("an explicit effort wins over the recipe", async () => {
    expect((await post({ ...VALID, llmModel: "claude-opus-5.5", reasoningEffort: "low" })).statusCode).toBe(200)
    const { request, creditId, guardId } = sent()
    expect(request).toMatchObject({ modelId: "claude-opus-5.5", reasoningEffort: "low" })
    // Any Claude effort runs on Anthropic's own API, so low bills direct too.
    expect(creditId).toBe("text-to-picker:premium-direct")
    expect(guardId).toBe(creditId)
  })

  // Decided 2026-10-20 (production cost audit): Claude Fable 5 is withheld from
  // every legend-sized structured read. Refused before any row or reservation.
  it("refuses Claude Fable 5 with a validation_error before reserving, like an unknown model", async () => {
    const res = await post({ ...VALID, llmModel: "claude-fable-5" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(mocks.insertJob).not.toHaveBeenCalled()
    expect(mocks.reserveCreditsForJob).not.toHaveBeenCalled()
    expect(mocks.llmCompleteStructured).not.toHaveBeenCalled()
  })

  /** The failed job row as the route wrote it. */
  function failedRow(): Record<string, unknown> {
    const failed = mocks.jobUpdate.mock.calls.map(([row]) => row as Record<string, unknown>).find((row) => row.status === "failed")
    expect(failed).toBeDefined()
    return failed as Record<string, unknown>
  }

  it("a failure that carried usage keeps its cost AND the lane that served it on the failed row", async () => {
    mocks.llmCompleteStructured.mockRejectedValue(
      new StructuredLlmError("llm-structured: validation failed after 3 attempt(s): x", { inputTokens: 90_000, outputTokens: 2_000, providerCost: 0.0412, complete: true }, { lane: "direct-anthropic" }),
    )
    expect((await post(VALID)).statusCode).toBe(502)
    expect(failedRow()).toMatchObject({ provider_cost: 0.0412, provider: "direct-anthropic" })
    expect(mocks.refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
  })

  it("a failure that reported no usage writes a null cost and names no lane", async () => {
    mocks.llmCompleteStructured.mockRejectedValue(new Error("The model stopped responding"))
    expect((await post(VALID)).statusCode).toBe(502)
    expect(failedRow().provider_cost).toBeNull()
    expect(failedRow()).not.toHaveProperty("provider")
  })

  // Promise.all would have dropped the cost of every batch that answered
  // before another failed; the run's spend is every settled batch's.
  it("a fanned-out run with one failed batch records the cost of the batches that answered too", async () => {
    mocks.llmCompleteStructured
      .mockResolvedValueOnce({ output: {}, inputTokens: 1, outputTokens: 1, lane: "kie", providerCost: 0.004 })
      .mockRejectedValueOnce(new StructuredLlmError("x", { inputTokens: 1, outputTokens: 1, providerCost: 0.002, complete: true }, { lane: "kie" }))
      .mockResolvedValue({ output: {}, inputTokens: 1, outputTokens: 1, lane: "kie", providerCost: 0.003 })
    expect((await post({ text: VALID.text, userId: USER_ID })).statusCode).toBe(502)
    const batches = batchTargetPickers([...PICKER_TYPES]).length
    expect(batches).toBeGreaterThan(2)
    expect(failedRow().provider_cost).toBeCloseTo(0.004 + 0.002 + 0.003 * (batches - 2), 9)
    expect(failedRow().provider).toBe("kie")
    expect(mocks.refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(mocks.commitReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("every batch of a fanned-out read runs at the resolved effort", async () => {
    expect((await post({ text: VALID.text, userId: USER_ID, llmModel: "claude-opus-5.5" })).statusCode).toBe(200)
    const calls = mocks.llmCompleteStructured.mock.calls as Array<[Record<string, unknown>]>
    expect(calls.length).toBeGreaterThan(1)
    for (const [request] of calls) expect(request).toMatchObject({ modelId: "claude-opus-5.5", reasoningEffort: "high", timeoutMs: 240_000 })
  })

  // The same effort-aware timeout as describe-to-picker, from the effort the
  // run RESOLVES to: an Opus 5.5 run goes out at high and gets high's 240 s.
  it("asks the LLM client for the effort's timeout: 240 s for an Opus 5.5 run, none for a default run", async () => {
    expect((await post({ ...VALID, llmModel: "claude-opus-5.5" })).statusCode).toBe(200)
    expect(sent().request).toMatchObject({ reasoningEffort: "high", timeoutMs: 240_000 })

    vi.clearAllMocks()
    expect((await post(VALID)).statusCode).toBe(200)
    expect(sent().request).not.toHaveProperty("timeoutMs")

    vi.clearAllMocks()
    expect((await post({ ...VALID, reasoningEffort: "max" })).statusCode).toBe(200)
    expect(sent().request).toMatchObject({ reasoningEffort: "max", timeoutMs: 285_000 })
  })

  /** The completed job row as the route wrote it. */
  function completedRow(): Record<string, unknown> {
    const completed = mocks.jobUpdate.mock.calls.map(([row]) => row as Record<string, unknown>).find((row) => row.status === "completed")
    expect(completed).toBeDefined()
    return completed as Record<string, unknown>
  }

  it("records which lane served the analysis in the admin-only provider column, never in output_data", async () => {
    const res = await post(VALID)
    expect(res.statusCode).toBe(200)

    expect(completedRow().provider).toBe("kie")
    expect((completedRow().output_data as { usage: unknown }).usage).toEqual({ inputTokens: 1, outputTokens: 1, batches: 1 })
    expect(JSON.stringify(res.json())).not.toContain("kie")
  })

  it("records each batch's lane, in batch order, when they did not all land on one", async () => {
    mocks.llmCompleteStructured
      .mockResolvedValueOnce({ output: {}, inputTokens: 1, outputTokens: 1, lane: "kie" })
      .mockResolvedValueOnce({ output: {}, inputTokens: 1, outputTokens: 1, lane: "direct-gemini" })

    expect((await post({ text: VALID.text, userId: USER_ID })).statusCode).toBe(200)

    const row = completedRow()
    const batches = (row.output_data as { usage: { batches: number } }).usage.batches
    expect(batches).toBeGreaterThan(1)
    expect(row.provider).toBe(["kie", "direct-gemini", ...Array(batches - 2).fill("kie")].join(","))
  })

  // What the run cost the platform, summed over its batches (production cost
  // audit, 2026-10-20: a row with token counts alone is invisible to the cost reports).
  it("records the batches' summed provider cost in the admin-only provider_cost column, null when none reported one", async () => {
    mocks.llmCompleteStructured
      .mockResolvedValueOnce({ output: {}, inputTokens: 1, outputTokens: 1, lane: "kie", providerCost: 0.004 })
      .mockResolvedValueOnce({ output: {}, inputTokens: 1, outputTokens: 1, lane: "kie", providerCost: 0.003 })
      .mockResolvedValue({ output: {}, inputTokens: 1, outputTokens: 1, lane: "kie" })
    expect((await post({ text: VALID.text, userId: USER_ID })).statusCode).toBe(200)
    expect(completedRow().provider_cost).toBeCloseTo(0.007, 9)

    vi.clearAllMocks()
    mocks.llmCompleteStructured.mockResolvedValue({ output: { person: { age: "age-30s" } }, inputTokens: 1, outputTokens: 1, lane: "kie" })
    expect((await post(VALID)).statusCode).toBe(200)
    expect(completedRow().provider_cost).toBeNull()
  })
})

describe("settledProviderCost", () => {
  const ok = (providerCost?: number): PromiseSettledResult<{ providerCost?: number }> => ({ status: "fulfilled", value: { providerCost } })
  const failed = (reason: unknown): PromiseSettledResult<{ providerCost?: number }> => ({ status: "rejected", reason })
  it("sums the answered batches' cost with a failed batch's billed usage", () => {
    const billed = new StructuredLlmError("x", { inputTokens: 1, outputTokens: 1, providerCost: 0.02, complete: true })
    expect(settledProviderCost([ok(0.01), failed(billed), ok(0.03)])).toBeCloseTo(0.06, 9)
  })
  it("a failure with no usage adds nothing; a run where nothing reported a cost is null", () => {
    expect(settledProviderCost([ok(0.01), failed(new Error("boom"))])).toBeCloseTo(0.01, 9)
    expect(settledProviderCost([ok(), failed(new Error("boom"))])).toBeNull()
  })
})

describe("servedLanes", () => {
  it("names the one lane every batch landed on", () => {
    expect(servedLanes(["kie", "kie"])).toBe("kie")
  })

  it("lists each batch's lane in order when they differ", () => {
    expect(servedLanes(["kie", "direct-gemini", "kie"])).toBe("kie,direct-gemini,kie")
  })
})
