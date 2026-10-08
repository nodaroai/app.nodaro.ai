import { describe, expect, it } from "vitest"
import { normalizeEdl } from "@nodaro/shared"
import { AUDITION_PAD_MS, auditionAt, auditionOfSpan, lookOwnerAt } from "../audition"

const VIDEO = { output: "video" as const, crossfadeMs: 0, sources: [] as string[] }
const AUDIO = { output: "audio" as const, crossfadeMs: 0, sources: [] as string[] }

// Single camera: its own sound is the render's.
const SINGLE = normalizeEdl({
  version: 1,
  clock: "master",
  sources: [{ id: "cam", url: "https://cdn.test/cam.mp4", kind: "video", offsetMs: 200 }],
  segments: [
    { id: "s0", inMs: 0, outMs: 4000, video: "cam" },
    { id: "s1", inMs: 5000, outMs: 9000, video: "cam" },
  ],
  dropped: [{ inMs: 4000, outMs: 5000, reason: "filler" }],
})

// Multicam: two cameras and the master audio the render plays under both.
const MULTI = normalizeEdl({
  version: 1,
  clock: "master",
  sources: [
    { id: "cam-1", url: "https://cdn.test/cam1.mp4", kind: "video" },
    { id: "cam-2", url: "https://cdn.test/cam2.mp4", kind: "video", offsetMs: 30_000 },
    { id: "mix", url: "https://cdn.test/mix.wav", kind: "audio", role: "master-audio", offsetMs: 100 },
  ],
  segments: [
    { id: "a", inMs: 30_000, outMs: 40_000, video: "cam-1" },
    { id: "b", inMs: 42_000, outMs: 50_000, video: "cam-2" },
  ],
  dropped: [{ inMs: 40_000, outMs: 42_000, reason: "tangent" }],
})

describe("the look the audition plays: buildEdited's owner rule (R6 a)", () => {
  it("is the segment holding the instant", () => {
    expect(lookOwnerAt(MULTI, 45_000)?.id).toBe("b")
    expect(lookOwnerAt(MULTI, 42_000)?.id).toBe("b")
  })

  it("between two segments, the one before (restored time carries its look)", () => {
    expect(lookOwnerAt(MULTI, 41_000)?.id).toBe("a")
    // A segment's end is outside it: the cut that starts there is the one before's.
    expect(lookOwnerAt(MULTI, 40_000)?.id).toBe("a")
  })

  it("before the first segment, the first", () => {
    expect(lookOwnerAt(MULTI, 1_000)?.id).toBe("a")
  })

  it("past the last segment, the last", () => {
    expect(lookOwnerAt(MULTI, 99_000)?.id).toBe("b")
  })
})

describe("Hear it: a span ± 1.5 s from the original file, on its own clock", () => {
  it("plays the camera of the restored time's look with its own sound in single-camera", () => {
    const a = auditionOfSpan(SINGLE, VIDEO, { inMs: 4000, outMs: 5000 })!
    expect(a).toMatchObject({ sourceId: "cam", url: "https://cdn.test/cam.mp4", medium: "video", sourceOffsetMs: 200, cameraAudio: false })
    // Source clock = master − the source's offset.
    expect(a.fromMs).toBe(4000 - AUDITION_PAD_MS - 200)
    expect(a.toMs).toBe(5000 + AUDITION_PAD_MS - 200)
    expect(a.span).toEqual({ inMs: 3800, outMs: 4800 })
  })

  it("never starts before the file does", () => {
    const a = auditionOfSpan(SINGLE, VIDEO, { inMs: 500, outMs: 1000 })!
    expect(a.fromMs).toBe(0)
  })

  it("in multicam, a camera's scratch audio, and says so", () => {
    const a = auditionOfSpan(MULTI, VIDEO, { inMs: 40_000, outMs: 42_000 })!
    expect(a).toMatchObject({ sourceId: "cam-1", url: "https://cdn.test/cam1.mp4", medium: "video", cameraAudio: true })
    expect(a.fromMs).toBe(40_000 - AUDITION_PAD_MS)
  })

  it("for audio output, the segment's sound: its master audio, on that file's clock", () => {
    const a = auditionOfSpan(MULTI, AUDIO, { inMs: 44_000, outMs: 45_000 })!
    expect(a).toMatchObject({ sourceId: "mix", url: "https://cdn.test/mix.wav", medium: "audio", cameraAudio: false, sourceOffsetMs: 100 })
    expect(a.fromMs).toBe(44_000 - AUDITION_PAD_MS - 100)
  })

  it("for audio output with no master audio, the segment's own video file's sound", () => {
    const a = auditionOfSpan(SINGLE, AUDIO, { inMs: 4000, outMs: 5000 })!
    expect(a).toMatchObject({ sourceId: "cam", medium: "audio" })
  })

  it("an explicit segment audio wins over the master audio", () => {
    const edl = normalizeEdl({ ...MULTI, segments: [{ id: "a", inMs: 30_000, outMs: 40_000, video: "cam-1", audio: "cam-1" }] })
    expect(auditionOfSpan(edl, AUDIO, { inMs: 31_000, outMs: 32_000 })).toMatchObject({ sourceId: "cam-1", medium: "audio" })
    expect(auditionOfSpan(edl, VIDEO, { inMs: 31_000, outMs: 32_000 })).toMatchObject({ sourceId: "cam-1", cameraAudio: false })
  })

  it("plays the render's wired Sources media where it replaces a source's file", () => {
    const wired = { ...VIDEO, sources: ["", "https://cdn.test/cam2-hi.mp4"] }
    expect(auditionOfSpan(MULTI, wired, { inMs: 45_000, outMs: 46_000 })?.url).toBe("https://cdn.test/cam2-hi.mp4")
    expect(auditionOfSpan(MULTI, wired, { inMs: 31_000, outMs: 32_000 })?.url).toBe("https://cdn.test/cam1.mp4")
  })

  it("is null when the look's file has no URL", () => {
    const edl = normalizeEdl({ ...SINGLE, sources: [{ id: "cam", url: "", kind: "video" }] })
    expect(auditionOfSpan(edl, VIDEO, { inMs: 4000, outMs: 5000 })).toBeNull()
  })
})

describe("the original at a word: from its start, played on", () => {
  it("starts at the instant on the source clock, with no end and no span", () => {
    const a = auditionAt(MULTI, VIDEO, 45_500)!
    expect(a).toMatchObject({ sourceId: "cam-2", fromMs: 15_500, toMs: null, span: null, sourceOffsetMs: 30_000 })
  })
})
