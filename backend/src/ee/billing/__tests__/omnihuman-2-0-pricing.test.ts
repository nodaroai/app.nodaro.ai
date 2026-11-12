// @test-units-by-name prices only the omnihuman-2-0 rows and the lip-sync / upload-audio nodes it builds
/**
 * OmniHuman 2.0 — one price, three places (decided 2026-11-11). A run is
 * charged its per-second row × the billed seconds (the audio rounded up to a
 * whole second, at least 4), rounded up once and marked up once. At the 10%
 * markup these are the figures the docs state; the hold (route and workflow
 * run, `lipSyncRateBaseCredits`), the quote a client is served
 * (`<rate>:<N>u`) and the server's run estimate all say the same number, and a
 * retuned `model_pricing` row moves all of them together.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { rows, settings } = vi.hoisted(() => ({
  rows: new Map<string, number>(),
  settings: { current: { cost_markup_percent: 10, service_margin_percent: {} as Record<string, number> } },
}))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, hasCredits: () => true }
})
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "model_pricing") throw new Error(`unexpected table ${table}`)
      let id: string | undefined
      const query = {
        select: () => query,
        order: () => query,
        eq: (_col: string, value: string) => {
          id = value
          return query
        },
        single: async () => {
          const credit = id === undefined ? undefined : rows.get(id)
          return credit === undefined
            ? { data: null, error: { code: "PGRST116" } }
            : { data: { credit_cost: credit, is_enabled: true, tier_restriction: null }, error: null }
        },
        range: async (from: number) => ({
          data: from > 0 ? [] : [...rows].map(([model_identifier, credit_cost]) => ({ model_identifier, credit_cost })),
          error: null,
        }),
      }
      return query
    },
  },
}))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => settings.current }))

import { LIP_SYNC_AUDIO_RATES, OMNIHUMAN_2_0_PER_SECOND_CREDIT_ID, unitQuoteCreditId } from "@nodaro/shared/credits"
import { CreditsService, PriceNotConfiguredError, STATIC_CREDIT_COSTS, chargedCredits, getChargedPriceTable, invalidateModelPricingCache } from "../credits.js"
import { applyServiceMarkup } from "../service-margin.js"
import { lipSyncRateBaseCredits } from "../../../lib/lip-sync-inputs.js"

const ID = OMNIHUMAN_2_0_PER_SECOND_CREDIT_ID
const rate = LIP_SYNC_AUDIO_RATES["omnihuman-2-0"]!
const hold = async (seconds: number) => applyServiceMarkup(await lipSyncRateBaseCredits(rate, seconds), settings.current as never, ID)

beforeEach(() => {
  rows.clear()
  settings.current = { cost_markup_percent: 10, service_margin_percent: {} }
  invalidateModelPricingCache()
})

describe("OmniHuman 2.0 pricing at the 10% markup", () => {
  it("one row, 35 base credits a second; no bare id, no buckets", () => {
    expect(STATIC_CREDIT_COSTS[ID]).toBe(35)
    expect(STATIC_CREDIT_COSTS["omnihuman-2-0"]).toBeUndefined()
    expect(Object.keys(STATIC_CREDIT_COSTS).filter((id) => id.startsWith("omnihuman-2-0"))).toEqual([ID])
  })

  it.each([
    [4, 154],
    [10, 385],
    [11, 424],
    [15, 578],
    [60, 2310],
    [300, 11550],
  ])("%i billed seconds: the hold, the batch quote and the single quote are all %i", async (seconds, credits) => {
    expect(await hold(seconds)).toBe(credits)
    const quote = unitQuoteCreditId(ID, seconds)
    expect(chargedCredits(await getChargedPriceTable(), quote)).toBe(credits)
    expect(await CreditsService.getModelCreditCost(quote)).toBe(credits)
  })

  it("a quote names only a run that can exist: whole seconds from 4 to 300", async () => {
    const table = await getChargedPriceTable()
    for (const id of [`${ID}:3u`, `${ID}:301u`, `${ID}:10.5u`]) {
      expect(chargedCredits(table, id), id).toBeUndefined()
      await expect(CreditsService.getModelCreditCost(id)).rejects.toBeInstanceOf(PriceNotConfiguredError)
    }
  })

  it("an admin's retune of the row moves the hold and the quote together, rounded once", async () => {
    rows.set(ID, 30.5)
    invalidateModelPricingCache()
    // 11 × 30.5 = 335.5 → 336, then × 1.1 = 369.6 → 370.
    expect(await hold(11)).toBe(370)
    expect(await CreditsService.getModelCreditCost(unitQuoteCreditId(ID, 11))).toBe(370)
  })

  it("the server's run estimate: the wired audio's billed seconds, else the 5-minute ceiling", async () => {
    const node = { id: "x", type: "lip-sync", data: { provider: "omnihuman-2-0" } }
    const upload = { id: "a", type: "upload-audio", data: { url: "https://m.test/a.mp3", metadata: { durationSeconds: 3.2 } } }
    const edges = [{ source: "a", target: "x", targetHandle: "audio" }]
    expect(await CreditsService.estimateWorkflowCredits([upload, node], edges)).toBe(154)
    expect(await CreditsService.estimateWorkflowCredits([node], [])).toBe(11550)
  })
})
