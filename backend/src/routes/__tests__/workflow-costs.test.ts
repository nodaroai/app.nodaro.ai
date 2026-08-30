import { describe, it, expect, afterEach, vi } from "vitest"
import Fastify from "fastify"

const from = vi.fn()
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))

import { workflowCostRoutes } from "../workflow-costs.js"
import { setBillingProvider, clearBillingProvider, type BillingProvider } from "../../lib/billing-provider.js"

afterEach(() => { clearBillingProvider(); from.mockReset() })

// Authenticated app: mirrors the real auth hook by hard-coding a non-admin caller.
function build() {
  const app = Fastify()
  app.addHook("onRequest", async (req) => {
    ;(req as { userId?: string }).userId = "u1"
    ;(req as { userRole?: string }).userRole = "user"
  })
  app.register(workflowCostRoutes)
  return app
}

// UNauthenticated app: no onRequest hook → req.userId stays unset, so the route's
// IDOR guard must reject before any service-role query runs.
function buildNoAuth() {
  const app = Fastify()
  app.register(workflowCostRoutes)
  return app
}

// Non-admin query chain: supabase.from("jobs").select(...).in(...).eq("user_id", uid).
// Returns the eq spy so owner-scoping can be asserted.
function mockJobsQuery(rows: unknown[] | null, error: unknown = null) {
  const eq = vi.fn().mockResolvedValue({ data: rows, error })
  const inFn = vi.fn().mockReturnValue({ eq })
  const select = vi.fn().mockReturnValue({ in: inFn })
  from.mockReturnValue({ select })
  return { select, in: inFn, eq }
}

describe("POST /v1/jobs/cost-summary", () => {
  // ---- Restored security/validation guard tests (IDOR-sensitive service-role route) ----

  it("returns 401 when unauthenticated and never queries jobs without an owner (IDOR guard)", async () => {
    const app = buildNoAuth()
    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/cost-summary",
      payload: { jobIds: ["j1"] }, // no auth hook → req.userId unset
    })
    expect(res.statusCode).toBe(401)
    // The service-role query (which bypasses RLS) must NOT run without a user.
    // `supabase.from` delegates to this spy, so this asserts the DB was never touched.
    expect(from).not.toHaveBeenCalled()
  })

  it("returns 400 for empty jobIds array", async () => {
    const app = build()
    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/cost-summary",
      payload: { jobIds: [] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 400 for >500 jobIds (batch cap)", async () => {
    const app = build()
    const jobIds = Array.from({ length: 501 }, (_, i) => `job-${i}`)
    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/cost-summary",
      payload: { jobIds },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })

  it("returns 500 on DB error", async () => {
    mockJobsQuery(null, { message: "DB connection failed" })
    const app = build()
    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/cost-summary",
      payload: { jobIds: ["j1"] },
    })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
  })

  it("scopes the query to the caller (.eq(user_id)) for a non-admin owner (IDOR ownership scope)", async () => {
    const { eq } = mockJobsQuery([
      { id: "j1", status: "completed", input_data: { type: "generate-image", provider: "nano-banana" } },
    ])
    const app = build() // userRole = "user" → non-admin
    const res = await app.inject({
      method: "POST",
      url: "/v1/jobs/cost-summary",
      payload: { jobIds: ["j1"] },
    })
    expect(res.statusCode).toBe(200)
    expect(eq).toHaveBeenCalledWith("user_id", "u1")
  })

  // ---- Money-nullability tests (BillingProvider.report → null-not-zero) ----

  it("keeps unavailable jobs out of the total instead of counting them as 0", async () => {
    from.mockReturnValue({ select: () => ({ in: () => ({ eq: () => Promise.resolve({
      data: [
        { id: "j1", status: "completed", input_data: { type: "generate-image", provider: "nano-banana" } },
        { id: "j2", status: "completed", input_data: { type: "generate-image", provider: "nano-banana" } },
      ], error: null }) }) }) })
    const p: BillingProvider = {
      id: "nodaro-cloud", displayUnit: "credits",
      async report() {
        return new Map([
          ["j1", { amount: 10, unit: "credits", secondaryAmount: 0.02, secondaryUnit: "usd" }],
          ["j2", { amount: null, unit: "credits", secondaryAmount: null, secondaryUnit: "usd" }],
        ])
      },
      async account() { return null },
    }
    setBillingProvider(p)
    const app = build()
    const res = await app.inject({ method: "POST", url: "/v1/jobs/cost-summary", payload: { jobIds: ["j1", "j2"] } })
    const d = res.json().data
    expect(d.total_credits).toBe(10)   // NOT 10 + 0
    expect(d.unavailable).toBe(1)
    expect(d.breakdown[0].unavailable).toBe(1)
  })

  it("totals are null (not 0) when the whole batch is unavailable", async () => {
    from.mockReturnValue({ select: () => ({ in: () => ({ eq: () => Promise.resolve({
      data: [{ id: "j1", status: "completed", input_data: { type: "generate-image", provider: "x" } }], error: null }) }) }) })
    const p: BillingProvider = {
      id: "none-ish", displayUnit: "usd",
      async report() { return null }, async account() { return null },
    }
    setBillingProvider(p)
    const app = build()
    const res = await app.inject({ method: "POST", url: "/v1/jobs/cost-summary", payload: { jobIds: ["j1"] } })
    const d = res.json().data
    expect(d.total_credits).toBeNull()
    // USD is admin-only on this wire (SAI-7): for this non-admin caller the key
    // is ABSENT — `null` would wrongly say "the authority could not price it".
    expect("total_cost_usd" in d).toBe(false)
    expect(d.unavailable).toBe(1)
  })
})
