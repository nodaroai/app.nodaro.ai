/**
 * A Render final of a use-case node (Tighten Episode, decided 2026-10-13):
 * what it runs, and the one override it sends — the same set and the same
 * shape for the editor and for the app runner.
 */
import { describe, it, expect } from "vitest"
import { runsUseCaseRenderFinal, usecaseFinalRunSet, usecasePreviewTarget, usecaseRenderFinalOverrides } from "@nodaro/render-rules"

const nodes = [
  { id: "rec", type: "upload-video" },
  { id: "t1", type: "tighten-episode" },
  { id: "fmt", type: "social-media-format" },
  { id: "post", type: "webhook-output" },
  { id: "other", type: "text-prompt" },
]
const edges = [
  { source: "rec", target: "t1" },
  { source: "t1", target: "fmt" },
  { source: "fmt", target: "post" },
]

describe("usecaseFinalRunSet — a use-case node's Render final", () => {
  it("is the node and everything after it, never what feeds it or an unrelated node", () => {
    expect([...usecaseFinalRunSet("t1", nodes, edges)].sort()).toEqual(["fmt", "post", "t1"])
  })

  it("is the node alone when nothing follows it", () => {
    expect([...usecaseFinalRunSet("t1", nodes, edges.slice(0, 1))]).toEqual(["t1"])
  })

  it("is empty for a node not on the graph", () => {
    expect(usecaseFinalRunSet("gone", nodes, edges).size).toBe(0)
  })
})

describe("usecaseRenderFinalOverrides — the continuation, for this run only", () => {
  it("names the Preview's own run and the settings it was built from", () => {
    const settings = { output: "video", captions: true }
    const overrides = usecaseRenderFinalOverrides("t1", { jobId: "job-w", settings })
    expect(overrides).toEqual({ t1: { useCaseContinue: { mode: "render-final", jobId: "job-w", settings } } })
    expect(runsUseCaseRenderFinal(overrides.t1)).toBe(true)
  })

  it("carries no settings key when the take kept none", () => {
    expect(usecaseRenderFinalOverrides("t1", { jobId: "job-w" })).toEqual({ t1: { useCaseContinue: { mode: "render-final", jobId: "job-w" } } })
  })

  it("lays the continuation over the run's other fields for the node (the reviewer's edit)", () => {
    const edit = { v: 1 }
    expect(usecaseRenderFinalOverrides("t1", { jobId: "job-w" }, { editedEdl: edit })).toEqual({
      t1: { editedEdl: edit, useCaseContinue: { mode: "render-final", jobId: "job-w" } },
    })
  })
})

describe("usecasePreviewTarget — what a use-case node's Render final continues", () => {
  const settings = { output: "video", captions: true }
  const take = { status: "completed", jobId: "job-w", output: { videoUrl: "https://r2/p.mp4", quality: "proxy", useCaseSettings: settings } }

  it("a Preview take: its own wrapper and the settings its run was built from", () => {
    expect(usecasePreviewTarget(take)).toEqual({ jobId: "job-w", settings })
    const { useCaseSettings: _s, ...bare } = take.output
    expect(usecasePreviewTarget({ ...take, output: bare })).toEqual({ jobId: "job-w" })
  })

  it("none for a Final take, a take with no run named, a run under way, or nothing", () => {
    expect(usecasePreviewTarget({ ...take, output: { ...take.output, quality: "final" } })).toBeNull()
    expect(usecasePreviewTarget({ ...take, jobId: undefined })).toBeNull()
    expect(usecasePreviewTarget({ ...take, status: "running" })).toBeNull()
    expect(usecasePreviewTarget(undefined)).toBeNull()
  })

  it("none for a node run once per list item, whatever its rows say", () => {
    const rows = { listResults: ["https://r2/a.mp4"], listResultStamps: [{ quality: "proxy" }], quality: "proxy" }
    expect(usecasePreviewTarget({ ...take, output: rows })).toBeNull()
  })
})
