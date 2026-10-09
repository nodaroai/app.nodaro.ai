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
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", ANTHROPIC_API_KEY: "test-key", KIE_API_KEY: "", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true, hasCredits: () => true, isCommunity: () => false, isBusiness: () => false, hasAdmin: () => true,
}))
vi.mock("@/lib/cloud-llm-proxy.js", () => ({ maybeProxyLlmRouteToCloud: mocks.maybeProxyLlmRouteToCloud }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: mocks.insertJob }))
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
  const first = vi.fn(() => ({ eq: second }))
  return { supabase: { from: vi.fn(() => ({ update: () => ({ eq: first }) })), rpc: vi.fn().mockResolvedValue({ error: null }) } }
})

import { batchTargetPickers, mergeGaps, textToPickerRoutes } from "../text-to-picker.js"
import { PICKER_TYPES, PICKER_ANALYZER_FAMILIES, type PickerType } from "@nodaro/prompts"

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

// Decided 2026-10-09: text-to-picker matches describe-to-picker. Both bill the
// describe-to-picker feature, so its default — Opus 5.5 at effort "high" —
// applies here too, resolved ONCE for the request, the reservation and the
// guard's pre-check alike.
describe("POST /v1/text-to-picker — the default reasoning effort", () => {
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
    mocks.llmCompleteStructured.mockResolvedValue({ output: { person: { age: "age-30s" } }, inputTokens: 1, outputTokens: 1 })

    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const body = req.body as Record<string, unknown> | undefined
      if (typeof body?.userId === "string") req.userId = body.userId
    })
    await app.register(async (instance) => { await textToPickerRoutes(instance) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it("no model and no effort: Opus 5.5 at high, reserved — and pre-checked — on premium-direct", async () => {
    expect((await post(VALID)).statusCode).toBe(200)
    const { request, creditId, guardId } = sent()
    expect(request).toMatchObject({ modelId: "claude-opus-5.5", reasoningEffort: "high" })
    expect(creditId).toBe("describe-to-picker:premium-direct")
    expect(guardId).toBe(creditId)
  })

  it("another model with no effort keeps its Auto: no effort sent, no direct bump", async () => {
    expect((await post({ ...VALID, llmModel: "gemini-3.8-flash" })).statusCode).toBe(200)
    const { request, creditId, guardId } = sent()
    expect(request.modelId).toBe("gemini-3.8-flash")
    expect(request.reasoningEffort).toBeUndefined()
    expect(creditId).toBe("describe-to-picker:economy")
    expect(guardId).toBe(creditId)
  })

  it("an explicit effort wins over the default", async () => {
    expect((await post({ ...VALID, reasoningEffort: "low" })).statusCode).toBe(200)
    const { request, creditId, guardId } = sent()
    expect(request).toMatchObject({ modelId: "claude-opus-5.5", reasoningEffort: "low" })
    // Any Claude effort runs on Anthropic's own API, so low bills direct too.
    expect(creditId).toBe("describe-to-picker:premium-direct")
    expect(guardId).toBe(creditId)
  })

  it("every batch of a fanned-out read runs at the resolved effort", async () => {
    expect((await post({ text: VALID.text, userId: USER_ID })).statusCode).toBe(200)
    const calls = mocks.llmCompleteStructured.mock.calls as Array<[Record<string, unknown>]>
    expect(calls.length).toBeGreaterThan(1)
    for (const [request] of calls) expect(request).toMatchObject({ modelId: "claude-opus-5.5", reasoningEffort: "high", timeoutMs: 240_000 })
  })

  // The same effort-aware timeout as describe-to-picker, from the effort the
  // run RESOLVES to: a default run goes out at high and gets high's 240 s.
  it("asks the LLM client for the effort's timeout: 240 s for a default run, none for another model with no effort", async () => {
    expect((await post(VALID)).statusCode).toBe(200)
    expect(sent().request).toMatchObject({ reasoningEffort: "high", timeoutMs: 240_000 })

    vi.clearAllMocks()
    expect((await post({ ...VALID, llmModel: "gemini-3.8-flash" })).statusCode).toBe(200)
    expect(sent().request).not.toHaveProperty("timeoutMs")

    vi.clearAllMocks()
    expect((await post({ ...VALID, reasoningEffort: "max" })).statusCode).toBe(200)
    expect(sent().request).toMatchObject({ reasoningEffort: "max", timeoutMs: 285_000 })
  })
})
