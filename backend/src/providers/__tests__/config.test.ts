import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — must use vi.hoisted() for variables referenced inside vi.mock()
// ---------------------------------------------------------------------------

const { mockSettings, mockRegistryInfo } = vi.hoisted(() => {
  const mockSettings = {
    ai_provider: "kie" as "kie" | "replicate",
    cost_markup_percent: 50,
    nodaro_provider_prefs: null as null | { scope: "all" | "exclusives"; precedence: "nodaro" | "local" },
  }
  // null = nodaro NOT registered (unconnected); an object = registered.
  const mockRegistryInfo = { value: null as null | { id: string } }
  return { mockSettings, mockRegistryInfo }
})

vi.mock("../registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../registry.js")>()
  return {
    ...actual,
    providerRegistry: new Proxy(actual.providerRegistry, {
      get(target, prop, receiver) {
        if (prop === "getProviderInfo") {
          return (id: string) => (id === "nodaro" ? mockRegistryInfo.value : Reflect.get(target, prop, receiver).call(target, id))
        }
        return Reflect.get(target, prop, receiver)
      },
    }),
  }
})

vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: vi.fn(() => Promise.resolve({ ...mockSettings })),
  calculateDisplayCost: vi.fn(
    (cost: number, markup: number) => cost * (1 + markup / 100)
  ),
}))

// ---------------------------------------------------------------------------
// Import module under test (after mocks are registered)
// ---------------------------------------------------------------------------

import {
  buildRoutingDecision,
  applyMarkup,
  resolveMarkup,
  type RoutingDecision,
} from "../config.js"

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildRoutingDecision", () => {
  beforeEach(() => {
    mockSettings.nodaro_provider_prefs = null
    mockRegistryInfo.value = null
  })

  beforeEach(() => {
    mockSettings.ai_provider = "kie"
    mockSettings.cost_markup_percent = 50
  })

  // Regression: migration 005 seeds ai_provider='"replicate"' on every fresh
  // database, and nothing ever rewrites it (community has no admin routes; the
  // admin PUT only accepts "kie"). The old branch returned an EMPTY chain for
  // any non-"kie" value, so every registry-routed node threw
  // "No provider available" on a fresh self-host install even with a valid
  // KIE_API_KEY. Routing must not depend on the legacy setting.
  it("legacy ai_provider='replicate' routes identically to kie mode (fresh-install seed)", async () => {
    mockSettings.ai_provider = "replicate"

    const result = await buildRoutingDecision("image-generation", "flux")

    expect(result.providerChain).toEqual(["kie", "replicate"])
    expect(result.markupPercent).toBe(50)
    expect(result.activeProvider).toBe("kie")
  })

  it("legacy ai_provider='replicate' still routes KIE-only capabilities", async () => {
    mockSettings.ai_provider = "replicate"

    const result = await buildRoutingDecision("video-to-video", "wan-2.6")

    expect(result.providerChain).toEqual(["kie"])
    expect(result.markupPercent).toBe(50)
    expect(result.activeProvider).toBe("kie")
  })

  it("kie mode returns ['kie'] chain for KIE-only capability with markup", async () => {
    mockSettings.cost_markup_percent = 30

    const result = await buildRoutingDecision("lip-sync", "kling-avatar")

    expect(result.providerChain).toEqual(["kie"])
    expect(result.markupPercent).toBe(30)
    expect(result.activeProvider).toBe("kie")
  })

  it("kie mode returns ['kie'] chain for shared capability (replicate disabled)", async () => {
    const result = await buildRoutingDecision("image-to-video", "minimax")

    expect(result.providerChain).toEqual(["kie"])
    expect(result.markupPercent).toBe(50)
    expect(result.activeProvider).toBe("kie")
  })
})

describe("applyMarkup", () => {
  it("returns null when providerCost is null", () => {
    expect(applyMarkup(null, 25)).toBeNull()
  })

  it("applies configured pricing factor correctly", () => {
    expect(applyMarkup(100, 25)).toBe(125)
  })

  it("applies 0% markup and returns same value", () => {
    expect(applyMarkup(42, 0)).toBe(42)
  })
})

describe("resolveMarkup", () => {
  it("returns configured markup for KIE mode regardless of providerUsed (replicate disabled)", () => {
    const kieDecision: RoutingDecision = {
      providerChain: ["kie"],
      markupPercent: 50,
      activeProvider: "kie",
      settings: { ai_provider: "kie", cost_markup_percent: 50, service_margin_percent: {}, carousel_video_autoplay: true, apps_page_video_autoplay: true, featured_app_ids: [], featured_apps_limit: 20, apps_auto_scroll_seconds: 4, nodaro_provider_prefs: null, copilot_enabled: true, copilot_default_tier: null, copilot_tier_caps: null },
    }
    expect(resolveMarkup(kieDecision, "kie")).toBe(50)
    // With replicate disabled, even replicate providerUsed returns the same KIE markup
    expect(resolveMarkup(kieDecision, "replicate")).toBe(50)
  })
})

describe("web-scrape credit costs", () => {
  it("has all 5 static composite entries", async () => {
    const { STATIC_CREDIT_COSTS } = await import("../../ee/billing/credits.js")
    // base from current Apify per-result rates (markup applied once at runtime).
    expect(STATIC_CREDIT_COSTS["web-scrape:google-search"]).toBe(30)
    expect(STATIC_CREDIT_COSTS["web-scrape:content-crawler"]).toBe(10)
    expect(STATIC_CREDIT_COSTS["web-scrape:content-crawler:site"]).toBe(50)
    expect(STATIC_CREDIT_COSTS["web-scrape:instagram"]).toBe(10)
    expect(STATIC_CREDIT_COSTS["web-scrape:tiktok"]).toBe(10)
  })

  it("has bare fallback entry used by estimateWorkflowCredits", async () => {
    // Without this, estimateWorkflowCredits returns 0 for unconfigured web-scrape
    // nodes because getNodeModelIdentifier returns the bare node type.
    const { STATIC_CREDIT_COSTS } = await import("../../ee/billing/credits.js")
    expect(STATIC_CREDIT_COSTS["web-scrape"]).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// 4b: the nodaro chain extension is the USER'S choice (scope + precedence)
// ---------------------------------------------------------------------------
describe("buildRoutingDecision — nodaro prefs (4b)", () => {
  beforeEach(() => {
    mockSettings.nodaro_provider_prefs = null
    mockRegistryInfo.value = { id: "nodaro" } // connected/registered
  })

  it("legacy default (no stored prefs) keeps the pre-4b semantics: nodaro LAST", async () => {
    const d = await buildRoutingDecision("image-generation", "nano-banana")
    expect(d.providerChain).toEqual(["kie", "replicate", "nodaro"])
  })

  it('scope "all" + precedence "local": user keys first, nodaro fills gaps', async () => {
    mockSettings.nodaro_provider_prefs = { scope: "all", precedence: "local" }
    const d = await buildRoutingDecision("image-generation", "nano-banana")
    expect(d.providerChain).toEqual(["kie", "replicate", "nodaro"])
  })

  it('scope "all" + precedence "nodaro": "ignore my other providers" — nodaro FIRST', async () => {
    mockSettings.nodaro_provider_prefs = { scope: "all", precedence: "nodaro" }
    const d = await buildRoutingDecision("image-generation", "nano-banana")
    expect(d.providerChain).toEqual(["nodaro", "kie", "replicate"])
  })

  it('scope "exclusives": commodity chains are byte-identical to an unconnected install', async () => {
    mockSettings.nodaro_provider_prefs = { scope: "exclusives", precedence: "nodaro" }
    const d = await buildRoutingDecision("image-generation", "nano-banana")
    expect(d.providerChain).toEqual(["kie", "replicate"])
  })

  it("an unregistered nodaro provider ignores prefs entirely", async () => {
    mockRegistryInfo.value = null
    mockSettings.nodaro_provider_prefs = { scope: "all", precedence: "nodaro" }
    const d = await buildRoutingDecision("image-generation", "nano-banana")
    expect(d.providerChain).toEqual(["kie", "replicate"])
  })
})
