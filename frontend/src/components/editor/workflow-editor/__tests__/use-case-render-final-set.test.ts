import { describe, it, expect } from "vitest"
import { editPlanBasis } from "@nodaro/shared/edl"
import { estimateRunCredits } from "../estimate-run-credits"
import { usecaseRenderFinalOffered, usecaseRenderFinalRun, usecaseRenderFinalTarget } from "../use-case-render-final-set"

/**
 * A Tighten Episode's Render final (decided 2026-10-13) continues the run that
 * made the take ON SHOW, only while that take is a Preview and the node is
 * neither running nor failed, with that run's own settings.
 */
const at = { x: 0, y: 0 }
const rec = { id: "rec", type: "upload-video", position: at, data: { url: "https://r2/ep.mp4" } }
const wire = { id: "w", source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" }
const SETTINGS = { captions: true, reviewBeforeRender: true, framing: { aspect: "9:16", layout: "stacked" } }
const preview = (jobId: string, extra: Record<string, unknown> = {}) => ({ url: `https://r2/${jobId}.mp4`, quality: "proxy", jobId, ...extra })
const final = (jobId: string) => ({ url: `https://r2/${jobId}.mp4`, quality: "final", jobId })
const t1 = (data: Record<string, unknown>) => ({ id: "t1", type: "tighten-episode", position: at, data: { label: "T", ...data } })
const targetOf = (data: Record<string, unknown>) => usecaseRenderFinalTarget(t1(data) as never)

describe("usecaseRenderFinalTarget", () => {
  it("a Preview on show: its own run's wrapper and settings", () => {
    expect(targetOf({ useCaseJobId: "00000000-0000-4000-8000-000000000002", generatedResults: [preview("00000000-0000-4000-8000-000000000001", { useCaseSettings: SETTINGS })] })).toEqual({ jobId: "00000000-0000-4000-8000-000000000001", settings: SETTINGS })
  })

  it("(a) a review-off run's Final on show: none", () => {
    expect(targetOf({ useCaseJobId: "00000000-0000-4000-8000-000000000001", generatedResults: [final("00000000-0000-4000-8000-000000000001")] })).toBeUndefined()
  })

  it("(b) after a Render final completed its Final is on show: none — the Preview picked again is its own run's", () => {
    const takes = [final("00000000-0000-4000-8000-00000000000f"), preview("00000000-0000-4000-8000-000000000001")]
    expect(targetOf({ useCaseJobId: "00000000-0000-4000-8000-00000000000f", generatedResults: takes, activeResultIndex: 0 })).toBeUndefined()
    expect(targetOf({ useCaseJobId: "00000000-0000-4000-8000-00000000000f", generatedResults: takes, activeResultIndex: 1 })).toEqual({ jobId: "00000000-0000-4000-8000-000000000001" })
  })

  it("(c) a failed run (a failed final, or a later fresh run) under an earlier Preview: none — Continue's", () => {
    expect(targetOf({ executionStatus: "failed", useCaseJobId: "job-x", generatedResults: [preview("00000000-0000-4000-8000-000000000001")] })).toBeUndefined()
    for (const status of ["running", "pending"]) expect(targetOf({ executionStatus: status, generatedResults: [preview("00000000-0000-4000-8000-000000000001")] })).toBeUndefined()
  })

  it("(d) an older Preview picked in the gallery finishes ITS run, never the newest", () => {
    expect(targetOf({ useCaseJobId: "00000000-0000-4000-8000-000000000002", generatedResults: [preview("00000000-0000-4000-8000-000000000002"), preview("00000000-0000-4000-8000-000000000001")], activeResultIndex: 1 })).toEqual({ jobId: "00000000-0000-4000-8000-000000000001" })
  })

  it("a take naming a synthetic `exec-…` id (no real wrapper): none", () => {
    expect(targetOf({ generatedResults: [{ url: "https://r2/p.mp4", quality: "proxy", jobId: "exec-t1" }] })).toBeUndefined()
  })

  it("while a run of the node is queued it is offered (the bar shows it busy), but nothing can start yet", () => {
    const data = { executionStatus: "pending", generatedResults: [preview("00000000-0000-4000-8000-000000000001")] }
    expect(usecaseRenderFinalOffered(t1(data) as never)).toBe(true)
    expect(targetOf(data)).toBeUndefined()
    expect(usecaseRenderFinalOffered(t1({ ...data, executionStatus: "failed" }) as never)).toBe(false)
  })

  it("a take that names no run: none", () => {
    expect(targetOf({ useCaseJobId: "00000000-0000-4000-8000-000000000001", generatedResults: [{ url: "https://r2/p.mp4", quality: "proxy" }] })).toBeUndefined()
  })
})

describe("usecaseRenderFinalRun", () => {
  it("the continuation carries the take's run and settings, over the node and what follows", () => {
    const fmt = { id: "fmt", type: "social-media-format", position: at, data: {} }
    const run = usecaseRenderFinalRun("t1", [rec, t1({ captions: false, generatedResults: [preview("00000000-0000-4000-8000-000000000001", { useCaseSettings: SETTINGS })] }), fmt] as never, [wire, { id: "o", source: "t1", target: "fmt", sourceHandle: "media" }] as never)!
    expect(run.overrides).toEqual({ t1: { useCaseContinue: { mode: "render-final", jobId: "00000000-0000-4000-8000-000000000001", settings: SETTINGS } } })
    expect([...run.runSet].sort()).toEqual(["fmt", "t1"])
  })
})

describe("the editor's Render final of a Trailer is quoted on the edited cut (decided 2026-10-18)", () => {
  const edlOf = (sec: number) => ({ version: 1, clock: "master", sources: [{ id: "rec", url: "https://r2/ep.mp4", kind: "video" }], segments: [{ id: "s0", inMs: 0, outMs: sec * 1000, video: "rec" }] })
  const PLAN = edlOf(35)
  const tr = (data: Record<string, unknown>) => ({
    id: "t1",
    type: "episode-trailer",
    position: at,
    data: { label: "Trailer", reviewBeforeRender: true, generatedJson: PLAN, generatedResults: [preview("00000000-0000-4000-8000-000000000001")], ...data },
  })
  // A per-unit row's whole-run price (`<rate>:<units>u`) at 3 a unit, so a render's minutes show.
  const quote = (data: Record<string, unknown>) => {
    const run = usecaseRenderFinalRun("t1", [rec, tr(data)] as never, [wire] as never)!
    return estimateRunCredits(run.executable, run.graph, [wire] as never, (id) => 3 * Number(/:(\d+)u$/.exec(id)?.[1] ?? 1))
  }
  it("an edit that lengthens the trailer to 150 s is quoted above the unedited 40 seconds", () => {
    const lengthened = { v: 1, kind: "edl", basis: editPlanBasis(PLAN), edl: { segments: edlOf(150).segments, dropped: [] } }
    expect(quote({ editedEdl: lengthened })).toBeGreaterThan(quote({}))
  })
})
