/**
 * D14 (decided 2026-10-11): a Speaker View fed a bare video seeds Cut and 9:16,
 * not the one-camera Pan and the 16:9 fallback it seeds for an Edit Plan's
 * edit. The mode is read off the edit itself (`isWholeClipEdl`), so every
 * surface that builds the context (canvas, MCP, templates) agrees.
 */
import { describe, it, expect } from "vitest"
import {
  SPEAKER_VIEW_DEFAULTS,
  isWholeClipEdl,
  normalizeSpeakerViewData,
  resolveSpeakerViewAspect,
  speakerViewAspectOf,
  speakerViewContext,
  speakerViewDefaultsFor,
  wholeClipEdl,
} from "@nodaro/render-rules"

const URL = "https://cdn.example.test/clip.mp4"
const clip = (input: Partial<Parameters<typeof wholeClipEdl>[0]> = {}) => {
  const r = wholeClipEdl({ url: URL, durationMs: 14_600, ...input })
  if ("problem" in r) throw new Error(r.problem)
  return r.edl
}
const seg = (id: string, inS: number, speaker?: string) => ({ id, inMs: inS * 1000, outMs: (inS + 5) * 1000, video: "w", ...(speaker ? { speaker } : {}) })
const oneCameraEdit = { version: 1, clock: "master", sources: [{ id: "w", url: "https://x/w.mp4", kind: "video" }], segments: [seg("s0", 0, "Host"), seg("s1", 5, "Guest")] }
const twoCameraEdit = {
  version: 1,
  clock: "master",
  sources: [{ id: "a", url: "https://x/a.mp4", kind: "video" }, { id: "b", url: "https://x/b.mp4", kind: "video" }],
  segments: [{ ...seg("s0", 0, "Host"), video: "a" }, { ...seg("s1", 5, "Guest"), video: "b" }],
}

describe("speakerViewDefaultsFor a whole-clip video (D14)", () => {
  it("seeds Cut and 9:16, with the other SV20 defaults unchanged", () => {
    const d = speakerViewDefaultsFor(speakerViewContext(clip())!)
    expect(d).toEqual({
      layout: "single",
      switchType: "cut",
      switchDurationMs: SPEAKER_VIEW_DEFAULTS.switchDurationMs,
      emphasisStyle: SPEAKER_VIEW_DEFAULTS.emphasisStyle,
      emphasisDurationMs: SPEAKER_VIEW_DEFAULTS.emphasisDurationMs,
      targetAspect: "9:16",
    })
  })

  it("seeds Cut and 9:16 with a two-label transcript wired too", () => {
    const transcript = { text: "", segments: [], words: [{ word: "a", start: 0, end: 1, speaker: "A" }, { word: "b", start: 12, end: 13, speaker: "B" }] }
    const ctx = speakerViewContext(clip({ speakers: ["A", "B"] }), transcript)!
    expect(ctx.clips[0]!.speakerCount).toBe(2)
    const d = speakerViewDefaultsFor(ctx)
    expect(d.switchType).toBe("cut")
    expect(d.targetAspect).toBe("9:16")
  })

  it("reads the edit it is given, as a JSON string too", () => {
    expect(speakerViewDefaultsFor(speakerViewContext(JSON.stringify(clip()))!).switchType).toBe("cut")
  })

  it("seeds the aspect the whole-clip edit names", () => {
    expect(speakerViewDefaultsFor(speakerViewContext(clip({ targetAspect: "1:1" }))!).targetAspect).toBe("1:1")
  })

  it("is what the panel, the summary and the normalizer read as the aspect of a node nobody set", () => {
    const ctx = speakerViewContext(clip())!
    expect(speakerViewAspectOf({}, ctx)).toBe("9:16")
    expect(normalizeSpeakerViewData({}, ctx).data).toEqual({})
  })
})

describe("speakerViewDefaultsFor is unchanged for an edit that is not a whole clip", () => {
  it("one camera, several segments: Single + Pan + the edit's aspect, else 16:9", () => {
    const d = speakerViewDefaultsFor(speakerViewContext(oneCameraEdit)!)
    expect(d.layout).toBe("single")
    expect(d.switchType).toBe("pan")
    expect(d.targetAspect).toBe("16:9")
  })

  it("two cameras: Auto + Cut", () => {
    const d = speakerViewDefaultsFor(speakerViewContext(twoCameraEdit)!)
    expect(d.layout).toBe("auto")
    expect(d.switchType).toBe("cut")
    expect(d.targetAspect).toBe("16:9")
  })

  it("a one-camera edit that is one unnamed segment but is NOT the video-mode shape still seeds Pan", () => {
    const edit = { ...oneCameraEdit, segments: [{ id: "s0", inMs: 0, outMs: 5000, video: "w" }] }
    expect(isWholeClipEdl(edit)).toBe(false)
    expect(speakerViewDefaultsFor(speakerViewContext(edit)!).switchType).toBe("pan")
  })

  it("a clip pack mixing a whole clip and an ordinary edit is not video mode", () => {
    const ctx = speakerViewContext([clip(), oneCameraEdit])!
    expect(speakerViewDefaultsFor(ctx).switchType).toBe("pan")
  })
})

describe("the editor and the engine take the SAME aspect fallback for a whole-clip edit", () => {
  const withoutMeta = () => {
    const { meta: _meta, ...rest } = clip()
    return rest
  }

  it("a whole-clip-shaped edit with no meta.targetAspect is 9:16 in both resolvers", () => {
    const edit = withoutMeta()
    expect(isWholeClipEdl(edit)).toBe(true)
    expect(resolveSpeakerViewAspect(undefined, edit)).toBe("9:16")
    expect(speakerViewAspectOf({}, speakerViewContext(edit)!)).toBe("9:16")
  })

  it("the request still wins, then the edit's own aspect", () => {
    expect(resolveSpeakerViewAspect("1:1", withoutMeta())).toBe("1:1")
    expect(resolveSpeakerViewAspect(undefined, clip({ targetAspect: "4:5" }))).toBe("4:5")
  })

  it("an ordinary edit with no meta.targetAspect stays 16:9 in both resolvers", () => {
    expect(resolveSpeakerViewAspect(undefined, oneCameraEdit)).toBe("16:9")
    expect(speakerViewAspectOf({}, speakerViewContext(oneCameraEdit)!)).toBe("16:9")
  })
})
