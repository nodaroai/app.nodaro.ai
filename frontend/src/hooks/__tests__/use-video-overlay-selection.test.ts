import { describe, it, expect, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useVideoOverlayBaseSelection, useVideoOverlaySelection, useVideoOverlaySelectionStore } from "../use-video-overlay-selection"

beforeEach(() => useVideoOverlaySelectionStore.setState({ selected: {}, base: {} }))

describe("useVideoOverlaySelection", () => {
  it("is per node and not node data", () => {
    const a = renderHook(() => useVideoOverlaySelection("a"))
    const b = renderHook(() => useVideoOverlaySelection("b"))
    act(() => a.result.current[1](2))
    expect(a.result.current[0]).toBe(2)
    expect(b.result.current[0]).toBeNull()
    act(() => a.result.current[1](null))
    expect(a.result.current[0]).toBeNull()
    expect(useVideoOverlaySelectionStore.getState().selected).toEqual({})
  })

  // Never two outlines or two sets of handles: a layer or the base, not both.
  it("selecting the base deselects the layer, and selecting a layer deselects the base", () => {
    const layer = renderHook(() => useVideoOverlaySelection("a"))
    const base = renderHook(() => useVideoOverlayBaseSelection("a"))
    act(() => layer.result.current[1](1))
    act(() => base.result.current[1](true))
    expect(base.result.current[0]).toBe(true)
    expect(layer.result.current[0]).toBeNull()
    act(() => layer.result.current[1](0))
    expect(layer.result.current[0]).toBe(0)
    expect(base.result.current[0]).toBe(false)
    act(() => base.result.current[1](true))
    act(() => base.result.current[1](false))
    expect(useVideoOverlaySelectionStore.getState()).toMatchObject({ selected: {}, base: {} })
  })
})
