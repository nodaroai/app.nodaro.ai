import { describe, it, expect } from "vitest"
import { editPlanBasis } from "@nodaro/shared/edl"
import { isRenderNodeType, renderPlanPath } from "@nodaro/shared/nodes"
import { buildEpisodeTrailerGraph, buildTightenEpisodeGraph, resolveEpisodeTrailerSettings, resolveTightenEpisodeSettings } from "@nodaro/render-rules"
import { reviewViewOf, usecaseReviewSource } from "../use-case-review-source"
import { reviewEntryOf, reviewKindOf, reviewRendersOf, reviewTargetOf } from "../review-entry"
import { renderReviewAdapterOf } from "@/lib/render-review-adapter"

/**
 * A use-case node (Tighten Episode) is its own review source (decided
 * 2026-10-13): its run's plan, the reviewer's edit, the transcript, and the
 * render its run used, read as the Edit Plan → render pair that run is.
 */
const plan = { version: 1, sources: [{ id: "s0", url: "https://r2/ep.mp4", role: "master" }], segments: [{ id: "a", sourceId: "s0", inMs: 0, outMs: 4000 }], dropped: [] }
const transcript = { version: 1, words: [{ text: "Hi", startMs: 0, endMs: 300, speaker: "A" }] }
const at = { x: 0, y: 0 }
const rec = { id: "rec", type: "upload-video", position: at, data: { url: "https://r2/ep.mp4" } }
const t1 = (data: Record<string, unknown> = {}) => ({
  id: "t1", type: "tighten-episode", position: at,
  data: { label: "T", generatedJson: plan, generatedTranscript: transcript, generatedVideoUrl: "https://r2/p.mp4", ...data },
})
const wire = { id: "w", source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" }
const built = (data: Record<string, unknown>) => {
  const g = buildTightenEpisodeGraph(resolveTightenEpisodeSettings(data, "video"), { media: { url: "https://r2/ep.mp4", kind: "video" } })
  return g.nodes.find((n) => n.id === g.outputMap.renderNodeId)!
}

describe("a use-case node is its own review source", () => {
  it("carries the plan, the edit, the transcript and the render its run uses", () => {
    const edit = { v: 1, kind: "edl", basis: editPlanBasis(plan), edl: { segments: [], dropped: [] } }
    const source = usecaseReviewSource("t1", [rec, t1({ editedEdl: edit })], [wire])
    const render = built({})
    expect(source).toEqual({
      planId: "t1", plan, editedEdl: edit, transcript, renderType: render.type, render: render.data, recordingUrl: "https://r2/ep.mp4",
    })
    expect(isRenderNodeType(source!.renderType)).toBe(true)
    expect(renderReviewAdapterOf(source!.renderType)!.reviewContext(source!.render, ["https://r2/ep.mp4"])).toEqual({
      output: "video", crossfadeMs: 0, sources: ["https://r2/ep.mp4"],
    })
  })

  it("reads the recording the run reads first: the node's mediaOrder, else the first wire (a malformed order orders nothing)", () => {
    const audio = { id: "mic", type: "upload-audio", position: at, data: { url: "https://r2/ep.m4a" } }
    const audioWire = { id: "w2", source: "mic", target: "t1", sourceHandle: "audio", targetHandle: "media" }
    const ordered = usecaseReviewSource("t1", [rec, audio, t1({ mediaOrder: ["mic"] })], [wire, audioWire])
    expect(ordered?.recordingUrl).toBe("https://r2/ep.m4a")
    expect(ordered?.render).toEqual(buildTightenEpisodeGraph(resolveTightenEpisodeSettings({}, "audio"), { media: { url: "https://r2/ep.m4a", kind: "audio" } }).nodes.find((n) => n.id === "uc-render")!.data)
    for (const mediaOrder of [undefined, "mic", [7]]) {
      expect(usecaseReviewSource("t1", [rec, audio, t1({ mediaOrder })], [wire, audioWire])?.recordingUrl, String(mediaOrder)).toBe("https://r2/ep.mp4")
    }
  })

  it("with framing, the review reads the framed render's own settings", () => {
    const framing = { aspect: "9:16", layout: "stacked" }
    const source = usecaseReviewSource("t1", [rec, t1({ framing })], [wire])!
    expect(source.renderType).toBe(built({ framing }).type)
    expect(source.renderType).not.toBe(built({}).type)
    expect(source.render).toMatchObject({ targetAspect: "9:16", layout: "stacked", autoRegions: true })
  })

  it("a transcript handed on as JSON text reads as the transcript", () => {
    expect(usecaseReviewSource("t1", [rec, t1({ generatedTranscript: JSON.stringify(transcript) })], [wire])!.transcript).toEqual(transcript)
  })

  it("no plan yet, or not a Tighten EDL: not reviewable", () => {
    expect(usecaseReviewSource("t1", [rec, t1({ generatedJson: undefined })], [wire])).toBeNull()
    expect(usecaseReviewSource("t1", [rec, t1({ generatedJson: [plan] })], [wire])).toBeNull()
    expect(reviewKindOf("t1", [rec, t1({ generatedJson: undefined })] as never, [wire] as never)).toBeNull()
  })

  it("a list-driven node (one run per item) has no single run to review", () => {
    const list = {
      id: "ls", type: "list", position: at,
      data: { columns: [{ id: "default", name: "Items", handleId: "col_default", type: "video-url" }], rows: [["https://r2/a.mp4"], ["https://r2/b.mp4"]] },
    }
    const each = { id: "le", source: "ls", target: "t1", sourceHandle: "col_default", targetHandle: "media", data: { outputMode: "each" } }
    expect(usecaseReviewSource("t1", [list, t1()], [each])).toBeNull()
    expect(reviewEntryOf("t1", [list, t1()] as never, [each] as never)).toBeNull()
  })

  it("the review entry, target and renders resolve to the node itself — no Edit Plan on the canvas", () => {
    expect(reviewEntryOf("t1", [rec, t1()] as never, [wire] as never)).toEqual({ planId: "t1", kind: "edl" })
    expect(reviewTargetOf("t1", [rec, t1()] as never, [wire] as never)).toBe("t1")
    expect(reviewRendersOf("t1", [rec, t1()] as never, [wire] as never).map((n) => n.id)).toEqual(["t1"])
  })

  it("is read as the pair its run is: the node is the plan, the run's render reads it and the recording", () => {
    const view = reviewViewOf("t1", [rec, t1()], [wire])
    expect(view.renderId).not.toBe("t1")
    expect(renderPlanPath(view.renderId, view.nodes, view.edges as never)?.planId).toBe("t1")
    const render = view.nodes.find((n) => n.id === view.renderId)!
    const rows = renderReviewAdapterOf(render.type)!.rows(render as never, view.nodes as never, view.edges as never)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.sources).toEqual(["https://r2/ep.mp4"])
    expect(JSON.parse(rows[0]!.edl as string)).toMatchObject({ segments: [{ id: "a", inMs: 0, outMs: 4000 }] })
  })

  it("a Trailer is its own review source too: its plan, read by the cut its run renders the formats from", () => {
    const tr = { ...t1({ formats: ["9:16", "1:1"], reviewBeforeRender: true }), id: "tr", type: "episode-trailer" }
    const trWire = { ...wire, target: "tr" }
    const g = buildEpisodeTrailerGraph(resolveEpisodeTrailerSettings({ formats: ["9:16", "1:1"], reviewBeforeRender: true }, "video"), { media: { url: "https://r2/ep.mp4", kind: "video" } })
    const render = g.nodes.find((n) => n.id === g.outputMap.renderNodeId)!
    const source = usecaseReviewSource("tr", [rec, tr], [trWire])!
    expect(source).toMatchObject({ planId: "tr", plan, transcript, renderType: render.type, recordingUrl: "https://r2/ep.mp4" })
    expect(reviewEntryOf("tr", [rec, tr] as never, [trWire] as never)).toEqual({ planId: "tr", kind: "edl" })
  })

  it("any other node is read as the canvas it is", () => {
    const cut = { id: "cut", type: "apply-edl", position: at, data: {} }
    expect(reviewViewOf("cut", [cut], [])).toEqual({ renderId: "cut", nodes: [cut], edges: [] })
  })

  it("reads the settings the take on show was made with, never the node's later ones (decided 2026-10-13)", () => {
    // Framed when the preview ran; framing cleared on the node since.
    const framing = { aspect: "9:16", layout: "stacked" }
    const take = { url: "https://r2/p.mp4", quality: "proxy", jobId: "job-1", useCaseSettings: { ...resolveTightenEpisodeSettings({ framing }, "video") } }
    const source = usecaseReviewSource("t1", [rec, t1({ framing: null, generatedResults: [take] })], [wire])!
    expect(source.renderType).toBe(built({ framing }).type)
    expect(source.render).toMatchObject({ targetAspect: "9:16", layout: "stacked" })
    // A take that kept none reads the node's own.
    expect(usecaseReviewSource("t1", [rec, t1({ framing: null, generatedResults: [{ url: "https://r2/p.mp4" }] })], [wire])!.renderType).toBe(built({}).type)
  })
})
