/**
 * The framing source a viewer's run reads (decided 2026-10-20): `auto` (the
 * new node's default) follows faces only while Speaker Frames is available to
 * the viewer, else it is the even split — silently. An explicit `tracking`
 * is never rewritten (its caller is refused up front). ONE rule for the route,
 * both engines' bodies, the estimate's expansion and the resume match.
 */
import { describe, it, expect } from "vitest"
import {
  SPEAKER_FRAMES_PRICED,
  USE_CASE_FRAMES_NODE_ID,
  USE_CASE_RUN_VIEWER_AS_BEFORE,
  expandUseCaseNodes,
  USE_CASE_NODE_TYPES,
  usecaseDescriptor,
  usecaseFramesAvailableFor,
  usecaseFramingForViewer,
  usecaseRunRecordings,
} from "@nodaro/render-rules"

const FRAMED = { framing: { aspect: "9:16", layout: "stacked" } } as const
/** A type whose absent default is `static` (every type that predates `auto`). */
const STATIC_ABSENT = { absentFramingSource: "static" } as const
/** A type whose absent default is `auto` (Speaker Layout). */
const AUTO_ABSENT = { absentFramingSource: "auto" } as const

describe("usecaseFramingForViewer", () => {
  it("auto, Speaker Frames withheld: the even split", () => {
    expect(usecaseFramingForViewer({ ...FRAMED, framingSource: "auto" }, false, STATIC_ABSENT)).toEqual({ ...FRAMED, framingSource: "static" })
  })
  it("auto, Speaker Frames available: the same object (the resolver follows faces)", () => {
    const s = { ...FRAMED, framingSource: "auto" }
    expect(usecaseFramingForViewer(s, true, STATIC_ABSENT)).toBe(s)
  })
  it("never rewrites an explicit choice, nor a node without one on a type whose absent default is static", () => {
    for (const s of [{ ...FRAMED, framingSource: "tracking" }, { ...FRAMED, framingSource: "static" }, { ...FRAMED }, {}]) {
      expect(usecaseFramingForViewer(s, false, STATIC_ABSENT)).toBe(s)
      expect(usecaseFramingForViewer(s, true, STATIC_ABSENT)).toBe(s)
    }
  })
  it("absent on a type whose absent default is auto: the even split for a viewer without Speaker Frames, the same object for one with", () => {
    const s = { ...FRAMED }
    expect(usecaseFramingForViewer(s, false, AUTO_ABSENT)).toEqual({ ...FRAMED, framingSource: "static" })
    expect(usecaseFramingForViewer(s, true, AUTO_ABSENT)).toBe(s)
    // A value that is not a framing source is read as absent.
    expect(usecaseFramingForViewer({ framingSource: "nonsense" }, false, AUTO_ABSENT)).toEqual({ framingSource: "static" })
    // An explicit choice is never rewritten, whatever the type's default.
    for (const t of [{ framingSource: "tracking" }, { framingSource: "static" }]) expect(usecaseFramingForViewer(t, false, AUTO_ABSENT)).toBe(t)
  })
  it("each type's absent default is its spec's: Speaker Layout auto, every type that predates it static", () => {
    expect(Object.fromEntries(USE_CASE_NODE_TYPES.map((t) => [t, usecaseDescriptor(t).absentFramingSource]))).toEqual({
      "tighten-episode": "static",
      "episode-chapters": "static",
      "episode-trailer": "static",
      "clip-pack": "static",
      "speaker-layout": "auto",
    })
  })
  it("an estimate given no answer reads Speaker Frames as available (never under the run's hold)", () => {
    expect(usecaseFramesAvailableFor(undefined)).toBe(true)
    expect(usecaseFramesAvailableFor({})).toBe(true)
    expect(usecaseFramesAvailableFor({ multicam: true })).toBe(true)
    expect(usecaseFramesAvailableFor({ framesWithheld: true })).toBe(false)
  })
  it("a run's 'as before' viewer reads neither several recordings nor Speaker Frames", () => {
    expect(USE_CASE_RUN_VIEWER_AS_BEFORE).toEqual({ multicam: false, framesAvailable: false })
  })
})

describe("Tighten's resolved settings for the viewer", () => {
  const d = usecaseDescriptor("tighten-episode")
  it("auto for a viewer without Speaker Frames resolves exactly as a node with no framing source", () => {
    expect(d.resolveSettings(usecaseFramingForViewer({ ...FRAMED, framingSource: "auto" }, false, d), "video")).toEqual(d.resolveSettings({ ...FRAMED }, "video"))
  })
  it("auto for a viewer with Speaker Frames follows faces (while it is priced)", () => {
    const s = d.resolveSettings(usecaseFramingForViewer({ ...FRAMED, framingSource: "auto" }, true, d), "video") as { framingSource?: string }
    expect(s.framingSource).toBe(SPEAKER_FRAMES_PRICED ? "tracking" : undefined)
  })
})

describe("both engines' one body rule (usecaseRunRecordings) reads the viewer's framing", () => {
  const wired = [{ nodeId: "rec", url: "https://r2/ep.mp4" }]
  const run = (settings: Record<string, unknown>, framesAvailable: boolean) =>
    usecaseRunRecordings({ wired, data: {}, maxRecordings: 6, takesMaster: true, multicam: false, framesAvailable, absentFramingSource: "static", settings })
  it("sends auto as the even split to a viewer without Speaker Frames", () => {
    expect(run({ ...FRAMED, framingSource: "auto" }, false).settings).toEqual({ ...FRAMED, framingSource: "static" })
  })
  it("sends auto as auto to a viewer with Speaker Frames, and tracking as tracking to anyone", () => {
    expect(run({ ...FRAMED, framingSource: "auto" }, true).settings).toEqual({ ...FRAMED, framingSource: "auto" })
    expect(run({ ...FRAMED, framingSource: "tracking" }, false).settings).toEqual({ ...FRAMED, framingSource: "tracking" })
  })
  it("a node without a framing source sends none (the body as before)", () => {
    expect(run({ ...FRAMED }, false).settings).toEqual({ ...FRAMED })
    expect(run({ ...FRAMED }, true).settings).toEqual({ ...FRAMED })
  })
})

describe("the estimate's expansion reads the viewer's framing (framesWithheld)", () => {
  const rec = { id: "rec", type: "upload-video", data: { url: "https://r2/ep.mp4", metadata: { durationSeconds: 3600 } } }
  const node = (framingSource?: string) => ({ id: "t1", type: "tighten-episode", data: { label: "Tighten Episode", captions: false, ...FRAMED, ...(framingSource ? { framingSource } : {}) } })
  const edges = [{ source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" }]
  const frames = (x: ReturnType<typeof expandUseCaseNodes>) => x.nodes.some((n) => n.id === `t1::${USE_CASE_FRAMES_NODE_ID}`)
  it("auto, Speaker Frames withheld: the static chain, exactly a node without a framing source", () => {
    const withheld = expandUseCaseNodes([rec, node("auto")], edges, { framesWithheld: true })
    expect(frames(withheld)).toBe(false)
    expect(withheld.nodes).toEqual(expandUseCaseNodes([rec, node()], edges).nodes)
  })
  it("auto with no answer (or available): the tracking chain", () => {
    expect(frames(expandUseCaseNodes([rec, node("auto")], edges))).toBe(SPEAKER_FRAMES_PRICED)
  })
  it("an explicit tracking is priced as tracking whoever asks (its run is refused, never cheaper)", () => {
    expect(frames(expandUseCaseNodes([rec, node("tracking")], edges, { framesWithheld: true }))).toBe(true)
  })
})
