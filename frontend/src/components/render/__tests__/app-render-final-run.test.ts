/**
 * An app run's Render final of a use-case node (Tighten Episode, decided
 * 2026-10-13) quotes what the editor's quotes for the same take: the node's
 * final chain from its render on, with no fee, on the Preview's settings and
 * the run's own plan — read off the run's state, never the creator's snapshot.
 */
import { describe, it, expect } from "vitest"
import { TIGHTEN_EPISODE_DEFAULTS, runsUseCaseRenderFinal } from "@nodaro/render-rules"
import { editPlanBasis } from "@nodaro/shared/edl"
import { appRenderFinalRun, appUseCaseFinalTarget } from "../app-render-final-run"
import { runEstimateGraph } from "../app-render-review"
import { estimateRunCredits, runModelIds } from "@/components/editor/workflow-editor/estimate-run-credits"
import { usecaseRenderFinalRun } from "@/components/editor/workflow-editor/use-case-render-final-set"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const at = { x: 0, y: 0 }
const rec = { id: "rec", type: "upload-video", position: at, data: { label: "Rec", url: "https://r2/ep.mp4", assetId: "", metadata: { durationSeconds: 3600 }, fieldMappings: {} } }
const fmt = { id: "fmt", type: "add-captions", position: at, data: { label: "Captions", fieldMappings: {} } }
const edges = [
  { id: "w", source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" },
  { id: "o", source: "t1", target: "fmt", sourceHandle: "media", targetHandle: "video" },
] as unknown as WorkflowEdge[]
// Captions on when the Preview ran; the creator's snapshot has them off.
const SETTINGS = { ...TIGHTEN_EPISODE_DEFAULTS, captions: true, reviewBeforeRender: true }
const PLAN = { segments: [{ start: 0, end: 600 }], dropped: [] }
const snapshotT1 = { id: "t1", type: "tighten-episode", position: at, data: { label: "Tighten Episode", fieldMappings: {}, captions: false, reviewBeforeRender: true } }
const previewState = { status: "completed", jobId: "00000000-0000-4000-8000-0000000000aa", output: { videoUrl: "https://r2/p.mp4", quality: "proxy", useCaseSettings: SETTINGS, json: PLAN } }
const price: Record<string, number> = { "use-case-fee:tighten-episode": 10 }
const cached = (id: string) => price[id] ?? 3

const appGraph = (t1State: unknown) => {
  const states = { rec: { status: "completed", output: { videoUrl: "https://r2/ep.mp4" } }, t1: t1State }
  const graph = runEstimateGraph([rec, snapshotT1, fmt] as unknown as WorkflowNode[], states as never)
  return { graph, states }
}

describe("an app's Render final of a use-case node", () => {
  it("continues the take on show's own run, with its settings, over the node and what follows", () => {
    const { graph, states } = appGraph(previewState)
    const run = appRenderFinalRun("t1", graph, edges, states)
    expect(run.executable.map((n) => n.id).sort()).toEqual(["fmt", "t1"])
    const t1 = run.nodes.find((n) => n.id === "t1")!.data as Record<string, unknown>
    expect(t1.useCaseContinue).toEqual({ mode: "render-final", jobId: "00000000-0000-4000-8000-0000000000aa", settings: SETTINGS })
    expect(runsUseCaseRenderFinal(t1)).toBe(true)
    // Never the quality lever: the node is not a render.
    expect(t1.quality).toBeUndefined()
  })

  it("quotes exactly what the editor quotes for the same Preview take — no fee", () => {
    const { graph, states } = appGraph(previewState)
    const app = appRenderFinalRun("t1", graph, edges, states)
    const canvasT1 = {
      ...snapshotT1,
      data: { ...snapshotT1.data, generatedJson: PLAN, generatedResults: [{ url: "https://r2/p.mp4", quality: "proxy", jobId: "00000000-0000-4000-8000-0000000000aa", useCaseSettings: SETTINGS }] },
    }
    const canvas = usecaseRenderFinalRun("t1", [rec, canvasT1, fmt] as unknown as WorkflowNode[], edges)!
    const appCredits = estimateRunCredits(app.executable, app.nodes, edges, cached)
    expect(appCredits).toBeGreaterThan(0)
    expect(appCredits).toBe(estimateRunCredits(canvas.executable, canvas.graph, edges, cached))
    expect(runModelIds(app.executable, app.nodes, edges)).not.toContain("use-case-fee:tighten-episode")
    // The Preview's settings decide (captions on), not the snapshot's (off).
    const { useCaseSettings: _s, ...bare } = previewState.output
    const noSettings = appGraph({ ...previewState, output: bare })
    const snapshotRun = appRenderFinalRun("t1", noSettings.graph, edges, noSettings.states)
    expect(estimateRunCredits(snapshotRun.executable, snapshotRun.nodes, edges, cached)).toBeLessThan(appCredits)
  })

  it("carries the run's review of the node's plan beside the continuation", () => {
    const edit = { v: 1, kind: "edl", basis: "b", edl: { segments: [], dropped: [] } }
    const { graph, states } = appGraph({ ...previewState, editedEdl: edit })
    const t1 = appRenderFinalRun("t1", graph, edges, states).nodes.find((n) => n.id === "t1")!.data as Record<string, unknown>
    expect(t1.editedEdl).toEqual(edit)
  })

  it("quotes a Trailer's final on the run's plan as the review leaves it: a longer edited cut is quoted longer (decided 2026-10-18)", () => {
    const edlOf = (sec: number) => ({ version: 1, clock: "master", sources: [{ id: "rec", url: "https://r2/ep.mp4", kind: "video" }], segments: [{ id: "s0", inMs: 0, outMs: sec * 1000, video: "rec" }] })
    const plan = edlOf(35)
    const tr = { id: "t1", type: "episode-trailer", position: at, data: { label: "Trailer", reviewBeforeRender: true } }
    const trEdges = [{ id: "i", source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" }] as unknown as WorkflowEdge[]
    const state = (editedEdl?: unknown) => ({
      status: "completed",
      jobId: "00000000-0000-4000-8000-0000000000aa",
      output: { videoUrl: "https://r2/p.mp4", quality: "proxy", json: plan },
      ...(editedEdl ? { editedEdl } : {}),
    })
    const quote = (editedEdl?: unknown) => {
      const states = { rec: { status: "completed", output: { videoUrl: "https://r2/ep.mp4" } }, t1: state(editedEdl) }
      const g = runEstimateGraph([rec, tr] as unknown as WorkflowNode[], states as never)
      const run = appRenderFinalRun("t1", g, trEdges, states)
      // A per-unit row's whole-run price (`<rate>:<units>u`) at 3 a unit, so a render's minutes show.
      return estimateRunCredits(run.executable, run.nodes, trEdges, (id) => 3 * Number(/:(\d+)u$/.exec(id)?.[1] ?? 1))
    }
    const lengthened = { v: 1, kind: "edl", basis: editPlanBasis(plan), edl: { segments: edlOf(150).segments, dropped: [] } }
    expect(quote(lengthened)).toBeGreaterThan(quote())
  })

  it("offers none for a Final take, a take with no run named, or a node fed by a list", () => {
    const final = appGraph({ ...previewState, output: { ...previewState.output, quality: "final" } })
    expect(appRenderFinalRun("t1", final.graph, edges, final.states).executable).toEqual([])
    const unnamed = appGraph({ ...previewState, jobId: undefined })
    expect(appUseCaseFinalTarget("t1", unnamed.graph, edges, unnamed.states)).toBeNull()
    const list = {
      id: "ls",
      type: "list",
      position: at,
      data: { label: "Episodes", columns: [{ id: "default", name: "Items", handleId: "col_default", type: "video-url" }], rows: [["https://r2/a.mp4"], ["https://r2/b.mp4"]] },
    }
    const listEdges = [
      { id: "le", source: "ls", target: "t1", sourceHandle: "col_default", targetHandle: "media", data: { outputMode: "each" } },
      edges[1],
    ] as unknown as WorkflowEdge[]
    const states = { t1: previewState }
    const graph = runEstimateGraph([list, snapshotT1, fmt] as unknown as WorkflowNode[], states as never)
    expect(appUseCaseFinalTarget("t1", graph, listEdges, states)).toBeNull()
    expect(appRenderFinalRun("t1", graph, listEdges, states).executable).toEqual([])
  })

  it("a review-on Trailer's Preview (its list empty until the final) is offered Render final: a continuation of its own run", () => {
    const trSettings = { formats: ["9:16", "1:1"], reviewBeforeRender: true }
    const snapshotTr = { id: "t1", type: "episode-trailer", position: at, data: { label: "Trailer", fieldMappings: {}, reviewBeforeRender: true } }
    const trState = { status: "completed", jobId: "00000000-0000-4000-8000-0000000000bb", output: { videoUrl: "https://r2/p.mp4", quality: "proxy", listResults: [], useCaseSettings: trSettings, json: PLAN } }
    const states = { rec: { status: "completed", output: { videoUrl: "https://r2/ep.mp4" } }, t1: trState }
    const graph = runEstimateGraph([rec, snapshotTr, fmt] as unknown as WorkflowNode[], states as never)
    expect(appUseCaseFinalTarget("t1", graph, edges, states)).not.toBeNull()
    const run = appRenderFinalRun("t1", graph, edges, states)
    expect(run.executable.map((n) => n.id).sort()).toEqual(["fmt", "t1"])
    const t1 = run.nodes.find((n) => n.id === "t1")!.data as Record<string, unknown>
    expect(t1.useCaseContinue).toEqual({ mode: "render-final", jobId: "00000000-0000-4000-8000-0000000000bb", settings: trSettings })
  })

  it("a review-on Clip Pack's Preview batch (its own list of clips) is offered Render final: every clip at final, no edit, no fee", () => {
    const cpSettings = { count: 3, captions: true, reviewBeforeRender: true }
    const clip = (i: number) => ({
      version: 1, clock: "master", sources: [{ id: "rec", url: "https://r2/ep.mp4", kind: "video" }],
      segments: [{ id: `c${i}`, inMs: i * 100_000, outMs: i * 100_000 + 60_000, video: "rec" }], dropped: [], meta: { title: `Clip ${i}` },
    })
    const plan = [clip(0), clip(1), clip(2)]
    const urls = plan.map((_, i) => `https://r2/c${i}.mp4`)
    const WRAPPER = "00000000-0000-4000-8000-0000000000cc"
    const snapshotCp = { id: "t1", type: "clip-pack", position: at, data: { label: "Clip Pack", fieldMappings: {}, reviewBeforeRender: true } }
    const cpState = {
      status: "completed", jobId: WRAPPER,
      output: { videoUrl: urls[0], quality: "proxy", listResults: urls, listResultStamps: urls.map(() => ({ quality: "proxy" })), useCaseSettings: cpSettings, json: plan },
    }
    const cpEdges = [edges[0]!] as unknown as WorkflowEdge[]
    const states = { rec: { status: "completed", output: { videoUrl: "https://r2/ep.mp4" } }, t1: cpState }
    const graph = runEstimateGraph([rec, snapshotCp] as unknown as WorkflowNode[], states as never)
    expect(appUseCaseFinalTarget("t1", graph, cpEdges, states)).toEqual({ jobId: WRAPPER, settings: cpSettings })
    const run = appRenderFinalRun("t1", graph, cpEdges, states)
    expect(run.executable.map((n) => n.id)).toEqual(["t1"])
    const t1 = run.nodes.find((n) => n.id === "t1")!.data as Record<string, unknown>
    expect(t1.useCaseContinue).toEqual({ mode: "render-final", jobId: WRAPPER, settings: cpSettings })
    // No review in the app: no edit is sent, so every clip renders.
    expect(t1.editedEdl).toBeUndefined()
    // Quoted as the editor quotes the same take: the three clips at final, no fee.
    const canvasCp = { ...snapshotCp, data: { ...snapshotCp.data, generatedJson: plan, generatedResults: urls.map((url) => ({ url, quality: "proxy", jobId: WRAPPER, useCaseSettings: cpSettings })) } }
    const canvas = usecaseRenderFinalRun("t1", [rec, canvasCp] as unknown as WorkflowNode[], cpEdges)!
    const appCredits = estimateRunCredits(run.executable, run.nodes, cpEdges, cached)
    // 3 one-minute clips × (Speaker View at 3 a minute + captions at 3).
    expect(appCredits).toBe(3 * (3 + 3))
    expect(appCredits).toBe(estimateRunCredits(canvas.executable, canvas.graph, cpEdges, cached))
    expect(runModelIds(run.executable, run.nodes, cpEdges)).not.toContain("use-case-fee:clip-pack")
  })

  it("a render's Render final is unchanged: its set, the render at Final", () => {
    const nodes = [
      { id: "plan", type: "edit-plan", position: at, data: {} },
      { id: "cut", type: "apply-edl", position: at, data: { quality: "proxy" } },
    ] as unknown as WorkflowNode[]
    const run = appRenderFinalRun("cut", nodes, [{ id: "e", source: "plan", target: "cut", targetHandle: "edl" }] as unknown as WorkflowEdge[], {})
    expect(run.executable.map((n) => n.id)).toEqual(["cut"])
    expect((run.nodes.find((n) => n.id === "cut")!.data as Record<string, unknown>).quality).toBe("final")
  })
})
