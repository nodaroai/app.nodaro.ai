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

const store = vi.hoisted(() => ({ updateNodeData: vi.fn() }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ updateNodeData: store.updateNodeData, runSingleNode: () => {} }),
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

describe("useGenerateVideoStripModel — Auto duration", () => {
  it("labels Auto as Auto, never '-1s'", () => {
    expect(strip({ provider: "seedance-2-5", duration: -1 }).durationShort).toBe("Auto")
  })

  it("switching to a model without Auto clears it — the panel's snap is not mounted here", () => {
    store.updateNodeData.mockClear()
    strip({ provider: "seedance-2-5", duration: -1 }).onModelChange("kling-3.0")
    expect(store.updateNodeData).toHaveBeenCalledWith("n1", { provider: "kling-3.0", duration: undefined })
  })

  it("switching between two Auto-capable models keeps it; a real length is never touched", () => {
    store.updateNodeData.mockClear()
    strip({ provider: "seedance-2-5", duration: -1 }).onModelChange("seedance-2")
    expect(store.updateNodeData).toHaveBeenLastCalledWith("n1", { provider: "seedance-2" })
    strip({ provider: "seedance-2-5", duration: 12 }).onModelChange("kling-3.0")
    expect(store.updateNodeData).toHaveBeenLastCalledWith("n1", { provider: "kling-3.0" })
  })
})


/**
 * Switching the model FROM the strip must leave the node holding values the
 * new model accepts — the config panel's fail-safe never runs when the panel is
 * not mounted. Reported: Seedance (480p) → MiniMax H3 kept showing "480p"
 * instead of the 2K the model renders.
 */
describe("useGenerateVideoStripModel — model switch snaps stale values", () => {
  it("seedance 480p → minimax-h3 writes the 2K the model renders", () => {
    store.updateNodeData.mockClear()
    strip({ provider: "seedance-2-5", resolution: "480p" }).onModelChange("minimax-h3")
    expect(store.updateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({ provider: "minimax-h3", resolution: "2K" }))
  })

  it("a stale resolution already on the node displays what the model renders, never an option it lacks", () => {
    const s = strip({ provider: "minimax-h3", resolution: "480p" })
    expect(s.currentResolution).toBe("2K")
  })

  it("leaving Seedance 2.5 clears its Draft flag", () => {
    store.updateNodeData.mockClear()
    strip({ provider: "seedance-2-5", resolution: "480p", draft: true }).onModelChange("seedance-2-fast")
    expect(store.updateNodeData).toHaveBeenCalledWith("n1", expect.objectContaining({ provider: "seedance-2-fast", draft: undefined }))
  })

  it("a valid value is kept (seedance-2-fast 720p → seedance-2-5)", () => {
    store.updateNodeData.mockClear()
    strip({ provider: "seedance-2-fast", resolution: "720p" }).onModelChange("seedance-2-5")
    const patch = store.updateNodeData.mock.calls[0][1]
    expect(patch).toEqual({ provider: "seedance-2-5" })
  })
})

describe("useGenerateVideoStripModel — Seedance Draft", () => {
  it("draft on locks the resolution lever to 480p", () => {
    const s = strip({ provider: "seedance-2-5", resolution: "480p", draft: true })
    expect(s.resolutionOptions?.map((o) => o.value)).toEqual(["480p"])
  })
  it("exposes the registry's Draft control for a draft-capable model only", () => {
    expect(strip({ provider: "seedance-2-5" }).draftControl?.field).toBe("draft")
  })
})
