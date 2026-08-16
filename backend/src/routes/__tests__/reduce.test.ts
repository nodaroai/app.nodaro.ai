import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"

vi.mock("../../services/reduce-strategies/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../services/reduce-strategies/index.js")>(
    "../../services/reduce-strategies/index.js",
  )
  return {
    ...actual,
    dispatchStrategy: vi.fn(),
  }
})

// The connected-install proxy: the AI judge is an LLM call and goes to the
// cloud when this install has no LLM key and a live connection; every other
// strategy stays local. Default: local (keyed / not connected).
const cloudMocks = vi.hoisted(() => ({
  maybeProxyLlmRouteToCloud: vi.fn<(req: unknown, reply: { status: (c: number) => { send: (b: unknown) => unknown } }, path: string) => Promise<boolean>>(async () => false),
}))
vi.mock("../../lib/cloud-llm-proxy.js", () => ({ maybeProxyLlmRouteToCloud: cloudMocks.maybeProxyLlmRouteToCloud }))
vi.mock("../../middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: vi.fn().mockResolvedValue({ usageLogId: "usage-1" }),
}))

vi.mock("../../ee/billing/credits.js", () => ({
  CreditsService: {
    commitCredits: vi.fn().mockResolvedValue(undefined),
    refundCredits: vi.fn().mockResolvedValue(undefined),
  },
}))

// Counter used by the supabase mock so each `jobs.insert(...).select().single()`
// returns a fresh id — needed for the "no dedup" test that asserts the two
// responses have different jobIds.
let nextJobId = 0

vi.mock("../../lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      // commitReservedCreditsForJob / refundReservedCreditsForJob fetch reserved
      // usage_logs via supabase.from("usage_logs").select("id").eq("job_id", ...).eq("status", "reserved")
      // — return an empty list so they no-op (the credit mocks below handle the
      // assertion that they were called; for the route we only care that the
      // .eq().eq() chain resolves).
      if (table === "usage_logs") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }
      }
      // jobs table — supports both INSERT...SELECT...SINGLE and
      // UPDATE...EQ("id", ...).EQ("user_id", ...).
      return {
        insert: () => ({
          select: () => ({
            single: () => {
              nextJobId += 1
              return Promise.resolve({ data: { id: `job-${nextJobId}` }, error: null })
            },
          }),
        }),
        update: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        }),
      }
    },
  },
}))

async function buildTestApp() {
  const { reduceRoutes } = await import("../reduce.js")
  const app = Fastify()
  app.addHook("preHandler", async (req, reply) => {
    // Stub Node socket timeouts that Fastify inject() doesn't populate; matches
    // the pattern used by ai-writer.test.ts and other sibling route tests.
    req.raw.setTimeout = (() => {}) as never
    reply.raw.setTimeout = (() => {}) as never
    ;(req as unknown as { userId: string }).userId = "test-user-1"
  })
  await app.register(reduceRoutes)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  nextJobId = 0
  cloudMocks.maybeProxyLlmRouteToCloud.mockResolvedValue(false)
})

describe("POST /v1/reduce — the AI judge on the nodaro.ai connection", () => {
  it("forwards pick-best-llm to the cloud when the install has no LLM key and is connected — no local job, no local dispatch", async () => {
    cloudMocks.maybeProxyLlmRouteToCloud.mockImplementation(async (_req: unknown, reply: { status: (c: number) => { send: (b: unknown) => unknown } }) => {
      reply.status(200).send({ jobId: "cloud-job", output: "B", meta: { winnerIndex: 1 } })
      return true
    })
    const { dispatchStrategy } = await import("../../services/reduce-strategies/index.js")
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/reduce",
      payload: { strategyId: "pick-best-llm", strategyConfig: { criteria: "best" }, inputs: ["A", "B"] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ jobId: "cloud-job", output: "B" })
    expect(cloudMocks.maybeProxyLlmRouteToCloud).toHaveBeenCalledWith(expect.anything(), expect.anything(), "/v1/reduce")
    expect(dispatchStrategy).not.toHaveBeenCalled()
  })

  it("never forwards a local strategy (concat) — no LLM in it, nothing for the cloud to add", async () => {
    const { dispatchStrategy } = await import("../../services/reduce-strategies/index.js")
    vi.mocked(dispatchStrategy).mockResolvedValue({ output: "A B", meta: {} } as never)
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/reduce",
      payload: { strategyId: "concat", strategyConfig: {}, inputs: ["A", "B"] },
    })
    expect(res.statusCode).toBe(200)
    expect(cloudMocks.maybeProxyLlmRouteToCloud).not.toHaveBeenCalled()
  })

  it("answers 503 provider_unavailable (not 500) when no LLM can judge — the same shape as every other LLM route", async () => {
    const { dispatchStrategy } = await import("../../services/reduce-strategies/index.js")
    const { LlmProviderUnavailableError } = await import("../../lib/llm-client.js")
    vi.mocked(dispatchStrategy).mockRejectedValue(new LlmProviderUnavailableError("No provider for LLM nodes — no provider is configured. Add KIE_API_KEY or ANTHROPIC_API_KEY in Install health → Provider keys, or connect nodaro.ai."))
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST", url: "/v1/reduce",
      payload: { strategyId: "pick-best-llm", strategyConfig: { criteria: "best" }, inputs: ["A", "B"] },
    })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("provider_unavailable")
    expect(res.json().error.message).toMatch(/ANTHROPIC_API_KEY/)
  })
})

describe("POST /v1/reduce", () => {
  it("400s on invalid strategyId", async () => {
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/reduce",
      payload: { strategyId: "not-real", strategyConfig: {}, inputs: ["a"] },
    })
    expect(res.statusCode).toBe(400)
  })

  it("happy path: returns { jobId, output, meta }", async () => {
    const { dispatchStrategy } = await import("../../services/reduce-strategies/index.js")
    vi.mocked(dispatchStrategy).mockResolvedValue({
      result: "a-b",
      meta: { summary: "joined 2" },
    })
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/reduce",
      payload: { strategyId: "concat", strategyConfig: { separator: "-" }, inputs: ["a", "b"] },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.output).toBe("a-b")
    expect(body.meta.summary).toBe("joined 2")
    expect(body.jobId).toBeTruthy()
    // Inputs are NOT echoed back — the frontend already has them locally and
    // the orchestrator doesn't read them off the response.
    expect(body.inputs).toBeUndefined()
  })

  // The AI judge bills by its chosen model's tier (like every LLM node);
  // the reservation id must reflect the strategyConfig.llmModel the user picked.
  it.each([
    [undefined, "reduce:pick-best-llm"],
    ["claude-sonnet-4.6", "reduce:pick-best-llm"],
    ["gemini-3.6-flash", "reduce:pick-best-llm:economy"],
    ["claude-opus-4.8", "reduce:pick-best-llm:premium"],
  ])("pick-best-llm with llmModel=%s reserves credits under %s", async (llmModel, expectedId) => {
    const { dispatchStrategy } = await import("../../services/reduce-strategies/index.js")
    const { reserveCreditsForJob } = await import("../../middleware/credit-guard.js")
    vi.mocked(dispatchStrategy).mockResolvedValue({ result: "a", meta: { summary: "Chose #1 of 2: ok", selectedIndex: 0 } })
    vi.mocked(reserveCreditsForJob).mockClear()
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/reduce",
      payload: {
        strategyId: "pick-best-llm",
        strategyConfig: { criteria: "best", inputKind: "text", ...(llmModel ? { llmModel } : {}) },
        inputs: ["a", "b"],
      },
    })
    expect(res.statusCode).toBe(200)
    const reserveArgs = vi.mocked(reserveCreditsForJob).mock.calls[0]
    expect(reserveArgs[3]).toBe(expectedId)
  })

  it("400s on an unknown judge model before any credits reserve", async () => {
    const { reserveCreditsForJob } = await import("../../middleware/credit-guard.js")
    vi.mocked(reserveCreditsForJob).mockClear()
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/reduce",
      payload: { strategyId: "pick-best-llm", strategyConfig: { criteria: "best", llmModel: "not-a-model" }, inputs: ["a", "b"] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(vi.mocked(reserveCreditsForJob)).not.toHaveBeenCalled()
  })

  it("does NOT dedup identical bodies within 10s (dedup: false)", async () => {
    const { dispatchStrategy } = await import("../../services/reduce-strategies/index.js")
    vi.mocked(dispatchStrategy).mockResolvedValue({ result: "x", meta: { summary: "ok" } })
    const app = await buildTestApp()
    const payload = { strategyId: "concat", strategyConfig: { separator: "-" }, inputs: ["a", "b"] }
    const res1 = await app.inject({ method: "POST", url: "/v1/reduce", payload })
    const res2 = await app.inject({ method: "POST", url: "/v1/reduce", payload })
    expect(res1.statusCode).toBe(200)
    expect(res2.statusCode).toBe(200)
    expect(res2.headers["x-dedup-hit"]).toBeUndefined()
    expect(res1.json().jobId).not.toBe(res2.json().jobId)
  })

  it("400 with no_valid_inputs on EmptyInputError", async () => {
    const { dispatchStrategy, EmptyInputError } = await import(
      "../../services/reduce-strategies/index.js"
    )
    vi.mocked(dispatchStrategy).mockRejectedValue(new EmptyInputError())
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/reduce",
      payload: {
        strategyId: "pick-best-llm",
        strategyConfig: { criteria: "x", inputKind: "text" },
        inputs: ["", ""],
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("no_valid_inputs")
  })
})
