// @test-watches backend/src/services/workflow-engine/sub-workflow-handler.ts
/**
 * The editor's Render final on a Tighten Episode node (decided 2026-10-13)
 * sends the continuation as an input override of that run only:
 * `{ [node]: { useCaseContinue: { mode: "render-final", jobId } } }`. Merged by
 * the worker's one override merge over the saved graph, it makes the node's
 * executor call the continue route with render-final and the node's saved
 * edit — never a fresh run, never the saved data changed.
 */
import { USE_CASE_RUN_VIEWER_AS_BEFORE } from "@nodaro/render-rules"
import { describe, it, expect } from "vitest"
import { applyInputOverridesToNodes } from "../../../workers/apply-input-overrides.js"
import { usecaseContinuePath } from "@nodaro/render-rules"
import { continuingGeneration, requestOf } from "../use-case-request.js"
import { routeUseCaseInput } from "../use-case-inputs.js"
import type { OrchestratorContext, ResolvedInputs, SimpleEdge, SimpleNode } from "../types.js"

const CONTINUE_PATH = usecaseContinuePath("tighten-episode")

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
    const request = requestOf(t1, {}, ctx, null, USE_CASE_RUN_VIEWER_AS_BEFORE)
    expect(request.path).toBe(CONTINUE_PATH)
    expect(request.body).toMatchObject({ jobId: "job-1", mode: "render-final", editedEdl: EDIT, reviewerPresent: true, nodeId: "t1" })
    expect(request.fallback).toBeUndefined()
  })

  it("asks for the preview's run only: never the node's later settings (the route renders with the run's stored ones)", () => {
    const nodes = saved().map((n) => (n.id === "t1" ? { ...n, data: { ...n.data, captions: false, framing: null } } : n))
    applyInputOverridesToNodes(nodes, { t1: { useCaseContinue: { mode: "render-final", jobId: "job-1", settings: { captions: true } } } }, "all")
    const body = requestOf(nodes.find((n) => n.id === "t1")!, {}, ctx, null, USE_CASE_RUN_VIEWER_AS_BEFORE).body
    expect(body).toMatchObject({ jobId: "job-1", mode: "render-final" })
    for (const key of ["captions", "framing", "settings", "output"]) expect(body).not.toHaveProperty(key)
  })

  it("without the override the same saved node is a fresh run", () => {
    const nodes = saved()
    const t1 = nodes.find((n) => n.id === "t1")!
    const request = requestOf(t1, { useCaseMedia: [{ nodeId: "rec", url: "https://r2/ep.mp4" }] } as never, ctx, null, USE_CASE_RUN_VIEWER_AS_BEFORE)
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
        const request = requestOf(t1, media, ctx, null, USE_CASE_RUN_VIEWER_AS_BEFORE)
        expect(request.path).toBe("/v1/tighten-episode")
        expect(request.body).not.toHaveProperty("jobId")
      }
    })
  }

  it("this run's own override still wins over a stale saved one", () => {
    const nodes = stale({ mode: "from-failed", jobId: "job-old" })
    applyInputOverridesToNodes(nodes, { t1: { useCaseContinue: { mode: "render-final", jobId: "job-1" } } }, "all")
    expect(requestOf(nodes.find((n) => n.id === "t1")!, media, ctx, null, USE_CASE_RUN_VIEWER_AS_BEFORE).body).toMatchObject({ jobId: "job-1", mode: "render-final" })
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


describe("the request reads the node's own descriptor", () => {
  const media = { useCaseMedia: [{ nodeId: "rec", url: "https://r2/ep.mp4" }] }

  it("Tighten Episode's routes are the ones P1 called", () => {
    expect(CONTINUE_PATH).toBe("/v1/tighten-episode/continue")
    const t1 = saved().find((n) => n.id === "t1")!
    expect(requestOf(t1, media as never, ctx, null, USE_CASE_RUN_VIEWER_AS_BEFORE).path).toBe("/v1/tighten-episode")
    expect(requestOf(t1, media as never, ctx, "job-failed", USE_CASE_RUN_VIEWER_AS_BEFORE).path).toBe(CONTINUE_PATH)
  })

  it("a fresh run sends the type's setting keys and nothing else of the node's data", () => {
    const t1: SimpleNode = {
      id: "t1", type: "tighten-episode",
      data: { output: "video", captions: false, framing: null, planTier: "premium", musicDuckAmount: 40, label: "Mine", useCaseJobId: "job-0", generatedVideoUrl: "x" },
    }
    const body = requestOf(t1, media as never, ctx, null, USE_CASE_RUN_VIEWER_AS_BEFORE).body
    expect(body).toMatchObject({ mediaUrls: ["https://r2/ep.mp4"], output: "video", captions: false, framing: null, planTier: "premium", musicDuckAmount: 40 })
    for (const key of ["label", "useCaseJobId", "generatedVideoUrl"]) expect(body).not.toHaveProperty(key)
  })

  it("a wired music bed rides along; an intro card is sent only to a type with that input (Tighten has none)", () => {
    const t1 = saved().find((n) => n.id === "t1")!
    const body = requestOf(t1, { ...media, useCaseMusic: "https://r2/bed.mp3", useCaseIntroCard: "https://r2/card.mp4" } as never, ctx, null, USE_CASE_RUN_VIEWER_AS_BEFORE).body
    expect(body).toMatchObject({ musicUrl: "https://r2/bed.mp3" })
    expect(body).not.toHaveProperty("introCardUrl")
  })

  it("no recording wired: the node's own label in the refusal", () => {
    const t1 = saved().find((n) => n.id === "t1")!
    expect(() => requestOf(t1, {} as never, ctx, null, USE_CASE_RUN_VIEWER_AS_BEFORE)).toThrow("Tighten Episode needs a recording wired into Media")
  })

  it("a newer generation is continued on the same continue route", () => {
    const t1 = saved().find((n) => n.id === "t1")!
    const next = continuingGeneration(requestOf(t1, media as never, ctx, "job-failed", USE_CASE_RUN_VIEWER_AS_BEFORE), "job-newer")
    expect(next.path).toBe(CONTINUE_PATH)
    expect(next.body).toMatchObject({ jobId: "job-newer", mode: "from-failed" })
  })

  it("a wire into introCard is the node's intro card", () => {
    const inputs: ResolvedInputs = {} as ResolvedInputs
    const edge = { id: "e", source: "card", target: "t1", targetHandle: "introCard" } as SimpleEdge
    expect(routeUseCaseInput(inputs, edge, "card", "https://r2/card.mp4")).toBe(true)
    expect(inputs.useCaseIntroCard).toBe("https://r2/card.mp4")
  })
})
