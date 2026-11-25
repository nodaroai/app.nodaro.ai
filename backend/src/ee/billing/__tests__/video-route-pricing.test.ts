// @test-units-by-name it reads only the Seedance 2.x price ids, never a node unit
import { describe, expect, it } from "vitest"
import { CREDIT_BASE_USD } from "@nodaro/shared/models"
import { STATIC_CREDIT_COSTS, PriceNotConfiguredError, chargedPriceTableFrom } from "../credits.js"
import {
  ROUTE_PRICE_ROUND_TO,
  ROUTE_SETTLE_MAX_OF_QUOTE,
  routeUsdToBaseCredits,
  routedChargedCredits,
  routedListedPrice,
  routedPriceIdOf,
  routedQuote,
  routedSettlementCredits,
} from "../video-route-pricing.js"
import { defaultVideoRoutePolicy, isRoutableVideoModel, type VideoRoutePolicy } from "../../../lib/video-route-policy.js"
import type { RouteView } from "../../../lib/video-route-decision.js"
import type { PluginAlternateRouteRequest, PluginAlternateRoutesService } from "../../../lib/private-plugins/types.js"

const settings = { cost_markup_percent: 20, service_margin_percent: {} } as Parameters<typeof routedChargedCredits>[2]
const request: PluginAlternateRouteRequest = {
  jobId: "j", jobType: "image-to-video", model: "seedance-2-5", parent: null, prompt: "p", draft: false,
  referenceImageUrls: [], referenceVideoUrls: [], referenceAudioUrls: [],
}
const service = (quote: PluginAlternateRoutesService["quote"]): PluginAlternateRoutesService => ({
  accepts: () => ({ routeId: "r" }), start: async () => ({ taskRef: "t" }), poll: async () => ({ state: "running" }), prices: () => [], quote,
})
const view: RouteView = { v2: true, capable: () => true, accepts: () => ({ routeId: "r" }) }
const routedPolicy = (model: string): VideoRoutePolicy => ({ ...defaultVideoRoutePolicy(), models: { [model]: { route: "alternate" } } })

describe("routeUsdToBaseCredits — the one USD → credits rule", () => {
  it("passes the cost through at the credit's value, rounded up to the next 10", () => {
    expect(ROUTE_PRICE_ROUND_TO).toBe(10)
    expect(routeUsdToBaseCredits(0)).toBe(0)
    // One credit's worth → the first step.
    expect(routeUsdToBaseCredits(CREDIT_BASE_USD)).toBe(10)
    // Exactly 10 steps' worth stays where it is (no float creep): 100 credits.
    expect(routeUsdToBaseCredits(CREDIT_BASE_USD * 100)).toBe(100)
    expect(routeUsdToBaseCredits(CREDIT_BASE_USD * 101)).toBe(110)
    expect(() => routeUsdToBaseCredits(-1)).toThrow()
  })

  it("marks up at the platform id, as the default price of that id is", () => {
    expect(routedChargedCredits(100, "seedance-2-5:8s:720p", settings)).toBe(120)
  })

  it("settles from the billed cost with the same rule", () => {
    expect(routedSettlementCredits({ providerCostUsd: CREDIT_BASE_USD * 101, priceId: "seedance-2-5:8s:720p", settings, quotedUsd: CREDIT_BASE_USD * 100 })).toEqual({ baseCredits: 110, chargedCredits: 132, capped: false })
  })

  it("never settles a missing, zero or negative cost as free (it throws: the caller commits the hold)", () => {
    for (const cost of [0, -1, Number.NaN, undefined as unknown as number]) {
      expect(() => routedSettlementCredits({ providerCostUsd: cost, priceId: "seedance-2-5:8s:720p", settings, quotedUsd: 1 })).toThrow()
    }
  })

  it("charges a runaway cost only up to ROUTE_SETTLE_MAX_OF_QUOTE × the quote, and says so", () => {
    expect(ROUTE_SETTLE_MAX_OF_QUOTE).toBe(3)
    const r = routedSettlementCredits({ providerCostUsd: CREDIT_BASE_USD * 10_000, priceId: "seedance-2-5:8s:720p", settings: { cost_markup_percent: 0, service_margin_percent: {} } as typeof settings, quotedUsd: CREDIT_BASE_USD * 100 })
    expect(r).toEqual({ baseCredits: 300, chargedCredits: 300, capped: true })
  })

  it("worked examples: a per-second route cost × seconds, with and without a reference video", () => {
    // 8 s of output at $0.0700/s: $0.56 → 280 credits at the credit's value → 280 (already a step of 10).
    expect(routeUsdToBaseCredits(0.07 * 8)).toBe(280)
    // The same 8 s with a 6 s reference clip billed at the same rate: (8 + 6) × $0.07 = $0.98 → 490.
    expect(routeUsdToBaseCredits(0.07 * (8 + 6))).toBe(490)
    // 5 s at $0.0453/s: $0.2265 → 113.25 credits → rounded up to 120.
    expect(routeUsdToBaseCredits(0.0453 * 5)).toBe(120)
  })
})

describe("routedQuote — the admission hold", () => {
  it("holds the quote times the key's factor", () => {
    const q = routedQuote({
      service: service(() => ({ billedSeconds: 8, usd: CREDIT_BASE_USD * 100 })),
      request, priceId: "seedance-2-5:8s:720p", factorKey: "k",
      factors: { k: { factor: 1.2, updatedAt: "x", by: "admin" } }, settings,
    })
    expect(q).toEqual({ usd: CREDIT_BASE_USD * 100, billedSeconds: 8, factor: 1.2, baseCredits: 120, chargedCredits: 144 })
  })

  it("hard-fails (price_not_configured) with no quote — never the default price", () => {
    for (const quote of [undefined, () => null, () => { throw new Error("x") }, () => ({ billedSeconds: 8, usd: 0 }), () => ({ billedSeconds: Number.NaN, usd: 1 })]) {
      expect(() => routedQuote({ service: service(quote as PluginAlternateRoutesService["quote"]), request, priceId: "seedance-2-5:8s:720p", factorKey: "k", factors: {}, settings })).toThrow(PriceNotConfiguredError)
    }
    expect(() => routedQuote({ service: undefined, request, priceId: "seedance-2-5:8s:720p", factorKey: "k", factors: {}, settings })).toThrow(PriceNotConfiguredError)
  })
})

describe("routed price ids", () => {
  it("parses every Seedance 2.x id the platform prices (a new id shape fails here)", () => {
    const ids = Object.keys(STATIC_CREDIT_COSTS).filter((id) => id.startsWith("seedance-2"))
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      const parsed = routedPriceIdOf(id)
      expect(parsed, id).toBeDefined()
      expect(isRoutableVideoModel(parsed!.model), id).toBe(true)
    }
    expect(routedPriceIdOf("seedance-2-5:8s:720p-ref")).toEqual({ model: "seedance-2-5", kind: "generate", resolution: "720p", hasRefVideo: true, seconds: 8 })
    expect(routedPriceIdOf("seedance-2-5-hd:8s-ref")).toEqual({ model: "seedance-2-5", kind: "draft-finalize", resolution: undefined, hasRefVideo: true, seconds: 8 })
    expect(routedPriceIdOf("seedance-2-5-flash-extend:720p:per-1s")).toMatchObject({ model: "seedance-2-5-flash", kind: "extend", resolution: "720p" })
    expect(routedPriceIdOf("kling-3.0:5s")).toBeUndefined()
    // A Seedance head with a segment of no known shape is no routed id.
    for (const odd of ["seedance-2-5:8s:720p:extra", "seedance-2-5:fast", "seedance-2-5:8s:720p-hdr", "seedance-2-5:999s"]) {
      expect(routedPriceIdOf(odd), odd).toBeUndefined()
    }
  })
})

describe("every Seedance id the default table prices, under a routed model", () => {
  it("is priced by the route or explicitly refused — never a node-type row or 0", () => {
    const ids = Object.keys(STATIC_CREDIT_COSTS).filter((id) => routedPriceIdOf(id))
    const someListed = Object.fromEntries(ids.filter((_, i) => i % 2 === 0).map((id) => [id, CREDIT_BASE_USD * 50]))
    const models = [...new Set(ids.map((id) => routedPriceIdOf(id)!.model))]
    const policy = { ...defaultVideoRoutePolicy(), models: Object.fromEntries(models.map((m) => [m, { route: "alternate" as const }])) }
    const table = chargedPriceTableFrom(new Map(), settings, undefined, { policy, view, pricesUsd: someListed, factors: {} })
    for (const id of ids) {
      const base = table.base(id)
      if (base === undefined) expect(table.refuses?.(id), id).toBe(true)
      else expect(base, id).toBe(50)
    }
  })
})

describe("listing a routed model", () => {
  const rows = new Map<string, number>()
  // USD per listed id: $0.14 → 70 credits at the credit's value.
  const prices = { "seedance-2-5:8s:720p": CREDIT_BASE_USD * 70 }

  it("is inert with nothing routed: the table is the one it always was", () => {
    const plain = chargedPriceTableFrom(rows, settings)
    const withNone = chargedPriceTableFrom(rows, settings, undefined, undefined)
    for (const id of Object.keys(STATIC_CREDIT_COSTS).filter((i) => i.startsWith("seedance-2"))) {
      expect(withNone.base(id)).toBe(plain.base(id))
    }
    expect(routedListedPrice({ policy: defaultVideoRoutePolicy(), view, pricesUsd: prices, factors: {} }, "seedance-2-5:8s:720p")).toEqual({ routed: false })
  })

  it("lists the route's price for a routed model, times its factor, and never the default one", () => {
    const listing = { policy: routedPolicy("seedance-2-5"), view, pricesUsd: prices, factors: { "seedance-2-5:720p:noref:generate": { factor: 1.1, updatedAt: "x", by: "auto" as const } } }
    const table = chargedPriceTableFrom(rows, settings, undefined, listing)
    // 70 × 1.1 = 77 → the route step → 80.
    expect(table.base("seedance-2-5:8s:720p")).toBe(80)
    // Not listed by the route: not listed, and refused (never a node-type row or 0).
    expect(table.base("seedance-2-5:8s:480p")).toBeUndefined()
    expect(table.refuses?.("seedance-2-5:8s:480p")).toBe(true)
    expect(table.refuses?.("seedance-2-5:8s:720p")).toBe(false)
    // Another model is untouched.
    expect(table.base("seedance-2:8s:720p")).toBe(STATIC_CREDIT_COSTS["seedance-2:8s:720p"])
  })

  it("lists the default price where this process's route cannot take the model", () => {
    for (const v of [null, { ...view, v2: false }, { ...view, capable: () => false }]) {
      const table = chargedPriceTableFrom(rows, settings, undefined, { policy: routedPolicy("seedance-2-5"), view: v, pricesUsd: prices, factors: {} })
      expect(table.base("seedance-2-5:8s:720p")).toBe(STATIC_CREDIT_COSTS["seedance-2-5:8s:720p"])
    }
  })
})
