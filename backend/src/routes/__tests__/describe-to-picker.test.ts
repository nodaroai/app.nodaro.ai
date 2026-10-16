import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify"
import { buildPickerAnalyzerSpec, getAdultOnlyIds } from "@nodaro/prompts/picker-catalogs"

const mocks = vi.hoisted(() => ({
  maybeProxyLlmRouteToCloud: vi.fn(),
  insertJob: vi.fn(),
  jobUpdate: vi.fn(),
  /** The credit id the guard's pre-check resolved for a request. */
  guardCreditId: vi.fn(),
  reserveCreditsForJob: vi.fn(),
  commitReservedCreditsForJob: vi.fn(),
  commitReservedCreditsForJobAtPrice: vi.fn(),
  refundReservedCreditsForJob: vi.fn(),
  markProviderCallStart: vi.fn(),
  llmCompleteStructured: vi.fn(),
  llmStreamStructured: vi.fn(),
  prefetchAsBase64: vi.fn(),
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
  commitReservedCreditsForJobAtPrice: mocks.commitReservedCreditsForJobAtPrice,
  refundReservedCreditsForJob: mocks.refundReservedCreditsForJob,
}))
vi.mock("@/lib/reconcile/persistence.js", () => ({ markProviderCallStart: mocks.markProviderCallStart }))
vi.mock("@/lib/llm-client.js", () => ({
  llmCompleteStructured: mocks.llmCompleteStructured,
  llmStreamStructured: mocks.llmStreamStructured,
}))
vi.mock("@/lib/anthropic-image.js", () => ({ prefetchAsBase64: mocks.prefetchAsBase64 }))
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

import Anthropic from "@anthropic-ai/sdk"
import { DESCRIBE_TO_PICKER_FALLBACK_MODEL, getLlmModel } from "@nodaro/shared/llm-models"
import { LlmContentRefusalError, LlmLaneError, LlmPlatformExhaustedError, LlmStreamResponseError, LLM_CONTENT_REFUSAL_MESSAGE } from "../../lib/llm-errors.js"
import { serveFromFallback } from "../../lib/llm/lane-fallback.js"
import { LLM_MAX_LANES_PER_CALL } from "../../lib/llm/router.js"
import { LLM_STRUCTURED_DEFAULT_ATTEMPTS, LLM_STRUCTURED_DIRECT_BACKUP_ASKS } from "../../lib/llm/structured.js"
import { effortTimeoutMs } from "../../lib/llm-effort-timeout.js"
import { STALE_THRESHOLD_MS } from "../../lib/reconcile/types.js"
import { StructuredLlmError } from "../../lib/llm/structured.js"
import { resolveTargetPickers, buildGapRecords, buildMissingPickerReport, buildSystemPrompt, describeToPickerRoutes, withDescribeToPickerDefaults, isEmptyPickerRead, pickerFallbackReason, EMPTY_PICKER_READ_MESSAGE, DESCRIBE_TO_PICKER_MAX_RUNTIME_MS, fallbackLaneTimeoutMs } from "../describe-to-picker.js"

describe("resolveTargetPickers", () => {
  it("prefers the targetPickers array", () => {
    expect(resolveTargetPickers({ targetPickers: ["person", "styling"] })).toEqual(["person", "styling"])
  })
  it("falls back to the legacy scalar targetPicker", () => {
    expect(resolveTargetPickers({ targetPicker: "person" })).toEqual(["person"])
  })
  it("returns [] when neither present", () => {
    expect(resolveTargetPickers({})).toEqual([])
  })
})

describe("withDescribeToPickerDefaults (what the credit guard prices)", () => {
  it("fills an omitted model and effort with the analyzer's defaults", () => {
    expect(withDescribeToPickerDefaults({ imageUrl: "x" })).toEqual({ imageUrl: "x", llmModel: "claude-opus-5.5", reasoningEffort: "high" })
    expect(withDescribeToPickerDefaults(undefined)).toEqual({ llmModel: "claude-opus-5.5", reasoningEffort: "high" })
  })
  it("keeps what the body sent: another model gets no default effort, and an explicit effort wins", () => {
    expect(withDescribeToPickerDefaults({ llmModel: "gemini-3.8-flash" })).toEqual({ llmModel: "gemini-3.8-flash", reasoningEffort: undefined })
    expect(withDescribeToPickerDefaults({ reasoningEffort: "low" })).toEqual({ llmModel: "claude-opus-5.5", reasoningEffort: "low" })
  })
  it("treats a model or effort that is not a string as absent, and never mutates the body", () => {
    const body = { llmModel: 42, reasoningEffort: null }
    expect(withDescribeToPickerDefaults(body)).toEqual({ llmModel: "claude-opus-5.5", reasoningEffort: "high" })
    expect(body).toEqual({ llmModel: 42, reasoningEffort: null })
  })
})

describe("buildGapRecords", () => {
  const pickerJson = { person: { age: "age-early-20s" }, framing: { composition: ["centered", "negative-space"] } }
  it("joins chosenId from the picker section and normalizes observed", () => {
    const recs = buildGapRecords(
      { missingItems: [{ picker: "person", dimension: "age", observed: "  Late  Teens " }], missingCategories: [] },
      pickerJson,
      "u1",
    )
    expect(recs).toEqual([
      {
        p_picker_type: "person",
        p_gap_type: "item",
        p_dimension: "age",
        p_observed: "  Late  Teens ",
        p_observed_norm: "late teens",
        p_chosen_id: "age-early-20s",
        p_sample_user_id: "u1",
      },
    ])
  })
  it("uses the first array element for chosenId and null for categories", () => {
    const recs = buildGapRecords(
      {
        missingItems: [{ picker: "framing", dimension: "composition", observed: "x" }],
        missingCategories: [{ picker: "person", suggestedDimension: "freckle-density", observed: "y" }],
      },
      pickerJson,
      "u1",
    )
    expect(recs[0].p_chosen_id).toBe("centered")
    expect(recs[1]).toMatchObject({ p_gap_type: "category", p_dimension: "freckle-density", p_chosen_id: null })
  })
  it("returns [] for empty/absent gaps", () => {
    expect(buildGapRecords(undefined, pickerJson, "u1")).toEqual([])
    expect(buildGapRecords({ missingItems: [], missingCategories: [] }, pickerJson, "u1")).toEqual([])
  })
})

describe("buildMissingPickerReport", () => {
  const ctx = {
    imageUrl: "https://cdn.example/img.png",
    llmModel: "claude-opus-4.7",
    targetPickers: ["person"],
    origin: "person",
    userId: "u1",
    jobId: "j1",
  }

  it("builds a per-incident app_report carrying the image link and app origin", () => {
    const gaps = {
      missingItems: [{ picker: "person", dimension: "hair-color", observed: "blue-green ombre" }],
      missingCategories: [{ picker: "person", suggestedDimension: "freckles", observed: "dense freckles" }],
    }
    const report = buildMissingPickerReport(gaps, ctx)
    expect(report).toMatchObject({
      appSlug: "person",
      node: "describe-to-picker",
      kind: "missing-picker",
      title: "2 unmatched attributes in image analysis",
      userId: "u1",
      jobId: "j1",
    })
    expect(report?.payload).toMatchObject({ imageUrl: ctx.imageUrl, gaps, llmModel: ctx.llmModel })
  })

  it("is null when the analysis had no gaps (no report row)", () => {
    expect(buildMissingPickerReport(undefined, ctx)).toBeNull()
    expect(buildMissingPickerReport({ missingItems: [], missingCategories: [] }, ctx)).toBeNull()
  })

  it("omits the app slug when no origin was sent", () => {
    const report = buildMissingPickerReport(
      { missingItems: [{ picker: "person", dimension: "age", observed: "x" }], missingCategories: [] },
      { ...ctx, origin: undefined },
    )
    expect(report?.appSlug).toBeNull()
    expect(report?.title).toBe("1 unmatched attribute in image analysis")
  })
})

describe("buildSystemPrompt", () => {
  const otherLegend = "- setting: Setting\n- exposure-settings: Exposure Settings — Aperture, Shutter Speed, ISO"

  it("appends the OTHER PICKERS reference (with its text) when otherPickersLegend is non-empty", () => {
    const out = buildSystemPrompt("WIRED LEGEND", undefined, otherLegend)
    expect(out).toContain("OTHER PICKERS")
    expect(out).toContain(otherLegend)
    // The appended reference lands AFTER the wired legend.
    expect(out.indexOf("OTHER PICKERS")).toBeGreaterThan(out.indexOf("WIRED LEGEND"))
  })

  it("omits the OTHER PICKERS section entirely when otherPickersLegend is empty", () => {
    const out = buildSystemPrompt("WIRED LEGEND", undefined, "")
    expect(out).not.toContain("OTHER PICKERS")
    // The wired legend + gap guidance are still present.
    expect(out).toContain("WIRED LEGEND")
    expect(out).toContain("GAPS (catalog feedback)")
  })
})

describe("POST /v1/describe-to-picker — W1-a minor-age floor", () => {
  const USER_ID = "00000000-0000-4000-8000-000000000001"

  let app: FastifyInstance

  async function post(payload: Record<string, unknown>) {
    return app.inject({ method: "POST", url: "/v1/describe-to-picker", payload })
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.maybeProxyLlmRouteToCloud.mockResolvedValue(false)
    mocks.insertJob.mockResolvedValue({ data: { id: "job-1" }, error: null })
    mocks.reserveCreditsForJob.mockResolvedValue({ usageLogId: "usage-1" })
    mocks.commitReservedCreditsForJob.mockResolvedValue(undefined)
    mocks.refundReservedCreditsForJob.mockResolvedValue(0)
    mocks.markProviderCallStart.mockResolvedValue(undefined)
    mocks.prefetchAsBase64.mockResolvedValue({ type: "image", url: "https://cdn.example/img.png" })

    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const body = req.body as Record<string, unknown> | undefined
      if (typeof body?.userId === "string") req.userId = body.userId
    })
    await app.register(async (instance) => { await describeToPickerRoutes(instance) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  const VALID = {
    imageUrl: "https://cdn.example/img.png",
    targetPickers: ["person", "styling"],
    userId: USER_ID,
  }

  it("a minor person value floors adult-only ids from the same analysis's styling before the response", async () => {
    mocks.llmCompleteStructured.mockResolvedValue({
      output: { person: { age: "age-pre-teen" }, styling: { top: "top-bra-top" } },
      inputTokens: 100,
      outputTokens: 50,
    })
    const res = await post(VALID)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.pickerJson.styling).toEqual({})
    expect(body.pickerJson.person).toEqual({ age: "age-pre-teen" })
    // The floored value is also what gets persisted on the job row and fed to gap recording.
    expect(mocks.jobUpdate).toHaveBeenCalledWith({
      status: "completed",
      progress: 100,
      completed_at: expect.any(String),
      output_data: { json: { person: { age: "age-pre-teen" }, styling: {} }, targetPickers: ["person", "styling"], usage: { inputTokens: 100, outputTokens: 50 }, answeredBy: "claude-opus-5.5" },
    })
  })

  it("is unaffected for an adult person value", async () => {
    mocks.llmCompleteStructured.mockResolvedValue({
      output: { person: { age: "age-30s" }, styling: { top: "top-bra-top" } },
      inputTokens: 100,
      outputTokens: 50,
    })
    const res = await post(VALID)
    expect(res.statusCode).toBe(200)
    expect(res.json().pickerJson.styling).toEqual({ top: "top-bra-top" })
  })

  it("asks the LLM client for a longer timeout only when the reasoning effort is high or above", async () => {
    mocks.llmCompleteStructured.mockResolvedValue({ output: { person: { age: "age-30s" }, styling: {} }, inputTokens: 1, outputTokens: 1 })
    // A default read runs Opus 5.5 at the default effort, high — the timeout
    // follows the effort the read RUNS at, not the one the body sent.
    expect((await post(VALID)).statusCode).toBe(200)
    expect(mocks.llmCompleteStructured.mock.calls.at(-1)?.[0]).toMatchObject({ reasoningEffort: "high", timeoutMs: 240_000 })
    // Another model with no effort keeps its Auto, and so the client's default timeout.
    expect((await post({ ...VALID, llmModel: "gemini-3.8-flash" })).statusCode).toBe(200)
    expect(mocks.llmCompleteStructured.mock.calls.at(-1)?.[0]).not.toHaveProperty("timeoutMs")
    expect((await post({ ...VALID, reasoningEffort: "max" })).statusCode).toBe(200)
    expect(mocks.llmCompleteStructured.mock.calls.at(-1)?.[0]).toMatchObject({ reasoningEffort: "max", timeoutMs: 285_000 })
  })
})

// Decided 2026-10-09: the analyzer's default is Opus 5.5 at effort "high". The
// effort is resolved ONCE, so the request the model gets and the credit row the
// job reserves always describe the same call.
describe("POST /v1/describe-to-picker — the default reasoning effort", () => {
  const USER_ID = "00000000-0000-4000-8000-000000000001"
  const VALID = { imageUrl: "https://cdn.example/img.png", targetPickers: ["person"], userId: USER_ID }

  let app: FastifyInstance

  async function post(payload: Record<string, unknown>) {
    return app.inject({ method: "POST", url: "/v1/describe-to-picker", payload })
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
    mocks.prefetchAsBase64.mockResolvedValue({ type: "image", url: "https://cdn.example/img.png" })
    mocks.llmCompleteStructured.mockResolvedValue({ output: { person: { age: "age-30s" } }, inputTokens: 1, outputTokens: 1 })

    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const body = req.body as Record<string, unknown> | undefined
      if (typeof body?.userId === "string") req.userId = body.userId
    })
    await app.register(async (instance) => { await describeToPickerRoutes(instance) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it("no model and no effort: Opus 5.5 at high, reserved on the rung a direct premium call bills", async () => {
    expect((await post(VALID)).statusCode).toBe(200)
    const { request, creditId } = sent()
    expect(request).toMatchObject({ modelId: "claude-opus-5.5", reasoningEffort: "high" })
    expect(creditId).toBe("describe-to-picker:premium-direct")
  })

  it("the default model named with no effort gets the same default", async () => {
    expect((await post({ ...VALID, llmModel: "claude-opus-5.5" })).statusCode).toBe(200)
    const { request, creditId } = sent()
    expect(request).toMatchObject({ modelId: "claude-opus-5.5", reasoningEffort: "high" })
    expect(creditId).toBe("describe-to-picker:premium-direct")
  })

  it("another model with no effort keeps its Auto: no effort sent, no direct bump", async () => {
    expect((await post({ ...VALID, llmModel: "gemini-3.8-flash" })).statusCode).toBe(200)
    const { request, creditId } = sent()
    expect(request.modelId).toBe("gemini-3.8-flash")
    expect(request.reasoningEffort).toBeUndefined()
    expect(creditId).toBe("describe-to-picker:economy")
  })

  it("an explicit effort wins over the default", async () => {
    expect((await post({ ...VALID, reasoningEffort: "low" })).statusCode).toBe(200)
    const { request, creditId } = sent()
    expect(request).toMatchObject({ modelId: "claude-opus-5.5", reasoningEffort: "low" })
    // Any Claude effort runs on Anthropic's own API, so low bills direct too.
    expect(creditId).toBe("describe-to-picker:premium-direct")
  })

  // The guard reads the raw body before validation. Priced on the bare id (10)
  // while the job reserves premium-direct (25), a balance in between passed
  // the check and then failed the reservation with a 500 instead of a 402.
  it("the credit guard pre-checks the rung the reservation charges: premium-direct for a default read, its own id for an explicit model", async () => {
    expect((await post(VALID)).statusCode).toBe(200)
    let { creditId, guardId } = sent()
    expect(guardId).toBe("describe-to-picker:premium-direct")
    expect(guardId).toBe(creditId)

    vi.clearAllMocks()
    expect((await post({ ...VALID, llmModel: "gemini-3.8-flash" })).statusCode).toBe(200)
    ;({ creditId, guardId } = sent())
    expect(guardId).toBe("describe-to-picker:economy")
    expect(guardId).toBe(creditId)
  })

  it("the guard and the reservation agree for a named default model and an explicit effort too", async () => {
    for (const body of [{ ...VALID, llmModel: "claude-opus-5.5" }, { ...VALID, reasoningEffort: "low" }, { ...VALID, llmModel: "claude-sonnet-4.6" }]) {
      vi.clearAllMocks()
      expect((await post(body)).statusCode).toBe(200)
      const { creditId, guardId } = sent()
      expect(guardId, JSON.stringify(body)).toBe(creditId)
    }
  })
})

describe("POST /v1/describe-to-picker — streamed answer (Accept: text/event-stream)", () => {
  const USER_ID = "00000000-0000-4000-8000-000000000001"
  const URL = "/v1/describe-to-picker"
  const VALID = { imageUrl: "https://cdn.example/img.png", targetPickers: ["person", "styling"], userId: USER_ID }
  const SSE = { accept: "text/event-stream, application/json" }
  // Real catalog ids: an ordinary type and hair colour, and an adult-only top.
  const PERSON = buildPickerAnalyzerSpec("person")
  const ADULT_ONLY = getAdultOnlyIds()
  const firstOrdinary = (dimension: string) =>
    PERSON.dimensions.find((d) => d.dimension === dimension)?.entryIds.find((id) => !ADULT_ONLY.has(id)) as string
  const TYPE = firstOrdinary("type")
  const HAIR = firstOrdinary("hair-color")
  const ANSWER = {
    person: { type: TYPE, age: "age-30s", "hair-color": [HAIR] },
    styling: { top: "top-bra-top" },
    gaps: { missingItems: [], missingCategories: [] },
  }

  type StreamOpts = { schemaName?: string; onToolJson?: (partialJson: string) => void }
  let app: FastifyInstance

  /** The analyzer answering `output`, after streaming its JSON text in `pieces`. */
  function streamingAnalyzer(output: Record<string, unknown>, pieces = 5) {
    return async (_req: unknown, _schema: unknown, opts: StreamOpts) => {
      const text = JSON.stringify(output)
      const size = Math.ceil(text.length / pieces)
      for (let i = 0; i < text.length; i += size) opts.onToolJson?.(text.slice(i, i + size))
      return { output, inputTokens: 100, outputTokens: 50 }
    }
  }

  function events(payload: string): Array<{ type: string; data: Record<string, unknown> }> {
    return payload
      .split("\n\n")
      .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
      .filter((line): line is string => line !== undefined)
      .map((line) => JSON.parse(line.slice("data: ".length)))
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.maybeProxyLlmRouteToCloud.mockResolvedValue(false)
    mocks.insertJob.mockResolvedValue({ data: { id: "job-1" }, error: null })
    mocks.reserveCreditsForJob.mockResolvedValue({ usageLogId: "usage-1" })
    mocks.commitReservedCreditsForJob.mockResolvedValue(undefined)
    mocks.refundReservedCreditsForJob.mockResolvedValue(0)
    mocks.markProviderCallStart.mockResolvedValue(undefined)
    mocks.prefetchAsBase64.mockResolvedValue({ type: "image", url: "https://cdn.example/img.png" })

    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const body = req.body as Record<string, unknown> | undefined
      if (typeof body?.userId === "string") req.userId = body.userId
    })
    await app.register(async (instance) => { await describeToPickerRoutes(instance) })
    await app.ready()
  })

  afterEach(async () => { await app.close() })

  it("sends a field per detail as the model writes it, then done carrying exactly the JSON answer", async () => {
    mocks.llmStreamStructured.mockImplementation(streamingAnalyzer(ANSWER))
    const streamed = await app.inject({ method: "POST", url: URL, payload: VALID, headers: SSE })

    expect(streamed.statusCode).toBe(200)
    expect(streamed.headers["content-type"]).toBe("text/event-stream")
    const evts = events(streamed.payload)
    // The adult-only top never streams, adult or not: it arrives with `done`.
    expect(evts.filter((e) => e.type === "field").map((e) => e.data)).toEqual([
      { field: "person.type", value: TYPE },
      { field: "person.age", value: "age-30s" },
      { field: "person.hair-color", value: [HAIR] },
    ])
    expect(evts.filter((e) => e.type === "done")).toHaveLength(1)
    expect(evts.at(-1)).toMatchObject({ type: "done", data: { pickerJson: { styling: { top: "top-bra-top" } } } })
    expect(evts.at(-1)?.type).toBe("done")

    // The same analysis request as the JSON answer, and `done` is its body byte for byte.
    mocks.llmCompleteStructured.mockResolvedValue({ output: ANSWER, inputTokens: 100, outputTokens: 50 })
    const plain = await app.inject({ method: "POST", url: URL, payload: VALID })
    expect(JSON.stringify(evts.at(-1)?.data)).toBe(plain.payload)
    const [streamReq, , streamOpts] = mocks.llmStreamStructured.mock.calls[0] as [unknown, unknown, StreamOpts]
    const [plainReq, , plainOpts] = mocks.llmCompleteStructured.mock.calls[0] as [unknown, unknown, StreamOpts]
    expect(streamReq).toEqual(plainReq)
    expect(streamOpts.schemaName).toBe(plainOpts.schemaName)
  })

  it("bills exactly one analysis: commits on done and never refunds", async () => {
    mocks.llmStreamStructured.mockImplementation(streamingAnalyzer(ANSWER))
    await app.inject({ method: "POST", url: URL, payload: VALID, headers: SSE })

    expect(mocks.reserveCreditsForJob).toHaveBeenCalledTimes(1)
    expect(mocks.commitReservedCreditsForJob).toHaveBeenCalledTimes(1)
    expect(mocks.commitReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(mocks.refundReservedCreditsForJob).not.toHaveBeenCalled()
    expect(mocks.jobUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }))
    expect(mocks.llmCompleteStructured).not.toHaveBeenCalled()
  })

  it("without the event-stream Accept, answers JSON exactly as before and never streams", async () => {
    mocks.llmCompleteStructured.mockResolvedValue({ output: ANSWER, inputTokens: 100, outputTokens: 50 })
    const res = await app.inject({ method: "POST", url: URL, payload: VALID, headers: { accept: "application/json" } })

    expect(res.statusCode).toBe(200)
    expect(res.headers["content-type"]).toContain("application/json")
    expect(res.json()).toEqual({ jobId: "job-1", pickerJson: { person: ANSWER.person, styling: ANSWER.styling }, gaps: ANSWER.gaps })
    expect(mocks.llmStreamStructured).not.toHaveBeenCalled()
  })

  it("keeps validation, auth and credit failures plain HTTP errors, before any stream opens", async () => {
    const noImage = await app.inject({ method: "POST", url: URL, payload: { targetPickers: ["person"], userId: USER_ID }, headers: SSE })
    expect(noImage.statusCode).toBe(400)
    expect(noImage.json().error.code).toBe("validation_error")

    const anonymous = await app.inject({ method: "POST", url: URL, payload: { imageUrl: VALID.imageUrl, targetPickers: ["person"] }, headers: SSE })
    expect(anonymous.statusCode).toBe(401)
    expect(anonymous.json().error.code).toBe("unauthorized")

    mocks.reserveCreditsForJob.mockImplementationOnce(async (_req: unknown, reply: FastifyReply) => {
      reply.status(402).send({ error: { code: "insufficient_credits", message: "Not enough credits" } })
      return null
    })
    const broke = await app.inject({ method: "POST", url: URL, payload: VALID, headers: SSE })
    expect(broke.statusCode).toBe(402)
    expect(broke.headers["content-type"]).toContain("application/json")
    expect(broke.json().error.code).toBe("insufficient_credits")
    expect(mocks.llmStreamStructured).not.toHaveBeenCalled()
  })

  it("a failure after the stream opened sends error, refunds, and fails the job", async () => {
    mocks.llmStreamStructured.mockImplementation(async (_req: unknown, _schema: unknown, opts: StreamOpts) => {
      opts.onToolJson?.('{"person":{"age":"age-30s"')
      throw new Error("The model stopped responding")
    })
    const res = await app.inject({ method: "POST", url: URL, payload: VALID, headers: SSE })

    expect(res.statusCode).toBe(200)
    const evts = events(res.payload)
    expect(evts.map((e) => e.type)).toEqual(["field", "error"])
    expect(evts.at(-1)?.data).toEqual({ code: "llm_error", message: "The model stopped responding" })
    expect(mocks.refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(mocks.commitReservedCreditsForJob).not.toHaveBeenCalled()
    expect(mocks.jobUpdate).toHaveBeenCalledWith({ status: "failed", error_message: "The model stopped responding", completed_at: expect.any(String), output_data: { error: "The model stopped responding" } })
  })

  it("a minor: no field carries a value the floor removes, and done carries the floored answer", async () => {
    const minor = { person: { age: "age-pre-teen", "hair-color": [HAIR] }, styling: { top: "top-bra-top" } }
    mocks.llmStreamStructured.mockImplementation(streamingAnalyzer(minor, 9))
    const evts = events((await app.inject({ method: "POST", url: URL, payload: VALID, headers: SSE })).payload)

    expect(evts.filter((e) => e.type === "field").map((e) => e.data)).toEqual([
      { field: "person.age", value: "age-pre-teen" },
      { field: "person.hair-color", value: [HAIR] },
    ])
    expect(evts.at(-1)).toMatchObject({ type: "done", data: { pickerJson: { person: minor.person, styling: {} } } })
  })

  it("delivers each event while the analysis is still running, to an in-process reader too", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    mocks.llmStreamStructured.mockImplementation(async (_req: unknown, _schema: unknown, opts: StreamOpts) => {
      opts.onToolJson?.('{"person":{"age":"age-30s"')
      await gate
      opts.onToolJson?.("}}")
      return { output: { person: { age: "age-30s" } }, inputTokens: 1, outputTokens: 1 }
    })

    // How an in-process caller reads it: an inject whose body is a live stream.
    const res = await app.inject({ method: "POST", url: URL, payload: VALID, headers: SSE, payloadAsStream: true })
    let text = ""
    const stream = res.stream()
    stream.on("data", (chunk: Buffer) => { text += chunk.toString() })
    const ended = new Promise((resolve) => stream.on("end", resolve))

    await vi.waitFor(() => expect(text).toContain('"field":"person.age"'))
    expect(text).not.toContain('"type":"done"')
    release()
    await ended
    expect(text).toContain('"type":"done"')
  })

  // A plain provider error's message IS the sentence the person reads, so a
  // log keyed on "the message was rewritten" never fired for it: a failed
  // fallback lane reached the person with no log line anywhere.
  it.each([
    ["the JSON answer", {}],
    ["the streamed answer", SSE],
  ])("%s logs the raw failure, its causes and the job id, and the person reads the same sentence as before", async (_label, headers) => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const failure = new Error("got status: 400 Bad Request.", { cause: new Error("upstream detail") })
      mocks.llmCompleteStructured.mockRejectedValue(failure)
      mocks.llmStreamStructured.mockRejectedValue(failure)
      const res = await app.inject({ method: "POST", url: URL, payload: VALID, headers })

      expect(mocks.jobUpdate).toHaveBeenCalledWith({ status: "failed", error_message: "got status: 400 Bad Request.", completed_at: expect.any(String), output_data: { error: "got status: 400 Bad Request." } })
      const logged = errorSpy.mock.calls.map((c) => c.map(String).join(" ")).filter((l) => l.includes("[describe-to-picker]"))
      expect(logged).toHaveLength(1)
      expect(logged[0]).toContain("job-1")
      expect(logged[0]).toContain("got status: 400 Bad Request.")
      expect(logged[0]).toContain("upstream detail")
      if (headers === SSE) {
        expect(events(res.payload).at(-1)).toEqual({ type: "error", data: { code: "llm_error", message: "got status: 400 Bad Request." } })
      } else {
        expect(res.statusCode).toBe(502)
        expect(res.json()).toEqual({ error: { code: "llm_error", message: "got status: 400 Bad Request." } })
      }
    } finally {
      errorSpy.mockRestore()
    }
  })
})

// Production 2026-10-15/16: the platform's Anthropic balance ran out. The KIE
// retry of the same Claude model refused ("out of capacity", job b6cb8117) or
// completed with `{}` (job 1572a638, billed — "found no pickers"). A Claude
// read that fails for a platform-side reason, or whose KIE retry answers
// nothing valid or nothing at all, is re-asked ONCE on Gemini 3.8 Flash and
// charged at Gemini's price; an empty read from a model that saw the photo
// fails uncharged.
describe("POST /v1/describe-to-picker — Gemini fallback and empty reads", () => {
  const USER_ID = "00000000-0000-4000-8000-000000000001"
  const URL = "/v1/describe-to-picker"
  const VALID = { imageUrl: "https://cdn.example/img.png", targetPickers: ["person", "styling"], userId: USER_ID }
  const SSE = { accept: "text/event-stream, application/json" }
  const READ = { person: { age: "age-30s" }, styling: {} }
  const drained = () => new LlmPlatformExhaustedError("anthropic direct lane: credit balance is too low | kie fallback failed: 503", {
    lane: "direct", provider: "anthropic", exhaustion: "billing",
  })
  const answer = (output: unknown, lane: "kie" | "direct-anthropic") => ({ output, inputTokens: 10, outputTokens: 5, lane })

  let app: FastifyInstance
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  function events(payload: string): Array<{ type: string; data: Record<string, unknown> }> {
    return payload
      .split("\n\n")
      .map((block) => block.split("\n").find((line) => line.startsWith("data: ")))
      .filter((line): line is string => line !== undefined)
      .map((line) => JSON.parse(line.slice("data: ".length)))
  }
  const requests = (fn: typeof mocks.llmCompleteStructured) => fn.mock.calls.map((c) => c[0] as Record<string, unknown>)
  const completedRow = () => mocks.jobUpdate.mock.calls.map((c) => c[0] as Record<string, unknown>).find((r) => r.status === "completed")

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.llmCompleteStructured.mockReset()
    mocks.llmStreamStructured.mockReset()
    mocks.maybeProxyLlmRouteToCloud.mockResolvedValue(false)
    mocks.insertJob.mockResolvedValue({ data: { id: "job-1" }, error: null })
    mocks.reserveCreditsForJob.mockResolvedValue({ usageLogId: "usage-1" })
    mocks.commitReservedCreditsForJob.mockResolvedValue(undefined)
    mocks.commitReservedCreditsForJobAtPrice.mockResolvedValue(undefined)
    mocks.refundReservedCreditsForJob.mockResolvedValue(1)
    mocks.markProviderCallStart.mockResolvedValue(undefined)
    mocks.prefetchAsBase64.mockResolvedValue({ type: "image", url: "https://cdn.example/img.png" })
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      const body = req.body as Record<string, unknown> | undefined
      if (typeof body?.userId === "string") req.userId = body.userId
    })
    await app.register(async (instance) => { await describeToPickerRoutes(instance) })
    await app.ready()
  })

  afterEach(async () => {
    warnSpy.mockRestore()
    errorSpy.mockRestore()
    await app.close()
  })

  it("Claude exhausted on both lanes: Gemini 3.8 Flash answers once, the job records it, and the charge is Gemini's price", async () => {
    mocks.llmCompleteStructured.mockRejectedValueOnce(drained()).mockResolvedValueOnce(answer(READ, "kie"))
    const res = await app.inject({ method: "POST", url: URL, payload: { ...VALID, advancedMode: true, temperature: 0.3 } })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ jobId: "job-1", pickerJson: READ })
    const [claude, gemini] = requests(mocks.llmCompleteStructured)
    expect(claude).toMatchObject({ modelId: "claude-opus-5.5", reasoningEffort: "high", requireLane: "direct", temperature: 0.3 })
    // The fallback runs at its own defaults, on its own lanes: no Claude effort,
    // timeout or Advanced-mode pin rides along.
    expect(gemini.modelId).toBe(DESCRIBE_TO_PICKER_FALLBACK_MODEL)
    expect(gemini.reasoningEffort).toBeUndefined()
    // A drained account answers at once, so Gemini gets the client's default per-lane timeout.
    expect(gemini.timeoutMs).toBe(120_000)
    expect(gemini).not.toHaveProperty("requireLane")
    expect(gemini).not.toHaveProperty("temperature")
    expect(gemini.messages).toEqual(claude.messages)

    expect(completedRow()).toMatchObject({ provider: "kie", output_data: { answeredBy: "gemini-3.8-flash", json: READ } })
    expect(mocks.commitReservedCreditsForJobAtPrice).toHaveBeenCalledWith("job-1", "describe-to-picker:economy")
    expect(mocks.commitReservedCreditsForJob).not.toHaveBeenCalled()
    expect(mocks.refundReservedCreditsForJob).not.toHaveBeenCalled()
    const logged = warnSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.startsWith("[picker-fallback]"))
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatch(/^\[picker-fallback\] claude-opus-5\.5 → gemini-3\.8-flash: the anthropic platform account refused \(billing\)/)
  })

  it("the KIE retry of Claude answers: no fallback, charged as the Claude model chosen", async () => {
    mocks.llmCompleteStructured.mockResolvedValueOnce(answer(READ, "kie"))
    expect((await app.inject({ method: "POST", url: URL, payload: VALID })).statusCode).toBe(200)
    expect(mocks.llmCompleteStructured).toHaveBeenCalledTimes(1)
    expect(completedRow()).toMatchObject({ provider: "kie", output_data: { answeredBy: "claude-opus-5.5" } })
    expect(mocks.commitReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(mocks.commitReservedCreditsForJobAtPrice).not.toHaveBeenCalled()
  })

  it.each([
    ["the KIE retry answered empty", () => mocks.llmCompleteStructured.mockResolvedValueOnce(answer({ person: {}, styling: {} }, "kie"))],
    ["the KIE retry's answer did not validate", () => mocks.llmCompleteStructured.mockRejectedValueOnce(
      new StructuredLlmError("llm-structured: validation failed after 3 attempt(s): person: expected object", { inputTokens: 1, outputTokens: 1, complete: true }, { lane: "kie" }))],
    ["the KIE lane failed (503)", () => mocks.llmCompleteStructured.mockRejectedValueOnce(
      new LlmLaneError("KIE.ai messages stream claude-opus-5.5 failed (503): Internal error", { lane: "kie", httpStatus: 503 }))],
    ["the direct lane failed (529)", () => mocks.llmCompleteStructured.mockRejectedValueOnce(
      Anthropic.APIError.generate(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, undefined, new Headers()))],
    ["the direct lane could not be reached", () => mocks.llmCompleteStructured.mockRejectedValueOnce(new Anthropic.APIConnectionTimeoutError())],
  ])("%s → Gemini answers", async (reason, arrange) => {
    arrange()
    mocks.llmCompleteStructured.mockResolvedValueOnce(answer(READ, "kie"))
    expect((await app.inject({ method: "POST", url: URL, payload: VALID })).statusCode).toBe(200)
    expect(requests(mocks.llmCompleteStructured).map((r) => r.modelId)).toEqual(["claude-opus-5.5", "gemini-3.8-flash"])
    expect(warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes(`: ${reason}`))).toBe(true)
    expect(mocks.commitReservedCreditsForJobAtPrice).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["a direct answer that never validated", new StructuredLlmError("llm-structured: validation failed after 3 attempt(s): x", { inputTokens: 1, outputTokens: 1, complete: true }, { lane: "direct-anthropic" })],
    ["a direct 400 (the request's own problem, or a refusal)", Anthropic.APIError.generate(400, { type: "error", error: { type: "invalid_request_error", message: "Could not process image" } }, undefined, new Headers())],
    ["a usage-carrying failure (the model answered and was paid)", new LlmStreamResponseError("stream died after usage", { inputTokens: 5, outputTokens: 5, complete: true })],
  ])("%s: no fallback — the job fails and the reservation is refunded", async (_label, err) => {
    mocks.llmCompleteStructured.mockRejectedValueOnce(err)
    const res = await app.inject({ method: "POST", url: URL, payload: VALID })
    expect(res.statusCode).toBe(502)
    expect(mocks.llmCompleteStructured).toHaveBeenCalledTimes(1)
    expect(mocks.refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(mocks.commitReservedCreditsForJob).not.toHaveBeenCalled()
  })

  // The direct lane refused the REQUEST (a 400), the client then tried KIE,
  // and KIE failed too: the request is the problem, so Gemini is not asked.
  it("an unpinned direct 400 followed by a KIE failure: no Gemini, the job fails and is refunded", async () => {
    const direct400 = Anthropic.APIError.generate(400, { type: "error", error: { type: "invalid_request_error", message: "messages.0.content.0.image.source.base64: invalid image" } }, undefined, new Headers())
    const kie503 = new LlmLaneError("KIE.ai messages stream claude-opus-5.5 failed (503): Internal error", { lane: "kie", httpStatus: 503 })
    const thrown = await serveFromFallback({ modelId: "claude-opus-5.5", primary: "direct-anthropic", fallback: "kie" }, direct400, () => Promise.reject(kie503))
      .catch((e: unknown) => e)
    expect((thrown as Error).cause).toBe(direct400)
    mocks.llmCompleteStructured.mockRejectedValueOnce(new StructuredLlmError("x", { inputTokens: 0, outputTokens: 0, complete: true }, { cause: thrown }))

    const res = await app.inject({ method: "POST", url: URL, payload: VALID })
    expect(res.statusCode).toBe(502)
    expect(mocks.llmCompleteStructured).toHaveBeenCalledTimes(1)
    expect(mocks.refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
  })

  // A billed refusal is a paid answer about the photo (decided 2026-10-16): the
  // job fails with the content-policy sentence and the hold is COMMITTED.
  it.each([
    ["the JSON answer", {}],
    ["the streamed answer", SSE],
  ])("a billed content refusal on %s: no Gemini, the content-policy sentence, the job failed and charged", async (_label, headers) => {
    const refusal = new LlmContentRefusalError("refused (direct-anthropic claude-opus-5.5 stopped with refusal)", { inputTokens: 3, outputTokens: 4, complete: true })
    // As llmCompleteStructured throws it: wrapped, the refusal as its cause.
    const thrown = new StructuredLlmError(refusal.message, { inputTokens: 3, outputTokens: 4, complete: true }, { cause: refusal })
    mocks.llmCompleteStructured.mockRejectedValueOnce(thrown)
    mocks.llmStreamStructured.mockRejectedValueOnce(thrown)
    const res = await app.inject({ method: "POST", url: URL, payload: VALID, headers })
    if (headers === SSE) {
      expect(events(res.payload)).toEqual([{ type: "error", data: { code: "llm_error", message: LLM_CONTENT_REFUSAL_MESSAGE } }])
      expect(mocks.llmStreamStructured).toHaveBeenCalledTimes(1)
    } else {
      expect(res.json()).toEqual({ error: { code: "llm_error", message: LLM_CONTENT_REFUSAL_MESSAGE } })
      expect(mocks.llmCompleteStructured).toHaveBeenCalledTimes(1)
    }
    expect(mocks.jobUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error_message: LLM_CONTENT_REFUSAL_MESSAGE }))
    expect(mocks.commitReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(mocks.refundReservedCreditsForJob).not.toHaveBeenCalled()
    expect(mocks.commitReservedCreditsForJobAtPrice).not.toHaveBeenCalled()
  })

  it("a refusal that came back with no billed usage is refunded", async () => {
    mocks.llmCompleteStructured.mockRejectedValueOnce(new LlmContentRefusalError("refused", { inputTokens: 0, outputTokens: 0, complete: false }))
    const res = await app.inject({ method: "POST", url: URL, payload: VALID })
    expect(res.statusCode).toBe(502)
    expect(mocks.llmCompleteStructured).toHaveBeenCalledTimes(1)
    expect(mocks.refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(mocks.commitReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("a requested Gemini model that fails is not re-asked", async () => {
    mocks.llmCompleteStructured.mockRejectedValueOnce(new LlmLaneError("KIE.ai chat-completions failed (503)", { lane: "kie", httpStatus: 503 }))
    expect((await app.inject({ method: "POST", url: URL, payload: { ...VALID, llmModel: "gemini-3.8-flash" } })).statusCode).toBe(502)
    expect(mocks.llmCompleteStructured).toHaveBeenCalledTimes(1)
  })

  it("Gemini fails too: the job fails, the reservation is refunded, nothing is committed", async () => {
    mocks.llmCompleteStructured
      .mockRejectedValueOnce(drained())
      .mockRejectedValueOnce(new LlmLaneError("KIE.ai chat-completions gemini-3.8-flash failed (503)", { lane: "kie", httpStatus: 503 }))
    const res = await app.inject({ method: "POST", url: URL, payload: VALID })
    expect(res.statusCode).toBe(502)
    expect(mocks.llmCompleteStructured).toHaveBeenCalledTimes(2)
    expect(mocks.jobUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }))
    expect(mocks.refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(mocks.commitReservedCreditsForJob).not.toHaveBeenCalled()
    expect(mocks.commitReservedCreditsForJobAtPrice).not.toHaveBeenCalled()
  })

  it.each([
    ["the direct lane (it saw the photo)", [answer({ person: {}, styling: { top: "" } }, "direct-anthropic")]],
    ["the Gemini fallback", [answer({}, "kie"), answer({ person: { "hair-color": [] } }, "kie")]],
  ])("an empty read from %s fails uncharged on the JSON path, and is not re-asked", async (_label, answers) => {
    for (const a of answers) mocks.llmCompleteStructured.mockResolvedValueOnce(a)
    const res = await app.inject({ method: "POST", url: URL, payload: VALID })
    expect(res.statusCode).toBe(502)
    expect(res.json()).toEqual({ error: { code: "llm_error", message: EMPTY_PICKER_READ_MESSAGE } })
    expect(mocks.llmCompleteStructured).toHaveBeenCalledTimes(answers.length)
    expect(mocks.jobUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error_message: EMPTY_PICKER_READ_MESSAGE }))
    expect(completedRow()).toBeUndefined()
    expect(mocks.refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(mocks.commitReservedCreditsForJob).not.toHaveBeenCalled()
    expect(mocks.commitReservedCreditsForJobAtPrice).not.toHaveBeenCalled()
  })

  it("an empty read on the streamed path ends in an error event, not done, and is refunded", async () => {
    mocks.llmStreamStructured.mockResolvedValueOnce(answer({ person: {} }, "direct-anthropic"))
    const res = await app.inject({ method: "POST", url: URL, payload: VALID, headers: SSE })
    const evts = events(res.payload)
    expect(evts.map((e) => e.type)).toEqual(["error"])
    expect(evts[0].data).toEqual({ code: "llm_error", message: EMPTY_PICKER_READ_MESSAGE })
    expect(mocks.refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(mocks.commitReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("streamed: Claude fails before writing anything, Gemini answers — the stream ends in done (Gemini's answer does not stream fields)", async () => {
    mocks.llmStreamStructured.mockRejectedValueOnce(drained()).mockResolvedValueOnce(answer(READ, "kie"))
    const res = await app.inject({ method: "POST", url: URL, payload: VALID, headers: SSE })
    const evts = events(res.payload)
    expect(evts.map((e) => e.type)).toEqual(["done"])
    expect(evts[0].data).toEqual({ jobId: "job-1", pickerJson: READ })
    expect(requests(mocks.llmStreamStructured).map((r) => r.modelId)).toEqual(["claude-opus-5.5", "gemini-3.8-flash"])
    expect(mocks.commitReservedCreditsForJobAtPrice).toHaveBeenCalledWith("job-1", "describe-to-picker:economy")
  })

  it("streamed: a failure after a field was sent is never followed by another model", async () => {
    mocks.llmStreamStructured.mockImplementationOnce(async (_req: unknown, _schema: unknown, opts: { onToolJson?: (p: string) => void }) => {
      opts.onToolJson?.('{"person":{"age":"age-30s"')
      throw new LlmLaneError("KIE.ai messages stream failed (503)", { lane: "kie", httpStatus: 503 })
    })
    const res = await app.inject({ method: "POST", url: URL, payload: VALID, headers: SSE })
    expect(events(res.payload).map((e) => e.type)).toEqual(["field", "error"])
    expect(mocks.llmStreamStructured).toHaveBeenCalledTimes(1)
    expect(mocks.refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
  })
})

describe("isEmptyPickerRead", () => {
  it("is empty only when no target section holds a value", () => {
    expect(isEmptyPickerRead({}, ["person"])).toBe(true)
    expect(isEmptyPickerRead({ person: {}, styling: { top: "", tags: [] } }, ["person", "styling"])).toBe(true)
    expect(isEmptyPickerRead({ framing: { shot: "close-up" } }, ["person"])).toBe(true)
    expect(isEmptyPickerRead({ person: { "hair-color": ["hair-black"] } }, ["person", "styling"])).toBe(false)
  })
})

// The reconciliation sweep fails and refunds an anthropic-sync row past its
// threshold, so the whole request — Claude at its slowest, every lane, the
// direct-tool backup, then Gemini — must end before it.
describe("describe-to-picker's runtime budget", () => {
  const claudeWorstMs = (LLM_STRUCTURED_DEFAULT_ATTEMPTS * LLM_MAX_LANES_PER_CALL + LLM_STRUCTURED_DIRECT_BACKUP_ASKS) * effortTimeoutMs("max")!
  const prefetchMs = 30_000

  it("fits under the anthropic-sync threshold", () => {
    expect(DESCRIBE_TO_PICKER_MAX_RUNTIME_MS).toBeLessThanOrEqual(STALE_THRESHOLD_MS["anthropic-sync"])
  })

  it("the worst Claude run plus a capped Gemini run stays inside it, without touching the timeout floor", () => {
    const elapsed = prefetchMs + claudeWorstMs
    const perLane = fallbackLaneTimeoutMs(elapsed)
    expect(perLane).toBeGreaterThan(10_000)
    expect(elapsed + LLM_STRUCTURED_DEFAULT_ATTEMPTS * LLM_MAX_LANES_PER_CALL * perLane).toBeLessThanOrEqual(DESCRIBE_TO_PICKER_MAX_RUNTIME_MS)
  })

  it("a Claude failure that came back at once leaves Gemini the client's default timeout", () => {
    expect(fallbackLaneTimeoutMs(1_000)).toBe(120_000)
  })
})

describe("pickerFallbackReason", () => {
  const opus = getLlmModel("claude-opus-5.5")!
  it("is only for a Claude analyzer", () => {
    expect(pickerFallbackReason(getLlmModel("gemini-3.8-flash")!, new LlmLaneError("x", { lane: "kie", httpStatus: 503 }))).toBeUndefined()
  })
  it("reads a wrapped failure through its cause chain", () => {
    const wrapped = new StructuredLlmError("x", { inputTokens: 0, outputTokens: 0, complete: true }, {
      cause: Anthropic.APIError.generate(503, undefined, "unavailable", new Headers()),
    })
    expect(pickerFallbackReason(opus, wrapped)).toBe("the direct lane failed (503)")
  })
  it("a KIE failure after a direct request error is the request's, after a direct 5xx the platform's", () => {
    const kie = (cause: unknown) => Object.assign(new LlmLaneError("kie 503", { lane: "kie", httpStatus: 503 }), { cause })
    expect(pickerFallbackReason(opus, kie(Anthropic.APIError.generate(400, undefined, "bad image", new Headers())))).toBeUndefined()
    expect(pickerFallbackReason(opus, kie(Anthropic.APIError.generate(529, undefined, "overloaded", new Headers())))).toBe("the direct lane failed (529)")
    expect(pickerFallbackReason(opus, kie(undefined))).toBe("the KIE lane failed (503)")
    // A drained account's raw reply is a 400 too — typed as exhaustion first.
    expect(pickerFallbackReason(opus, kie(new LlmPlatformExhaustedError("drained", { lane: "direct", provider: "anthropic", exhaustion: "billing" })))).toBe("the anthropic platform account refused (billing)")
  })

  it("a direct lane error that is the request's own is not platform-side", () => {
    expect(pickerFallbackReason(opus, new LlmLaneError("x", { lane: "direct", httpStatus: 400 }))).toBeUndefined()
    expect(pickerFallbackReason(opus, new Error("plain"))).toBeUndefined()
  })
})
