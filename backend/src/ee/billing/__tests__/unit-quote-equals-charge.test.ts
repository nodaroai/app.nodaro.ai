/**
 * A per-unit run's QUOTE is its CHARGE. Every lane charges a run priced per
 * unit as ONE whole — the rate row's base × the units, rounded up, marked up
 * once at the rate — while the served one-unit price is already rounded up, so
 * a client multiplying it by the units over-quotes. The price lookups answer
 * the whole run under its own id, `<rateId>:<units>u`; these cases hold that
 * answer (the batch endpoint's rule over the price table, the single GET) and
 * the server's own run estimate to what the routes reserve, at a NON-ZERO
 * margin where the two rules part.
 *
 * The cases are the shared fixture (tools/fixtures/unit-quote-cases.json),
 * which the editor's suite holds its quote to and which covers every node
 * type in the editor's per-unit registry.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const { settings } = vi.hoisted(() => ({
  settings: { current: { cost_markup_percent: 0, service_margin_percent: {} as Record<string, number> } },
}))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, hasCredits: () => true, speechLengthPricingEnabled: () => true }
})
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

import { VIDEO_UTIL_PRICING, speechLengthPriceModel } from "@nodaro/shared"
import { CreditsService, PriceNotConfiguredError, STATIC_CREDIT_COSTS, chargedCredits, getChargedPriceTable, getModelCreditBaseCost, invalidateModelPricingCache } from "../credits.js"
import { applyServiceMarkup } from "../service-margin.js"
import { ltxExtendBaseCredits } from "../../../lib/ltx-extend-credits.js"
import { ltxRetakeBaseCredits } from "../../../lib/ltx-retake-credits.js"
import { maskCompositeBaseCredits } from "../../../lib/mask-composite-length.js"
import { SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE } from "../../../lib/speaker-view-plan.js"
import { UNIT_QUOTE_MAX_UNITS, UNIT_QUOTE_RATE_IDS, parseRateQuoteCreditId } from "../../../lib/unit-quote-rates.js"

type Case = {
  name: string
  nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>
  edges: Array<{ id: string; source: string; target: string; targetHandle: string }>
  node: string
  expect: { rateId: string; units: number; quoteId: string; servedUnit: number; credits: number; perUnitQuote: number }
}
const FIXTURE = resolve(__dirname, "../../../../../tools/fixtures/unit-quote-cases.json")
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
  pricing: { chargePercent: number; serviceMarginPercent: Record<string, number>; unitRows: Record<string, number> }
  cases: Case[]
}

function expand(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(expand)
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>
    if (typeof o.repeat === "number" && typeof o.of === "string") return ((o.prefix as string | undefined) ?? "") + o.of.repeat(o.repeat)
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, expand(v)]))
  }
  return value
}

/**
 * What the run's own route reserves (base, before the markup) for `units` of
 * `rateId` — each the route's or the plan's own function, not a re-derivation.
 */
async function routeBase(nodeType: string, rateId: string, units: number): Promise<number> {
  switch (nodeType) {
    case "apply-edl":
      // routes/apply-edl.ts computeCredits: the row (getModelCreditBaseCost) × the minutes.
      return (await getModelCreditBaseCost(rateId)).creditCost * units
    case "speaker-view":
      return SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE[rateId as keyof typeof SPEAKER_VIEW_CREDITS_PER_OUTPUT_MINUTE] * units
    case "trim-video":
    case "loop-video":
    case "combine-videos":
    case "assemble-narrated-video":
      // lib/video-utility-credits.ts: units × VIDEO_UTIL_PRICING.CREDIT_UNIT.
      return VIDEO_UTIL_PRICING.CREDIT_UNIT * units
    case "mask-composite":
      return maskCompositeBaseCredits(units)
    case "extend-video":
      return ltxExtendBaseCredits(units)
    case "video-retake":
      return ltxRetakeBaseCredits(units)
    case "text-to-speech":
    case "text-to-dialogue":
      // lib/speech-credits.ts: the unit row × the started hundreds.
      return STATIC_CREDIT_COSTS[rateId]! * units
    default:
      throw new Error(`no route rule for ${nodeType} — add one with its case`)
  }
}

/** The id a run's charge is marked up at: the rate itself, a speech row's model. */
const marginKey = (rateId: string) => speechLengthPriceModel(rateId) ?? rateId

beforeEach(() => {
  settings.current = { cost_markup_percent: fixture.pricing.chargePercent, service_margin_percent: fixture.pricing.serviceMarginPercent }
  invalidateModelPricingCache()
})

describe("the fixture's charge — every case, at its non-zero margins", () => {
  it("prices on the code's own rows, at a non-zero margin", () => {
    expect(fixture.pricing.chargePercent).toBeGreaterThan(0)
    for (const [id, row] of Object.entries(fixture.pricing.unitRows)) expect(STATIC_CREDIT_COSTS[id], id).toBe(row)
  })

  it.each(fixture.cases.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const { rateId, units, quoteId, servedUnit, credits } = c.expect
    const nodeType = c.nodes.find((n) => n.id === c.node)!.type

    // What the run's route reserves: its own base, marked up once at the rate.
    const charge = applyServiceMarkup(await routeBase(nodeType, rateId, units), settings.current as never, marginKey(rateId))
    expect(charge).toBe(credits)

    // What a client is told for the whole run: the batch endpoint's rule over the price table, and the single GET.
    const table = await getChargedPriceTable()
    expect(chargedCredits(table, quoteId)).toBe(credits)
    expect(await CreditsService.getModelCreditCost(quoteId)).toBe(credits)

    // The one-unit price the server serves, and the rule this replaces: it × the units, more than the charge.
    expect(chargedCredits(table, rateId)).toBe(servedUnit)
    expect(servedUnit * Math.ceil(units)).toBe(c.expect.perUnitQuote)
    expect(c.expect.perUnitQuote).toBeGreaterThan(credits)

    // The server's own run estimate (apps, templates, MCP) of a node whose units its own data
    // decides is the same charge. (A length read off an uploaded clip is the editor's to know:
    // the server's estimate prices such a wire at the estimators' fallback length.)
    if (c.edges.length === 0) {
      const node = c.nodes.find((n) => n.id === c.node)!
      expect(await CreditsService.estimateWorkflowCredits([{ ...node, data: expand(node.data) as Record<string, unknown> }], [])).toBe(credits)
    }
  })
})

describe("what a whole-run quote id accepts", () => {
  it("every per-unit rate is priced, and quoted at the rate's own margin", async () => {
    const table = await getChargedPriceTable()
    for (const rateId of UNIT_QUOTE_RATE_IDS) {
      expect(chargedCredits(table, rateId), rateId).toBeDefined()
      settings.current = { cost_markup_percent: 15, service_margin_percent: { [rateId]: 37 } }
      invalidateModelPricingCache()
      const base = STATIC_CREDIT_COSTS[rateId]! * 7
      expect(chargedCredits(await getChargedPriceTable(), `${rateId}:7u`), rateId).toBe(applyServiceMarkup(base, settings.current as never, rateId))
    }
  })

  it.each([
    ["a rate not charged per unit", "nano-banana:3u"],
    ["no unit count", "trim-video:u"],
    ["zero units", "trim-video:0u"],
    ["a negative count", "trim-video:-2u"],
    ["an exponent", "trim-video:1e3u"],
    ["more units than any run", `trim-video:${UNIT_QUOTE_MAX_UNITS + 1}u`],
    ["a speech row through the rate reader (it has its own)", "elevenlabs-v4:per-100-chars:7u"],
  ])("refuses %s — priced nowhere", async (_label, id) => {
    if (!id.includes(":per-100-chars")) expect(parseRateQuoteCreditId(id)).toBeUndefined()
    expect(chargedCredits(await getChargedPriceTable(), id)).toBeUndefined()
    await expect(CreditsService.getModelCreditCost(id)).rejects.toBeInstanceOf(PriceNotConfiguredError)
  })

  it("reads fractional units back exactly as the editor wrote them", () => {
    expect(parseRateQuoteCreditId(`ltx-2.3-pro-retake:per-second:${String(2 + 1 / 3)}u`)).toEqual({ rateId: "ltx-2.3-pro-retake:per-second", units: 2 + 1 / 3 })
  })
})
