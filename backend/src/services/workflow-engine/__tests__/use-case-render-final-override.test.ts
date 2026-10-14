// @test-watches backend/src/services/workflow-engine/sub-workflow-handler.ts
/**
 * The editor's Render final on a Tighten Episode node (decided 2026-10-13)
 * sends the continuation as an input override of that run only:
 * `{ [node]: { useCaseContinue: { mode: "render-final", jobId } } }`. Merged by
 * the worker's one override merge over the saved graph, it makes the node's
 * executor call the continue route with render-final and the node's saved
 * edit — never a fresh run, never the saved data changed.
 */
import { describe, it, expect } from "vitest"
import { applyInputOverridesToNodes } from "../../../workers/apply-input-overrides.js"
import { CONTINUE_PATH, requestOf } from "../use-case-request.js"
import type { OrchestratorContext, SimpleNode } from "../types.js"

const EDIT = { v: 1, kind: "edl", basis: "b", edl: { segments: [{ id: "s0", inMs: 0, outMs: 4000 }], dropped: [] } }
const saved = (): SimpleNode[] => [
  { id: "rec", type: "upload-video", data: { url: "https://r2/ep.mp4" } },
  {
    id: "t1", type: "tighten-episode",
    data: { reviewBeforeRender: true, useCaseJobId: "job-1", editedEdl: EDIT, generatedVideoUrl: "https://r2/p.mp4", generatedResults: [{ url: "https://r2/p.mp4", quality: "proxy" }] },
  },
]
const ctx = { userId: "u1", workflowId: "wf-1", reviewerPresent: true } as unknown as OrchestratorContext

describe("the editor's Render final override reaches the continue route", () => {
  it("merged over the saved graph, the node asks for its render-final with its saved edit", () => {
    const nodes = saved()
    applyInputOverridesToNodes(nodes, { t1: { useCaseContinue: { mode: "render-final", jobId: "job-1" } } }, "all")
    const t1 = nodes.find((n) => n.id === "t1")!
    const request = requestOf(t1, {}, ctx, null)
    expect(request.path).toBe(CONTINUE_PATH)
    expect(request.body).toMatchObject({ jobId: "job-1", mode: "render-final", editedEdl: EDIT, reviewerPresent: true, nodeId: "t1" })
    expect(request.fallback).toBeUndefined()
  })

  it("asks for the preview's run only: never the node's later settings (the route renders with the run's stored ones)", () => {
    const nodes = saved().map((n) => (n.id === "t1" ? { ...n, data: { ...n.data, captions: false, framing: null } } : n))
    applyInputOverridesToNodes(nodes, { t1: { useCaseContinue: { mode: "render-final", jobId: "job-1", settings: { captions: true } } } }, "all")
    const body = requestOf(nodes.find((n) => n.id === "t1")!, {}, ctx, null).body
    expect(body).toMatchObject({ jobId: "job-1", mode: "render-final" })
    for (const key of ["captions", "framing", "settings", "output"]) expect(body).not.toHaveProperty(key)
  })

  it("without the override the same saved node is a fresh run", () => {
    const nodes = saved()
    const t1 = nodes.find((n) => n.id === "t1")!
    const request = requestOf(t1, { useCaseMedia: [{ nodeId: "rec", url: "https://r2/ep.mp4" }] } as never, ctx, null)
    expect(request.path).not.toBe(CONTINUE_PATH)
  })
})

describe("a continuation saved on the graph is never this run's", () => {
  const media = { useCaseMedia: [{ nodeId: "rec", url: "https://r2/ep.mp4" }] } as never
  const stale = (cont: Record<string, unknown>): SimpleNode[] =>
    saved().map((n) => (n.id === "t1" ? { ...n, data: { ...n.data, useCaseContinue: cont } } : n))

  for (const cont of [{ mode: "from-failed", jobId: "job-old" }, { mode: "render-final", jobId: "job-old" }]) {
    it(`a saved ${cont.mode} flag, with no override: the run's merge drops it and the node runs fresh`, () => {
      for (const overrides of [undefined, { rec: { url: "https://r2/other.mp4" } }]) {
        const nodes = stale(cont)
        applyInputOverridesToNodes(nodes, overrides, "all")
        const t1 = nodes.find((n) => n.id === "t1")!
        expect(t1.data).not.toHaveProperty("useCaseContinue")
        const request = requestOf(t1, media, ctx, null)
        expect(request.path).toBe("/v1/tighten-episode")
        expect(request.body).not.toHaveProperty("jobId")
      }
    })
  }

  it("this run's own override still wins over a stale saved one", () => {
    const nodes = stale({ mode: "from-failed", jobId: "job-old" })
    applyInputOverridesToNodes(nodes, { t1: { useCaseContinue: { mode: "render-final", jobId: "job-1" } } }, "all")
    expect(requestOf(nodes.find((n) => n.id === "t1")!, media, ctx, null).body).toMatchObject({ jobId: "job-1", mode: "render-final" })
  })

  it("a sub-workflow's graph drops it on load (a nested graph gets no overrides)", async () => {
    const { dropSavedRunOnlyFields } = await import("../run-only-fields.js")
    const nodes = stale({ mode: "from-failed", jobId: "job-old" })
    dropSavedRunOnlyFields(nodes)
    expect(nodes.find((n) => n.id === "t1")!.data).not.toHaveProperty("useCaseContinue")
    const src = (await import("node:fs")).readFileSync(new URL("../sub-workflow-handler.ts", import.meta.url), "utf8")
    expect(src).toMatch(/prepareSubWorkflowNodes\([^\n]*\)\n(?:\s*\/\/[^\n]*\n)*\s*dropSavedRunOnlyFields\(subNodes\)/)
  })
})

