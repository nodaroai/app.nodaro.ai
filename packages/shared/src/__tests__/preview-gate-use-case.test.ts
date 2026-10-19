import { describe, it, expect } from "vitest"
// Through the package index: both engines and the editor read the hold from here.
import {
  PREVIEW_RENDER_NODE_TYPES,
  REVIEW_HOLDING_USE_CASE_TYPES,
  isPreviewHoldingType,
  previewStops,
  rendersAsPreview,
  withRunOverrides,
  PREVIEW_REVIEW_REQUIRED,
  PREVIEW_REVIEW_REQUIRED_REVIEW_ON,
  PREVIEW_REVIEW_REQUIRED_MIXED,
  PREVIEW_RENDER_NESTED,
  PREVIEW_RENDER_NESTED_REVIEW_ON,
  PREVIEW_RENDER_NESTED_MIXED,
  isPreviewRefusalCode,
} from "../index.js"

const rec = { id: "rec", type: "upload-video", data: {} }
const t1 = (data: Record<string, unknown>) => ({ id: "t1", type: "tighten-episode", data })
const fmt = { id: "fmt", type: "social-media-format", data: {} }
const post = { id: "post", type: "webhook-output", data: {} }
const edges = [
  { source: "rec", target: "t1" },
  { source: "t1", target: "fmt", sourceHandle: "media" },
  { source: "fmt", target: "post" },
]

describe("a review-on use-case node holds what follows it until its Render final", () => {
  it("is a preview-holding type without joining the render set", () => {
    expect(REVIEW_HOLDING_USE_CASE_TYPES.has("tighten-episode")).toBe(true)
    expect(isPreviewHoldingType("tighten-episode")).toBe(true)
    expect(isPreviewHoldingType("episode-trailer")).toBe(true)
    expect(isPreviewHoldingType("clip-pack")).toBe(true)
    expect(PREVIEW_RENDER_NODE_TYPES.has("clip-pack")).toBe(false)
    expect(isPreviewHoldingType("apply-edl")).toBe(true)
    expect(isPreviewHoldingType("speaker-view")).toBe(true)
    expect(isPreviewHoldingType("social-media-format")).toBe(false)
    expect(isPreviewHoldingType(undefined)).toBe(false)
    expect(isPreviewHoldingType(null)).toBe(false)
    expect(PREVIEW_RENDER_NODE_TYPES.has("tighten-episode")).toBe(false)
  })

  it("review on: holds its descendants when it executes", () => {
    const stops = previewStops([rec, t1({ reviewBeforeRender: true }), fmt, post], edges)
    expect(stops.previewRenderIds).toEqual(["t1"])
    expect([...stops.gatedNodeIds].sort()).toEqual(["fmt", "post"])
  })

  it("review off: holds nothing", () => {
    expect(previewStops([rec, t1({}), fmt, post], edges).gatedNodeIds.size).toBe(0)
    expect(previewStops([rec, t1({ reviewBeforeRender: false }), fmt, post], edges).gatedNodeIds.size).toBe(0)
  })

  it("a quality field on the node does not decide it: review does", () => {
    expect(rendersAsPreview(t1({ quality: "proxy" }))).toBe(false)
    expect(rendersAsPreview(t1({ reviewBeforeRender: true, quality: "final" }))).toBe(true)
  })

  it("its Render final (a render-final continuation naming its run) releases them", () => {
    const node = t1({ reviewBeforeRender: true, useCaseContinue: { mode: "render-final", jobId: "job-1" } })
    expect(rendersAsPreview(node)).toBe(false)
    expect(previewStops([rec, node, fmt, post], edges).gatedNodeIds.size).toBe(0)
  })

  it("a review-on Trailer holds what follows it; its Render final override releases it", () => {
    const tr = (data: Record<string, unknown>) => ({ id: "t1", type: "episode-trailer", data })
    const held = previewStops([rec, tr({ reviewBeforeRender: true }), fmt, post], edges)
    expect(held.previewRenderIds).toEqual(["t1"])
    expect([...held.gatedNodeIds].sort()).toEqual(["fmt", "post"])
    expect(previewStops([rec, tr({}), fmt, post], edges).gatedNodeIds.size).toBe(0)
    const released = withRunOverrides([rec, tr({ reviewBeforeRender: true }), fmt, post], {
      t1: { useCaseContinue: { mode: "render-final", jobId: "00000000-0000-4000-8000-000000000007" } },
    })
    expect(previewStops(released, edges).gatedNodeIds.size).toBe(0)
  })

  it("the continuation set as a run override releases them too", () => {
    const graph = withRunOverrides([rec, t1({ reviewBeforeRender: true }), fmt, post], {
      t1: { useCaseContinue: { mode: "render-final", jobId: "job-1" } },
    })
    expect(previewStops(graph, edges).gatedNodeIds.size).toBe(0)
  })

  it("a continuation the node would not run as one still holds: no run named, or a continue from a failure", () => {
    // The executor runs a fresh review-on run when the continuation names no
    // run, so what follows would build on its preview.
    expect(rendersAsPreview(t1({ reviewBeforeRender: true, useCaseContinue: { mode: "render-final" } }))).toBe(true)
    expect(rendersAsPreview(t1({ reviewBeforeRender: true, useCaseContinue: { mode: "render-final", jobId: 7 } }))).toBe(true)
    // A continue from a failure finishes the run it continues: a review-on run's preview.
    expect(rendersAsPreview(t1({ reviewBeforeRender: true, useCaseContinue: { mode: "from-failed", jobId: "job-1" } }))).toBe(true)
  })

  it("not executing, a saved Preview take holds them (the run view, a continuation of something else)", () => {
    const stops = previewStops([rec, t1({ reviewBeforeRender: true }), fmt, post], edges, {
      executes: () => false,
      savedRenders: {
        output: (d) => ((d as { reviewBeforeRender?: boolean }).reviewBeforeRender ? { quality: "proxy" } : undefined),
        batch: () => undefined,
      },
    })
    expect(stops.savedPreviewRenderIds).toEqual(["t1"])
    expect([...stops.gatedNodeIds].sort()).toEqual(["fmt", "post"])
  })

  it("not executing, a saved Final take holds nothing", () => {
    const stops = previewStops([rec, t1({ reviewBeforeRender: true }), fmt, post], edges, {
      executes: () => false,
      savedRenders: { output: () => ({ quality: "final" }), batch: () => undefined },
    })
    expect(stops.gatedNodeIds.size).toBe(0)
  })
})

describe("the preview refusal codes", () => {
  it("six codes, one predicate: the render's two (and every older row's) plus a review-on and a mixed one of each", () => {
    const codes = [
      PREVIEW_REVIEW_REQUIRED,
      PREVIEW_REVIEW_REQUIRED_REVIEW_ON,
      PREVIEW_REVIEW_REQUIRED_MIXED,
      PREVIEW_RENDER_NESTED,
      PREVIEW_RENDER_NESTED_REVIEW_ON,
      PREVIEW_RENDER_NESTED_MIXED,
    ]
    expect(new Set(codes).size).toBe(6)
    for (const code of codes) {
      expect(code).toMatch(/^[a-z_]+$/)
      expect(isPreviewRefusalCode(code)).toBe(true)
    }
    expect(PREVIEW_REVIEW_REQUIRED).toBe("preview_review_required")
    expect(PREVIEW_RENDER_NESTED).toBe("preview_render_nested")
    for (const other of ["continuation_not_found", "", undefined, null, 7]) expect(isPreviewRefusalCode(other)).toBe(false)
  })
})

describe("a continuation saved on the graph is never a run's (the engine's rule, in the shared funnel)", () => {
  const saved = (cont: Record<string, unknown>) => [rec, t1({ reviewBeforeRender: true, useCaseContinue: cont }), fmt, post]

  it("a saved render-final naming a run, with no override: dropped — the node is a Preview and holds what follows", () => {
    const graph = withRunOverrides(saved({ mode: "render-final", jobId: "job-old" }), undefined)
    const node = graph.find((n) => n.id === "t1")!
    expect(node.data).not.toHaveProperty("useCaseContinue")
    expect(rendersAsPreview(node)).toBe(true)
    expect([...previewStops(graph, edges).gatedNodeIds].sort()).toEqual(["fmt", "post"])
    // Overrides for other nodes drop it too.
    expect(withRunOverrides(saved({ mode: "render-final", jobId: "job-old" }), { fmt: { x: 1 } }).find((n) => n.id === "t1")!.data).not.toHaveProperty("useCaseContinue")
  })

  it("this run's own override still sets it, over a stale saved one", () => {
    const graph = withRunOverrides(saved({ mode: "from-failed", jobId: "job-old" }), { t1: { useCaseContinue: { mode: "render-final", jobId: "job-1" } } })
    const node = graph.find((n) => n.id === "t1")!
    expect((node.data as Record<string, unknown>).useCaseContinue).toEqual({ mode: "render-final", jobId: "job-1" })
    expect(rendersAsPreview(node)).toBe(false)
  })

  it("is applied once, to the saved graph: a second pass drops the continuation the first set", () => {
    const once = withRunOverrides(saved({}), { t1: { useCaseContinue: { mode: "render-final", jobId: "job-1" } } })
    expect(withRunOverrides(once, undefined).find((n) => n.id === "t1")!.data).not.toHaveProperty("useCaseContinue")
  })

  it("a node with neither an override nor a saved run-only field is returned as is", () => {
    const nodes = [rec, t1({ reviewBeforeRender: true }), fmt]
    const out = withRunOverrides(nodes, undefined)
    out.forEach((n, i) => expect(n).toBe(nodes[i]))
  })
})
