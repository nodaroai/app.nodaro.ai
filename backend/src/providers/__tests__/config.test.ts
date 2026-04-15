import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — must use vi.hoisted() for variables referenced inside vi.mock()
// ---------------------------------------------------------------------------

const { mockSettings } = vi.hoisted(() => {
  const mockSettings = {
    ai_provider: "kie" as "kie" | "replicate",
    ***REDACTED-OSS-SCRUB***
  }
  return { mockSettings }
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
    mockSettings.ai_provider = "kie"
    ***REDACTED-OSS-SCRUB***
  })

  it("non-kie mode returns empty chain (replicate disabled)", async () => {
    mockSettings.ai_provider = "replicate"

    const result = await buildRoutingDecision("image-generation", "flux")

    expect(result.providerChain).toEqual([])
    expect(result.markupPercent).toBe(0)
    expect(result.activeProvider).toBe("kie")
  })

  it("non-kie mode returns empty chain for KIE-only capability", async () => {
    mockSettings.ai_provider = "replicate"

    const result = await buildRoutingDecision("video-to-video", "wan-2.6")

    expect(result.providerChain).toEqual([])
    expect(result.markupPercent).toBe(0)
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
    ***REDACTED-OSS-SCRUB***
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
      ***REDACTED-OSS-SCRUB***
      activeProvider: "kie",
      ***REDACTED-OSS-SCRUB***
    }
    ***REDACTED-OSS-SCRUB***
    // With replicate disabled, even replicate providerUsed returns the same KIE markup
    ***REDACTED-OSS-SCRUB***
  })
})

describe("web-scrape credit costs", () => {
  it("has all 5 static composite entries", async () => {
    const { STATIC_CREDIT_COSTS } = await import("../../billing/credits.js")
    expect(STATIC_CREDIT_COSTS["web-scrape:google-search"]).toBe(2)
    expect(STATIC_CREDIT_COSTS["web-scrape:content-crawler"]).toBe(3)
    expect(STATIC_CREDIT_COSTS["web-scrape:content-crawler:site"]).toBe(10)
    expect(STATIC_CREDIT_COSTS["web-scrape:instagram"]).toBe(5)
    expect(STATIC_CREDIT_COSTS["web-scrape:tiktok"]).toBe(5)
  })

  it("has bare fallback entry used by estimateWorkflowCredits", async () => {
    // Without this, estimateWorkflowCredits returns 0 for unconfigured web-scrape
    // nodes because getNodeModelIdentifier returns the bare node type.
    const { STATIC_CREDIT_COSTS } = await import("../../billing/credits.js")
    expect(STATIC_CREDIT_COSTS["web-scrape"]).toBe(5)
  })
})
