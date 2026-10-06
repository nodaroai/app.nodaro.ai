/**
 * A `:per-100-chars` row is a RATE a client may only apply while the server
 * charges by length. The public price reads therefore serve it only while
 * SPEECH_LENGTH_PRICING_ENABLED is on — that absence is how the editor,
 * Studio and every other client learn the flag's state (spec §5.7). The
 * reservation path (getModelCreditBaseCost) is NOT filtered: the seams read
 * it only while the flag is on, and hiding it there would 503 a reservation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const flag = vi.hoisted(() => ({ on: false }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, hasCredits: () => true, speechLengthPricingEnabled: () => flag.on }
})

// No model_pricing rows: every price falls back to STATIC_CREDIT_COSTS (the
// `supabase` mock shape of charged-price-table.test.ts, which this file mirrors).
function modelPricingQuery() {
  const query = {
    select: () => query,
    order: () => query,
    eq: () => query,
    single: async () => ({ data: null, error: { code: "PGRST116" } }),
    range: async () => ({ data: [], error: null }),
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
  getAppSettings: async () => ({ cost_markup_percent: 0, service_margin_percent: {} }),
}))

import {
  CreditsService,
  PriceNotConfiguredError,
  STATIC_CREDIT_COSTS,
  chargedCredits,
  getChargedPriceTable,
  getModelCreditBaseCost,
  invalidateModelPricingCache,
} from "../credits.js"
import { chargedPricing } from "../../../lib/mcp/tools/models.js"
import { MODEL_CATALOG, SPEECH_UNIT_CREDIT_SUFFIX } from "@nodaro/shared"

const UNIT = "elevenlabs-v4:per-100-chars"
const UNIT_IDS = Object.keys(STATIC_CREDIT_COSTS).filter((k) => k.endsWith(SPEECH_UNIT_CREDIT_SUFFIX))

beforeEach(() => invalidateModelPricingCache())

describe("flag OFF — unit rows are priced nowhere on the public reads", () => {
  beforeEach(() => {
    flag.on = false
  })

  it("the static table does carry unit rows (the cases below are not vacuous)", () => {
    expect(UNIT_IDS).toContain(UNIT)
    expect(UNIT_IDS.length).toBeGreaterThanOrEqual(6)
  })

  it("the price table answers undefined for every :per-100-chars id, and the flat rows as today", async () => {
    const table = await getChargedPriceTable()
    for (const id of UNIT_IDS) {
      expect(table.base(id), id).toBeUndefined()
      expect(chargedCredits(table, id, 8), id).toBeUndefined()
    }
    expect(table.base("elevenlabs-v4")).toBe(30)
    expect(chargedCredits(table, "elevenlabs-v4")).toBe(30)
  })

  it("the single lookup refuses the unit id the way it refuses an id priced nowhere", async () => {
    await expect(CreditsService.getModelCreditCost(UNIT)).rejects.toBeInstanceOf(PriceNotConfiguredError)
    expect(await CreditsService.getModelCreditCost("elevenlabs-v4")).toBe(30)
  })

  it("the reservation path still reads the row — the seams are not affected", async () => {
    expect((await getModelCreditBaseCost(UNIT)).creditCost).toBe(4)
  })

  it("list_models / GET /v1/models drop the unit row instead of showing the catalog figure", async () => {
    const table = await getChargedPriceTable()
    const prices = { credits: (id: string, units?: number) => chargedCredits(table, id, units) }
    // Whatever rows the catalog carries, a unit row is dropped; a flat row that
    // the table does not price keeps its catalog figure, as today.
    const rows = chargedPricing(
      [...MODEL_CATALOG["elevenlabs-v4"]!.pricing, { identifier: UNIT, credits: 4 }, { identifier: "not-priced-anywhere", credits: 9 }],
      prices,
    )
    expect(rows.map((r) => r.identifier)).toEqual(["elevenlabs-v4", "not-priced-anywhere"])
    expect(rows[1]!.credits).toBe(9)
  })
})

describe("flag ON — unit rows are served at the charged price", () => {
  beforeEach(() => {
    flag.on = true
  })

  it("the table prices the unit row and multiplies units before the markup", async () => {
    const table = await getChargedPriceTable()
    expect(table.base(UNIT)).toBe(4)
    expect(chargedCredits(table, UNIT, 8)).toBe(32)
    expect(await CreditsService.getModelCreditCost(UNIT)).toBe(4)
  })

  it("list_models serves both rows, the flat one first", async () => {
    const table = await getChargedPriceTable()
    const prices = { credits: (id: string, units?: number) => chargedCredits(table, id, units) }
    expect(chargedPricing(MODEL_CATALOG["elevenlabs-v4"]!.pricing, prices).map((r) => r.identifier)).toEqual(["elevenlabs-v4", UNIT])
  })
})
