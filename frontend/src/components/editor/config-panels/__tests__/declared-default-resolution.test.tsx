/**
 * A model whose unset size is not its first listed one (MiniMax H3 Image and
 * Seedream 5.5 render 2K, their first listed size is 1K) shows and writes that size on every editor
 * surface: the config panel's fail-safe, the run strip and its snap, and a
 * published app's reset. No other image model's shown default moves.
 */
import { describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"
import { renderHook } from "@testing-library/react"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"

const store = vi.hoisted(() => ({ updateNodeData: vi.fn() }))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ updateNodeData: store.updateNodeData, runSingleNode: () => {} }),
}))

import { IMAGE_RESOLUTION_OPTIONS, declaredDefaultResolution, defaultResolutionFor } from "../model-options"
import { useGenerateImageStripModel } from "@/components/nodes/use-generate-image-strip-model"
import { getQuickConfigs, quickConfigSnapPatch, resolveQuickConfigOptions } from "@/components/nodes/node-quick-configs"
import { ConfigFieldRenderer } from "@/components/presentation/config-field-renderer"

const MINIMAX = ["minimax-h3-image", "minimax-h3-image-i2i"]
const SEEDREAM_5_5 = ["seedream-5-5", "seedream-5-5-i2i"]
const DECLARING = [...MINIMAX, ...SEEDREAM_5_5]

describe("the declared default size", () => {
  it("is declared by MiniMax H3 Image's and Seedream 5.5's two ids each and by two video models only", () => {
    const declaring = Object.values(MODEL_CATALOG).filter((m) => m.defaultResolution).map((m) => m.id).sort()
    expect(declaring).toEqual(["gemini-omni-flash-1-2", "minimax-h3-image", "minimax-h3-image-i2i", "nodaro-video-upscale", "seedream-5-5", "seedream-5-5-i2i"])
    expect(MODEL_CATALOG["gemini-omni-flash-1-2"]!.kind).toBe("video")
    // Nodaro Video Upscale's 1080p, its first tier: what a value it does not
    // take is coerced to (normalizeVideoUpscaleResolution).
    expect(MODEL_CATALOG["nodaro-video-upscale"]!.kind).toBe("video")
    expect(MODEL_CATALOG["nodaro-video-upscale"]!.defaultResolution).toBe("1080p")
  })

  it("is 2K on MiniMax H3 Image and Seedream 5.5 and nothing on every other image model with a size menu", () => {
    for (const id of DECLARING) {
      expect(declaredDefaultResolution(id), id).toBe("2K")
      expect(defaultResolutionFor(id), id).toBe("2K")
    }
    for (const id of Object.keys(IMAGE_RESOLUTION_OPTIONS).filter((id) => !DECLARING.includes(id))) {
      expect(declaredDefaultResolution(id), id).toBeUndefined()
    }
  })

  it("leaves the panel fail-safe of every other model as it was (Flux 2 keeps its own default)", () => {
    expect(defaultResolutionFor("flux-2-pro")).toBe("2 MP")
    expect(defaultResolutionFor("flux-2-klein")).toBe("1 MP")
    expect(defaultResolutionFor("gpt-image-2-6-flare")).toBeUndefined()
    expect(defaultResolutionFor("seedream-5-flash")).toBeUndefined()
  })
})

describe("the run strip", () => {
  const strip = (data: Record<string, unknown>) =>
    renderHook(() => useGenerateImageStripModel("n1", data as never)).result.current

  it("shows 2K for an unset size on MiniMax H3 Image, the first listed size elsewhere", () => {
    expect(strip({ provider: "minimax-h3-image" }).currentResolution).toBe("2K")
    expect(strip({ provider: "seedream-5-5" }).currentResolution).toBe("2K")
    expect(strip({ provider: "seedream-5-flash" }).currentResolution).toBe("1K")
    expect(strip({ provider: "gpt-image-2" }).currentResolution).toBe(IMAGE_RESOLUTION_OPTIONS["gpt-image-2"]![0]!.value)
  })

  it("snaps a stale size to 2K on MiniMax H3 Image, to the first listed size elsewhere", () => {
    const control = getQuickConfigs("generate-image").find((q) => q.field === "resolution")!
    const snap = (provider: string) => {
      const data = { provider, resolution: "2 MP" }
      return quickConfigSnapPatch(control, "2 MP", resolveQuickConfigOptions(control, data), data)
    }
    expect(snap("minimax-h3-image")).toEqual({ resolution: "2K" })
    expect(snap("seedream-5-5")).toEqual({ resolution: "2K" })
    expect(snap("gpt-image-2")).toEqual({ resolution: "1K" })
  })
})

describe("a published app's size field", () => {
  // Only Generate Image exposes a size field to a published app (`renderGenerateImage`).
  const renderSize = (provider: string) => {
    const onChange = vi.fn()
    render(<ConfigFieldRenderer nodeType="generate-image" field="resolution" value={undefined} nodeData={{ provider }} onChange={onChange} />)
    return onChange
  }

  it("writes 2K for an unset size on MiniMax H3 Image and Seedream 5.5, the first listed size elsewhere", () => {
    expect(renderSize("minimax-h3-image")).toHaveBeenCalledWith("2K")
    expect(renderSize("seedream-5-5")).toHaveBeenCalledWith("2K")
    expect(renderSize("gpt-image-2")).toHaveBeenCalledWith("1K")
  })
})
