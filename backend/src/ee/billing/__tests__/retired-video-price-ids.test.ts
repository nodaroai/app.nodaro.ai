// @test-units-by-name names no node unit: it reads only the STATIC_CREDIT_COSTS rows of the models the retired video ids run as (Seedance 2 Mini, Seedance 2.5 Extend)
/**
 * A RETIRED VIDEO MODEL'S PRICE ID IS PRICED AS THE ID OF THE MODEL IT RUNS AS.
 *
 * A retired video model (`RETIRED_VIDEO_PROVIDERS`) runs as another model, so
 * every price answer for one of its ids — `GET /v1/credits/model-cost` (the
 * single lookup), the batch table behind `/v1/credits/model-costs`, the model
 * lists and the estimates, and the stated prices of the MCP tool hints — is
 * the answer for the same id spelled with the model it runs as. A stale
 * `model_pricing` row left under the old spelling (`seedance-2-extend:8s:720p`
 * at 530 in production, while that run is charged as Seedance 2.5) is never
 * read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { RETIRED_VIDEO_PROVIDERS } from "@nodaro/shared/models"

const { db, settings } = vi.hoisted(() => ({
  db: { rows: [] as Array<{ model_identifier: string; credit_cost: number }> },
  settings: { value: { cost_markup_percent: 0, service_margin_percent: {} as Record<string, number> } },
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
      const sorted = [...db.rows].sort((a, b) => a.model_identifier.localeCompare(b.model_identifier))
      return { data: sorted.slice(from, to + 1), error: null }
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
  return { ...orig, hasCredits: () => true }
})

import {
  CreditsService,
  PriceNotConfiguredError,
  STATIC_CREDIT_COSTS,
  chargedCredits,
  getChargedPriceTable,
  getModelCreditBaseCost,
  getModelCreditCostFromDB,
  invalidateModelPricingCache,
} from "../credits.js"
import { statedPrices } from "../stated-prices.js"
import { applyServiceMarkup, effectiveMarkupPercent } from "../service-margin.js"

const RETIRED = "seedance-2-extend:8s:720p"
const RUNS_AS = "seedance-2-5-extend:8s:720p"

beforeEach(() => {
  db.rows = []
  settings.value = { cost_markup_percent: 0, service_margin_percent: {} }
  invalidateModelPricingCache()
})

/** Every price answer for `id`: the single lookup (base and charged), the public quote, the batch table, the stated price. */
async function answersFor(id: string) {
  const outcome = async <T>(read: () => Promise<T>) => read().then((value) => ({ value }), (err: unknown) => ({ error: (err as Error).constructor.name }))
  const table = await getChargedPriceTable()
  return {
    base: await outcome(async () => (await getModelCreditBaseCost(id)).creditCost),
    charged: await outcome(async () => (await getModelCreditCostFromDB(id)).creditCost),
    quote: await outcome(() => CreditsService.getModelCreditCost(id)),
    tableBase: table.base(id),
    tableCharged: chargedCredits(table, id),
    stated: statedPrices().credits(id),
  }
}

describe("a retired video model's price id", () => {
  it("answers exactly what the id of the model it runs as answers, never its stale row", async () => {
    // Production: the earlier spelling's row was never repriced (530, quoted 583 at a 10% markup).
    db.rows = [
      { model_identifier: RETIRED, credit_cost: 530 },
      { model_identifier: "seedance-2-extend", credit_cost: 530 },
      { model_identifier: RUNS_AS, credit_cost: STATIC_CREDIT_COSTS[RUNS_AS]! },
    ]
    // A per-service margin on the model it runs as applies to the old spelling too.
    settings.value = { cost_markup_percent: 10, service_margin_percent: { "seedance-2-5-extend": 25 } }

    const retired = await answersFor(RETIRED)
    expect(retired).toEqual(await answersFor(RUNS_AS))
    // Not vacuous: the model it runs as is priced, at its margin, far above the stale row.
    expect(retired.quote).toEqual({ value: Math.ceil((STATIC_CREDIT_COSTS[RUNS_AS]! * 125) / 100) })
    expect(retired.tableCharged).toBe(Math.ceil((STATIC_CREDIT_COSTS[RUNS_AS]! * 125) / 100))
  })

  it("the bare retired id answers what the bare id it runs as answers (priced nowhere: refused, never the stale 530)", async () => {
    db.rows = [{ model_identifier: "seedance-2-extend", credit_cost: 530 }]
    const retired = await answersFor("seedance-2-extend")
    expect(retired).toEqual(await answersFor("seedance-2-5-extend"))
    expect(retired.quote).toEqual({ error: PriceNotConfiguredError.name })
    expect(retired.tableBase).toBeUndefined()
  })

  it("a per-unit quote of a rate row under the old spelling is priced from the rate row it runs as", async () => {
    settings.value = { cost_markup_percent: 10, service_margin_percent: {} }
    expect(await answersFor("seedance-2-extend:720p:per-2s:9u")).toEqual(await answersFor("seedance-2-5-extend:720p:per-2s:9u"))
  })

  it("holds for every retired id and every priced id of the model it runs as", async () => {
    settings.value = { cost_markup_percent: 10, service_margin_percent: {} }
    const pairs = Object.entries(RETIRED_VIDEO_PROVIDERS).flatMap(([retired, runsAs]) =>
      Object.keys(STATIC_CREDIT_COSTS)
        .filter((id) => id === runsAs || id.startsWith(`${runsAs}:`))
        .map((id) => [`${retired}${id.slice(runsAs.length)}`, id] as const),
    )
    // Every retired id runs as a model with priced ids.
    for (const runsAs of Object.values(RETIRED_VIDEO_PROVIDERS)) {
      expect(pairs.some(([, id]) => id === runsAs || id.startsWith(`${runsAs}:`)), runsAs).toBe(true)
    }
    for (const [retired, id] of pairs) {
      expect(await answersFor(retired), retired).toEqual(await answersFor(id))
    }
  })
})

// The margin lookup is the one funnel every markup goes through (`effectiveMarkupPercent`): the
// price reads above, a route's computed reservation (`routeCreditOverride`, at the request's raw
// identifier), the workflow's overrides and the measured settle (`commitJobCredits`, at the usage
// log's raw `action`). A retired spelling reaching any of them is marked up exactly as the id it
// runs as, so a quote, a reservation and a settle can never disagree on it.
describe("a retired video model's price id at the markup", () => {
  it("is marked up at the margin of the id it runs as, for every retired id and spelling", () => {
    for (const [retired, runsAs] of Object.entries(RETIRED_VIDEO_PROVIDERS)) {
      const settings = { cost_markup_percent: 10, service_margin_percent: { [runsAs]: 40 } }
      for (const suffix of ["", ":8s:720p", ":720p:per-2s", ":720p:per-2s:9u"]) {
        expect(effectiveMarkupPercent(settings, `${retired}${suffix}`), `${retired}${suffix}`).toBe(40)
        expect(applyServiceMarkup(1710, settings, `${retired}${suffix}`)).toBe(applyServiceMarkup(1710, settings, `${runsAs}${suffix}`))
      }
    }
  })

  it("leaves every other id's margin as it was: a prefix match on the `:` boundary, the longest winning", () => {
    const settings = { cost_markup_percent: 10, service_margin_percent: { "seedance-2": 20, "seedance-2-5-extend": 40 } }
    expect(effectiveMarkupPercent(settings, "seedance-2:8s:720p")).toBe(20)
    expect(effectiveMarkupPercent(settings, "seedance-2-0-extend:8s:720p")).toBe(10)
    expect(effectiveMarkupPercent(settings, "seedance-2-5-extend:8s:720p")).toBe(40)
  })
})
