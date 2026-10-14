/**
 * A speech QUOTE is the CHARGE. Every lane reserves a length-priced speech
 * request as ONE whole — the base of the text (units × the model's unit row)
 * marked up once, at the model it runs as — so a client that multiplies a
 * served one-unit price by the units over-quotes it. The price lookups serve
 * the whole request under its own id, `<model>:per-100-chars:<N>u`; these
 * cases hold that answer — the batch endpoint's rule (`chargedCredits` over
 * the price table), the single GET, and the workflow estimate — to what the
 * route guard and the orchestrator reserve, at a NON-ZERO percent where the
 * two rules part, and fail if a quote and a charge ever disagree.
 *
 * The cases are the shared fixture (tools/fixtures/speech-estimate-cases.json,
 * whose `credits` the editor's suite holds its quote to) and the seam-parity
 * table every speech pricing suite reads.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const { flag, settings } = vi.hoisted(() => ({
  flag: { on: true },
  settings: { current: { cost_markup_percent: 15, service_margin_percent: {} as Record<string, number> } },
}))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, hasCredits: () => true, speechLengthPricingEnabled: () => flag.on }
})

// No model_pricing rows: every price falls back to STATIC_CREDIT_COSTS (the
// mock shape of speech-unit-rows-served.test.ts).
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

import {
  getDialogueCapabilities,
  getMaxTtsChars,
} from "@nodaro/shared/models"
import {
  parseSpeechQuoteCreditId,
  speechPriceUnits,
  speechQuoteCreditId,
  speechUnitCreditId,
} from "@nodaro/shared/credits"
import {
  CreditsService,
  PriceNotConfiguredError,
  STATIC_CREDIT_COSTS,
  chargedCredits,
  getChargedPriceTable,
  invalidateModelPricingCache,
} from "../credits.js"
import { applyServiceMarkup } from "../service-margin.js"
import { billableDialogueChars, billableSpeechChars, dialogueBaseCredits, speechBaseCredits, speechRunsAs } from "../../../lib/speech-credits.js"
import { speechChargeOverride, speechEstimateChars, type SpeechEstimateContext } from "../../../lib/speech-estimate.js"
import { resolveTextToSpeechGuardProvider } from "../../../routes/text-to-speech.js"
import { DIALOGUE_PARITY_CASES, SPEECH_PARITY_CASES } from "../../../lib/__tests__/speech-parity-cases.js"

type Repeat = { repeat: number; of: string; prefix?: string }
type Case = {
  name: string
  nodeType: string
  data: Record<string, unknown>
  ctx?: Record<string, unknown>
  expect: { runsAs: string; chars: number; exact: boolean; units: number; quoteId: string; credits: number }
}
const FIXTURE = resolve(__dirname, "../../../../../tools/fixtures/speech-estimate-cases.json")
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
  pricing: { chargePercent: number; unitRows: Record<string, number> }
  cases: Case[]
}

function expand(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(expand)
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>
    if (typeof o.repeat === "number" && typeof o.of === "string") {
      const r = o as Repeat
      return (r.prefix ?? "") + r.of.repeat(r.repeat)
    }
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, expand(v)]))
  }
  return value
}

/** A percent and per-model margins where the quote rule and the old per-unit rule part on every row. */
const MARGINS = { cost_markup_percent: 15, service_margin_percent: { "elevenlabs-v3": 25, "elevenlabs-turbo": 40, "elevenlabs-dialogue-v4": 35 } }

beforeEach(() => {
  flag.on = true
  settings.current = MARGINS
  invalidateModelPricingCache()
})

describe("the fixture's charge — every case, at its non-zero percent", () => {
  beforeEach(() => {
    settings.current = { cost_markup_percent: fixture.pricing.chargePercent, service_margin_percent: {} }
  })

  it("prices on the code's own unit rows, at a non-zero percent", () => {
    expect(fixture.pricing.chargePercent).toBeGreaterThan(0)
    for (const [id, row] of Object.entries(fixture.pricing.unitRows)) expect(STATIC_CREDIT_COSTS[id], id).toBe(row)
  })

  it.each(fixture.cases.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const data = expand(c.data) as Record<string, unknown>
    const ctx = (c.ctx ? expand(c.ctx) : {}) as SpeechEstimateContext
    const e = speechEstimateChars(c.nodeType, data, ctx)
    const units = speechPriceUnits(e.chars)
    const quoteId = speechQuoteCreditId(e.runsAs, units)
    expect(quoteId).toBe(c.expect.quoteId)

    // What the run reserves: the base of those characters on the model's unit row, marked up once at the model.
    const base = units * STATIC_CREDIT_COSTS[speechUnitCreditId(e.runsAs)]!
    expect(applyServiceMarkup(base, settings.current as never, e.runsAs)).toBe(c.expect.credits)

    // What a client is told: the batch endpoint's rule over the price table, and the single GET.
    const table = await getChargedPriceTable()
    expect(chargedCredits(table, quoteId)).toBe(c.expect.credits)
    expect(await CreditsService.getModelCreditCost(quoteId)).toBe(c.expect.credits)

    // The rule this replaces — a served one-unit price × the units — quotes more, so the cases discriminate.
    expect(units * chargedCredits(table, speechUnitCreditId(e.runsAs))!).toBeGreaterThan(c.expect.credits)
  })
})

describe("every lane's charge equals the quote of the same request (per-model margins on)", () => {
  it.each(SPEECH_PARITY_CASES)("text-to-speech provider %j, %j", async (provider, text) => {
    const guardProvider = resolveTextToSpeechGuardProvider({ provider, text })
    // The REST route: computeCredits is the base, the guard marks it up once at the provider it resolved.
    const routeCharge = applyServiceMarkup(await speechBaseCredits(guardProvider, text), MARGINS as never, guardProvider)
    // The orchestrator and the pipeline services.
    expect(await speechChargeOverride("text-to-speech", { provider: guardProvider, text }, guardProvider)).toBe(routeCharge)
    // The quote a client asks for: the whole request's id on the model it runs as.
    const runsAs = speechRunsAs(guardProvider)
    const quoteId = speechQuoteCreditId(runsAs, speechPriceUnits(billableSpeechChars(guardProvider, text)))
    expect(chargedCredits(await getChargedPriceTable(), quoteId)).toBe(routeCharge)
    expect(await CreditsService.getModelCreditCost(quoteId)).toBe(routeCharge)
    // The workflow estimate (apps, templates, the server's run estimate) of the same node.
    if (text.length <= getMaxTtsChars(runsAs)) {
      const node = { id: "n", type: "text-to-speech", data: { ...(provider ? { provider } : {}), textSource: "direct", directText: text } }
      expect(await CreditsService.estimateWorkflowCredits([node])).toBe(routeCharge)
    }
  })

  it.each(DIALOGUE_PARITY_CASES)("text-to-dialogue provider %j", async (provider, lines) => {
    const model = provider ?? "elevenlabs-dialogue"
    const routeCharge = applyServiceMarkup(await dialogueBaseCredits(lines, provider), MARGINS as never, model)
    expect(await speechChargeOverride("text-to-dialogue", { dialogue: lines, provider }, model)).toBe(routeCharge)
    const quoteId = speechQuoteCreditId(model, speechPriceUnits(billableDialogueChars(lines, model)))
    expect(chargedCredits(await getChargedPriceTable(), quoteId)).toBe(routeCharge)
    expect(await CreditsService.getModelCreditCost(quoteId)).toBe(routeCharge)
    const node = { id: "d", type: "text-to-dialogue", data: { ...(provider ? { provider } : {}), dialogue: lines } }
    expect(await CreditsService.estimateWorkflowCredits([node])).toBe(routeCharge)
  })

  it("a margin set on a unit row's own id is not the model's: the quote follows the model, as the charge does", async () => {
    settings.current = { cost_markup_percent: 15, service_margin_percent: { "elevenlabs-v4:per-100-chars": 200 } }
    const routeCharge = applyServiceMarkup(await speechBaseCredits("elevenlabs-v4", "a".repeat(1000)), settings.current as never, "elevenlabs-v4")
    expect(routeCharge).toBe(46)
    expect(chargedCredits(await getChargedPriceTable(), "elevenlabs-v4:per-100-chars:10u")).toBe(routeCharge)
    expect(await CreditsService.getModelCreditCost("elevenlabs-v4:per-100-chars:10u")).toBe(routeCharge)
  })
})

describe("what the quote ids accept", () => {
  it("a request of any length a model can run: from the floor up to its cap in started hundreds", () => {
    expect(parseSpeechQuoteCreditId("elevenlabs-v4:per-100-chars:8u")).toEqual({ model: "elevenlabs-v4", unitId: "elevenlabs-v4:per-100-chars", units: 8 })
    expect(parseSpeechQuoteCreditId("elevenlabs-v4:per-100-chars:100u")?.units).toBe(100)
    expect(parseSpeechQuoteCreditId("elevenlabs-turbo:per-100-chars:400u")?.units).toBe(400)
    expect(parseSpeechQuoteCreditId("elevenlabs-dialogue:per-100-chars:50u")?.units).toBe(speechPriceUnits(getDialogueCapabilities("elevenlabs-dialogue").maxChars))
  })

  it.each([
    ["below the floor", "elevenlabs-v4:per-100-chars:7u"],
    ["above the model's cap", "elevenlabs-v4:per-100-chars:101u"],
    ["above v3 dialogue's cap", "elevenlabs-dialogue:per-100-chars:51u"],
    ["the legacy alias (a quote names the model it runs as)", "elevenlabs:per-100-chars:8u"],
    ["a model that does not speak", "nano-banana:per-100-chars:8u"],
    ["no unit count", "elevenlabs-v4:per-100-chars:u"],
    ["a fractional count", "elevenlabs-v4:per-100-chars:8.5u"],
  ])("refuses %s — priced nowhere", async (_label, id) => {
    expect(parseSpeechQuoteCreditId(id)).toBeUndefined()
    expect(chargedCredits(await getChargedPriceTable(), id)).toBeUndefined()
    await expect(CreditsService.getModelCreditCost(id)).rejects.toBeInstanceOf(PriceNotConfiguredError)
  })

  it("with length pricing off, a quote id is priced nowhere — as its unit row is", async () => {
    flag.on = false
    const id = "elevenlabs-v4:per-100-chars:10u"
    expect(chargedCredits(await getChargedPriceTable(), id)).toBeUndefined()
    await expect(CreditsService.getModelCreditCost(id)).rejects.toBeInstanceOf(PriceNotConfiguredError)
  })
})
