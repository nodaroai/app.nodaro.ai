/**
 * The hold after a review-on use-case node lives in @nodaro/shared (the stop
 * rule both engines and both estimators read); the use-case nodes and their
 * Render final's override live in @nodaro/render-rules. These pin the two
 * together, so a new use-case node or a new override shape cannot leave what
 * follows it building on a preview, or held after its Render final. Only a
 * reviewable type holds; one without a review (Chapters) never does.
 */
import { describe, it, expect } from "vitest"
import { REVIEW_HOLDING_USE_CASE_TYPES, previewStops, rendersAsPreview, withRunOverrides } from "@nodaro/shared/nodes"
import { USE_CASE_NODE_TYPES, runsUseCaseRenderFinal, usecaseDescriptor, usecaseFinalRunSet, usecaseRenderFinalOverrides } from "@nodaro/render-rules"
import { requestOf } from "../../services/workflow-engine/use-case-request.js"
import type { OrchestratorContext, ResolvedInputs, SimpleNode } from "../../services/workflow-engine/types.js"

const graph = (type: string) => ({
  nodes: [
    { id: "rec", type: "upload-video", data: { url: "https://r2/ep.mp4" } },
    { id: "t1", type, data: { reviewBeforeRender: true } as Record<string, unknown> },
    { id: "fmt", type: "social-media-format", data: {} },
    { id: "post", type: "webhook-output", data: {} },
  ],
  edges: [
    { source: "rec", target: "t1" },
    { source: "t1", target: "fmt", sourceHandle: "media" },
    { source: "fmt", target: "post" },
  ],
})

const REVIEWABLE = USE_CASE_NODE_TYPES.filter((type) => usecaseDescriptor(type).reviewable)
const NOT_REVIEWABLE = USE_CASE_NODE_TYPES.filter((type) => !usecaseDescriptor(type).reviewable)

describe("every use-case node with review holds what follows it", () => {
  it("the holding list names exactly the reviewable types", () => {
    expect([...REVIEW_HOLDING_USE_CASE_TYPES].sort()).toEqual([...REVIEWABLE].sort())
  })

  for (const type of NOT_REVIEWABLE) {
    it(`${type} has no review: asked for one, it is no preview and holds nothing`, () => {
      const { nodes, edges } = graph(type)
      expect(rendersAsPreview(nodes.find((n) => n.id === "t1")!)).toBe(false)
      expect(previewStops(nodes, edges).gatedNodeIds.size).toBe(0)
    })
  }

  for (const type of REVIEWABLE) {
    it(`${type}: the Render final override releases exactly what the expansion prices as a final`, () => {
      const { nodes, edges } = graph(type)
      // Review on, no override: a Preview, and what follows waits.
      const t1 = nodes.find((n) => n.id === "t1")!
      expect(runsUseCaseRenderFinal(t1.data)).toBe(false)
      expect(rendersAsPreview(t1)).toBe(true)
      expect([...previewStops(nodes, edges).gatedNodeIds].sort()).toEqual(["fmt", "post"])

      // The shipped override, merged as the run merges it: the final, nothing held.
      for (const target of [{ jobId: "job-w" }, { jobId: "job-w", settings: { output: "video" } }]) {
        const run = withRunOverrides(nodes, usecaseRenderFinalOverrides("t1", target, { editedEdl: { cuts: [] } }))
        const overridden = run.find((n) => n.id === "t1")!
        expect(runsUseCaseRenderFinal(overridden.data)).toBe(true)
        expect(rendersAsPreview(overridden)).toBe(false)
        const stops = previewStops(run, edges, { executes: (id) => usecaseFinalRunSet("t1", run, edges).has(id) })
        expect(stops.gatedNodeIds.size).toBe(0)
        expect(stops.previewRenderIds).toEqual([])
      }
    })
  }
})

describe("a render-final override that names no run", () => {
  // Reachable through any lane that keeps a nested override verbatim (an API
  // run's inputOverrides, node data written by an agent): all three readers —
  // the stop rule, the expansion every estimator prices, and the server
  // engine's call — read it as a fresh run, never as a Render final. A type
  // without a review is no preview either way; its engine call is still fresh.
  for (const type of USE_CASE_NODE_TYPES) {
    it(`${type}: the stop rule, the expansion and the engine all read a fresh run`, () => {
      const { nodes, edges } = graph(type)
      const run = withRunOverrides(nodes, { t1: { useCaseContinue: { mode: "render-final" } } })
      const t1 = run.find((n) => n.id === "t1")!
      expect(runsUseCaseRenderFinal(t1.data)).toBe(false)
      if (usecaseDescriptor(type).reviewable) {
        expect(rendersAsPreview(t1)).toBe(true)
        expect([...previewStops(run, edges).gatedNodeIds].sort()).toEqual(["fmt", "post"])
      } else {
        expect(rendersAsPreview(t1)).toBe(false)
        expect(previewStops(run, edges).gatedNodeIds.size).toBe(0)
      }
      const ctx = { userId: "u1", billingContext: { payer: "personal", userId: "u1" } } as unknown as OrchestratorContext
      const inputs = { useCaseMedia: [{ nodeId: "rec", url: "https://r2/ep.mp4" }] } as unknown as ResolvedInputs
      const request = requestOf(t1 as unknown as SimpleNode, inputs, ctx, null)
      expect(request.path).toBe(usecaseDescriptor(type).route)
      expect(request.body).not.toHaveProperty("jobId")
    })
  }
})
