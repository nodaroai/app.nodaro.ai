// @test-units-by-name names no node unit: it reads only the pixverse-v6-extend and grok-extend rows of STATIC_CREDIT_COSTS (Extend Video is a legacy node)
/**
 * The credit audit (theoretical mode) compares a KIE model's cost with what
 * we charge for it. A key priced only through composite rows — its
 * per-length / per-resolution rows (`pixverse-v6-extend:<N>s:<quality>`,
 * `grok-extend:<N>s:<res>`), with no bare row of its own — has no single
 * price, and the provider's records do not say which row each task was
 * charged at. So it is compared with the rows that cover each billed amount:
 * - no row covers an amount: UNDERPRICED (every charge of the key is below it);
 * - otherwise CHECK_TIERS, with the cheapest covering row per amount — never
 *   OK, since a task charged at a cheaper row than the one that covers it
 *   would be under-priced and nothing here can tell. Never UNDERPRICED at a
 *   bare price of 0, either: that read every such key as under-priced
 *   whenever KIE billed its tasks one fixed amount.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import Fastify from "fastify"

const { kie } = vi.hoisted(() => ({
  kie: { records: [] as Array<{ taskId: string; consumeCredits: number; model: string; state: string }> },
}))

vi.mock("@/ee/middleware/require-admin.js", () => ({ requireAdmin: async () => {} }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => ({ cost_markup_percent: 0, service_margin_percent: {} }) }))
vi.mock("@/providers/kie/credit-lookup.js", () => ({
  fetchAllKieLogs: async () => ({ records: kie.records, sources: [], errors: [], rawSamples: [] }),
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: () => { throw new Error("theoretical mode reads no table") } } }))

const { adminCreditAuditRoutes } = await import("../admin-credit-audit.js")
const { GROK_EXTEND_WIRE_MODEL, KIE_CREDIT_USD, PIXVERSE_V6_EXTEND_WIRE_MODEL } = await import("../../../providers/kie/models.js")
const { CREDIT_BASE_USD } = await import("@nodaro/shared/models")
const { STATIC_CREDIT_COSTS } = await import("../../billing/credits.js")

/** `count` successful KIE tasks of `model`, each billed `credits` KIE credits. */
const tasks = (model: string, credits: number, count = 3) =>
  Array.from({ length: count }, (_, i) => ({ taskId: `${model}-${credits}-${i}`, consumeCredits: credits, model, state: "success" }))

/** The key's composite rows, ascending. */
const rowsOf = (key: string) =>
  Object.entries(STATIC_CREDIT_COSTS).filter(([id]) => id.startsWith(`${key}:`)).map(([, credits]) => credits).sort((a, b) => a - b)

/** Our credits a KIE cost needs at no markup. */
const required = (kieCredits: number) => Math.ceil(kieCredits / (CREDIT_BASE_USD / KIE_CREDIT_USD))

async function theoretical() {
  const app = Fastify()
  await app.register(adminCreditAuditRoutes)
  const res = await app.inject({ method: "POST", url: "/v1/admin/credit-audit/sync", payload: { token: "t" } })
  await app.close()
  expect(res.statusCode).toBe(200)
  const body = res.json() as { mismatches: number; models: Array<Record<string, unknown>> }
  return { mismatches: body.mismatches, byModel: new Map(body.models.map((m) => [m.kieModel as string, m])) }
}

beforeEach(() => {
  kie.records = []
})

describe("credit audit (theoretical) — a key priced only through composite rows", () => {
  it.each([
    ["pixverse-v6-extend", PIXVERSE_V6_EXTEND_WIRE_MODEL, 48],
    ["grok-extend", GROK_EXTEND_WIRE_MODEL, 27],
  ])("%s, billed an amount between its cheapest and dearest rows, is CHECK_TIERS with the row that covers it — never OK", async (key, wire, credits) => {
    // The premise: no bare row, only composite rows, and the cost lies between the cheapest and the dearest.
    expect(STATIC_CREDIT_COSTS[key]).toBeUndefined()
    const rows = rowsOf(key)
    expect(rows[0]!).toBeLessThan(required(credits))
    expect(rows.at(-1)!).toBeGreaterThanOrEqual(required(credits))

    kie.records = tasks(wire, credits)
    const { byModel, mismatches } = await theoretical()
    const row = byModel.get(wire)!
    expect(row.ourKey).toBe(key)
    expect(row.variable).toBe(false)
    expect(row.status).toBe("CHECK_TIERS")
    // Counted among the results to look at, not as matched.
    expect(mismatches).toBe(1)
    // No single price of its own, and no diff a reader could take for a match.
    expect(row.ourCredits).toBeNull()
    expect(row.diff).toBeNull()
    // The cheapest row that covers the billed amount.
    expect(row.tierBreakdown).toEqual([
      { kieCost: credits, tasks: 3, required: required(credits), bestTier: rows.find((r) => r >= required(credits)), covered: true },
    ])
  })

  it("a cost even the cheapest row covers is still CHECK_TIERS: the key's charges are never reported as plain OK", async () => {
    const rows = rowsOf("grok-extend")
    // KIE credits worth no more than the cheapest row.
    const credits = Math.floor((rows[0]! * CREDIT_BASE_USD) / KIE_CREDIT_USD)
    expect(required(credits)).toBeLessThanOrEqual(rows[0]!)
    kie.records = tasks(GROK_EXTEND_WIRE_MODEL, credits)
    expect((await theoretical()).byModel.get(GROK_EXTEND_WIRE_MODEL)!.status).toBe("CHECK_TIERS")
  })

  it("a variable cost of such a key is CHECK_TIERS too, each billed amount with its covering row", async () => {
    kie.records = [...tasks(GROK_EXTEND_WIRE_MODEL, 27), ...tasks(GROK_EXTEND_WIRE_MODEL, 15, 2)]
    const row = (await theoretical()).byModel.get(GROK_EXTEND_WIRE_MODEL)!
    expect(row.variable).toBe(true)
    expect(row.status).toBe("CHECK_TIERS")
    expect((row.tierBreakdown as Array<{ kieCost: number }>).map((t) => t.kieCost).sort((a, b) => a - b)).toEqual([15, 27])
  })

  it("still flags a cost that none of the key's rows covers", async () => {
    // KIE credits worth more than the dearest row, at no markup.
    kie.records = tasks(GROK_EXTEND_WIRE_MODEL, rowsOf("grok-extend").at(-1)! + 100)
    const row = (await theoretical()).byModel.get(GROK_EXTEND_WIRE_MODEL)!
    expect(row.status).toBe("UNDERPRICED")
    expect(row.diff as number).toBeLessThan(0)
  })
})
