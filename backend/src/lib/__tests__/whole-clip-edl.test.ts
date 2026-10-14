/**
 * The whole-clip EDL (Speaker View's Video input, decided 2026-10-11): ONE pure
 * function turns a bare video and its measured length into the one-source,
 * one-segment edit that the badge, the checks, the self-host route and the
 * cloud render all read. These pin what the plugin's contract needs from it
 * (a clean edit, the source id Speaker Frames already uses, the clip's own
 * sound) and the speaker-labels rule (D15).
 */
import { describe, it, expect } from "vitest"
import { normalizeEdl, validateEdl, type Edl } from "@nodaro/shared/edl"
import {
  SPEAKER_FRAMES_BARE_VIDEO_SOURCE_ID,
  SPEAKER_VIEW_VIDEO_DEFAULT_ASPECT,
  coerceSpeakerViewEdl,
  findSpeakerViewIssues,
  isWholeClipEdl,
  wholeClipEdl,
} from "@nodaro/render-rules"

const URL = "https://cdn.example.test/uploads/videos/clip.mp4"
const built = (input: Parameters<typeof wholeClipEdl>[0]): Edl => {
  const r = wholeClipEdl(input)
  if ("problem" in r) throw new Error(`unexpected problem: ${r.problem}`)
  return r.edl
}

describe("wholeClipEdl shape", () => {
  it("is one video source, one segment over the whole clip, and nothing else", () => {
    const edl = built({ url: URL, durationMs: 14_600 })
    expect(edl).toEqual({
      version: 1,
      clock: "master",
      sources: [{ id: "video", kind: "video", url: URL }],
      segments: [{ id: "seg-0", inMs: 0, outMs: 14_600, video: "video" }],
      meta: { targetAspect: "9:16" },
    })
  })

  it("names its source with the id Speaker Frames gives a bare video (the tracks provenance check reads it)", () => {
    expect(SPEAKER_FRAMES_BARE_VIDEO_SOURCE_ID).toBe("video")
    expect(built({ url: URL, durationMs: 1000 }).sources[0]!.id).toBe(SPEAKER_FRAMES_BARE_VIDEO_SOURCE_ID)
  })

  it("names no audio source and no role: the clip's own sound plays untouched", () => {
    const edl = built({ url: URL, durationMs: 5000 })
    expect(edl.sources.some((s) => s.kind === "audio" || s.role !== undefined)).toBe(false)
    expect(edl.segments[0]!.audio).toBeUndefined()
    expect(edl.segments[0]!.speaker).toBeUndefined()
  })

  it("trims the url", () => {
    expect(built({ url: `  ${URL}\n`, durationMs: 1000 }).sources[0]!.url).toBe(URL)
  })

  it("passes normalizeEdl unchanged and validateEdl with no issues AND no warnings", () => {
    for (const speakers of [undefined, [], ["A"], ["A", "B"], ["A", "B", "C"]]) {
      for (const targetAspect of [undefined, "9:16", "1:1", "4:5", "16:9"] as const) {
        const edl = built({ url: URL, durationMs: 14_633, speakers, targetAspect })
        const v = validateEdl(normalizeEdl(edl))
        expect(v.issues, JSON.stringify({ speakers, targetAspect })).toEqual([])
        expect(v.warnings, JSON.stringify({ speakers, targetAspect })).toEqual([])
        expect(normalizeEdl(edl)).toEqual(edl)
      }
    }
  })

  it("is what the Speaker View rule reads as an edit, and it is a normal one (no refusal on the edit)", () => {
    const edl = built({ url: URL, durationMs: 14_600, speakers: ["A", "B"] })
    expect("edl" in coerceSpeakerViewEdl(edl)).toBe(true)
    const verdict = findSpeakerViewIssues({ edl, transcript: { text: "x", segments: [], words: [{ word: "hi", start: 0, end: 1, speaker: "A" }] } })
    expect(verdict.issues.filter((i) => i.code === "edit" || i.code === "structural")).toEqual([])
  })

  it("is not mutated by, and does not share arrays with, its input", () => {
    const speakers = ["A", "B"]
    const edl = built({ url: URL, durationMs: 1000, speakers })
    speakers.push("C")
    expect(edl.sources[0]!.speakers).toEqual(["A", "B"])
  })
})

describe("wholeClipEdl target aspect", () => {
  it("defaults to the video-mode aspect, so a node nobody seeded (an MCP write, a template) still reframes", () => {
    expect(SPEAKER_VIEW_VIDEO_DEFAULT_ASPECT).toBe("9:16")
    expect(built({ url: URL, durationMs: 1000 }).meta?.targetAspect).toBe("9:16")
  })

  it("keeps an aspect the renderer draws", () => {
    expect(built({ url: URL, durationMs: 1000, targetAspect: "1:1" }).meta?.targetAspect).toBe("1:1")
  })

  it("falls back to the default for an aspect it does not know", () => {
    expect(built({ url: URL, durationMs: 1000, targetAspect: "21:9" as never }).meta?.targetAspect).toBe("9:16")
  })
})

describe("wholeClipEdl speakers (D15: only when the transcript has two or more labels)", () => {
  it("omits the key for no labels", () => {
    expect("speakers" in built({ url: URL, durationMs: 1000 }).sources[0]!).toBe(false)
    expect("speakers" in built({ url: URL, durationMs: 1000, speakers: [] }).sources[0]!).toBe(false)
  })

  it("omits the key for exactly one label (it would assert 'this camera shows one speaker' to the renderer)", () => {
    expect("speakers" in built({ url: URL, durationMs: 1000, speakers: ["Speaker 1"] }).sources[0]!).toBe(false)
  })

  it("writes two labels in the order given", () => {
    expect(built({ url: URL, durationMs: 1000, speakers: ["Man", "Woman"] }).sources[0]!.speakers).toEqual(["Man", "Woman"])
  })

  it("writes three labels", () => {
    expect(built({ url: URL, durationMs: 1000, speakers: ["A", "B", "C"] }).sources[0]!.speakers).toEqual(["A", "B", "C"])
  })

  it("counts DISTINCT labels: a repeated label is one speaker, so it is omitted", () => {
    expect("speakers" in built({ url: URL, durationMs: 1000, speakers: ["A", "A"] }).sources[0]!).toBe(false)
    expect(built({ url: URL, durationMs: 1000, speakers: ["A", "B", "A"] }).sources[0]!.speakers).toEqual(["A", "B"])
  })

  it("keeps labels exactly as the transcript spells them, so they match its words downstream", () => {
    // transcriptSpeakerLabels returns word.speaker verbatim: " A" and "A" are two
    // labels there, so they are two labels here, and neither is rewritten.
    expect(built({ url: URL, durationMs: 1000, speakers: [" A", "A"] }).sources[0]!.speakers).toEqual([" A", "A"])
    expect(built({ url: URL, durationMs: 1000, speakers: ["Host ", "Guest"] }).sources[0]!.speakers).toEqual(["Host ", "Guest"])
  })

  it("ignores blank and non-string entries", () => {
    expect("speakers" in built({ url: URL, durationMs: 1000, speakers: ["A", "", "  ", 3 as never, null as never] }).sources[0]!).toBe(false)
  })
})

describe("wholeClipEdl duration", () => {
  it("cuts a fractional length DOWN to a whole millisecond: a too-long outMs is billed and read past the stream's end", () => {
    expect(built({ url: URL, durationMs: 14_633.9 }).segments[0]!.outMs).toBe(14_633)
  })

  it.each([0, -5, 0.4, Number.NaN, Number.POSITIVE_INFINITY, "14000" as never, undefined as never])("refuses %s with a plain sentence", (durationMs) => {
    const r = wholeClipEdl({ url: URL, durationMs })
    expect("problem" in r && typeof r.problem === "string" && r.problem.length > 0).toBe(true)
    expect("edl" in r).toBe(false)
  })

  it("does not judge the 180-minute cap (the Speaker View rule does)", () => {
    expect("edl" in wholeClipEdl({ url: URL, durationMs: 200 * 60_000 })).toBe(true)
  })
})

describe("wholeClipEdl url", () => {
  it.each(["", "   ", undefined as never, 5 as never])("refuses %s", (url) => {
    const r = wholeClipEdl({ url, durationMs: 1000 })
    expect("problem" in r).toBe(true)
  })
})

describe("isWholeClipEdl", () => {
  it("recognises what wholeClipEdl builds, and its JSON string", () => {
    const edl = built({ url: URL, durationMs: 14_600, speakers: ["A", "B"] })
    expect(isWholeClipEdl(edl)).toBe(true)
    expect(isWholeClipEdl(JSON.stringify(edl))).toBe(true)
  })

  it("does not take an edit with a named speaker, several segments, two sources, a role or a trimmed start", () => {
    const edl = built({ url: URL, durationMs: 14_600 })
    expect(isWholeClipEdl({ ...edl, segments: [{ ...edl.segments[0]!, speaker: "A" }] })).toBe(false)
    expect(isWholeClipEdl({ ...edl, segments: [edl.segments[0]!, { ...edl.segments[0]!, id: "seg-1" }] })).toBe(false)
    expect(isWholeClipEdl({ ...edl, sources: [...edl.sources, { id: "mic", kind: "audio", url: "https://x/m.wav" }] })).toBe(false)
    expect(isWholeClipEdl({ ...edl, sources: [{ ...edl.sources[0]!, role: "wide" }] })).toBe(false)
    expect(isWholeClipEdl({ ...edl, segments: [{ ...edl.segments[0]!, inMs: 2000 }] })).toBe(false)
    expect(isWholeClipEdl({ ...edl, sources: [{ ...edl.sources[0]!, id: "cam-a" }], segments: [{ ...edl.segments[0]!, video: "cam-a" }] })).toBe(false)
  })

  it("does not take an output-clock edit, a non-edit, or junk", () => {
    const edl = built({ url: URL, durationMs: 14_600 })
    expect(isWholeClipEdl({ ...edl, clock: "output" })).toBe(false)
    for (const junk of [undefined, null, 3, "not json", [], {}, [edl]]) expect(isWholeClipEdl(junk)).toBe(false)
  })
})
