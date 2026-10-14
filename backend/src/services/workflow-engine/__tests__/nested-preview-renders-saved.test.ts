/**
 * A nested graph (a sub-workflow, a component) is a SAVED graph no run
 * overrides: a use-case continuation saved on it is stale and never releases
 * a review-on node from the nested refusal (the engine drops it on load).
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => true }))
import { previewRendersIn } from "../nested-preview-renders.js"

describe("previewRendersIn", () => {
  const graph = (data: Record<string, unknown>) => ({
    nodes: [
      { id: "rec", type: "upload-video", data: {} },
      { id: "t1", type: "tighten-episode", data: { reviewBeforeRender: true, ...data } },
    ],
    edges: [{ id: "e", source: "rec", target: "t1" }],
  })

  it("a review-on node with a saved render-final naming a run still holds the nested graph", () => {
    const { nodes, edges } = graph({ useCaseContinue: { mode: "render-final", jobId: "job-old" } })
    expect(previewRendersIn(nodes as never, edges as never)).toEqual(["t1"])
  })

  it("and without one, the same", () => {
    const { nodes, edges } = graph({})
    expect(previewRendersIn(nodes as never, edges as never)).toEqual(["t1"])
  })
})
