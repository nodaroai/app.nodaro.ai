/**
 * Golden-table test for the generate-video-pro DISPLAY-ONLY credit estimate
 * (`estimateNodeCredits`'s "generate-video-pro" branch in ../types.ts).
 *
 * This is a UI-side twin of the money-authoritative closed-form in
 * `backend/src/ee/billing/generate-video-pro-credits.ts`
 * (`computeGenerateVideoProPricing`) — same split algorithm, same reserve
 * formula. The golden numbers below are copied verbatim from that file's own
 * test (`backend/src/ee/billing/__tests__/generate-video-pro-credits.test.ts`)
 * so a drift between the two would show up as a mismatched popup vs. actual
 * charge, not just a broken test.
 *
 * `getCachedCredits` (the live React Query model-cost cache) is mocked to
 * return the seeded seedance-2 @ 720p 8s composites (82 no-ref / 50 ref) —
 * the exact STATIC_CREDIT_COSTS rows the backend golden table itself pins.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/ee/hooks/use-model-credits", () => ({
  getCachedCredits: vi.fn(),
}))

import { getCachedCredits } from "@/ee/hooks/use-model-credits"
import { estimateNodeCredits } from "../types"
import type { GenerateVideoProNodeData } from "@/types/nodes"

function gvpNode(duration: number, overrides: Partial<GenerateVideoProNodeData> = {}) {
  return {
    type: "generate-video-pro",
    data: {
      label: "Generate Video Pro",
      provider: "seedance-2",
      prompt: "a cat walking",
      duration,
      resolution: "720p",
      generateAudio: true,
      ...overrides,
    } as GenerateVideoProNodeData,
  }
}

describe("estimateNodeCredits — generate-video-pro", () => {
  beforeEach(() => {
    vi.mocked(getCachedCredits).mockImplementation((id: string) => {
      if (id === "seedance-2:8s:720p") return 82
      if (id === "seedance-2:8s:720p-ref") return 50
      return undefined
    })
  })

  it("D=16 -> multi, n=2, s=17, 183", () => {
    expect(estimateNodeCredits(gvpNode(16))).toBe(183)
  })

  it("D=60 -> multi, n=5, s=62, 483", () => {
    expect(estimateNodeCredits(gvpNode(60))).toBe(483)
  })

  it("D=8 -> single, cached composite for the snapped tier (mock 82 -> 82)", () => {
    expect(estimateNodeCredits(gvpNode(8))).toBe(82)
  })

  it("D=300 clamps to 120 -> multi, n=9, s=123, 889 (same as D=120)", () => {
    expect(estimateNodeCredits(gvpNode(300))).toBe(889)
  })

  it("uncached: single mode falls back to a per-second approximation, never throws", () => {
    vi.mocked(getCachedCredits).mockReturnValue(undefined)
    expect(() => estimateNodeCredits(gvpNode(8))).not.toThrow()
    expect(estimateNodeCredits(gvpNode(8))).toBeGreaterThan(0)
  })

  it("uncached: multi mode falls back to the static 82/50 rates, still 183 for D=16", () => {
    vi.mocked(getCachedCredits).mockReturnValue(undefined)
    expect(estimateNodeCredits(gvpNode(16))).toBe(183)
  })
})
