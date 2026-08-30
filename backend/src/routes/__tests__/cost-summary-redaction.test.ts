import { describe, it, expect, afterEach, vi } from "vitest"
import Fastify from "fastify"

const from = vi.fn()
vi.mock("../../lib/supabase.js", () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))

import { workflowCostRoutes } from "../workflow-costs.js"
import { sanitizeCostSummaryForPublic } from "../jobs.js"
import { setBillingProvider, clearBillingProvider, type BillingProvider } from "../../lib/billing-provider.js"

/**
 * SAI-7 / A2 — USD is admin-only on the cost-summary wire.
 *
 * The invariant is KEY ABSENCE for a non-admin, which is un-fakeable: a
 * `null` here already means "the authority could not price this" and must
 * keep meaning exactly that. Credits, counts and the breakdown shape are
 * untouched; admins keep the full shape and the exact provider sums.
 */

afterEach(() => {
  clearBillingProvider()
  from.mockReset()
})

function build(role: "user" | "admin") {
  const app = Fastify()
  app.addHook("onRequest", async (req) => {
    ;(req as { userId?: string }).userId = "u1"
    ;(req as { userRole?: string }).userRole = role
  })
  app.register(workflowCostRoutes)
  return app
}

const ROWS = [
  { id: "j1", status: "completed", input_data: { type: "generate-image", provider: "flux" } },
  { id: "j2", status: "completed", input_data: { type: "generate-image", provider: "flux" } },
  { id: "j3", status: "failed", input_data: { type: "generate-video", provider: "veo3" } },
]

// Non-admins are owner-scoped (.eq), admins are not — the chain ends one call
// earlier for them, so both shapes have to resolve.
function mockJobs(rows: unknown[]) {
  const resolved = Promise.resolve({ data: rows, error: null })
  const eq = vi.fn().mockReturnValue(resolved)
  const inFn = vi.fn().mockReturnValue(Object.assign(resolved, { eq }))
  from.mockReturnValue({ select: vi.fn().mockReturnValue({ in: inFn }) })
}

/** A stub authority that prices every job with credits AND a USD secondary. */
const priced: BillingProvider = {
  id: "stub-cloud",
  displayUnit: "credits",
  async report(ids) {
    return new Map(ids.map((id) => [id, { amount: 12, unit: "credits", secondaryAmount: 0.4213, secondaryUnit: "usd" }]))
  },
  async account() {
    return null
  },
}

describe("POST /v1/jobs/cost-summary — USD redaction (SAI-7)", () => {
  it("non-admin: total_cost_usd is ABSENT top-level and on every breakdown row; credits unchanged", async () => {
    mockJobs(ROWS)
    setBillingProvider(priced)
    const res = await build("user").inject({ method: "POST", url: "/v1/jobs/cost-summary", payload: { jobIds: ["j1", "j2", "j3"] } })
    expect(res.statusCode).toBe(200)
    const d = res.json().data

    expect(Object.hasOwn(d, "total_cost_usd")).toBe(false)
    expect(d.breakdown.length).toBe(2)
    expect(d.breakdown.every((r: Record<string, unknown>) => !("total_cost_usd" in r))).toBe(true)

    // Everything that is not USD survives byte-for-byte.
    expect(d.total_credits).toBe(36)
    expect(d.total_jobs).toBe(3)
    expect(d.unavailable).toBe(0)
    const image = d.breakdown.find((r: { node_type: string }) => r.node_type === "generate-image")
    expect(image).toMatchObject({ model: "flux", runs: 2, successful: 2, failed: 0, total_credits: 24, avg_credits_per_run: 12 })
  })

  it("admin: total_cost_usd present and equal to the provider's secondary sums", async () => {
    mockJobs(ROWS)
    setBillingProvider(priced)
    const res = await build("admin").inject({ method: "POST", url: "/v1/jobs/cost-summary", payload: { jobIds: ["j1", "j2", "j3"] } })
    const d = res.json().data
    expect(d.total_cost_usd).toBeCloseTo(3 * 0.4213, 6)
    const image = d.breakdown.find((r: { node_type: string }) => r.node_type === "generate-image")
    expect(image.total_cost_usd).toBeCloseTo(2 * 0.4213, 6)
  })

  it("carries the provider's unit with the figures (H13) — for admins and non-admins alike", async () => {
    mockJobs(ROWS)
    setBillingProvider(priced)
    for (const role of ["user", "admin"] as const) {
      const res = await build(role).inject({ method: "POST", url: "/v1/jobs/cost-summary", payload: { jobIds: ["j1"] } })
      expect(res.json().data.unit).toBe("credits")
    }
  })

  it("non-admin: an unpriced batch still says null for credits (unavailable), and still no USD key", async () => {
    mockJobs(ROWS)
    setBillingProvider({ id: "mute", displayUnit: "usd", async report() { return null }, async account() { return null } })
    const res = await build("user").inject({ method: "POST", url: "/v1/jobs/cost-summary", payload: { jobIds: ["j1"] } })
    const d = res.json().data
    expect(d.total_credits).toBeNull() // "could not say", preserved
    expect(Object.hasOwn(d, "total_cost_usd")).toBe(false)
    expect(d.unit).toBe("usd")
  })
})

describe("sanitizeCostSummaryForPublic", () => {
  const summary = {
    total_credits: 5,
    total_cost_usd: 0.1,
    unit: "credits",
    total_jobs: 1,
    unavailable: 0,
    breakdown: [{ node_type: "x", model: "m", runs: 1, successful: 1, failed: 0, total_credits: 5, total_cost_usd: 0.1, avg_credits_per_run: 5, unavailable: 0 }],
  }
  it("returns the SAME object for an admin (identity — nothing is rebuilt)", () => {
    expect(sanitizeCostSummaryForPublic(summary, true)).toBe(summary)
  })
  it("deletes the key (does not null it) for a non-admin, and does not mutate the input", () => {
    const out = sanitizeCostSummaryForPublic(summary, false)
    expect("total_cost_usd" in out).toBe(false)
    expect("total_cost_usd" in out.breakdown[0]).toBe(false)
    expect(out.unit).toBe("credits")
    expect(summary.total_cost_usd).toBe(0.1) // input untouched
    expect(summary.breakdown[0].total_cost_usd).toBe(0.1)
  })
})
