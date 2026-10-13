/**
 * What the canvas knows about a bare video wired into Speaker View (decided
 * 2026-10-11): the idle edit that stands in for the edit, the wiring rule, and
 * the issues and warnings the badge adds on top of the edit's own verdict.
 */
import { beforeEach, describe, it, expect, vi } from "vitest"

// `priced`: Speaker View; `frames`: Speaker Frames. Video mode is open only with both (R15).
const flag = vi.hoisted(() => ({ priced: true, frames: true }))
vi.mock("@nodaro/render-rules", async (importOriginal) => (await import("@/test-utils/speaker-view-video-gate-mock")).withVideoGate(await importOriginal<typeof import("@nodaro/render-rules")>(), flag))
beforeEach(() => {
  flag.priced = true
  flag.frames = true
})
import { isWholeClipEdl } from "@nodaro/render-rules"
import { speakerFramesUnnamedViews, speakerViewContextOf, speakerViewEdits, speakerViewUnnamedOf, speakerViewVideoUrl } from "../speaker-view-context"
import { speakerViewInputState } from "../speaker-view-input-state"
import { speakerViewVideoExtras, speakerViewWiring, withSpeakerViewVideoExtras } from "../speaker-view-video"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const edge = (source: string, target: string, targetHandle: string, sourceHandle?: string): WorkflowEdge =>
  ({ id: `${source}-${target}-${targetHandle}`, source, target, targetHandle, ...(sourceHandle ? { sourceHandle } : {}) }) as unknown as WorkflowEdge

const URL = "https://cdn.example.test/uploads/videos/clip.mp4"
const WORDS = (labels: string[]) => ({ words: labels.map((speaker, i) => ({ text: `w${i}`, start: i, end: i + 0.5, speaker })) })
const upload = (meta: Record<string, unknown> = {}) => node("up", "upload-video", { url: URL, metadata: meta })
const transcribe = (labels: string[]) => node("tx", "transcribe", { generatedResults: [{ url: "", transcript: WORDS(labels) }], activeResultIndex: 0 })

describe("a video wired into Speaker View", () => {
  it("stands in for the edit: one whole-clip edit at the video's own address", () => {
    const nodes = [upload(), node("sv", "speaker-view")]
    const edits = speakerViewEdits("sv", nodes, [edge("up", "sv", "video")])
    expect(edits).toHaveLength(1)
    expect(isWholeClipEdl(edits[0])).toBe(true)
    expect((edits[0] as { sources: Array<{ url: string }> }).sources[0]?.url).toBe(URL)
  })

  it("reads the address off the producer exactly as the engines do", () => {
    const nodes = [upload(), node("sv", "speaker-view")]
    expect(speakerViewVideoUrl("sv", nodes, [edge("up", "sv", "video")])).toBe(URL)
    expect(speakerViewVideoUrl("sv", [node("up", "upload-video"), node("sv", "speaker-view")], [edge("up", "sv", "video")])).toBeUndefined()
  })

  it("has NO edit before the video has an address: a stand-in address never reaches the region editor, a thumbnail or the badge as a source", () => {
    const nodes = [node("up", "upload-video"), node("sv", "speaker-view")]
    const edges = [edge("up", "sv", "video")]
    expect(speakerViewEdits("sv", nodes, edges)).toEqual([])
    expect(speakerViewContextOf("sv", nodes, edges)).toBeUndefined()
    // However the producer is left (blank, an empty result, a result with no url), no edit names an invented address.
    for (const producer of [node("up", "upload-video", { url: "" }), node("up", "upload-video", { url: "   " }), node("up", "generate-video", { generatedResults: [] })]) {
      const found = speakerViewEdits("sv", [producer, node("sv", "speaker-view")], edges)
      expect(JSON.stringify(found)).not.toContain("video.invalid")
      expect(found).toEqual([])
    }
  })

  it("makes the context read as whole-clip, with the transcript's speakers", () => {
    const nodes = [upload(), transcribe(["A", "A", "B", "B"]), node("sv", "speaker-view")]
    const ctx = speakerViewContextOf("sv", nodes, [edge("up", "sv", "video"), edge("tx", "sv", "transcript")])
    expect(ctx?.clips[0]).toMatchObject({ wholeClip: true, cameras: 1, speakerCount: 2 })
  })

  it("does not change what a Speaker Frames node or an edl wire reads", () => {
    const nodes = [upload(), node("sf", "speaker-frames")]
    expect(speakerViewEdits("sf", nodes, [edge("up", "sf", "video")])).toEqual([])
  })

  it("is ready for the input panel", () => {
    const nodes = [upload(), node("sv", "speaker-view")]
    expect(speakerViewInputState("sv", nodes, [edge("up", "sv", "video")])).toEqual({ kind: "ready" })
  })
})

describe("speakerViewWiring", () => {
  it("counts a wire or the node's own edit", () => {
    const nodes = [upload(), node("plan", "edit-plan"), node("sv", "speaker-view")]
    expect(speakerViewWiring("sv", nodes, [edge("up", "sv", "video")])).toEqual({ hasEdl: false, hasVideo: true })
    expect(speakerViewWiring("sv", nodes, [edge("plan", "sv", "edl")])).toEqual({ hasEdl: true, hasVideo: false })
    expect(speakerViewWiring("sv", nodes, [edge("plan", "sv", "edl"), edge("up", "sv", "video")])).toEqual({ hasEdl: true, hasVideo: true })
    expect(speakerViewWiring("sv", [node("sv", "speaker-view", { edl: { sources: [] } })], [])).toEqual({ hasEdl: true, hasVideo: false })
  })
})

describe("speakerViewVideoExtras", () => {
  const graph = (over: { meta?: Record<string, unknown>; labels?: string[]; svData?: Record<string, unknown>; tracks?: boolean; both?: boolean } = {}) => {
    const nodes = [
      upload(over.meta ?? { width: 3840, height: 2160 }),
      ...(over.labels ? [transcribe(over.labels)] : []),
      ...(over.tracks ? [node("sf", "speaker-frames")] : []),
      ...(over.both ? [node("plan", "edit-plan")] : []),
      node("sv", "speaker-view", over.svData ?? {}),
    ]
    const edges = [
      edge("up", "sv", "video"),
      ...(over.labels ? [edge("tx", "sv", "transcript")] : []),
      ...(over.tracks ? [edge("sf", "sv", "tracks")] : []),
      ...(over.both ? [edge("plan", "sv", "edl")] : []),
    ]
    return { nodes, edges }
  }

  it("R15: while Speaker Frames (or Speaker View) is unpriced, says only that video mode is not open", () => {
    for (const [priced, frames] of [[true, false], [false, true]] as const) {
      flag.priced = priced
      flag.frames = frames
      const g = graph({ meta: { width: 1080, height: 1920 } })
      const x = speakerViewVideoExtras("sv", g.nodes, g.edges)!
      expect(x.issues, `${priced}/${frames}`).toEqual(["Speaker View from a video is not available yet. Use an edit as the input instead. Nothing was charged."])
      expect(x.warnings).toEqual([])
    }
  })
  const extras = (g: ReturnType<typeof graph>) => speakerViewVideoExtras("sv", g.nodes, g.edges)

  it("is null when no video is wired", () => {
    expect(speakerViewVideoExtras("sv", [node("sv", "speaker-view")], [])).toBeNull()
  })

  it("asks for Transcribe with speaker detection when no transcript is wired (D3)", () => {
    expect(extras(graph())?.issues.join(" ")).toMatch(/Transcribe/)
  })

  it("refuses both an edit and a video", () => {
    expect(extras(graph({ labels: ["A", "B"], both: true }))?.issues.join(" ")).toMatch(/not both/i)
  })

  it("has no issue with a transcript that names speakers, and warns about framing (D9)", () => {
    const e = extras(graph({ labels: ["A", "B"] }))
    expect(e?.issues).toEqual([])
    expect(e?.warnings).toContain("No framing set for A, B: the centre of the frame is used.")
  })

  it("does not warn about framing when face tracks are wired", () => {
    const e = extras(graph({ labels: ["A", "B"], tracks: true }))
    expect(e?.warnings.join(" ")).not.toMatch(/No framing/)
  })

  it("D18: refuses a source already as narrow as the target, from the producer's saved size", () => {
    const e = extras(graph({ labels: ["A", "B"], meta: { width: 1080, height: 1920 } }))
    expect(e?.issues.join(" ")).toMatch(/1080×1920/)
  })

  it("D10: warns about the upscale of a small source, naming it", () => {
    const e = extras(graph({ labels: ["A", "B"], meta: { width: 640, height: 360 } }))
    expect(e?.warnings.join(" ")).toMatch(/640×360/)
  })

  it("judges against the node's aspect when it has one", () => {
    const e = extras(graph({ labels: ["A", "B"], meta: { width: 1920, height: 1080 }, svData: { targetAspect: "16:9" } }))
    expect(e?.issues.join(" ")).toMatch(/1920×1080/)
  })

  it("does not judge a size it does not know", () => {
    const e = extras(graph({ labels: ["A", "B"], meta: {} }))
    expect(e?.issues).toEqual([])
  })
})

describe("tap-first: the speakers no face track names (decided 2026-10-13)", () => {
  const descriptor = (tracks: unknown[]) => ({
    version: 1, sampleFps: 2, detector: { id: "yunet" }, url: "https://cdn/speaker-tracks/11111111-2222-4333-8444-555555555555.json", sha256: "a".repeat(64), bytes: 10,
    sources: [{ sourceId: "video", clock: "source", frame: { w: 640, h: 360 }, sampledSpans: [{ startMs: 0, endMs: 14_000 }], tracks }],
  })
  const ABSTAINED = descriptor([{ id: "video/t1", boxCount: 3 }, { id: "video/t2", boxCount: 3 }])
  const graph = (framesData: Record<string, unknown> = { generatedJson: ABSTAINED }, extra: { edl?: boolean } = {}) => {
    const nodes = [upload({ width: 1920, height: 1080 }), transcribe(["A", "A", "B"]), node("sf", "speaker-frames", framesData), ...(extra.edl ? [node("plan", "edit-plan")] : []), node("sv", "speaker-view")]
    const edges = [edge("up", "sv", "video"), edge("tx", "sv", "transcript"), edge("sf", "sv", "tracks", "tracks"), edge("up", "sf", "video"), ...(extra.edl ? [edge("plan", "sv", "edl")] : [])]
    return { nodes, edges }
  }

  it("names every speaker when the matcher abstained, and the badge says how to fix it", () => {
    const g = graph()
    expect(speakerViewUnnamedOf("sv", g.nodes, g.edges)).toEqual([{ speaker: "A", name: "A" }, { speaker: "B", name: "B" }])
    expect(speakerViewVideoExtras("sv", g.nodes, g.edges)?.warnings).toContain(
      "Speaker Frames could not tell which face is A, B. Pick their faces in Edit framing…, then Update preview; until then Speaker View does not follow them.",
    )
  })

  it("clears once Speaker Frames' corrections name each speaker", () => {
    const g = graph({ generatedJson: ABSTAINED, trackAssignments: [{ trackId: "video/t1", speaker: "A", rawSpeaker: "A" }, { trackId: "video/t2", speaker: "B", rawSpeaker: "B" }] })
    expect(speakerViewUnnamedOf("sv", g.nodes, g.edges)).toEqual([])
    expect(speakerViewVideoExtras("sv", g.nodes, g.edges)?.warnings.join(" ")).not.toMatch(/could not tell/)
  })

  it("asks nothing before Speaker Frames has a result, or on an edit-fed Speaker View", () => {
    const before = graph({})
    expect(speakerViewUnnamedOf("sv", before.nodes, before.edges)).toEqual([])
    const both = graph(undefined, { edl: true })
    expect(speakerViewUnnamedOf("sv", both.nodes, both.edges)).toEqual([])
  })

  it("R15: asks nothing while video mode is not live", () => {
    flag.frames = false
    const g = graph()
    expect(speakerViewUnnamedOf("sv", g.nodes, g.edges)).toEqual([])
    expect(speakerFramesUnnamedViews("sf", g.nodes, g.edges)).toEqual([])
  })

  it("finds, from the Speaker Frames node, the Speaker View its tracks leave speakers unnamed in", () => {
    const g = graph()
    expect(speakerFramesUnnamedViews("sf", g.nodes, g.edges)).toEqual([{ nodeId: "sv", unnamed: [{ speaker: "A", name: "A" }, { speaker: "B", name: "B" }] }])
  })
})

describe("withSpeakerViewVideoExtras", () => {
  const ok = { kind: "edl" as const, ok: true, issues: [], warnings: ["n"] }
  it("is the verdict itself when there is nothing to add", () => {
    expect(withSpeakerViewVideoExtras(ok, null)).toBe(ok)
    expect(withSpeakerViewVideoExtras(null, null)).toBeNull()
  })
  it("adds issues first and warnings last, and fails the verdict on an issue", () => {
    const v = withSpeakerViewVideoExtras(ok, { issues: ["i"], warnings: ["w"] })
    expect(v).toMatchObject({ ok: false, issues: ["i"], warnings: ["n", "w"] })
  })
  it("builds a verdict when there was none", () => {
    expect(withSpeakerViewVideoExtras(null, { issues: [], warnings: ["w"] })).toMatchObject({ ok: true, issues: [], warnings: ["w"] })
  })
})
