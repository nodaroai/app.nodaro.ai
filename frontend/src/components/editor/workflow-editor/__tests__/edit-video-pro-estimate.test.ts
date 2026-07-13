/**
 * Golden-table test for the edit-video-pro DISPLAY-ONLY credit estimate
 * (`estimateNodeCredits`'s "edit-video-pro" branch in ../types.ts).
 *
 * This is a UI-side twin of the money-authoritative closed-form in
 * `backend/src/ee/billing/edit-video-pro-credits.ts`
 * (`computeEditVideoProPricing`) — same split algorithm, same reserve
 * formula, ALWAYS DISPLAYED AT 720p (the client can't know the source's real
 * resolution tier; the server only learns it by probing at reserve time).
 * Four of the five rows below are copied verbatim from that file's own golden
 * table (`backend/src/ee/billing/__tests__/edit-video-pro-credits.test.ts`,
 * probed at a 720p source) so a drift between the two would show up as a
 * mismatched popup vs. actual charge, not just a broken test. The "D unknown"
 * row has no backend equivalent (a failed/absent probe worst-cases at the TOP
 * catalog tier there, not 720p) — it exercises this function's OWN
 * worst-case fallback (tail + refIn both assumed present) instead.
 *
 * `getCachedCredits` (the live React Query model-cost cache) is mocked to
 * always return undefined — the golden numbers are the pure static-fallback
 * path (fee 10, refPerSec 6.25 = the seeded seedance-2 8s 720p-ref composite
 * 50 / 8).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/ee/hooks/use-model-credits", () => ({
  getCachedCredits: vi.fn(),
}))

import { getCachedCredits } from "@/ee/hooks/use-model-credits"
import { estimateNodeCredits } from "../types"
import type { EditVideoProNodeData } from "@/types/nodes"

function evpNode(overrides: Partial<EditVideoProNodeData> = {}) {
  return {
    type: "edit-video-pro",
    data: {
      label: "Edit Video Pro",
      provider: "seedance-2",
      mode: "replace",
      prompt: "a cat walking",
      spanStart: 0,
      spanEnd: 8,
      generateAudio: true,
      ...overrides,
    } as EditVideoProNodeData,
  }
}

describe("estimateNodeCredits — edit-video-pro", () => {
  beforeEach(() => {
    vi.mocked(getCachedCredits).mockReturnValue(undefined)
  })

  it("mid-video span 10, D known (20) -> 92", () => {
    expect(
      estimateNodeCredits(evpNode({ spanStart: 2, spanEnd: 12, sourceDurationSec: 20 })),
    ).toBe(92)
  })

  it("A=0 span 10, D 20 -> 79", () => {
    expect(
      estimateNodeCredits(evpNode({ spanStart: 0, spanEnd: 10, sourceDurationSec: 20 })),
    ).toBe(79)
  })

  it("D unknown -> worst-cases tail+refIn (spanStart 2, spanEnd 12 -> 92)", () => {
    expect(
      estimateNodeCredits(evpNode({ spanStart: 2, spanEnd: 12, sourceDurationSec: undefined })),
    ).toBe(92)
  })

  it("B==D -> 79", () => {
    expect(
      estimateNodeCredits(evpNode({ spanStart: 10, spanEnd: 20, sourceDurationSec: 20 })),
    ).toBe(79)
  })

  it("span 20 mid -> 167", () => {
    expect(
      estimateNodeCredits(evpNode({ spanStart: 5, spanEnd: 25, sourceDurationSec: 40 })),
    ).toBe(167)
  })
})
