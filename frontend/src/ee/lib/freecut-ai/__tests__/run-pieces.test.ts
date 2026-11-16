import { describe, expect, it } from "vitest"
import { findBeat, startOnBeat } from "../beat"
import { coverTransform, followPath, formatOps, mainFaces, pathAt, phoneFraming, speakerAt } from "../crop-path"
import { readTimelineView, type TimedWord } from "../edit-plan"
import { brollCount, brollShots, motionOps } from "../run/broll"
import type { RunContext } from "../run/context"
import { sentencesOf, spaced } from "../run/creative"
import { cutSteps, joinCuts, speechCuts, type CutRange } from "../run/cut"
import { MUSIC_VOLUME_DB, duckOps } from "../run/music"
import { pictureShotsNow, pictureSpan, pictureSpans, playheadSecond } from "../run/picture"

const w = (text: string, start: number, end: number, speaker?: string): TimedWord => ({ text, start, end, ...(speaker ? { speaker } : {}) })

describe("the phone crop", () => {
  it("knows who speaks at a moment, from the words around it", () => {
    const words = [w("Hi", 0, 0.5, "A"), w("there", 0.6, 1, "A"), w("Yes", 3, 3.4, "B")]
    expect(speakerAt(words, 0.8)).toBe("A")
    expect(speakerAt(words, 1.6)).toBe("A")
    expect(speakerAt(words, 3.2)).toBe("B")
    expect(speakerAt(words, 2.5)).toBeUndefined()
  })

  it("frames whoever speaks, and the biggest face when the tracks name nobody", () => {
    const set = {
      sources: [
        {
          tracks: [
            { speaker: "A", boxes: [{ ms: 0, x: 0.1, y: 0.2, w: 0.1, h: 0.2 }, { ms: 500, x: 0.1, y: 0.2, w: 0.1, h: 0.2 }] },
            { speaker: "B", boxes: [{ ms: 0, x: 0.7, y: 0.2, w: 0.2, h: 0.3 }, { ms: 500, x: 0.7, y: 0.2, w: 0.2, h: 0.3 }] },
          ],
        },
      ],
    }
    for (const f of mainFaces(set, () => "A")) expect(f.cx).toBeCloseTo(0.15)
    for (const f of mainFaces(set)) expect(f.cx).toBeCloseTo(0.8)
  })

  it("holds still while the face stays near, glides no faster than it may, and cuts to a new person", () => {
    const path = followPath([
      { t: 0, cx: 0.5, w: 0.2 },
      { t: 0.5, cx: 0.53, w: 0.2 }, // within the dead zone: the crop holds
      { t: 1, cx: 0.7, w: 0.2 }, // a glide: just enough to bring the face back inside the dead zone
      { t: 1.5, cx: 0.1, w: 0.2 }, // another person: a cut
    ])
    expect(path[1]).toEqual({ t: 0.5, cx: 0.5 })
    expect(path[2]!.cx).toBeCloseTo(0.64)
    expect(path[3]).toEqual({ t: 1.5, cx: 0.1, cut: true })
    expect(pathAt(path, 0.75)).toBeCloseTo(0.57)
    expect(pathAt(path, 9)).toBe(0.1)
    expect(pathAt([], 3)).toBe(0.5)
  })

  it("fills the phone canvas with the picture, centered on the face as far as the picture reaches", () => {
    const source = { width: 1920, height: 1080 }
    const phone = { width: 1080, height: 1920 }
    expect(coverTransform(source, phone, 0.5)).toEqual({ x: 0, y: 0, width: 3413, height: 1920 })
    // A face at the right edge: the crop stops at the edge of the picture, never past it.
    expect(coverTransform(source, phone, 1).x).toBe(-1166)
    expect(coverTransform(source, phone, 0).x).toBe(1166)
    expect(coverTransform(source, source)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  })

  it("puts the edit into 9:16 with the crop moving with the face, and back to wide", () => {
    const timeline = readTimelineView({
      fps: 30,
      durationInFrames: 300,
      items: [
        { id: "v1", type: "video", trackId: "t", from: 0, durationInFrames: 300, mediaId: "m", sourceStart: 0, sourceEnd: 300, sourceFps: 30 },
        { id: "b1", type: "image", trackId: "t2", from: 30, durationInFrames: 60, mediaId: "img" },
      ],
      media: [{ id: "img", width: 1024, height: 1024 }],
    })!
    const framing = phoneFraming("m", { width: 1920, height: 1080 }, { width: 1920, height: 1080 }, [
      { t: 0, cx: 0.5 },
      { t: 4, cx: 0.6 },
      { t: 6, cx: 0.2, cut: true },
    ])
    const phone = formatOps(timeline, framing, "phone")
    expect(phone[0]).toEqual({ op: "setCanvas", width: 1080, height: 1920 })
    const keys = phone.filter((o) => o.op === "addKeyframe" && o.itemId === "v1")
    expect(keys.map((k) => [k.frame, k.easing])).toEqual([
      [0, "ease-in-out"],
      [120, "ease-in-out"],
      [179, "hold"],
      [180, "ease-in-out"],
    ])
    // The old frame's moves go first; the b-roll fills the new canvas too.
    expect(phone.filter((o) => o.op === "removeKeyframes" && o.itemId === "v1").map((o) => o.property)).toEqual(["x", "width", "height"])
    expect(phone.find((o) => o.op === "setTransform" && o.id === "b1")).toMatchObject({ transform: { width: 1920, height: 1920 } })

    const wide = formatOps(timeline, framing, "wide")
    expect(wide[0]).toEqual({ op: "setCanvas", width: 1920, height: 1080 })
    expect(wide.some((o) => o.op === "addKeyframe")).toBe(false)
    expect(wide.find((o) => o.op === "setTransform" && o.id === "v1")).toMatchObject({ transform: { x: 0, width: 1920, height: 1080 } })
  })
})

describe("the beat", () => {
  // A click every half second (120 BPM), the first at 0.25 s, over 12 seconds.
  const rate = 22050
  const clicks = (bpm: number, offset: number, seconds: number) => {
    const samples = new Float32Array(rate * seconds)
    for (let t = offset; t < seconds; t += 60 / bpm) {
      const at = Math.round(t * rate)
      for (let i = 0; i < 400 && at + i < samples.length; i++) samples[at + i] = Math.sin(i / 3) * Math.exp(-i / 120)
    }
    return samples
  }

  // How far a time is from the nearest click of a grid.
  const offBeat = (t: number, first: number, period: number) => {
    const phase = (((t - first) % period) + period) % period
    return Math.min(phase, period - phase)
  }

  it("finds the tempo and where the beats fall", () => {
    const grid = findBeat(clicks(120, 0.25, 12), rate)!
    expect(grid.bpm).toBeGreaterThan(116)
    expect(grid.bpm).toBeLessThan(124)
    expect(Math.abs((grid.beats[1]! - grid.beats[0]!) - 0.5)).toBeLessThan(0.03)
    // The grid lies on the clicks (within a hop or so of the envelope).
    for (const b of grid.beats.filter((x) => x < 6)) expect(offBeat(b, 0.25, 0.5)).toBeLessThan(0.04)
  })

  it("stays on the beat to the end of a long track, whatever its tempo", () => {
    const period = 60 / 123
    const grid = findBeat(clicks(123, 0.1, 180), rate)!
    expect(grid.bpm).toBeCloseTo(123, 0)
    for (const b of grid.beats.filter((x) => x > 170)) expect(offBeat(b, 0.1, period)).toBeLessThan(0.05)
  })

  it("has no beat for silence, or for too little sound", () => {
    expect(findBeat(new Float32Array(rate * 12), rate)).toBeNull()
    expect(findBeat(clicks(120, 0, 2), rate)).toBeNull()
  })

  it("starts the music so a beat lands on the first word", () => {
    const grid = { bpm: 120, beats: [0.2, 0.7, 1.2, 1.7] }
    expect(startOnBeat(grid, 1)).toBeCloseTo(0.2)
    expect(startOnBeat(grid, 0)).toBeCloseTo(0.2)
  })
})

describe("the Cutter", () => {
  const words = [w("So", 1, 1.3), w("um,", 2.5, 2.8), w("the", 4, 4.2), w("plan.", 4.3, 4.8)]

  it("cuts the ums, and with them gone the silence around each is one pause", () => {
    const cuts = speechCuts(words, "en", 8, { pauses: true, fillers: true, fillersGone: true })
    expect(cuts.filter((c) => c.kind === "filler").map((c) => c.words)).toEqual(["um"])
    const pauses = cuts.filter((c) => c.kind === "pause").map((c) => [Math.round(c.start * 100) / 100, Math.round(c.end * 100) / 100])
    expect(pauses).toEqual([
      [0, 0.88],
      [1.42, 3.88],
      [4.92, 8],
    ])
  })

  it("joins overlapping cuts, named by the strongest reason among them", () => {
    const cuts: CutRange[] = [
      { start: 1, end: 2, kind: "pause" },
      { start: 1.5, end: 2.5, kind: "filler", words: "um" },
      { start: 5, end: 6, kind: "pause" },
    ]
    expect(joinCuts(cuts)).toEqual([
      { start: 1, end: 2.5, kind: "filler", words: "um" },
      { start: 5, end: 6, kind: "pause" },
    ])
  })

  it("shows the first cuts one at a time, and never more than 10 steps (undo entries) however long the video", () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ start: i, end: i + 0.5, kind: "pause" as const }))
    const steps = cutSteps(many)
    expect(steps.slice(0, 4).every((s) => s.length === 1)).toBe(true)
    expect(steps.length).toBeLessThanOrEqual(10)
    expect(steps.flat()).toHaveLength(300)
    expect(cutSteps(many.slice(0, 3))).toHaveLength(3)
  })

  it("reads the words as sentences, broken at their ends and at long pauses", () => {
    const sentences = sentencesOf([w("Hello", 0, 0.4), w("there.", 0.5, 0.9), w("Next", 1, 1.3), w("part", 3, 3.4)])
    expect(sentences.map((s) => s.text)).toEqual(["Hello there.", "Next", "part"])
    expect(sentences[0]).toMatchObject({ index: 0, start: 0, end: 0.9 })
  })
})

describe("the picture change and the b-roll", () => {
  const timeline = readTimelineView({
    fps: 30,
    durationInFrames: 300,
    items: [
      { id: "a", type: "video", trackId: "t", from: 0, durationInFrames: 60, mediaId: "m", sourceStart: 0, sourceEnd: 60, sourceFps: 30 },
      { id: "b", type: "video", trackId: "t", from: 60, durationInFrames: 240, mediaId: "m", sourceStart: 150, sourceEnd: 390, sourceFps: 30 },
    ],
  })!

  it("reads the media second under the playhead, after the cuts", () => {
    expect(playheadSecond(timeline, "m", 30)).toBe(1)
    expect(playheadSecond(timeline, "m", 90)).toBe(6)
    expect(playheadSecond(timeline, "m", undefined)).toBe(0)
  })

  it("changes the shot at the playhead, inside what the edit keeps, at most ten seconds and at least two", () => {
    expect(pictureSpan(60, [], 5)).toEqual({ start: 5, end: 15 })
    // A cut at 8–9 s: the span stays on the playhead's side of it.
    expect(pictureSpan(60, [{ start: 8, end: 9 }], 5)).toEqual({ start: 5, end: 8 })
    // Too little kept at the playhead: the next stretch long enough.
    expect(pictureSpan(60, [{ start: 1, end: 20 }], 0.5)).toEqual({ start: 20, end: 30 })
    // Close to the end of a stretch, it starts early enough to last two seconds.
    expect(pictureSpan(60, [{ start: 6, end: 20 }], 5.5)).toEqual({ start: 4, end: 6 })
    // Near the end of a stretch, it starts early enough to last two seconds.
    expect(pictureSpan(10, [], 9.5)).toEqual({ start: 8, end: 10 })
    expect(pictureSpan(1.5, [], 0)).toBeNull()
  })
  it("changes several shots in a row: one after the other from the playhead, never across a cut, never the same seconds twice", () => {
    expect(pictureSpans(35, [], 5, 6)).toEqual([
      { start: 5, end: 15 },
      { start: 15, end: 25 },
      { start: 25, end: 35 },
    ])
    // Asked for fewer than fit.
    expect(pictureSpans(60, [], 0, 2)).toEqual([
      { start: 0, end: 10 },
      { start: 10, end: 20 },
    ])
    // A cut at 12-14 s ends a shot early; the next starts after the cut.
    expect(pictureSpans(30, [{ start: 12, end: 14 }], 0, 6)).toEqual([
      { start: 0, end: 10 },
      { start: 10, end: 12 },
      { start: 14, end: 24 },
      { start: 24, end: 30 },
    ])
    // One second left at the end is too little for a shot of its own: it is not changed twice.
    expect(pictureSpans(21, [], 0, 6)).toEqual([
      { start: 0, end: 10 },
      { start: 10, end: 20 },
    ])
    expect(pictureSpans(1.5, [], 0, 3)).toEqual([])
  })

  it("says before a run which seconds would change: the shots from the playhead, in the video under it", () => {
    const view = { fps: 30, durationInFrames: 900, currentFrame: 150, media: [{ id: "m", duration: 30 }], items: [{ id: "a", type: "video", trackId: "v", from: 0, durationInFrames: 900, mediaId: "m", sourceStart: 0, sourceFps: 30 }] }
    expect(pictureShotsNow(view, 7)).toEqual([
      { start: 5, end: 15 },
      { start: 15, end: 25 },
      { start: 25, end: 30 },
    ])
    expect(pictureShotsNow({ ...view, items: [] }, 7)).toEqual([])
  })

  it("makes four pictures for half a minute and eight for a minute, at most twenty unless the person asks", () => {
    expect(brollShots(30)).toBe(4)
    expect(brollShots(60)).toBe(8)
    expect(brollShots(8)).toBe(2)
    expect(brollShots(3600)).toBe(20)
    expect(brollCount(60, null)).toBe(8)
    expect(brollCount(60, 3)).toBe(3)
    expect(brollCount(60, 500)).toBe(40)
    expect(brollCount(60, 0)).toBe(1)
  })

  it("keeps pictures at least two seconds apart, each until its sentence ends or the next one comes", () => {
    const sentence = { index: 1, start: 10, end: 22, text: "x" }
    const out = spaced([{ sentence, start: 18 }, { sentence, start: 10.5 }, { sentence, start: 11 }, { sentence, start: 14 }])
    expect(out.map((p) => [p.start, p.until])).toEqual([[10.5, 14], [14, 18], [18, 22]])
  })

  it("moves each cutaway a little: a push in, or a pan", () => {
    const base = { x: 0, y: 0, width: 1920, height: 1080 }
    expect(motionOps("i", base, "push", 60).map((k) => [k.property, k.frame, k.value])).toEqual([
      ["width", 0, 1920],
      ["height", 0, 1080],
      ["width", 60, 2112],
      ["height", 60, 1188],
    ])
    const pan = motionOps("i", base, "panLeft", 60).filter((k) => k.property === "x").map((k) => k.value)
    expect(pan).toEqual([77, -77])
  })
})

describe("the music under the voice", () => {
  const timeline = readTimelineView({
    fps: 30,
    durationInFrames: 600,
    items: [{ id: "v", type: "video", trackId: "t", from: 0, durationInFrames: 600, mediaId: "m", sourceStart: 0, sourceEnd: 600, sourceFps: 30 }],
  })!
  const ctx = { fps: 30, timeline, mediaId: "m" } as unknown as RunContext

  it("lowers the music while someone speaks and brings it up in the gaps", () => {
    const ops = duckOps(ctx, "music", 0, [w("a", 2, 2.5), w("b", 2.8, 3.2), w("c", 10, 11)])
    const keys = ops.map((k) => [k.frame, k.value])
    // Open at the start; the first two words share one duck (their gap is short), the third its own.
    expect(keys[0]).toEqual([0, -8])
    expect(keys.filter(([, v]) => v === MUSIC_VOLUME_DB)).toHaveLength(4)
    expect(keys.slice(1, 5)).toEqual([
      [49, -8],
      [60, MUSIC_VOLUME_DB],
      [96, MUSIC_VOLUME_DB],
      [107, -8],
    ])
  })

  it("places the keyframes relative to where the music starts", () => {
    const ops = duckOps(ctx, "music", 30, [w("a", 2, 2.5)])
    expect(ops.map((k) => k.frame)).toEqual([0, 19, 30, 45, 56])
  })

  it("never writes more keyframes than the editor takes, however much is said", () => {
    const many = Array.from({ length: 200 }, (_, i) => w("x", i * 3, i * 3 + 0.5))
    expect(duckOps({ ...ctx, timeline: { ...timeline, durationInFrames: 20_000, items: [{ ...timeline.items[0]!, durationInFrames: 20_000, sourceEnd: 20_000 }] } } as unknown as RunContext, "music", 0, many).length).toBeLessThanOrEqual(80)
  })
})
