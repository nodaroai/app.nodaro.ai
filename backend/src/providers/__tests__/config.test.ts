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

  it("replicate mode returns ['replicate'] chain for shared capability", async () => {
    mockSettings.ai_provider = "replicate"

    const result = await buildRoutingDecision("image-generation", "flux")

    expect(result.providerChain).toEqual(["replicate"])
    expect(result.markupPercent).toBe(0)
    expect(result.activeProvider).toBe("replicate")
  })

  it("replicate mode returns empty chain for KIE-only capability", async () => {
    mockSettings.ai_provider = "replicate"

    const result = await buildRoutingDecision("video-to-video", "wan-2.6")

    expect(result.providerChain).toEqual([])
    expect(result.markupPercent).toBe(0)
    expect(result.activeProvider).toBe("replicate")
  })

  it("kie mode returns ['kie'] chain for KIE-only capability with markup", async () => {
    mockSettings.cost_markup_percent = 30

    const result = await buildRoutingDecision("lip-sync", "kling-avatar")

    expect(result.providerChain).toEqual(["kie"])
    expect(result.markupPercent).toBe(30)
    expect(result.activeProvider).toBe("kie")
  })

  it("kie mode returns ['kie', 'replicate'] chain for shared capability", async () => {
    const result = await buildRoutingDecision("image-to-video", "minimax")

    expect(result.providerChain).toEqual(["kie", "replicate"])
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
  it("returns 0 for replicate mode, configured markup for KIE provider, and 10 for replicate fallback", () => {
    const replicateDecision: RoutingDecision = {
      providerChain: ["replicate"],
      markupPercent: 0,
      activeProvider: "replicate",
      settings: { ai_provider: "replicate", cost_markup_percent: 0 },
    }
    expect(resolveMarkup(replicateDecision, "kie")).toBe(0)
    expect(resolveMarkup(replicateDecision, "replicate")).toBe(0)

    const kieDecision: RoutingDecision = {
      providerChain: ["kie", "replicate"],
      ***REDACTED-OSS-SCRUB***
      activeProvider: "kie",
      settings: { ai_provider: "kie", ***REDACTED-OSS-SCRUB*** },
    }
    ***REDACTED-OSS-SCRUB***
    expect(resolveMarkup(kieDecision, "replicate")).toBe(10)
  })
})
