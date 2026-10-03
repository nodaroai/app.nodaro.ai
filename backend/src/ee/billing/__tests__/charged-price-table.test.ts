/**
 * THE LISTED PRICE IS THE CHARGED PRICE.
 *
 * `getChargedPriceTable` prices the surfaces that list many prices at once —
 * `GET /v1/models`, MCP `list_models`, `GET /v1/nodes` and the workflow
 * estimates. The Run button and every reservation price through the single
 * lookup `getModelCreditCostFromDB`. When the two disagreed, users saw one
 * price and paid another (listed 150, charged 165), so the headline case here
 * runs both over the same database and settings and requires the same number
 * for every identifier.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { imageOverlayCredits } from "@nodaro/shared"

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
  getModelCreditCostFromDB,
  invalidateModelPricingCache,
} from "../credits.js"

const STATIC_IDS = Object.keys(STATIC_CREDIT_COSTS)
/** A composite family, so a per-service margin covers more than one row. */
const MARGIN_PREFIX = STATIC_IDS.find((id) => id.includes(":"))!.split(":")[0]!
/** A static price the database overrides. */
const OVERRIDDEN = STATIC_IDS.find((id) => (STATIC_CREDIT_COSTS[id] ?? 0) > 0)!

beforeEach(() => {
  db.rows = []
  db.cap = 1000
  db.failReads = 0
  db.rangeCalls = 0
  settings.value = { cost_markup_percent: 0, service_margin_percent: {} }
  edition.hasCredits = true
  invalidateModelPricingCache()
})

describe("getChargedPriceTable", () => {
  it("prices every identifier exactly as the Run button's single lookup does", async () => {
    db.rows = [
      { model_identifier: OVERRIDDEN, credit_cost: 999 },
      { model_identifier: "db-only-model", credit_cost: 7 },
    ]
    settings.value = { cost_markup_percent: 10, service_margin_percent: { [MARGIN_PREFIX]: 25 } }
    const sample = [
      ...STATIC_IDS.slice(0, 60),
      ...STATIC_IDS.filter((id) => id === MARGIN_PREFIX || id.startsWith(`${MARGIN_PREFIX}:`)),
      OVERRIDDEN,
      "db-only-model",
    ]

    const table = await getChargedPriceTable()
    for (const id of sample) {
      const single = await getModelCreditCostFromDB(id)
      expect(chargedCredits(table, id), id).toBe(single.creditCost)
    }
    // Not vacuous: the database, the global markup and the service margin each moved a price.
    expect(chargedCredits(table, OVERRIDDEN)).toBe(Math.ceil((999 * 110) / 100))
    expect(chargedCredits(table, "db-only-model")).toBe(8)
    const margined = STATIC_IDS.find((id) => id.startsWith(`${MARGIN_PREFIX}:`) && (STATIC_CREDIT_COSTS[id] ?? 0) > 0)!
    expect(chargedCredits(table, margined)).toBe(Math.ceil((STATIC_CREDIT_COSTS[margined]! * 125) / 100))
  })

  it("reads the rows past a capped page — a short page never ends the read", async () => {
    db.cap = 2
    db.rows = ["m-a", "m-b", "m-c", "m-d", "m-e"].map((id) => ({ model_identifier: id, credit_cost: 5 }))
    const table = await getChargedPriceTable()
    for (const row of db.rows) expect(table.base(row.model_identifier), row.model_identifier).toBe(5)
  })

  it("a failed read prices from the static table alone, and the next request reads again", async () => {
    db.rows = [{ model_identifier: OVERRIDDEN, credit_cost: 999 }]
    db.failReads = 1
    expect((await getChargedPriceTable()).base(OVERRIDDEN)).toBe(STATIC_CREDIT_COSTS[OVERRIDDEN])
    expect((await getChargedPriceTable()).base(OVERRIDDEN)).toBe(999)
  })

  it("is cached, and an admin price edit (invalidateModelPricingCache) drops it", async () => {
    db.rows = [{ model_identifier: OVERRIDDEN, credit_cost: 999 }]
    expect((await getChargedPriceTable()).base(OVERRIDDEN)).toBe(999)
    db.rows = [{ model_identifier: OVERRIDDEN, credit_cost: 555 }]
    expect((await getChargedPriceTable()).base(OVERRIDDEN)).toBe(999)
    invalidateModelPricingCache()
    expect((await getChargedPriceTable()).base(OVERRIDDEN)).toBe(555)
  })

  it("units multiply the base before the markup, as a computed reservation does", async () => {
    db.rows = [{ model_identifier: "per-second-rate", credit_cost: 3 }]
    settings.value = { cost_markup_percent: 10, service_margin_percent: {} }
    const table = await getChargedPriceTable()
    // 3 × 7 = 21 marked up once → ceil(23.1) = 24, never 7 × ceil(3.3) = 28.
    expect(chargedCredits(table, "per-second-rate", 7)).toBe(24)
    expect(chargedCredits(table, "priced-nowhere")).toBeUndefined()
  })
})

describe("CreditsService.estimateWorkflowCredits — what a run will be charged", () => {
  const OVERLAY_VARIANTS = ["x-header", "youtube-thumbnail"]

  it("prices each node the way its reservation will", async () => {
    settings.value = { cost_markup_percent: 10, service_margin_percent: {} }
    db.rows = [{ model_identifier: "nano-banana-2", credit_cost: 30 }]
    const overlayBase = imageOverlayCredits(OVERLAY_VARIANTS)
    expect(overlayBase).toBeGreaterThan(10) // the variants are billable

    const estimate = await CreditsService.estimateWorkflowCredits([
      { type: "generate-image", data: { provider: "nano-banana-2" } },
      { type: "image-overlay", data: { variants: OVERLAY_VARIANTS } },
    ])
    // The database row, marked up; Image Overlay's formula total, marked up
    // ONCE as a whole, the way its route's creditGuard reserves it.
    expect(estimate).toBe(Math.ceil((30 * 110) / 100) + Math.ceil((overlayBase * 110) / 100))
  })

  it("falls back to the node type's row when its model identifier is priced nowhere", async () => {
    settings.value = { cost_markup_percent: 10, service_margin_percent: {} }
    const typeBase = STATIC_CREDIT_COSTS["generate-image"]!
    const estimate = await CreditsService.estimateWorkflowCredits([
      { type: "generate-image", data: { provider: "no-such-model" } },
    ])
    expect(estimate).toBe(Math.ceil((typeBase * 110) / 100))
  })

  it("at no markup and no database rows it equals the static base estimate", async () => {
    const nodes = [
      { type: "generate-image", data: { provider: "nano-banana-2" } },
      { type: "image-overlay", data: { variants: OVERLAY_VARIANTS } },
      { type: "extract-audio" },
      { type: "text-prompt" },
    ]
    expect(await CreditsService.estimateWorkflowCredits(nodes)).toBe(CreditsService.estimateWorkflowBaseCredits(nodes))
  })

  it("without a credit system it quotes the static base and reads no price table", async () => {
    edition.hasCredits = false
    settings.value = { cost_markup_percent: 10, service_margin_percent: {} }
    const nodes = [{ type: "generate-image", data: { provider: "nano-banana-2" } }]
    expect(await CreditsService.estimateWorkflowCredits(nodes)).toBe(CreditsService.estimateWorkflowBaseCredits(nodes))
    expect(db.rangeCalls).toBe(0)
  })
})
