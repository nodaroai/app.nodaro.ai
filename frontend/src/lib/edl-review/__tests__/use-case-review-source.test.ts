import { describe, it, expect, vi, afterEach } from "vitest"
import { editPlanBasis } from "@nodaro/shared/edl"
import { isRenderNodeType, renderPlanPath } from "@nodaro/shared/nodes"
import { buildEpisodeTrailerGraph, buildTightenEpisodeGraph, resolveClipPackSettings, resolveEpisodeTrailerSettings, resolveTightenEpisodeSettings } from "@nodaro/render-rules"
import { reviewViewOf, usecaseReviewSource } from "../use-case-review-source"
import { reviewEntryOf, reviewKindOf, reviewRendersOf, reviewTargetOf } from "../review-entry"
import { renderReviewAdapterOf } from "@/lib/render-review-adapter"
import SINGLE_VIEWS from "./fixtures/use-case-review-view-single.json"

// The viewer's answer: may they use Speaker Map (several recordings, decided 2026-10-19)? "No" by default.
const viewer = vi.hoisted(() => ({ multicam: false }))
vi.mock("@/lib/use-case-multicam-viewer", () => ({ usecaseMulticamOffered: () => viewer.multicam }))
afterEach(() => {
  viewer.multicam = false
})

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

describe("one recording's review view is as it was before multicam (frozen from that code)", () => {
  const aud = { id: "aud", type: "upload-audio", position: at, data: { url: "https://r2/ep.m4a" } }
  const cam2 = { id: "cam2", type: "upload-video", position: at, data: { url: "https://r2/cam2.mp4" } }
  const mic = { id: "mic", type: "upload-audio", position: at, data: { url: "https://r2/mic.wav" } }
  const w = (source: string, sourceHandle: string, targetHandle = "media") => ({ id: `w-${source}`, source, target: "t1", sourceHandle, targetHandle })
  const now: Record<string, unknown> = {
    "video": reviewViewOf("t1", [rec, t1()], [w("rec", "video")]),
    "video, framed": reviewViewOf("t1", [rec, t1({ framing: { aspect: "9:16", layout: "auto" } })], [w("rec", "video")]),
    "audio": reviewViewOf("t1", [aud, t1({ output: "audio" })], [w("aud", "audio")]),
    "video, review on, captions": reviewViewOf("t1", [rec, t1({ reviewBeforeRender: true, captions: true })], [w("rec", "video")]),
    "two cameras and a master, viewer not multicam": reviewViewOf("t1", [rec, cam2, mic, t1()], [w("rec", "video"), w("cam2", "video"), w("mic", "audio", "masterAudio")]),
  }
  for (const [name, view] of Object.entries(SINGLE_VIEWS)) {
    it(name, () => expect(JSON.parse(JSON.stringify(now[name]))).toEqual(view))
  }
})

describe("a recording wired through a Teleport pair is reviewed as the same recording wired directly", () => {
  const send = { id: "send", type: "teleport-send", position: at, data: {} }
  const recv = { id: "recv", type: "teleport-receive", position: at, data: {} }
  const viaPair = [
    { id: "e1", source: "rec", target: "send", sourceHandle: "video", targetHandle: "in" },
    { id: "tp", source: "send", target: "recv", sourceHandle: "out", targetHandle: "in", data: { teleporter: true } },
    { id: "e2", source: "recv", target: "t1", sourceHandle: "out", targetHandle: "media" },
  ]
  const rowsOf = (view: ReturnType<typeof reviewViewOf>) => {
    const render = view.nodes.find((n) => n.id === view.renderId)!
    return renderReviewAdapterOf(render.type as string)!.rows(render as never, view.nodes as never, view.edges as never)
  }
  for (const [name, data] of [["video", {}], ["video, framed", { framing: { aspect: "9:16", layout: "auto" } }], ["audio", { output: "audio" }]] as const) {
    it(name, () => {
      const direct = reviewViewOf("t1", [rec, t1(data)], [wire])
      const teleported = reviewViewOf("t1", [rec, send, recv, t1(data)], viaPair)
      if (name === "video") expect(rowsOf(teleported).map((r) => r.sources)).toEqual([["https://r2/ep.mp4"]])
      expect(rowsOf(teleported).map((r) => r.sources)).toEqual(rowsOf(direct).map((r) => r.sources))
      expect(JSON.parse(JSON.stringify(teleported))).toEqual(JSON.parse(JSON.stringify(direct)))
      expect(usecaseReviewSource("t1", [rec, send, recv, t1(data)], viaPair)!.recordingUrl).toBe("https://r2/ep.mp4")
    })
  }
})

describe("a first recording with no file yet is skipped, as the run skips it (its resolver hands the run none)", () => {
  const empty = { id: "e0", type: "upload-video", position: at, data: {} }
  const clipPlan = [{ ...plan, meta: { title: "Clip" } }]
  const cases = [
    ["Tighten Episode", { ...t1() }],
    ["Trailer", { ...t1({ formats: ["9:16"], reviewBeforeRender: true }), type: "episode-trailer" }],
    ["Clip Pack", { ...t1({ generatedJson: clipPlan }), type: "clip-pack" }],
  ] as const
  for (const [name, node] of cases) {
    it(name, () => {
      const into = (source: string, id: string) => ({ id, source, target: "t1", sourceHandle: "video", targetHandle: "media" })
      const both = [into("e0", "w0"), into("rec", "w1")]
      expect(usecaseReviewSource("t1", [empty, rec, node], both)!.recordingUrl).toBe("https://r2/ep.mp4")
      const view = reviewViewOf("t1", [empty, rec, node], both)
      const sourceUrls = view.nodes.filter((n) => String(n.type).startsWith("upload-")).map((n) => (n.data as { url?: unknown }).url)
      expect(sourceUrls.length).toBeGreaterThan(0)
      expect(sourceUrls.every((u) => u === "https://r2/ep.mp4")).toBe(true)
      expect(JSON.parse(JSON.stringify(view))).toEqual(JSON.parse(JSON.stringify(reviewViewOf("t1", [rec, node], [into("rec", "w1")]))))
    })
  }
})

describe("a multicam take's review view (decided 2026-10-17)", () => {
  const cam2 = { id: "cam2", type: "upload-video", position: at, data: { url: "https://r2/cam2.mp4" } }
  const mic = { id: "mic", type: "upload-audio", position: at, data: { url: "https://r2/mic.wav" } }
  const w = (source: string, sourceHandle: string, targetHandle = "media") => ({ id: `w-${source}`, source, target: "t1", sourceHandle, targetHandle })
  const wires = [w("rec", "video"), w("cam2", "video"), w("mic", "audio", "masterAudio")]
  /** A take whose run kept the settings it was built from: a multicam run's carry `cameras`. */
  const take = (settings: object) => ({ reviewBeforeRender: true, generatedResults: [{ url: "https://r2/p.mp4", quality: "proxy", useCaseSettings: settings }] })
  const multicam = resolveTightenEpisodeSettings({ reviewBeforeRender: true, cameras: { speakerCameras: { "1": 2 } } }, "video", { recordings: 2, masterAudio: true })

  it("holds the recordings, the master, the plan, Camera Switch, the render and the transcript, wired plan → switch → render", () => {
    const view = reviewViewOf("t1", [rec, cam2, mic, t1(take(multicam))], wires)
    const ids = view.nodes.map((n) => n.id)
    for (const id of ["t1::uc-source", "t1::uc-cam-2", "t1::uc-master", "t1", "t1::uc-switch", "t1::uc-render", "t1::uc-transcribe"]) expect(ids).toContain(id)
    // Speaker Map (and its gated wire) and Audio Sync are not part of the review.
    expect(ids).not.toContain("t1::uc-map")
    expect(ids).not.toContain("t1::uc-sync")
    expect(view.edges.map((e) => `${e.source}>${e.target}.${e.targetHandle}`)).toEqual(expect.arrayContaining(["t1>t1::uc-switch.edl", "t1::uc-switch>t1::uc-render.edl"]))
    expect(renderPlanPath(view.renderId, view.nodes, view.edges as never)?.planId).toBe("t1")
    const render = view.nodes.find((n) => n.id === view.renderId)!
    expect(renderReviewAdapterOf(render.type)!.rows(render as never, view.nodes as never, view.edges as never)).toHaveLength(1)
  })
  it("the ids named inside data follow the view's names: the plan's roles, the switch's override", () => {
    const view = reviewViewOf("t1", [rec, cam2, mic, t1(take(multicam))], wires)
    const data = (id: string) => view.nodes.find((n) => n.id === id)!.data as Record<string, unknown>
    expect(data("t1")).toMatchObject({ sourceOrder: ["t1::uc-master", "t1::uc-source", "t1::uc-cam-2"], sourceConfig: { "t1::uc-master": { role: "master-audio" } } })
    expect(data("t1::uc-switch")).toMatchObject({ speakerMapByOrder: { "1": "t1::uc-cam-2" } })
    expect(data("t1::uc-cam-2")).toMatchObject({ url: "https://r2/cam2.mp4" })
    expect(data("t1::uc-master")).toMatchObject({ url: "https://r2/mic.wav" })
  })
  it("a take whose run read one recording is reviewed as that run, whoever the viewer now is", () => {
    viewer.multicam = true
    const single = resolveTightenEpisodeSettings({ reviewBeforeRender: true }, "video")
    const view = reviewViewOf("t1", [rec, cam2, mic, t1(take(single))], wires)
    expect(view.nodes.map((n) => n.id)).toEqual(["t1::uc-source", "t1::uc-transcribe", "t1::uc-silence", "t1", "t1::uc-render"])
  })
})

describe("Trailer's review on several recordings (decided 2026-10-17)", () => {
  const cam2 = { id: "cam2", type: "upload-video", position: at, data: { url: "https://r2/cam2.mp4" } }
  const mic = { id: "mic", type: "upload-audio", position: at, data: { url: "https://r2/mic.wav" } }
  const w = (source: string, sourceHandle: string, targetHandle = "media") => ({ id: `w-${source}`, source, target: "t1", sourceHandle, targetHandle })
  const wires = [w("rec", "video"), w("cam2", "video"), w("mic", "audio", "masterAudio")]
  const trailer = (data: Record<string, unknown> = {}) => ({ ...t1({ formats: ["9:16"], reviewBeforeRender: true, ...data }), type: "episode-trailer" })
  const take = (settings: object) => ({ generatedResults: [{ url: "https://r2/p.mp4", quality: "proxy", useCaseSettings: settings }] })

  it("a viewer who may not use Speaker Map reviews exactly the one-recording run: further cameras and the master are not read", () => {
    const view = reviewViewOf("t1", [rec, cam2, mic, trailer()], wires)
    expect(JSON.parse(JSON.stringify(view))).toEqual(JSON.parse(JSON.stringify(reviewViewOf("t1", [rec, trailer()], [w("rec", "video")]))))
  })
  it("a multicam take: the recordings, the master, the plan, Camera Switch and the render, wired plan → switch → render", () => {
    const settings = resolveEpisodeTrailerSettings({ formats: ["9:16"], reviewBeforeRender: true, cameras: { speakerCameras: { "1": 2 } } }, "video", { recordings: 2, masterAudio: true })
    const view = reviewViewOf("t1", [rec, cam2, mic, trailer(take(settings))], wires)
    const ids = view.nodes.map((n) => n.id)
    for (const id of ["t1::uc-source", "t1::uc-cam-2", "t1::uc-master", "t1", "t1::uc-switch", "t1::uc-render"]) expect(ids).toContain(id)
    expect(ids).not.toContain("t1::uc-map")
    expect(view.edges.map((e) => `${e.source}>${e.target}.${e.targetHandle}`)).toEqual(expect.arrayContaining(["t1>t1::uc-switch.edl", "t1::uc-switch>t1::uc-render.edl"]))
    expect(renderPlanPath(view.renderId, view.nodes, view.edges as never)?.planId).toBe("t1")
    expect((view.nodes.find((n) => n.id === "t1::uc-switch")!.data as Record<string, unknown>)).toMatchObject({ speakerMapByOrder: { "1": "t1::uc-cam-2" } })
  })
})

describe("Clip Pack's review on several recordings (decided 2026-10-17)", () => {
  const cam2 = { id: "cam2", type: "upload-video", position: at, data: { url: "https://r2/cam2.mp4" } }
  const mic = { id: "mic", type: "upload-audio", position: at, data: { url: "https://r2/mic.wav" } }
  const w = (source: string, sourceHandle: string, targetHandle = "media") => ({ id: `w-${source}`, source, target: "t1", sourceHandle, targetHandle })
  const wires = [w("rec", "video"), w("cam2", "video"), w("mic", "audio", "masterAudio")]
  const clipPlan = [{ ...plan, meta: { title: "Clip" } }]
  const pack = (data: Record<string, unknown> = {}) => ({ ...t1({ generatedJson: clipPlan, reviewBeforeRender: true, ...data }), type: "clip-pack" })
  const take = (settings: object) => ({ generatedResults: [{ url: "https://r2/p.mp4", quality: "proxy", useCaseSettings: settings }] })

  it("a viewer who may not use Speaker Map reviews exactly the one-recording run: further cameras and the master are not read", () => {
    const view = reviewViewOf("t1", [rec, cam2, mic, pack()], wires)
    expect(JSON.parse(JSON.stringify(view))).toEqual(JSON.parse(JSON.stringify(reviewViewOf("t1", [rec, pack()], [w("rec", "video")]))))
  })
  it("a multicam take: the recordings, the master, the plan, the per-clip Camera Switch and the render, wired plan → switch → render", () => {
    viewer.multicam = true
    const settings = resolveClipPackSettings({ reviewBeforeRender: true, cameras: { speakerCameras: { "1": 2 } } }, "video", { recordings: 2, masterAudio: true })
    const view = reviewViewOf("t1", [rec, cam2, mic, pack(take(settings))], wires)
    const ids = view.nodes.map((n) => n.id)
    for (const id of ["t1::uc-source", "t1::uc-cam-2", "t1::uc-master", "t1", "t1::uc-switch", "t1::uc-render"]) expect(ids).toContain(id)
    expect(view.edges.map((e) => `${e.source}>${e.target}.${e.targetHandle}`)).toEqual(expect.arrayContaining(["t1>t1::uc-switch.edl", "t1::uc-switch>t1::uc-render.edl"]))
    expect(renderPlanPath(view.renderId, view.nodes, view.edges as never)?.planId).toBe("t1")
  })
})
