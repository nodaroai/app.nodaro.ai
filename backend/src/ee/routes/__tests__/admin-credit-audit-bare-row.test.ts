// @test-units-by-name names no node unit: it reads only the wan-2.7 rows of STATIC_CREDIT_COSTS (an image model, no node type)
/**
 * The credit audit (theoretical mode), for a key WITH a bare row and dearer
 * composite rows (`wan-2.7`: its bare row, and its per-size rows above it).
 * The bare row is the one a task of the key is charged at; a dearer composite
 * row covering a billed amount says only that SOME charge of the key covers
 * it. So each billed amount is judged by the row that would be charged:
 * - the bare row covers it: as before (OK, or OVERPRICED far above the cost);
 * - only another row covers it: CHECK_TIERS — never OK;
 * - no row covers it: UNDERPRICED.
 * The same for a variable cost (each billed amount on its own) and a fixed one.
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

const { adminCreditAuditRoutes, buildModelMap } = await import("../admin-credit-audit.js")
const { KIE_CREDIT_USD } = await import("../../../providers/kie/models.js")
const { CREDIT_BASE_USD } = await import("@nodaro/shared/models")
const { STATIC_CREDIT_COSTS } = await import("../../billing/credits.js")

const KEY = "wan-2.7"
const WIRE = "wan/2-7-image"
const BARE = STATIC_CREDIT_COSTS[KEY]!
const ROWS = Object.entries(STATIC_CREDIT_COSTS).filter(([id]) => id.startsWith(`${KEY}:`)).map(([, c]) => c).sort((a, b) => a - b)

/** KIE credits per one of ours. */
const PER_CREDIT = CREDIT_BASE_USD / KIE_CREDIT_USD
/** Our credits a KIE cost needs at no markup. */
const required = (kieCredits: number) => Math.ceil(kieCredits / PER_CREDIT)
/** The most KIE credits `credits` of ours cover. */
const coveredBy = (credits: number) => Math.floor(credits * PER_CREDIT)

/** `count` successful KIE tasks of the key's model, each billed `credits` KIE credits. */
const tasks = (credits: number, count = 3) =>
  Array.from({ length: count }, (_, i) => ({ taskId: `${WIRE}-${credits}-${i}`, consumeCredits: credits, model: WIRE, state: "success" }))

async function audited(): Promise<Record<string, unknown>> {
  const app = Fastify()
  await app.register(adminCreditAuditRoutes)
  const res = await app.inject({ method: "POST", url: "/v1/admin/credit-audit/sync", payload: { token: "t" } })
  await app.close()
  expect(res.statusCode).toBe(200)
  const body = res.json() as { models: Array<Record<string, unknown>> }
  return body.models.find((m) => m.kieModel === WIRE)!
}

/** KIE credits the bare row does not cover but a dearer row does. */
const ONLY_DEARER = coveredBy(BARE) + Math.max(1, Math.floor(PER_CREDIT))
/** KIE credits no row covers. */
const ABOVE_ALL = coveredBy(ROWS.at(-1)!) + 10

beforeEach(() => {
  kie.records = []
})

describe("credit audit (theoretical) — a key with a bare row and dearer rows", () => {
  it("the premise: the key's model maps to it alone, and its bare row is below a composite row", () => {
    expect(buildModelMap().get(WIRE)?.map((m) => m.ourKey)).toEqual([KEY])
    expect(ROWS.at(-1)!).toBeGreaterThan(BARE)
    expect(required(ONLY_DEARER)).toBeGreaterThan(BARE)
    expect(required(ONLY_DEARER)).toBeLessThanOrEqual(ROWS.at(-1)!)
    expect(required(ABOVE_ALL)).toBeGreaterThan(ROWS.at(-1)!)
  })

  it("a variable cost whose dearer level only a composite row covers is CHECK_TIERS, never OK", async () => {
    kie.records = [...tasks(coveredBy(BARE)), ...tasks(ONLY_DEARER, 2)]
    const row = await audited()
    expect(row.variable).toBe(true)
    expect(row.status).toBe("CHECK_TIERS")
    expect(row.ourCredits).toBe(BARE)
    expect(row.diff).toBeNull()
  })

  it("a fixed cost above the bare row that a dearer row covers is CHECK_TIERS, with that row", async () => {
    kie.records = tasks(ONLY_DEARER)
    const row = await audited()
    expect(row.variable).toBe(false)
    expect(row.status).toBe("CHECK_TIERS")
    expect(row.ourCredits).toBe(BARE)
    expect(row.diff).toBeNull()
    expect(row.tierBreakdown).toEqual([
      { kieCost: ONLY_DEARER, tasks: 3, required: required(ONLY_DEARER), bestTier: ROWS.find((r) => r >= required(ONLY_DEARER)), covered: true },
    ])
  })

  it("a cost the bare row covers is OK, fixed or variable", async () => {
    kie.records = tasks(coveredBy(BARE))
    expect((await audited()).status).toBe("OK")
    kie.records = [...tasks(coveredBy(BARE)), ...tasks(coveredBy(BARE) - 1, 2)]
    const row = await audited()
    expect(row.variable).toBe(true)
    expect(row.status).toBe("OK")
  })

  it("a cost above every row is UNDERPRICED, fixed or variable", async () => {
    kie.records = tasks(ABOVE_ALL)
    expect((await audited()).status).toBe("UNDERPRICED")
    kie.records = [...tasks(coveredBy(BARE)), ...tasks(ABOVE_ALL, 2)]
    const row = await audited()
    expect(row.variable).toBe(true)
    expect(row.status).toBe("UNDERPRICED")
    expect(row.diff as number).toBeLessThan(0)
  })

  it("a cost far below the bare row is still OVERPRICED", async () => {
    kie.records = tasks(1)
    expect((await audited()).status).toBe("OVERPRICED")
  })
})
