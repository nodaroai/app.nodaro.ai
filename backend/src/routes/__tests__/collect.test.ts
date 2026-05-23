import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"

vi.mock("../../services/collect-strategies/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../services/collect-strategies/index.js")>(
    "../../services/collect-strategies/index.js",
  )
  return {
    ...actual,
    dispatchStrategy: vi.fn(),
  }
})

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
  const { collectRoutes } = await import("../collect.js")
  const app = Fastify()
  app.addHook("preHandler", async (req, reply) => {
    // Stub Node socket timeouts that Fastify inject() doesn't populate; matches
    // the pattern used by ai-writer.test.ts and other sibling route tests.
    req.raw.setTimeout = (() => {}) as never
    reply.raw.setTimeout = (() => {}) as never
    ;(req as unknown as { userId: string }).userId = "test-user-1"
  })
  await app.register(collectRoutes)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  nextJobId = 0
})

describe("POST /v1/collect", () => {
  it("400s on invalid strategyId", async () => {
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/collect",
      payload: { strategyId: "not-real", strategyConfig: {}, inputs: ["a"] },
    })
    expect(res.statusCode).toBe(400)
  })

  it("happy path: returns { jobId, output, meta }", async () => {
    const { dispatchStrategy } = await import("../../services/collect-strategies/index.js")
    vi.mocked(dispatchStrategy).mockResolvedValue({
      result: "a-b",
      meta: { summary: "joined 2" },
    })
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/collect",
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

  it("does NOT dedup identical bodies within 10s (dedup: false)", async () => {
    const { dispatchStrategy } = await import("../../services/collect-strategies/index.js")
    vi.mocked(dispatchStrategy).mockResolvedValue({ result: "x", meta: { summary: "ok" } })
    const app = await buildTestApp()
    const payload = { strategyId: "concat", strategyConfig: { separator: "-" }, inputs: ["a", "b"] }
    const res1 = await app.inject({ method: "POST", url: "/v1/collect", payload })
    const res2 = await app.inject({ method: "POST", url: "/v1/collect", payload })
    expect(res1.statusCode).toBe(200)
    expect(res2.statusCode).toBe(200)
    expect(res2.headers["x-dedup-hit"]).toBeUndefined()
    expect(res1.json().jobId).not.toBe(res2.json().jobId)
  })

  it("400 with no_valid_inputs on EmptyInputError", async () => {
    const { dispatchStrategy, EmptyInputError } = await import(
      "../../services/collect-strategies/index.js"
    )
    vi.mocked(dispatchStrategy).mockRejectedValue(new EmptyInputError())
    const app = await buildTestApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/collect",
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
