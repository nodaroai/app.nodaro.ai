import { describe, it, expect, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useVideoOverlaySelection, useVideoOverlaySelectionStore } from "../use-video-overlay-selection"

beforeEach(() => useVideoOverlaySelectionStore.setState({ selected: {} }))

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
})
