import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook } from "@testing-library/react"

/**
 * The bar's prices are the runs' own estimates over the graph each run
 * executes (the render with its quality overridden), never the canvas's: on
 * the canvas the render still reads Preview, which would gate the tail out of
 * the final's price and quote less than the run bills.
 */
type N = { id: string; type: string; data: Record<string, unknown> }
const PLAN: N = { id: "plan", type: "edit-plan", data: {} }
const CUT: N = { id: "cut", type: "apply-edl", data: { quality: "proxy" } }
const CAP: N = { id: "cap", type: "add-captions", data: {} }
const EDGES = [
  { id: "a", source: "plan", target: "cut", targetHandle: "edl" },
  { id: "b", source: "cut", target: "cap" },
]
const renderFinal = vi.fn()
const store = { renderCheck: null as { renderId: string; kind: "final" | "proxy" } | null }
const priced: Array<{ ids: string[]; cutQuality: unknown }> = []

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ nodes: [PLAN, CUT, CAP], edges: EDGES, renderCheck: store.renderCheck }),
    { getState: () => ({ renderFinal }) },
  ),
}))
vi.mock("@/hooks/use-run-from-here-credits", () => ({
  useRunSetCredits: (executable: N[], graph: N[]) => {
    priced.push({ ids: executable.map((n) => n.id).sort(), cutQuality: graph.find((n) => n.id === "cut")?.data.quality })
    return executable.length * 100
  },
}))
vi.mock("@/components/editor/workflow-editor/types", () => ({
  isExecutableNode: (n: { type?: string }) => n.type !== "edit-plan",
}))

import { useRenderFinal } from "../use-render-final"

beforeEach(() => {
  priced.length = 0
  renderFinal.mockClear()
  store.renderCheck = null
  window.__NODARO_RUNTIME__ = { previewStopRule: true }
})
afterEach(() => {
  delete window.__NODARO_RUNTIME__
})

describe("useRenderFinal", () => {
  it("prices Render final on the graph with the render at Final, tail included", () => {
    const { result } = renderHook(() => useRenderFinal("cut"))
    const final = priced.find((p) => p.cutQuality === "final")!
    expect(final.ids).toEqual(["cap", "cut"])
    expect(result.current.finalCredits).toBe(200)
  })

  it("prices Update preview on the graph with the render at proxy", () => {
    const { result } = renderHook(() => useRenderFinal("cut"))
    expect(priced.some((p) => p.cutQuality === "proxy" && p.ids.length > 0)).toBe(true)
    expect(result.current.canUpdatePreview).toBe(true)
  })

  it("with the flag off there is no Update preview, and nothing priced for it", () => {
    delete window.__NODARO_RUNTIME__
    const { result } = renderHook(() => useRenderFinal("cut"))
    expect(result.current.canUpdatePreview).toBe(false)
    expect(result.current.previewCredits).toBe(0)
    expect(priced.some((p) => p.cutQuality === "proxy" && p.ids.length > 0)).toBe(false)
    // Render final still prices, and runs.
    expect(result.current.finalCredits).toBe(200)
  })

  it("the buttons start the two runs on this render", () => {
    const { result } = renderHook(() => useRenderFinal("cut"))
    result.current.renderFinal()
    result.current.updatePreview()
    expect(renderFinal.mock.calls).toEqual([["cut", "final"], ["cut", "proxy"]])
  })

  // The editor holds one run click at a time, so any render's newer-run check
  // holds this render's buttons; only this render's own check is `checking`.
  it.each([
    [null, false, null],
    [{ renderId: "cut", kind: "final" }, true, "final"],
    [{ renderId: "cut", kind: "proxy" }, true, "proxy"],
    [{ renderId: "other", kind: "final" }, true, null],
  ] as const)("a newer-run check %j: pending %s, checking %s", (check, pending, checking) => {
    store.renderCheck = check
    const { result } = renderHook(() => useRenderFinal("cut"))
    expect(result.current.checkPending).toBe(pending)
    expect(result.current.checking).toBe(checking)
  })
})
