import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useResultAspectRatio } from "../use-result-aspect-ratio"
import { useWorkflowStore } from "../use-workflow-store"

vi.mock("../use-workflow-store", () => {
  const updateNodeData = vi.fn()
  const state = {
    nodes: [] as Array<{ id: string; data: Record<string, unknown> }>,
    updateNodeData,
  }
  const store = ((selector: (s: typeof state) => unknown) => selector(state)) as unknown as typeof useWorkflowStore
  ;(store as unknown as { getState: () => typeof state }).getState = () => state
  ;(store as unknown as { __setNodes: (n: typeof state.nodes) => void }).__setNodes = (n) => { state.nodes = n }
  ;(store as unknown as { __reset: () => void }).__reset = () => { state.nodes = []; updateNodeData.mockReset() }
  return { useWorkflowStore: store }
})

const __store = useWorkflowStore as unknown as {
  getState: () => { nodes: Array<{ id: string; data: Record<string, unknown> }>; updateNodeData: ReturnType<typeof vi.fn> }
  __setNodes: (n: Array<{ id: string; data: Record<string, unknown> }>) => void
  __reset: () => void
}

beforeEach(() => __store.__reset())

const baseResult = { url: "u1", timestamp: "t", jobId: "j1" }

describe("useResultAspectRatio", () => {
  it("returns aspect ratio synchronously when result has stored width/height", () => {
    const results = [{ ...baseResult, width: 1024, height: 576 }]
    const { result } = renderHook(() => useResultAspectRatio("n1", results, 0))
    expect(result.current.aspectRatio).toBeCloseTo(1024 / 576)
  })

  it("returns undefined when active result has no dimensions", () => {
    const results = [baseResult]
    const { result } = renderHook(() => useResultAspectRatio("n1", results, 0))
    expect(result.current.aspectRatio).toBeUndefined()
  })

  it("writes dimensions back via updateNodeData on first onLoadDimensions", () => {
    const results = [baseResult]
    __store.__setNodes([{ id: "n1", data: { generatedResults: results, activeResultIndex: 0 } }])
    const { result } = renderHook(() => useResultAspectRatio("n1", results, 0))
    act(() => result.current.onLoadDimensions({ width: 800, height: 600 }))
    expect(__store.getState().updateNodeData).toHaveBeenCalledWith("n1", {
      generatedResults: [{ ...baseResult, width: 800, height: 600 }],
    })
  })

  it("does NOT write back if result already has dimensions", () => {
    const results = [{ ...baseResult, width: 1024, height: 576 }]
    __store.__setNodes([{ id: "n1", data: { generatedResults: results, activeResultIndex: 0 } }])
    const { result } = renderHook(() => useResultAspectRatio("n1", results, 0))
    act(() => result.current.onLoadDimensions({ width: 800, height: 600 }))
    expect(__store.getState().updateNodeData).not.toHaveBeenCalled()
  })

  it("ignores onLoadDimensions if user switched to a different result mid-load", () => {
    // Closure captures result at index 0 (url=u1), but at fire time the store
    // points to index 1 (url=u2) — guard URL match should drop the write.
    const results = [baseResult, { ...baseResult, url: "u2", jobId: "j2" }]
    __store.__setNodes([{ id: "n1", data: { generatedResults: results, activeResultIndex: 1 } }])
    const { result } = renderHook(() => useResultAspectRatio("n1", results, 0))
    act(() => result.current.onLoadDimensions({ width: 800, height: 600 }))
    expect(__store.getState().updateNodeData).not.toHaveBeenCalled()
  })
})
