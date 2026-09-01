/**
 * Run-strip default display — the strip must quote the tier the node actually
 * RENDERS and BILLS, not `resolutions[0]` / `durations[0]`.
 *
 * Wan 3.0 is the first generate-video provider whose declared default differs
 * from index 0 of its (ascending) catalog ladders: it renders and bills 5s @
 * 720p while `resolutions` starts at 480p and `durations` at 2s. The strip read
 * index 0 directly, so a node whose model was switched FROM the hover strip
 * (`handleModelChange` writes only `provider`, and the config panel's fail-safe
 * effect never runs because that panel isn't mounted) displayed "480p"/"2s"
 * while the credit badge, the DAG payload fill and `runWan3` all used 720p/5s.
 *
 * The strip now shares `uiResolutionFill` / `uiDurationFill` with the backend
 * payload builder and the config panel, so the three cannot drift.
 */

import { describe, it, expect, vi } from "vitest"
import { renderHook } from "@testing-library/react"

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ updateNodeData: () => {}, runSingleNode: () => {} }),
}))

import { useGenerateVideoStripModel } from "../use-generate-video-strip-model"

const strip = (data: Record<string, unknown>) =>
  renderHook(() => useGenerateVideoStripModel("n1", data as never)).result.current

describe("useGenerateVideoStripModel — unset duration/resolution defaults", () => {
  for (const provider of ["wan-3", "wan-3-prime"]) {
    it(`${provider}: displays 720p / 5s for an unset value, not the cheapest 480p / 2s`, () => {
      const s = strip({ provider })
      expect(s.currentResolution).toBe("720p")
      expect(s.currentDuration).toBe(5)
      // Sanity: index 0 really is the cheaper tier, so this is not a tautology.
      expect(s.resolutionOptions?.[0]?.value).toBe("480p")
      expect(s.durationOptions[0]?.value).toBe(2)
    })

    it(`${provider}: an explicit selection still wins over the fill`, () => {
      const s = strip({ provider, resolution: "1080p", duration: 12 })
      expect(s.currentResolution).toBe("1080p")
      expect(s.currentDuration).toBe(12)
    })
  }

  it("gemini-omni-flash: displays the 8s tier the credit identifier falls back to", () => {
    const s = strip({ provider: "gemini-omni-flash" })
    expect(s.currentDuration).toBe(8)
    expect(s.durationOptions[0]?.value).toBe(4)
  })

  it("providers whose default IS index 0 are unchanged (seedance-2-fast)", () => {
    const s = strip({ provider: "seedance-2-fast" })
    expect(s.currentResolution).toBe(s.resolutionOptions?.[0]?.value ?? "")
    expect(s.currentDuration).toBe(s.durationOptions[0]?.value)
  })

  it("a provider with no resolution lever still reports an empty resolution", () => {
    const s = strip({ provider: "minimax" })
    expect(s.resolutionOptions).toBeUndefined()
    expect(s.currentResolution).toBe("")
  })
})
