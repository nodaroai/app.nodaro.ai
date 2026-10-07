/**
 * `http.computeVoiceChangerProTranslatePricing` — the additive-optional toolkit
 * member the Voice Changer Pro plugin's translate route asks for its
 * reservation ceiling (plugin falls back to its own constants on an older host).
 *
 * Mocking convention mirrors `toolkit.test.ts` (mock the real `lib/supabase.js`
 * / `lib/queue.js` IMPLEMENTATIONS so nothing touches the network) and
 * `toolkit-evp.test.ts` (partial-mock `@/lib/config.js` so only `hasCredits`
 * is overridden). Unlike the evp suite, the ee module is NOT replaced: only
 * the one `model_pricing` read is stubbed, so the REAL formula in
 * `ee/billing/voice-changer-pro-credits.ts` runs through the toolkit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockFrom, mockAdd, mockHasCreditsRef, mockGetModelCreditBaseCost, row } = vi.hoisted(() => {
  const mockSingle = vi.fn().mockResolvedValue({ data: { id: "job-1" }, error: null })
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle })
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect })
  const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert })
  const mockAdd = vi.fn().mockResolvedValue({ id: "bull-job-1" })
  // The shape `getModelCreditBaseCost` resolves (`ModelPricing`).
  const row = (creditCost: number) => ({ creditCost, isEnabled: true, tierRestriction: null })
  return {
    mockFrom,
    mockAdd,
    row,
    mockHasCreditsRef: { value: true },
    mockGetModelCreditBaseCost: vi.fn(async (_modelIdentifier: string) => row(2)),
  }
})

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: mockFrom } }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: mockAdd } }))
vi.mock(import("@/lib/config.js"), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, hasCredits: () => mockHasCreditsRef.value }
})
vi.mock(import("@/ee/billing/credits.js"), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getModelCreditBaseCost: mockGetModelCreditBaseCost }
})

import { buildToolkit } from "../toolkit.js"
import type { PluginToolkit } from "../types.js"

describe("toolkit http.computeVoiceChangerProTranslatePricing (additive-optional)", () => {
  let tk: PluginToolkit

  beforeEach(() => {
    vi.clearAllMocks()
    mockHasCreditsRef.value = true
    mockGetModelCreditBaseCost.mockResolvedValue(row(2))
    tk = buildToolkit()
  })

  it("is present on this host (a dropped wiring line would send every plugin to its fallback constants)", () => {
    expect(typeof tk.http.computeVoiceChangerProTranslatePricing).toBe("function")
  })

  it("answers the ee formula from the model_pricing floor: economy, 1,500 chars → 2 buckets × 5", async () => {
    await expect(tk.http.computeVoiceChangerProTranslatePricing!({ sourceChars: 1_500, tier: "economy" }))
      .resolves.toEqual({ floor: 2, ceilingPer1K: 5, reserveBase: 10 })
    expect(mockGetModelCreditBaseCost).toHaveBeenCalledWith("voice-changer-pro-translate")
  })

  it("the row's value is the floor (an admin retune reaches the plugin without a redeploy)", async () => {
    mockGetModelCreditBaseCost.mockResolvedValue(row(7))
    await expect(tk.http.computeVoiceChangerProTranslatePricing!({ sourceChars: 0, tier: "premium" }))
      .resolves.toEqual({ floor: 7, ceilingPer1K: 50, reserveBase: 7 })
  })

  it("throws outside Cloud (hasCredits false) without touching the credit layer", async () => {
    mockHasCreditsRef.value = false
    await expect(tk.http.computeVoiceChangerProTranslatePricing!({ sourceChars: 1_500, tier: "economy" }))
      .rejects.toThrow(/Cloud-edition/)
    expect(mockGetModelCreditBaseCost).not.toHaveBeenCalled()
  })
})
