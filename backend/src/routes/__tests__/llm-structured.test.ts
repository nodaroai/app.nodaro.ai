/**
 * POST /v1/llm/structured — the generic forced-schema LLM call.
 *
 * Covers the four things that are easy to get wrong on a route that spends
 * money: the pre-flight 400s (so nothing is reserved for a call that cannot
 * run), the credit lifecycle (reserve → commit on 200, refund on 502), what
 * the job row is allowed to store, and the fact that a caller's maxTokens
 * actually reaches the model outside Advanced mode.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const mocks = vi.hoisted(() => ({
  maybeProxyLlmRouteToCloud: vi.fn(),
  insertJob: vi.fn(),
  jobUpdate: vi.fn(),
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
  creditGuard: () => async () => {},
  reserveCreditsForJob: mocks.reserveCreditsForJob,
}))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({
  commitReservedCreditsForJob: mocks.commitReservedCreditsForJob,
  refundReservedCreditsForJob: mocks.refundReservedCreditsForJob,
}))
vi.mock("@/lib/reconcile/persistence.js", () => ({ markProviderCallStart: mocks.markProviderCallStart }))
vi.mock("@/lib/llm-client.js", () => ({ llmCompleteStructured: mocks.llmCompleteStructured }))
vi.mock("@/lib/supabase.js", () => {
  // .update({...}).eq("id", …).eq("user_id", …) — the exact chain the route uses.
  const second = vi.fn().mockResolvedValue({ data: null, error: null })
  const first = vi.fn(() => ({ eq: second }))
  return {
    supabase: {
      from: vi.fn(() => ({
        update: (row: Record<string, unknown>) => {
          mocks.jobUpdate(row)
          return { eq: first }
        },
      })),
    },
  }
})

import { llmStructuredRoutes } from "../llm-structured.js"

const USER_ID = "00000000-0000-4000-8000-000000000001"
const SCHEMA = { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false }
const VALID = { system: "You plan productions.", input: "A rainy chase through Rome.", jsonSchema: SCHEMA, userId: USER_ID }

let app: FastifyInstance

async function post(payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/v1/llm/structured", payload })
}

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.maybeProxyLlmRouteToCloud.mockResolvedValue(false)
  mocks.insertJob.mockResolvedValue({ data: { id: "job-1" }, error: null })
  mocks.reserveCreditsForJob.mockResolvedValue({ usageLogId: "usage-1" })
  mocks.commitReservedCreditsForJob.mockResolvedValue(undefined)
  mocks.refundReservedCreditsForJob.mockResolvedValue(0)
  mocks.markProviderCallStart.mockResolvedValue(undefined)
  mocks.llmCompleteStructured.mockResolvedValue({ output: { title: "Rain in Rome" }, inputTokens: 14000, outputTokens: 9000 })

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const body = req.body as Record<string, unknown> | undefined
    if (typeof body?.userId === "string") req.userId = body.userId
  })
  await app.register(async (instance) => { await llmStructuredRoutes(instance) })
  await app.ready()
})

afterEach(async () => { await app.close() })

describe("POST /v1/llm/structured — refusals that cost nothing", () => {
  it("forwards to the cloud and creates nothing when the proxy handles the call", async () => {
    // The real proxy sends the cloud's answer itself and returns true; the
    // stub must do the same, or Fastify sees a handler that resolved with
    // nothing and the assertions read a framework error instead of the route.
    mocks.maybeProxyLlmRouteToCloud.mockImplementation(async (_req: unknown, reply: { status: (n: number) => { send: (b: unknown) => unknown } }) => {
      reply.status(200).send({ jobId: "cloud-1", output: {}, usage: { inputTokens: 1, outputTokens: 1 } })
      return true
    })
    const res = await post(VALID)
    expect(res.json().jobId).toBe("cloud-1")
    expect(mocks.insertJob).not.toHaveBeenCalled()
    expect(mocks.reserveCreditsForJob).not.toHaveBeenCalled()
  })

  it("400s an empty input", async () => {
    const res = await post({ ...VALID, input: "" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("400s a jsonSchema that is not an object schema", async () => {
    const res = await post({ ...VALID, jsonSchema: { type: "string" } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain('type "object"')
  })

  it("400s a schema z.fromJSONSchema cannot convert, before reserving credits", async () => {
    const res = await post({ ...VALID, jsonSchema: { type: "object", properties: { a: { not: { type: "string" } } } } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(res.json().error.message).toContain("could not be converted")
    expect(mocks.reserveCreditsForJob).not.toHaveBeenCalled()
  })

  it("400s a maxTokens above the chosen model's own output limit", async () => {
    // deriveParams floors the cap UP for reasoning but never clamps it down,
    // so an over-cap value would otherwise reach the vendor after the reserve.
    const res = await post({ ...VALID, llmModel: "gemini-3.6-flash", maxTokens: 16384 })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toContain("8192")
    expect(mocks.insertJob).not.toHaveBeenCalled()
  })

  it("400s Advanced mode on a model with no direct lane", async () => {
    const res = await post({ ...VALID, llmModel: "claude-fable-5", advancedMode: true })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("advanced_mode_unsupported")
  })

  it("401s an unauthenticated call", async () => {
    const { userId: _drop, ...anonymous } = VALID
    const res = await post(anonymous)
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe("unauthorized")
  })

  it("503s when no LLM key is configured", async () => {
    const { config } = await import("../../lib/config.js")
    const original = config.ANTHROPIC_API_KEY
    ;(config as Record<string, unknown>).ANTHROPIC_API_KEY = ""
    const res = await post(VALID)
    ;(config as Record<string, unknown>).ANTHROPIC_API_KEY = original
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("provider_unavailable")
  })
})

describe("POST /v1/llm/structured — the successful call", () => {
  it("answers with the validated output and the usage in the BODY", async () => {
    const res = await post({ ...VALID, schemaName: "studio_production" })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      jobId: "job-1",
      output: { title: "Rain in Rome" },
      usage: { inputTokens: 14000, outputTokens: 9000 },
    })
  })

  it("reserves against the model's own llm-structured tier and commits on success", async () => {
    await post({ ...VALID, llmModel: "claude-fable-5" })
    expect(mocks.reserveCreditsForJob).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), "job-1", "llm-structured:premium",
    )
    expect(mocks.commitReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(mocks.refundReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("defaults to the generic chat model, billed at its economy tier", async () => {
    await post(VALID)
    expect(mocks.reserveCreditsForJob).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), "job-1", "llm-structured:economy",
    )
  })

  it("stores digests, never the raw system prompt or the raw schema", async () => {
    const system = "S".repeat(3000)
    await post({ ...VALID, system, schemaName: "studio_production" })
    const row = mocks.insertJob.mock.calls[0][1] as { input_data: Record<string, unknown> }
    const stored = row.input_data
    expect(stored.type).toBe("llm-structured")
    expect(stored.system).toEqual({
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      chars: 3000,
      head: system.slice(0, 500),
    })
    expect(stored.jsonSchema).toEqual({ name: "studio_production", bytes: Buffer.byteLength(JSON.stringify(SCHEMA), "utf8") })
    expect(JSON.stringify(stored)).not.toContain(system)
  })

  it("passes a caller's maxTokens through to the model OUTSIDE Advanced mode", async () => {
    await post({ ...VALID, llmModel: "claude-fable-5", maxTokens: 16384, maxRetries: 2 })
    const request = mocks.llmCompleteStructured.mock.calls[0][0] as Record<string, unknown>
    expect(request.maxTokens).toBe(16384)
    // Not the client's 120s default: a 12k-token forced-schema completion
    // outruns it, and every retry re-sends the whole legend prompt.
    expect(request.timeoutMs).toBe(240_000)
    expect(request.requireLane).toBeUndefined()
    expect(request.system).toBe(VALID.system)
    expect(request.messages).toEqual([{ role: "user", content: VALID.input }])
    expect(mocks.llmCompleteStructured.mock.calls[0][2]).toEqual({ schemaName: undefined, maxRetries: 2 })
  })

  it("marks the job completed with the output and usage", async () => {
    await post(VALID)
    expect(mocks.jobUpdate).toHaveBeenCalledWith({
      status: "completed",
      output_data: { output: { title: "Rain in Rome" }, inputTokens: 14000, outputTokens: 9000 },
    })
  })
})

describe("POST /v1/llm/structured — the failed call", () => {
  it("502s, fails the job and refunds when the model never returns valid JSON", async () => {
    mocks.llmCompleteStructured.mockRejectedValue(new Error("llm-structured: validation failed after 3 attempt(s): (root): Invalid input"))
    const res = await post(VALID)
    expect(res.statusCode).toBe(502)
    expect(res.json().error.code).toBe("llm_error")
    expect(mocks.jobUpdate).toHaveBeenCalledWith({
      status: "failed",
      output_data: { error: "llm-structured: validation failed after 3 attempt(s): (root): Invalid input" },
    })
    expect(mocks.refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(mocks.commitReservedCreditsForJob).not.toHaveBeenCalled()
  })
})
