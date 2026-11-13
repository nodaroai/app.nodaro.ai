// @test-units-by-name names no node unit: it prices the Seedance 2.5 Extend rate rows of STATIC_CREDIT_COSTS (extend-video is a legacy node)
/**
 * `@nodaro/shared`'s `seedanceExtendSourceCreditId` (decided 2026-11-13) is the
 * ONE id a client names a Seedance 2.5 Extend run on a known source by, and it
 * is priced at exactly what that run is charged: the server's quote resolution
 * (the batch endpoint's price table and the single GET) answers it with the
 * route's own charge — `seedanceExtendBaseCredits`, the render rule
 * `seedanceExtendPrice` priced on its rate row, marked up once at the rate —
 * here at a non-default price setting.
 *
 * The seconds rule it reads lives in `@nodaro/shared` and `@nodaro/render-rules`
 * re-exports it: one rule, never two copies.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { settings } = vi.hoisted(() => ({
  settings: { current: { cost_markup_percent: 10, service_margin_percent: { "seedance-2-5-extend": 25 } as Record<string, number> } },
}))
vi.mock("@/lib/config.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/config.js")>()), hasCredits: () => true }))
// No model_pricing rows: every price falls back to STATIC_CREDIT_COSTS.
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
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => settings.current }))

import * as credits from "@nodaro/shared/credits"
import { seedanceExtendFullWindowCreditId, seedanceExtendSourceCreditId } from "@nodaro/shared/credits"
import * as renderRules from "@nodaro/render-rules"
import { seedanceExtendPrice } from "@nodaro/render-rules"
import { CreditsService, chargedCredits, getChargedPriceTable, invalidateModelPricingCache } from "../credits.js"
import { applyServiceMarkup } from "../service-margin.js"
import { seedanceExtendBaseCredits } from "../../../lib/seedance-extend-credits.js"
import { parseRateQuoteCreditId } from "../../../lib/unit-quote-rates.js"
import { TAIL_RECIPES } from "../../../lib/extend-recipe.js"

const SOURCES = [1.8, 4, 8.04, 8.3, 10.05, 25]
const ADDED = [4, 8, 30]
const RESOLUTIONS = ["480p", "720p", "1080p"]

beforeEach(() => {
  invalidateModelPricingCache()
})

describe("seedanceExtendSourceCreditId, priced through the server's quote resolution, is the run's charge", () => {
  it("every source × seconds added × resolution: the id parses, and both lookups answer the route's charge", async () => {
    const table = await getChargedPriceTable()
    let cases = 0
    for (const source of SOURCES) {
      for (const duration of ADDED) {
        for (const resolution of RESOLUTIONS) {
          const label = `${source} s + ${duration} s at ${resolution}`
          const id = seedanceExtendSourceCreditId(source, duration, resolution)!
          const price = seedanceExtendPrice({ duration, resolution, sourcePictureSec: source })
          // The id names the rule's own rate row and units, exactly.
          expect(parseRateQuoteCreditId(id), label).toStrictEqual({ rateId: price.rateId, units: price.units })
          // What the route holds and the worker settles on that measured source, marked up once at the rate.
          const charge = applyServiceMarkup(await seedanceExtendBaseCredits({ duration, resolution, sourcePictureSec: source }), settings.current as never, price.rateId)
          expect(chargedCredits(table, id), label).toBe(charge)
          expect(chargedCredits(table, price.rateId, price.units), label).toBe(charge)
          expect(await CreditsService.getModelCreditCost(id), label).toBe(charge)
          cases++
        }
      }
    }
    expect(cases).toBe(SOURCES.length * ADDED.length * RESOLUTIONS.length)
  })

  it("the shortest source an extend takes (1.8 s) with the fewest seconds added is the fewest units a quote may name", () => {
    expect(parseRateQuoteCreditId(seedanceExtendSourceCreditId(1.8, 4, "720p")!)).toStrictEqual({ rateId: "seedance-2-5-extend:720p:per-2s", units: 2.9 })
  })

  // A shorter source is refused by the extend (the route before it reserves,
  // the worker before it generates), so no run on it is made or charged, and
  // the helper names none — whatever the seconds added: an id built from such
  // a source with more seconds added would clear the lookups' unit floor and
  // be answered at the price of a run on some other source.
  it.each([[1.7, 4], [1.7, 8], [1.0, 8], [0.5, 30]])("a %s s source, %s s added: no id (the extend refuses the source)", (source, duration) => {
    expect(seedanceExtendSourceCreditId(source, duration, "720p")).toBeUndefined()
  })

  it("…the same floor the route and the worker refuse at, compared as measured", () => {
    const floor = TAIL_RECIPES["seedance-2-5-extend"].minSourceSec
    for (const sec of [floor - 0.01, floor - 1e-9]) expect(seedanceExtendSourceCreditId(sec, 8, "720p"), String(sec)).toBeUndefined()
    expect(seedanceExtendSourceCreditId(floor, 8, "720p")).toBeDefined()
  })

  it("1.8 s + 8 s, the shortest source with more added: the id both lookups answer at the run's charge", async () => {
    const table = await getChargedPriceTable()
    const id = seedanceExtendSourceCreditId(1.8, 8, "720p")!
    const price = seedanceExtendPrice({ duration: 8, resolution: "720p", sourcePictureSec: 1.8 })
    expect(parseRateQuoteCreditId(id)).toStrictEqual({ rateId: price.rateId, units: price.units })
    const charge = applyServiceMarkup(await seedanceExtendBaseCredits({ duration: 8, resolution: "720p", sourcePictureSec: 1.8 }), settings.current as never, price.rateId)
    expect(chargedCredits(table, id)).toBe(charge)
    expect(await CreditsService.getModelCreditCost(id)).toBe(charge)
  })

  it("a source not known is the full-window id, never below a run on any source", async () => {
    const table = await getChargedPriceTable()
    for (const duration of ADDED) {
      for (const resolution of RESOLUTIONS) {
        const full = chargedCredits(table, seedanceExtendFullWindowCreditId(duration, resolution))!
        expect(seedanceExtendSourceCreditId(undefined, duration, resolution)).toBe(seedanceExtendFullWindowCreditId(duration, resolution))
        for (const source of SOURCES) expect(chargedCredits(table, seedanceExtendSourceCreditId(source, duration, resolution)!)).toBeLessThanOrEqual(full)
      }
    }
  })
})

describe("one seconds rule", () => {
  it("@nodaro/render-rules re-exports @nodaro/shared's functions, never a copy", () => {
    for (const name of ["seedanceExtendAddedSec", "seedanceExtendSourceSec", "seedanceExtendSentSec", "seedanceExtendUnits"] as const) {
      expect(renderRules[name], name).toBe(credits[name])
    }
  })
})
