/**
 * Pitch & Tempo is priced per started input minute (decided 2026-10-12): a run
 * reserves `pitch-tempo:<N>m`, which every lookup prices as the `pitch-tempo`
 * rate row × N — the single lookup (Run button, reservations), the price table
 * (listings, estimates) and the static fallback alike.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { db, settings, edition } = vi.hoisted(() => ({
  db: {
    rows: [] as Array<{ model_identifier: string; credit_cost: number }>,
    /** PostgREST's max_rows: the most rows one response can carry. */
    cap: 1000,
    /** How many whole-table reads fail before one succeeds. */
    failReads: 0,
    rangeCalls: 0,
  },
  settings: {
    value: { cost_markup_percent: 0, service_margin_percent: {} as Record<string, number> },
  },
  edition: { hasCredits: true },
}))

function modelPricingQuery() {
  let identifier: string | undefined
  const query = {
    select: () => query,
    order: () => query,
    eq: (_column: string, value: string) => {
      identifier = value
      return query
    },
    single: async () => {
      const row = db.rows.find((r) => r.model_identifier === identifier)
      return row
        ? { data: { credit_cost: row.credit_cost, is_enabled: true, tier_restriction: null }, error: null }
        : { data: null, error: { code: "PGRST116" } }
    },
    range: async (from: number, to: number) => {
      db.rangeCalls++
      if (db.failReads > 0) {
        db.failReads--
        return { data: null, error: { message: "connection reset" } }
      }
      const sorted = [...db.rows].sort((a, b) => a.model_identifier.localeCompare(b.model_identifier))
      return { data: sorted.slice(from, Math.min(to + 1, from + db.cap)), error: null }
    },
  }
  return query
}

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "model_pricing") throw new Error(`unexpected table ${table}`)
      return modelPricingQuery()
    },
  },
}))

vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: async () => settings.value,
}))

vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, hasCredits: () => edition.hasCredits }
})

import {
  CreditsService,
  STATIC_CREDIT_COSTS,
  chargedCredits,
  getChargedPriceTable,
  getModelCreditBaseCost,
  getModelCreditCostFromDB,
  invalidateModelPricingCache,
} from "../credits.js"


beforeEach(() => {
  db.rows = []
  settings.value = { cost_markup_percent: 0, service_margin_percent: {} }
  edition.hasCredits = true
  invalidateModelPricingCache()
})

describe("pitch-tempo per-minute ids", () => {
  it("has a 20-credit rate row in the static table and no stored minutes rows", () => {
    expect(STATIC_CREDIT_COSTS["pitch-tempo"]).toBe(20)
    expect(Object.keys(STATIC_CREDIT_COSTS).filter((id) => id.startsWith("pitch-tempo:"))).toEqual([])
  })

  it("prices the minutes ids from the static rate row when the database has none", async () => {
    const table = await getChargedPriceTable()
    expect(table.base("pitch-tempo:1m")).toBe(20)
    expect(table.base("pitch-tempo:4m")).toBe(80)
    expect(table.base("pitch-tempo:30m")).toBe(600)
    expect((await getModelCreditBaseCost("pitch-tempo:30m")).creditCost).toBe(600)
  })

  it("follows a retuned rate row, in the single lookup and the table alike", async () => {
    db.rows = [{ model_identifier: "pitch-tempo", credit_cost: 25 }]
    settings.value = { cost_markup_percent: 10, service_margin_percent: {} }
    const table = await getChargedPriceTable()
    expect(table.base("pitch-tempo:2m")).toBe(50)
    for (const id of ["pitch-tempo:1m", "pitch-tempo:2m", "pitch-tempo:17m"]) {
      expect(chargedCredits(table, id), id).toBe((await getModelCreditCostFromDB(id)).creditCost)
    }
    // 25 × 2 = 50, marked up once → 55.
    expect(chargedCredits(table, "pitch-tempo:2m")).toBe(55)
  })

  it("does not price an out-of-range minutes id", async () => {
    const table = await getChargedPriceTable()
    expect(table.base("pitch-tempo:31m")).toBeUndefined()
    expect(table.base("pitch-tempo:0m")).toBeUndefined()
  })
})

describe("pitch-tempo in a workflow estimate", () => {
  it("quotes one minute when the input's length is not known before the run", async () => {
    expect(await CreditsService.estimateWorkflowCredits([{ id: "pt", type: "pitch-tempo", data: {} }])).toBe(20)
  })

  it("quotes the started minutes of a length the graph tells (a fixed Trim window)", async () => {
    const trim = { id: "trim", type: "trim-video", data: { trimMode: "time", startTime: 0, endTime: 190 } }
    const pt = { id: "pt", type: "pitch-tempo", data: {} }
    const edges = [{ source: "trim", target: "pt", targetHandle: "in" }]
    const withPt = await CreditsService.estimateWorkflowCredits([trim, pt], edges)
    const trimAlone = await CreditsService.estimateWorkflowCredits([trim], [])
    expect(withPt - trimAlone).toBe(80)
  })
})
