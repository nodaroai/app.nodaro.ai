import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook } from "@testing-library/react"

/**
 * Render final on a Tighten Episode node's Preview (decided 2026-10-13): the
 * bar's Render final goes to the editor's handler, which continues the node's
 * own run; its price is that continuation (no fee) and every node after it, on
 * the graph carrying the continuation. No Update preview.
 */
type N = { id: string; type: string; data: Record<string, unknown> }
const REC: N = { id: "rec", type: "upload-video", data: { url: "https://r2/ep.mp4" } }
const T1: N = { id: "t1", type: "tighten-episode", data: { reviewBeforeRender: true, useCaseJobId: "00000000-0000-4000-8000-000000000001", generatedResults: [{ url: "https://r2/p.mp4", quality: "proxy", jobId: "00000000-0000-4000-8000-000000000001" }] } }
const FMT: N = { id: "fmt", type: "social-media-format", data: {} }
const EDGES = [
  { id: "a", source: "rec", target: "t1", targetHandle: "media" },
  { id: "b", source: "t1", target: "fmt", sourceHandle: "media" },
]
const state = { nodes: [REC, T1, FMT] as N[], fanOut: undefined as unknown }
const renderFinal = vi.fn()
const priced: Array<{ ids: string[]; graph: N[] }> = []

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ nodes: state.nodes, edges: EDGES, renderCheck: null }),
    { getState: () => ({ renderFinal }) },
  ),
}))
vi.mock("@/hooks/use-run-from-here-credits", () => ({
  useRunSetPrice: (executable: N[], graph: N[]) => {
    priced.push({ ids: executable.map((n) => n.id).sort(), graph })
    return { credits: executable.length * 100, hold: 0, estimating: false }
  },
}))
vi.mock("@/components/editor/workflow-editor/types", () => ({
  isExecutableNode: (n: { type?: string }) => n.type !== "upload-video",
}))
vi.mock("@/components/editor/workflow-editor/node-input-resolver", () => ({
  getListFanOutForNode: () => state.fanOut,
}))

import { useRenderFinal } from "../use-render-final"

beforeEach(() => {
  priced.length = 0
  renderFinal.mockClear()
  state.nodes = [REC, T1, FMT]
  state.fanOut = undefined
  window.__NODARO_RUNTIME__ = { previewStopRule: true }
})
afterEach(() => {
  delete window.__NODARO_RUNTIME__
})

describe("useRenderFinal on a Tighten Episode node", () => {
  it("prices the node's continuation and every node after it, on the graph carrying the continuation", () => {
    const { result } = renderHook(() => useRenderFinal("t1"))
    const final = priced.find((p) => p.ids.length > 0)!
    expect(final.ids).toEqual(["fmt", "t1"])
    expect(final.graph.find((n) => n.id === "t1")!.data.useCaseContinue).toEqual({ mode: "render-final", jobId: "00000000-0000-4000-8000-000000000001" })
    expect(result.current.finalCredits).toBe(200)
  })

  it("has no Update preview, and prices none", () => {
    const { result } = renderHook(() => useRenderFinal("t1"))
    expect(result.current.canUpdatePreview).toBe(false)
    expect(result.current.previewCredits).toBe(0)
  })

  it("Render final goes to the editor's handler as a final (which continues the node's run)", () => {
    const { result } = renderHook(() => useRenderFinal("t1"))
    result.current.renderFinal()
    expect(renderFinal).toHaveBeenCalledWith("t1", "final")
  })

  it("no run to continue, or a list-driven node: nothing to price", () => {
    state.nodes = [REC, { ...T1, data: { reviewBeforeRender: true, useCaseJobId: "00000000-0000-4000-8000-000000000001" } }, FMT]
    expect(renderHook(() => useRenderFinal("t1")).result.current.finalCredits).toBe(0)
    state.nodes = [REC, T1, FMT]
    state.fanOut = { items: ["a", "b"] }
    expect(renderHook(() => useRenderFinal("t1")).result.current.finalCredits).toBe(0)
  })
})
