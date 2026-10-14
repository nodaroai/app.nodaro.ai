/**
 * What follows a review-on use-case node (Tighten Episode) waits for its
 * Render final, exactly as after a render at Preview: the editor's run and
 * estimate (`previewRunnable`) and an app run on show (`runPreviewGate`) read
 * the same shared rule the server does.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { previewRunnable, runPreviewGate } from "../preview-gate"
import { usecaseRenderFinalRun } from "../use-case-render-final-set"

const previewRuleOn = () => { window.__NODARO_RUNTIME__ = { previewStopRule: true } }
const previewRuleOff = () => { delete window.__NODARO_RUNTIME__ }
beforeEach(previewRuleOn)
afterEach(previewRuleOff)

const at = { x: 0, y: 0 }
const JOB = "00000000-0000-4000-8000-000000000001"
const rec = { id: "rec", type: "upload-video", position: at, data: { url: "https://r2/ep.mp4" } }
const t1 = (data: Record<string, unknown>) => ({ id: "t1", type: "tighten-episode", position: at, data: { label: "T", ...data } })
const fmt = { id: "fmt", type: "social-media-format", position: at, data: {} }
const edges = [
  { id: "e1", source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" },
  { id: "e2", source: "t1", target: "fmt", sourceHandle: "media", targetHandle: "in" },
]
const ids = (nodes: Array<{ id: string }>) => nodes.map((n) => n.id).sort()

describe("the run view holds what follows a Tighten Episode Preview take", () => {
  const nodes = [t1({ reviewBeforeRender: true }), fmt]

  it("a proxy take of a use-case node gates its descendants that hold no result", () => {
    const gate = runPreviewGate(nodes as never, edges as never, {
      t1: { status: "completed", output: { videoUrl: "https://r2/p.mp4", quality: "proxy" } },
    } as never)
    expect(gate.previewRenderIds.has("t1")).toBe(true)
    expect(gate.gatedNodeIds.has("fmt")).toBe(true)
  })

  it("a Final take gates nothing", () => {
    const gate = runPreviewGate(nodes as never, edges as never, {
      t1: { status: "completed", output: { videoUrl: "https://r2/f.mp4", quality: "final" } },
    } as never)
    expect(gate.previewRenderIds.size).toBe(0)
    expect(gate.gatedNodeIds.size).toBe(0)
  })

  it("a descendant that holds a result of its own in the run is not shown as waiting", () => {
    const gate = runPreviewGate(nodes as never, edges as never, {
      t1: { status: "completed", output: { videoUrl: "https://r2/p.mp4", quality: "proxy" } },
      fmt: { status: "completed", output: { videoUrl: "https://r2/x.mp4" } },
    } as never)
    expect(gate.gatedNodeIds.has("fmt")).toBe(false)
  })
})

describe("the editor's run of a review-on Tighten Episode", () => {
  it("runs the node, never what follows it", () => {
    const nodes = [rec, t1({ reviewBeforeRender: true }), fmt]
    expect(ids(previewRunnable(nodes as never, nodes as never, edges as never))).toEqual(["rec", "t1"])
  })

  it("review off: runs what follows", () => {
    const nodes = [rec, t1({ reviewBeforeRender: false }), fmt]
    expect(ids(previewRunnable(nodes as never, nodes as never, edges as never))).toEqual(["fmt", "rec", "t1"])
  })

  it("with the flag off nothing is held", () => {
    previewRuleOff()
    const nodes = [rec, t1({ reviewBeforeRender: true }), fmt]
    expect(ids(previewRunnable(nodes as never, nodes as never, edges as never))).toEqual(["fmt", "rec", "t1"])
  })

  it("its Render final (the canvas's own run set and override) runs the node AND what follows", () => {
    const nodes = [
      rec,
      t1({ reviewBeforeRender: true, executionStatus: "completed", useCaseJobId: JOB, generatedResults: [{ url: "https://r2/p.mp4", quality: "proxy", jobId: JOB }] }),
      fmt,
    ]
    const run = usecaseRenderFinalRun("t1", nodes as never, edges as never)
    expect(run).not.toBeNull()
    expect(run!.overrides).toEqual({ t1: { useCaseContinue: { mode: "render-final", jobId: JOB } } })
    expect(ids(previewRunnable(run!.executable, run!.graph, edges as never))).toEqual(["fmt", "t1"])
  })
})
