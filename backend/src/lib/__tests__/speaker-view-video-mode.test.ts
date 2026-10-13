/**
 * Speaker View's Video input, as pure rules both engines and the editor read
 * (decided 2026-10-11): exactly one of `edl` and `video`, the transcript that
 * video mode requires (D3), the synthesised edit (D8, D15), the source-shape
 * checks (D18 refuses, D10 warns) and the non-blocking framing note (D9).
 */
import { describe, it, expect } from "vitest"
import {
  findSpeakerViewIssues,
  isWholeClipEdl,
  speakerViewFramingNote,
  speakerViewClipRefusal,
  speakerViewIdleEdit,
  speakerViewInputIssue,
  speakerViewVideoEdit,
  speakerViewVideoModeLive,
  speakerViewVideoRunRefusal,
  speakerViewVideoTranscriptIssue,
} from "@nodaro/render-rules"

const URL = "https://cdn.example.test/uploads/videos/clip.mp4"
const words = (labels: string[]) => ({ words: labels.map((speaker, i) => ({ text: `w${i}`, start: i, end: i + 0.5, speaker })) })
const TWO = words(["Alex", "Alex", "Sam", "Sam"])
const ONE = words(["Alex", "Alex"])
const NONE = { words: [{ text: "hi", start: 0, end: 0.5 }] }

describe("speakerViewInputIssue: exactly one of edl and video", () => {
  it("refuses both wired, in a plain sentence", () => {
    const issue = speakerViewInputIssue({ hasEdl: true, hasVideo: true })
    expect(issue?.code).toBe("both")
    expect(issue?.message).toMatch(/not both/i)
  })
  it("refuses neither wired, naming both inputs", () => {
    const issue = speakerViewInputIssue({ hasEdl: false, hasVideo: false })
    expect(issue?.code).toBe("neither")
    expect(issue?.message).toMatch(/edit/i)
    expect(issue?.message).toMatch(/video/i)
  })
  it("passes either one alone", () => {
    expect(speakerViewInputIssue({ hasEdl: true, hasVideo: false })).toBeNull()
    expect(speakerViewInputIssue({ hasEdl: false, hasVideo: true })).toBeNull()
  })
})

describe("speakerViewVideoTranscriptIssue: the transcript video mode requires (D3)", () => {
  it("asks for a Transcribe node with speaker detection when there is no transcript", () => {
    for (const none of [undefined, null, ""]) {
      const issue = speakerViewVideoTranscriptIssue(none)
      expect(issue?.code).toBe("no-transcript")
      expect(issue?.message).toMatch(/Transcribe/)
      expect(issue?.message).toMatch(/speaker detection/i)
    }
  })
  it("asks for speaker detection when the transcript names no speaker", () => {
    expect(speakerViewVideoTranscriptIssue(NONE)?.code).toBe("no-speaker-labels")
  })
  it("accepts a transcript that names at least one speaker, as an object or its JSON", () => {
    expect(speakerViewVideoTranscriptIssue(ONE)).toBeNull()
    expect(speakerViewVideoTranscriptIssue(JSON.stringify(TWO))).toBeNull()
  })
})

describe("speakerViewVideoEdit: the edit the run cuts", () => {
  const base = { url: URL, clip: { durationMs: 14_600, width: 3840, height: 2160 }, transcript: TWO }

  it("is the whole-clip edit with the transcript's two labels on the source (D8, D15)", () => {
    const r = speakerViewVideoEdit(base)
    if (!r.ok) throw new Error(r.message)
    expect(isWholeClipEdl(r.edl)).toBe(true)
    expect(r.edl.sources[0]?.speakers).toEqual(["Alex", "Sam"])
    expect(r.edl.segments[0]?.outMs).toBe(14_600)
    expect(r.edl.meta?.targetAspect).toBe("9:16")
  })

  it("writes no speakers for a single label (D15)", () => {
    const r = speakerViewVideoEdit({ ...base, transcript: ONE })
    if (!r.ok) throw new Error(r.message)
    expect(r.edl.sources[0]?.speakers).toBeUndefined()
  })

  it("draws at the node's aspect when it has one, else 9:16", () => {
    const r = speakerViewVideoEdit({ ...base, targetAspect: "1:1" })
    if (!r.ok) throw new Error(r.message)
    expect(r.edl.meta?.targetAspect).toBe("1:1")
    const d = speakerViewVideoEdit({ ...base, targetAspect: "not-an-aspect" })
    if (!d.ok) throw new Error(d.message)
    expect(d.edl.meta?.targetAspect).toBe("9:16")
  })

  it("passes the rule the badge, the route and the plugin share", () => {
    for (const transcript of [TWO, ONE]) {
      const r = speakerViewVideoEdit({ ...base, transcript })
      if (!r.ok) throw new Error(r.message)
      const verdict = findSpeakerViewIssues({ edl: r.edl, transcript, settings: { targetAspect: "9:16" } })
      expect(verdict.issues.map((i) => i.message)).toEqual([])
    }
  })

  it("refuses the transcript problems before looking at the clip", () => {
    expect(speakerViewVideoEdit({ ...base, transcript: undefined })).toMatchObject({ ok: false, code: "no-transcript" })
    expect(speakerViewVideoEdit({ ...base, transcript: NONE })).toMatchObject({ ok: false, code: "no-speaker-labels" })
  })

  it("refuses an unusable length with the clip-length sentence", () => {
    const r = speakerViewVideoEdit({ ...base, clip: { durationMs: 0 } })
    expect(r).toMatchObject({ ok: false, code: "bad-clip" })
  })

  it("D18: refuses a source at or narrower than the target, before any charge", () => {
    const r = speakerViewVideoEdit({ ...base, clip: { durationMs: 5000, width: 1080, height: 1920 } })
    expect(r).toMatchObject({ ok: false, code: "source-not-wider" })
    if (!r.ok) expect(r.message).toMatch(/1080×1920/)
  })

  it("does not refuse when the size is unknown", () => {
    const r = speakerViewVideoEdit({ ...base, clip: { durationMs: 5000 } })
    expect(r.ok).toBe(true)
  })

  it("D10: a low-resolution source renders anyway, with a warning naming the upscale", () => {
    const r = speakerViewVideoEdit({ ...base, clip: { durationMs: 14_600, width: 640, height: 360 } })
    if (!r.ok) throw new Error(r.message)
    expect(r.warnings.join(" ")).toMatch(/640×360/)
    expect(r.warnings.join(" ")).toMatch(/enlarged 5\.3×/)
  })

  it("has no resolution warning for a source that is not enlarged past the line", () => {
    const r = speakerViewVideoEdit(base)
    if (!r.ok) throw new Error(r.message)
    expect(r.warnings).toEqual([])
  })
})

describe("speakerViewIdleEdit: the edit the idle canvas judges", () => {
  it("is a whole-clip edit without a measured length", () => {
    expect(isWholeClipEdl(speakerViewIdleEdit({ url: URL, transcript: TWO }))).toBe(true)
    expect(speakerViewIdleEdit({ url: URL, transcript: TWO })?.sources[0]?.url).toBe(URL)
  })
  it("carries the same speakers and aspect rules as the run's", () => {
    const idle = speakerViewIdleEdit({ url: URL, transcript: TWO, targetAspect: "4:5" })
    expect(idle?.sources[0]?.speakers).toEqual(["Alex", "Sam"])
    expect(idle?.meta?.targetAspect).toBe("4:5")
  })
})

describe("the idle edit never invents an address (decided 2026-10-12)", () => {
  it("answers no edit at all without the video's real address, so nothing downstream can take a stand-in for a file", () => {
    for (const url of [undefined, "", "   "]) expect(speakerViewIdleEdit({ url, transcript: TWO })).toBeUndefined()
  })
})

describe("R2: faces in the clip, for a node that opts in", () => {
  const base = { url: URL, clip: { durationMs: 14_600, width: 3840, height: 2160 }, transcript: TWO }
  it("speakerViewClipRefusal: refuses a clip with no faces only when the node asks for it", () => {
    const none = { durationMs: 5000, width: 3840, height: 2160, faces: "none" as const }
    expect(speakerViewClipRefusal({ clip: none, targetAspect: "9:16", requireFaces: true })).toMatchObject({ code: "no-faces" })
    expect(speakerViewClipRefusal({ clip: none, targetAspect: "9:16", requireFaces: true })?.message).toMatch(/no faces/i)
    expect(speakerViewClipRefusal({ clip: none, targetAspect: "9:16" })).toBeNull()
    expect(speakerViewClipRefusal({ clip: none, targetAspect: "9:16", requireFaces: false })).toBeNull()
  })
  it("never refuses what it could not look at", () => {
    for (const faces of [undefined, "unknown" as const, "present" as const]) {
      expect(speakerViewClipRefusal({ clip: { durationMs: 5000, width: 3840, height: 2160, ...(faces ? { faces } : {}) }, targetAspect: "9:16", requireFaces: true })).toBeNull()
    }
  })
  it("D18 comes first, with the same sentence the edit uses", () => {
    const narrow = { durationMs: 5000, width: 1080, height: 1920, faces: "none" as const }
    expect(speakerViewClipRefusal({ clip: narrow, targetAspect: "9:16", requireFaces: true })).toMatchObject({ code: "source-not-wider" })
  })
  it("speakerViewVideoEdit refuses it at the node's own dispatch, on every engine and the route", () => {
    const r = speakerViewVideoEdit({ ...base, clip: { ...base.clip, faces: "none" }, requireFaces: true })
    expect(r).toMatchObject({ ok: false, code: "no-faces" })
    expect(speakerViewVideoEdit({ ...base, clip: { ...base.clip, faces: "none" } }).ok).toBe(true)
    expect(speakerViewVideoEdit({ ...base, clip: { ...base.clip, faces: "unknown" }, requireFaces: true }).ok).toBe(true)
  })
})

describe("speakerViewFramingNote: nothing to frame with (D9, non-blocking)", () => {
  const region = { x: 0, y: 0, w: 0.5, h: 1 }
  it("names the speakers with no drawn box when no face tracks are wired", () => {
    const note = speakerViewFramingNote({ speakers: ["Alex", "Sam"], tracksWired: false, speakerRegions: [], defaultRegionKeys: [] })
    expect(note).toBe("No framing set for Alex, Sam: the centre of the frame is used.")
  })
  it("names only the speakers still missing a drawn box", () => {
    const rows = [{ source: "video", speaker: "Alex", region }]
    expect(speakerViewFramingNote({ speakers: ["Alex", "Sam"], tracksWired: false, speakerRegions: rows, defaultRegionKeys: [] }))
      .toBe("No framing set for Sam: the centre of the frame is used.")
  })
  it("does not count a default box as framing", () => {
    const rows = [{ source: "video", speaker: "Alex", region }]
    const keys = [JSON.stringify(["video", "Alex"])]
    expect(speakerViewFramingNote({ speakers: ["Alex"], tracksWired: false, speakerRegions: rows, defaultRegionKeys: keys }))
      .toMatch(/Alex/)
  })
  it("is silent when face tracks are wired (their own notes speak) or every speaker has a box", () => {
    expect(speakerViewFramingNote({ speakers: ["Alex"], tracksWired: true, speakerRegions: [], defaultRegionKeys: [] })).toBeNull()
    const rows = [{ source: "video", speaker: "Alex", region }]
    expect(speakerViewFramingNote({ speakers: ["Alex"], tracksWired: false, speakerRegions: rows, defaultRegionKeys: [] })).toBeNull()
  })
  it("is silent with no speakers to name", () => {
    expect(speakerViewFramingNote({ speakers: [], tracksWired: false, speakerRegions: [], defaultRegionKeys: [] })).toBeNull()
  })
})

describe("speakerViewVideoRunRefusal: refused at run start, so Transcribe never charges for a run that cannot succeed", () => {
  const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, data })
  const wire = (source: string, target: string, targetHandle: string) => ({ source, target, targetHandle })
  const graph = (over: { meta?: Record<string, unknown>; transcript?: boolean; edl?: boolean; svData?: Record<string, unknown> } = {}) => ({
    nodes: [
      node("up", "upload-video", { metadata: over.meta ?? { width: 3840, height: 2160 } }),
      node("tx", "transcribe"),
      node("plan", "edit-plan"),
      node("sv", "speaker-view", over.svData ?? {}),
    ],
    edges: [
      wire("up", "sv", "video"),
      ...(over.transcript === false ? [] : [wire("tx", "sv", "transcript")]),
      ...(over.edl ? [wire("plan", "sv", "edl")] : []),
    ],
  })
  // The rules below the video-mode gate, asked with the mode live (both priced).
  const LIVE = { viewPriced: true, framesPriced: true }
  const refusal = (g: ReturnType<typeof graph>) => speakerViewVideoRunRefusal(g.nodes, g.nodes, g.edges, LIVE)

  it("passes a wired video with a transcript and a wide enough upload", () => {
    expect(refusal(graph())).toBeNull()
  })

  it("passes a graph with no video-mode Speaker View", () => {
    const g = graph()
    expect(speakerViewVideoRunRefusal(g.nodes, g.nodes, [wire("plan", "sv", "edl"), wire("tx", "sv", "transcript")], LIVE)).toBeNull()
  })

  it("R15: refuses video mode while either price flag is off, naming the node; an edit-driven one passes", () => {
    for (const flags of [{ viewPriced: true, framesPriced: false }, { viewPriced: false, framesPriced: true }, { viewPriced: false, framesPriced: false }]) {
      const r = speakerViewVideoRunRefusal(graph().nodes, graph().nodes, graph().edges, flags)
      expect(r?.nodeIds, JSON.stringify(flags)).toEqual(["sv"])
      expect(r?.message).toContain("Speaker View from a video is not available yet")
      expect(r?.message).toContain('Speaker View node "Speaker View"')
      expect(r?.message).toMatch(/nothing was charged/)
      const g = graph()
      expect(speakerViewVideoRunRefusal(g.nodes, g.nodes, [wire("plan", "sv", "edl"), wire("tx", "sv", "transcript")], flags)).toBeNull()
    }
  })

  it("R15: reads the real flags when none are given (Speaker Frames is unpriced today)", () => {
    const g = graph()
    expect(speakerViewVideoRunRefusal(g.nodes, g.nodes, g.edges) === null).toBe(speakerViewVideoModeLive())
  })

  it("refuses an edit and a video together, naming the node and saying nothing was charged", () => {
    const r = refusal(graph({ edl: true }))
    expect(r?.nodeIds).toEqual(["sv"])
    expect(r?.message).toMatch(/not both/i)
    expect(r?.message).toMatch(/nothing was charged/)
  })

  it("refuses a video with no transcript wired", () => {
    expect(refusal(graph({ transcript: false }))?.message).toMatch(/Transcribe/)
  })

  it("names the node by its LABEL, never its raw id", () => {
    const labelled = refusal(graph({ transcript: false, svData: { label: "Vertical cut" } }))
    expect(labelled?.message).toContain('Speaker View node "Vertical cut"')
    expect(labelled?.message).not.toContain("(Speaker View node sv)")
    expect(labelled?.nodeIds).toEqual(["sv"])
    // No label: the type's own name, still not the id.
    const plain = refusal(graph({ transcript: false }))
    expect(plain?.message).toContain('Speaker View node "Speaker View"')
    expect(plain?.message).not.toMatch(/\bsv\b/)
    const blank = refusal(graph({ transcript: false, svData: { label: "   " } }))
    expect(blank?.message).toContain('Speaker View node "Speaker View"')
  })

  it("accepts an inline transcript on the node", () => {
    expect(refusal(graph({ transcript: false, svData: { transcript: TWO } }))).toBeNull()
  })

  it("D18: refuses an upload already as narrow as the target, from its saved size", () => {
    const r = refusal(graph({ meta: { width: 1080, height: 1920 } }))
    expect(r?.message).toMatch(/1080×1920/)
  })

  it("judges against the node's own aspect", () => {
    expect(refusal(graph({ meta: { width: 1920, height: 1080 }, svData: { targetAspect: "16:9" } }))?.message).toMatch(/1920×1080/)
  })

  it("cannot judge a source that has not run, and says nothing about it", () => {
    const g = graph()
    g.nodes[0] = node("up", "generate-video")
    expect(refusal(g)).toBeNull()
    expect(refusal(graph({ meta: {} }))).toBeNull()
  })

  it("ignores a skipped node, and a node the run does not execute", () => {
    const g = graph({ transcript: false, svData: { skipped: true } })
    expect(refusal(g)).toBeNull()
    const h = graph({ transcript: false })
    expect(speakerViewVideoRunRefusal([], h.nodes, h.edges, LIVE)).toBeNull()
  })
})
