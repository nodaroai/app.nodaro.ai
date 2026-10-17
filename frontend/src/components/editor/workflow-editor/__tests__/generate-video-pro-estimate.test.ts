// @test-units-by-name estimates only generate-video-pro nodes
/**
 * Golden-table test for the generate-video-pro DISPLAY-ONLY credit estimate
 * (`estimateNodeCredits`'s "generate-video-pro" branch in ../types.ts).
 *
 * This is a UI-side twin of the money-authoritative closed-form in
 * `backend/src/ee/billing/generate-video-pro-credits.ts`
 * (`computeGenerateVideoProPricing`) — same split algorithm, same reserve
 * formula, same split-selection precedence (explicit segmentDurations >
 * preferredSegmentSec > classic). The golden numbers below are copied
 * verbatim from that file's own test
 * (`backend/src/ee/billing/__tests__/generate-video-pro-credits.test.ts`)
 * so a drift between the two would show up as a mismatched popup vs. actual
 * charge, not just a broken test.
 *
 * `getCachedCredits` (the live React Query model-cost cache) is mocked to
 * return the seeded seedance-2 @ 720p 8s composites (820 no-ref / 500 ref)
 * and the 100-credit pro fee — the exact STATIC_CREDIT_COSTS rows the
 * backend golden table itself pins. (This file previously carried the
 * pre-redenomination 82/50/10 numbers and only stayed green because the
 * stale mock happened to match the then-stale fallbacks — fixed 2026-08-03.)
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
      if (id === "seedance-2:8s:720p") return 820
      if (id === "seedance-2:8s:720p-ref") return 500
      if (id === "generate-video-pro") return 100
      return undefined
    })
  })

  it("D=16 -> multi, n=2, s=17, 1888", () => {
    expect(estimateNodeCredits(gvpNode(16))).toBe(1888)
  })

  it("D=60 -> multi, n=5, s=62, 5076", () => {
    expect(estimateNodeCredits(gvpNode(60))).toBe(5076)
  })

  it("D=8 -> single, cached composite for the snapped tier (mock 820 -> 820)", () => {
    vi.mocked(getCachedCredits).mockImplementation((id: string) =>
      id === "seedance-2:8s:720p" ? 820 : undefined,
    )
    expect(estimateNodeCredits(gvpNode(8))).toBe(820)
  })

  it("D=300 clamps to 120 -> multi, n=9, s=123, 9388 (same as D=120)", () => {
    expect(estimateNodeCredits(gvpNode(300))).toBe(9388)
  })

  it("uncached: single mode falls back to a per-second approximation, never throws", () => {
    vi.mocked(getCachedCredits).mockReturnValue(undefined)
    expect(() => estimateNodeCredits(gvpNode(8))).not.toThrow()
    expect(estimateNodeCredits(gvpNode(8))).toBeGreaterThan(0)
  })

  it("uncached: multi mode falls back to the post-redenomination 820/500/100 statics, still 1888 for D=16", () => {
    vi.mocked(getCachedCredits).mockReturnValue(undefined)
    expect(estimateNodeCredits(gvpNode(16))).toBe(1888)
  })

  // Levered paths (2026-08-03) — before this the estimate IGNORED
  // preferredSegmentSec entirely and misquoted every levered run.
  it("preferredSegmentSec=6 @ D=45 -> the levered split's 4215 (backend golden), not the classic 3701", () => {
    expect(estimateNodeCredits(gvpNode(45, { preferredSegmentSec: 6 }))).toBe(4215)
  })

  it("explicit segmentDurations (79.3s scene pack) -> priced verbatim, 7233 (backend golden)", () => {
    const SCENE_PACK_79 = [8, 10, 6, 6, 5, 6, 4, 4, 4, 5, 5, 5, 7, 8]
    expect(estimateNodeCredits(gvpNode(79.3, { segmentDurations: SCENE_PACK_79 }))).toBe(7233)
  })

  it("explicit takes precedence over preferredSegmentSec (backend parity)", () => {
    const eightSixes = [6, 6, 6, 6, 6, 6, 6, 6]
    expect(
      estimateNodeCredits(gvpNode(45, { segmentDurations: eightSixes, preferredSegmentSec: 15 })),
    ).toBe(4215)
  })

  it("a malformed explicit array (out-of-range entry) degrades to the classic split for display", () => {
    expect(estimateNodeCredits(gvpNode(16, { segmentDurations: [3, 14] }))).toBe(1888)
  })
})
