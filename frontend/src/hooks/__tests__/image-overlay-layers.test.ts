import { describe, it, expect } from "vitest"
import { reorderLayers } from "../use-image-overlay-layers"
import { DEFAULT_OVERLAY_LAYER, OVERLAY_HANDLE_IDS, OVERLAY_MAX_LAYERS, visibleOverlayLayerCount } from "@/types/nodes"

const L = DEFAULT_OVERLAY_LAYER

describe("reorderLayers", () => {
  it("brings a layer forward on a fresh node whose second slot has no settings yet (the on-canvas no-op bug)", () => {
    const next = reorderLayers([L, L], 0, "up")
    expect(next?.map((l) => l.zIndex)).toEqual([1, 0])
  })

  it("returns null at the ends instead of writing", () => {
    expect(reorderLayers([L, L], 1, "up")).toBeNull()
    expect(reorderLayers([L, L], 0, "down")).toBeNull()
  })

  it("re-stamps zIndex 0..n-1 from the new order and keeps every other field", () => {
    const next = reorderLayers([{ ...L, width: 10 }, { ...L, width: 20 }, { ...L, width: 30, zIndex: 9 }], 2, "down")
    expect(next?.map((l) => [l.width, l.zIndex])).toEqual([[10, 0], [20, 2], [30, 1]])
  })
})

describe("visibleOverlayLayerCount", () => {
  it("defaults to 4, grows to cover configured or wired slots, never exceeds the contract", () => {
    expect(visibleOverlayLayerCount(undefined, 0, 0)).toBe(4)
    expect(visibleOverlayLayerCount(2, 0, 0)).toBe(2)
    expect(visibleOverlayLayerCount(2, 0, 7)).toBe(7)
    expect(visibleOverlayLayerCount(2, 9, 0)).toBe(9)
    expect(visibleOverlayLayerCount(99, 0, 0)).toBe(OVERLAY_MAX_LAYERS)
    expect(visibleOverlayLayerCount(Number.NaN, 0, 0)).toBe(4)
    expect(OVERLAY_HANDLE_IDS.length).toBe(OVERLAY_MAX_LAYERS)
  })
})
