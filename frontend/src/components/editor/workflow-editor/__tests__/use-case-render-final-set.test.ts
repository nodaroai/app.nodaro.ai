import { describe, it, expect } from "vitest"
import { editPlanBasis } from "@nodaro/shared/edl"
import { estimateRunCreditLines, estimateRunCredits } from "../estimate-run-credits"
import { clipRenderChain } from "@/lib/edl-review/clip-chain"
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

describe("the editor's Render final of a review-on Clip Pack: the kept clips at final, no fee", () => {
  // Two one-minute clips, each priced once per run of its render and its captions.
  const clip = (i: number) => ({
    version: 1, clock: "master", sources: [{ id: "rec", url: "https://r2/ep.mp4", kind: "video" }],
    segments: [{ id: `c${i}`, inMs: i * 100_000, outMs: i * 100_000 + 60_000, video: "rec" }], dropped: [], meta: { title: `Clip ${i}` },
  })
  const PACK = [clip(0), clip(1)]
  const SETTINGS = { reviewBeforeRender: true, captions: true }
  const cp = (data: Record<string, unknown> = {}) => ({
    id: "cp", type: "clip-pack", position: at,
    data: {
      label: "Clip Pack", ...SETTINGS, generatedJson: PACK,
      generatedResults: [0, 1].map((i) => preview("00000000-0000-4000-8000-000000000001", { url: `https://r2/p${i}.mp4`, useCaseSettings: SETTINGS })),
      ...data,
    },
  })
  const cpWire = { id: "w", source: "rec", target: "cp", sourceHandle: "video", targetHandle: "media" }
  // Speaker View (framed by default) 7 a minute, captions 3 a clip; the fee 1000, so it would show.
  const PRICES: Record<string, number> = { "speaker-view:complex": 7, "add-captions:kinetic": 3, "use-case-fee:clip-pack": 1000 }
  const quote = (data: Record<string, unknown> = {}) => {
    const run = usecaseRenderFinalRun("cp", [rec, cp(data)] as never, [cpWire] as never)!
    const asked: string[] = []
    const lines = estimateRunCreditLines(run.executable, run.graph, [cpWire] as never, (id) => {
      asked.push(id)
      return PRICES[id]
    })
    return { lines, asked, chain: clipRenderChain("cp", [rec, cp(data)] as never, [cpWire] as never) }
  }

  it("2 kept clips: 2 final Speaker View renders + 2 captions, and the fee is never asked for", () => {
    const { lines, asked, chain } = quote()
    expect(lines.map((l) => [l.nodeId, l.credits])).toEqual([["cp", 2 * 7 + 2 * 3]])
    expect(asked).not.toContain("use-case-fee:clip-pack")
    // The footer's sentence names the runs the price is made of.
    expect(chain.map((s) => [s.label, s.times])).toEqual([["Render Clip", 2], ["Caption Clip", 2]])
  })

  it("a canvas node after the pack: the chain names it at the times its own line is priced", () => {
    const up = { id: "up", type: "add-captions", position: at, data: { label: "Subtitles" } }
    const wires = [cpWire, { id: "o", source: "cp", target: "up", sourceHandle: "clips", targetHandle: "video" }]
    const nodes = [rec, cp(), up]
    const run = usecaseRenderFinalRun("cp", nodes as never, wires as never)!
    const lines = estimateRunCreditLines(run.executable, run.graph, wires as never, (id) => PRICES[id])
    const chain = clipRenderChain("cp", nodes as never, wires as never)
    expect(chain.map((s) => s.nodeId)).toEqual(["cp::uc-render", "cp::uc-captions", "up"])
    const upLine = lines.find((l) => l.nodeId === "up")!
    expect(upLine.quantity.fanOut).toBe(2)
    expect(chain[2]!.times).toBe(upLine.quantity.fanOut)
  })

  it("a use-case node after the pack is named once, by its own label, at the times its own line is priced", () => {
    const t2 = { id: "t2", type: "tighten-episode", position: at, data: { label: "Tighten Episode" } }
    const wires = [cpWire, { id: "o", source: "cp", target: "t2", sourceHandle: "clips", targetHandle: "media" }]
    const nodes = [rec, cp(), t2]
    const run = usecaseRenderFinalRun("cp", nodes as never, wires as never)!
    const lines = estimateRunCreditLines(run.executable, run.graph, wires as never, (id) => PRICES[id] ?? 1)
    const chain = clipRenderChain("cp", nodes as never, wires as never)
    expect(chain.map((s) => [s.nodeId, s.label])).toEqual([["cp::uc-render", "Render Clip"], ["cp::uc-captions", "Caption Clip"], ["t2", "Tighten Episode"]])
    const t2Line = lines.find((l) => l.nodeId === "t2")!
    expect(chain[2]!.times).toBe(t2Line.quantity.fanOut)
  })

  it("a dropped clip is neither priced nor named", () => {
    const editedEdl = { v: 1, kind: "clips", basis: editPlanBasis(PACK), clips: [{ keep: false }, { keep: true }] }
    const { lines, chain } = quote({ editedEdl })
    expect(lines.map((l) => [l.nodeId, l.credits])).toEqual([["cp", 7 + 3]])
    expect(chain.map((s) => [s.label, s.times])).toEqual([["Render Clip", 1], ["Caption Clip", 1]])
  })
})
