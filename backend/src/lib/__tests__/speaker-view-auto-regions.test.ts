import { describe, it, expect } from "vitest"
import {
  AUTO_REGIONS_MAX_SPEAKERS,
  AUTO_REGIONS_PACK_MIN_TALK_MS,
  AUTO_REGIONS_PACK_MIN_TALK_SHARE,
  speakerViewPackSpeakers,
  AUTO_REGIONS_SOURCE_ASPECT,
  autoSpeakerRegions,
  defaultSpeakerRegions,
  isDefaultSpeakerRegion,
  speakerViewAspectOf,
  speakerViewCanvas,
  speakerViewContext,
  speakerViewEstimateTier,
  speakerViewAutoFraming,
  speakerViewAutoRegions,
  speakerViewCameraSpeakers,
  speakerViewFramingNote,
  speakerViewIdleEdit,
  speakerViewOnScreen,
  speakerViewRenderBasis,
  speakerViewVideoEdit,
  speakerViewWireSettings,
} from "@nodaro/render-rules"

/** The canvas shape the region editor draws its default boxes for. */
const canvasAspect = (aspect: "16:9" | "9:16" | "1:1" | "4:5") => {
  const c = speakerViewCanvas(aspect)
  return c.width / c.height
}
const NAMES = ["A", "B", "C", "D", "E", "F", "G"]
const edl = (speakers: string[], meta?: Record<string, unknown>) => ({
  version: 1,
  sources: [{ id: "uc-source", url: "https://r2/ep.mp4", kind: "video", role: "master" }],
  segments: speakers.map((speaker, i) => ({ id: `s${i}`, sourceId: "uc-source", video: "uc-source", speaker, inMs: i * 1000, outMs: i * 1000 + 900 })),
  ...(meta ? { meta } : {}),
})

describe("autoSpeakerRegions — the region editor's default boxes, on one camera", () => {
  it("assumes a 16:9 camera and caps at six speakers", () => {
    expect(AUTO_REGIONS_SOURCE_ASPECT).toBe(16 / 9)
    expect(AUTO_REGIONS_MAX_SPEAKERS).toBe(6)
  })

  it.each([
    [2, "9:16"],
    [2, "1:1"],
    [3, "9:16"],
    [4, "9:16"],
    [6, "4:5"],
  ] as const)("%i speakers at %s: exactly defaultSpeakerRegions, on the camera", (n, aspect) => {
    const speakers = NAMES.slice(0, n)
    const got = autoSpeakerRegions(speakers, "cam", canvasAspect(aspect), 16 / 9)
    expect(got).toEqual(defaultSpeakerRegions(speakers, canvasAspect(aspect), 16 / 9).map((d) => ({ source: "cam", ...d })))
    expect(got).toHaveLength(n)
  })

  it("isDefaultSpeakerRegion recognises every box it makes", () => {
    for (const n of [2, 3, 4, 5, 6]) {
      for (const aspect of ["9:16", "1:1", "4:5", "16:9"] as const) {
        const rows = autoSpeakerRegions(NAMES.slice(0, n), "cam", canvasAspect(aspect), 16 / 9)
        rows.forEach((row, k) => expect(isDefaultSpeakerRegion(row.region, k, n, 16 / 9)).toBe(true))
      }
    }
  })

  it("one speaker, or more than six: no boxes (the full frame)", () => {
    expect(autoSpeakerRegions(["A"], "cam", canvasAspect("9:16"), 16 / 9)).toEqual([])
    expect(autoSpeakerRegions(NAMES.slice(0, 7), "cam", canvasAspect("9:16"), 16 / 9)).toEqual([])
  })

  it("boxes that would each be the whole frame (a 16:9 canvas over the 16:9 camera): none — the same picture, the same stamp", () => {
    expect(defaultSpeakerRegions(["A", "B"], canvasAspect("16:9"), 16 / 9).every((d) => d.region.w === 1 && d.region.x === 0)).toBe(true)
    expect(autoSpeakerRegions(["A", "B"], "cam", canvasAspect("16:9"), 16 / 9)).toEqual([])
  })
})

describe("speakerViewWireSettings with autoRegions", () => {
  const ctx = speakerViewContext(edl(["Host", "Guest", "Host"]))
  const twoAt916 = autoSpeakerRegions(["Host", "Guest"], "uc-source", canvasAspect("9:16"), 16 / 9)

  it("the context names the edit's video source ids", () => {
    expect(ctx!.clips[0]!.cameraIds).toEqual(["uc-source"])
  })

  it("fills the default boxes on the edit's one camera when nothing is drawn", () => {
    expect(speakerViewWireSettings({ layout: "single", targetAspect: "9:16", autoRegions: true }, ctx).speakerRegions).toEqual(twoAt916)
  })

  it("the layout does not move the boxes (the editor's defaults follow the canvas, not the slot)", () => {
    const single = speakerViewWireSettings({ layout: "single", targetAspect: "9:16", autoRegions: true }, ctx).speakerRegions
    const stacked = speakerViewWireSettings({ layout: "stacked", targetAspect: "9:16", autoRegions: true }, ctx).speakerRegions
    const sideBySide = speakerViewWireSettings({ layout: "side-by-side", targetAspect: "9:16", autoRegions: true }, ctx).speakerRegions
    expect(stacked).toEqual(single)
    expect(sideBySide).toEqual(single)
  })

  it("the canvas is the node's aspect, else the edit's — as the region editor reads it", () => {
    const square = speakerViewContext(edl(["Host", "Guest"], { targetAspect: "1:1" }))
    const data = { layout: "single", autoRegions: true }
    expect(speakerViewAspectOf(data, square)).toBe("1:1")
    expect(speakerViewWireSettings(data, square).speakerRegions).toEqual(
      autoSpeakerRegions(["Host", "Guest"], "uc-source", canvasAspect("1:1"), 16 / 9),
    )
  })

  it("drawn regions always win", () => {
    const drawn = [{ source: "uc-source", speaker: "Host", region: { x: 0.1, y: 0, w: 0.4, h: 1 } }]
    expect(speakerViewWireSettings({ layout: "single", targetAspect: "9:16", autoRegions: true, speakerRegions: drawn }, ctx).speakerRegions).toEqual(drawn)
  })

  it("off by default: no flag (or not exactly true), no boxes — byte-identical to before", () => {
    expect(speakerViewWireSettings({ layout: "single", targetAspect: "9:16" }, ctx)).not.toHaveProperty("speakerRegions")
    expect(speakerViewWireSettings({ layout: "single", targetAspect: "9:16", autoRegions: "true" }, ctx)).not.toHaveProperty("speakerRegions")
    expect(speakerViewWireSettings({ layout: "single", targetAspect: "9:16", autoRegions: true }, ctx)).not.toHaveProperty("autoRegions")
  })

  it("one speaker or more than six: nothing is filled", () => {
    const one = speakerViewContext(edl(["Host", "Host"]))
    expect(speakerViewWireSettings({ layout: "single", targetAspect: "9:16", autoRegions: true }, one)).not.toHaveProperty("speakerRegions")
    const seven = speakerViewContext(edl(NAMES.slice(0, 7)))
    expect(speakerViewWireSettings({ layout: "single", targetAspect: "9:16", autoRegions: true }, seven)).not.toHaveProperty("speakerRegions")
  })

  it("no edit known yet, or several cameras: nothing is filled", () => {
    expect(speakerViewWireSettings({ layout: "single", autoRegions: true }, undefined)).not.toHaveProperty("speakerRegions")
    const two = { ...edl(["Host", "Guest"]), sources: [...edl([]).sources, { id: "cam2", url: "https://r2/2.mp4", kind: "video" }] }
    expect(speakerViewWireSettings({ layout: "single", autoRegions: true }, speakerViewContext(two)).speakerRegions).toBeUndefined()
  })

  it("a 16:9 canvas: nothing is filled (every box would be the whole frame) — byte-identical to the flag off", () => {
    const on = speakerViewWireSettings({ layout: "single", targetAspect: "16:9", autoRegions: true }, ctx)
    expect(on).toEqual(speakerViewWireSettings({ layout: "single", targetAspect: "16:9" }, ctx))
    expect(on).not.toHaveProperty("speakerRegions")
  })

  it("one clip of several the node runs over (a list row, told by the caller) with no transcript: nothing is filled", () => {
    const row = speakerViewContext(edl(["Host", "Guest"]), undefined, { packClip: true })
    expect(row?.packClip).toBe(true)
    // A pack is dealt over the episode's transcript (decided 2026-10-14): none known, no boxes.
    expect(speakerViewWireSettings({ layout: "single", targetAspect: "9:16", autoRegions: true }, row)).not.toHaveProperty("speakerRegions")
    expect(speakerViewWireSettings({ layout: "single", targetAspect: "9:16", autoRegions: true }, speakerViewContext([edl(["A", "B"]), edl(["A", "B"])])).speakerRegions).toBeUndefined()
  })

  it("the price estimate over a clip batch judges each clip as one of several", () => {
    // Pricing reads no region today: the boxes a pack row now gets leave its tier as it was.
    const tx = { version: 1, words: [{ text: "a", startMs: 0, endMs: 300, speaker: "A" }, { text: "b", startMs: 1000, endMs: 1300, speaker: "B" }] }
    expect(speakerViewEstimateTier({ layout: "single", targetAspect: "9:16", autoRegions: true }, [edl(["A", "B"]), edl(["A", "B"])], tx))
      .toBe(speakerViewEstimateTier({ layout: "single", targetAspect: "9:16" }, [edl(["A", "B"]), edl(["A", "B"])], tx))
  })
})

describe("speakerViewFramingNote with autoRegions", () => {
  it("a speaker the automatic boxes frame is framed; one they do not is still named", () => {
    const auto = [{ source: "video", speaker: "Alex" }]
    expect(speakerViewFramingNote({ speakers: ["Alex", "Sam"], tracksWired: false, speakerRegions: [], defaultRegionKeys: [], autoRegions: auto }))
      .toBe("No framing set for Sam: the centre of the frame is used.")
    expect(speakerViewFramingNote({ speakers: ["Alex"], tracksWired: false, speakerRegions: [], defaultRegionKeys: [], autoRegions: auto })).toBeNull()
  })
})

describe("a bare video (whole-clip edit): who is on screen does not depend on the edit's length", () => {
  // The second speaker starts after the idle edit's placeholder second.
  const transcript = {
    version: 1,
    words: [
      { text: "hi", startMs: 0, endMs: 400, speaker: "A" },
      { text: "yo", startMs: 5_000, endMs: 5_400, speaker: "B" },
      { text: "so", startMs: 9_000, endMs: 9_400, speaker: "A" },
    ],
  }
  const url = "https://r2/rec.mp4"
  const data = { layout: "single", targetAspect: "9:16", autoRegions: true }
  const idle = speakerViewIdleEdit({ url, transcript, targetAspect: "9:16" })!
  const measured = speakerViewVideoEdit({ url, clip: { durationMs: 14_600, width: 3840, height: 2160 }, transcript, targetAspect: "9:16" })
  if (!measured.ok) throw new Error(measured.message)
  const run = measured.edl

  it("every transcript speaker is on the camera, in order of first speech, for the idle and the measured edit alike", () => {
    for (const edl of [idle, run]) {
      const cam = edl.sources[0]!.id
      expect(speakerViewCameraSpeakers(speakerViewOnScreen(edl, transcript, data), cam)).toEqual(["A", "B"])
    }
  })

  it("the idle readers and the run deal the same boxes and stamp the same render basis", () => {
    const idleRows = speakerViewAutoRegions(data, speakerViewContext(idle, transcript))
    const runRows = speakerViewAutoRegions(data, speakerViewContext(run, transcript))
    expect(runRows).toHaveLength(2)
    expect(idleRows).toEqual(runRows)
    expect(runRows.map((r) => r.region.x)).toEqual([0.0918, 0.5918])
    const idleWire = speakerViewWireSettings(data, speakerViewContext(idle, transcript))
    const runWire = speakerViewWireSettings(data, speakerViewContext(run, transcript))
    expect(speakerViewRenderBasis(idleWire, idle)).toBe(speakerViewRenderBasis(runWire, run))
  })
})

describe("a clip of a pack (decided 2026-10-14)", () => {
  const transcript = {
    version: 1,
    words: [
      { text: "hi", startMs: 0, endMs: 300, speaker: "speaker_0" },
      { text: "hey", startMs: 400, endMs: 700, speaker: "speaker_1" },
    ],
  }
  const CAM = { id: "cam", url: "https://r2/ep.mp4", kind: "video" }
  const clipOnlyHost = { version: 1, sources: [CAM], segments: [{ id: "s1", video: "cam", inMs: 0, outMs: 300, speaker: "speaker_0" }] }
  const clipOnlyGuest = { ...clipOnlyHost, segments: [{ id: "s1", video: "cam", inMs: 400, outMs: 700, speaker: "speaker_1" }] }
  const data = { autoRegions: true, targetAspect: "9:16", layout: "stacked" } as const

  it("gets the boxes of every speaker in the episode on its camera, first heard first — the same on every clip", () => {
    const rows = speakerViewAutoRegions(data, speakerViewContext(clipOnlyHost, transcript, { packClip: true }))
    expect(rows.map((r) => [r.source, r.speaker])).toEqual([["cam", "speaker_0"], ["cam", "speaker_1"]])
    expect(rows).toEqual(autoSpeakerRegions(["speaker_0", "speaker_1"], "cam", canvasAspect("9:16"), AUTO_REGIONS_SOURCE_ASPECT))
    expect(speakerViewAutoRegions(data, speakerViewContext(clipOnlyGuest, transcript, { packClip: true }))).toEqual(rows)
    // A single edit of the same clip still deals over who is on screen: one speaker, no box.
    expect(speakerViewAutoRegions(data, speakerViewContext(clipOnlyHost, transcript))).toEqual([])
  })

  it("the pack judged whole (the panel's view of the batch) gets the very rows each clip is sent", () => {
    const row = speakerViewAutoRegions(data, speakerViewContext(clipOnlyHost, transcript, { packClip: true }))
    expect(speakerViewAutoRegions(data, speakerViewContext([clipOnlyHost, clipOnlyGuest], transcript))).toEqual(row)
    expect(speakerViewWireSettings(data, speakerViewContext(clipOnlyGuest, transcript, { packClip: true })).speakerRegions).toEqual(row)
    // The panel's line for a pack says so; one edit keeps its own.
    expect(speakerViewAutoFraming(data, speakerViewContext([clipOnlyHost, clipOnlyGuest], transcript))).toBe("pack-boxes")
    expect(speakerViewAutoFraming(data, speakerViewContext([clipOnlyHost, clipOnlyGuest]))).toBe("off")
    expect(speakerViewAutoFraming(data, speakerViewContext({ ...clipOnlyHost, segments: [...clipOnlyHost.segments, ...clipOnlyGuest.segments] }, transcript))).toBe("boxes")
  })

  it("drawn regions still win; several cameras still get none", () => {
    expect(speakerViewAutoRegions({ ...data, speakerRegions: [{ source: "cam", speaker: "speaker_0", region: { x: 0, y: 0, w: 0.5, h: 1 } }] }, speakerViewContext(clipOnlyHost, transcript, { packClip: true }))).toEqual([])
    const twoCams = {
      ...clipOnlyHost,
      sources: [CAM, { id: "cam2", url: "https://r2/c2.mp4", kind: "video" }],
      segments: [...clipOnlyHost.segments, { id: "s2", video: "cam2", inMs: 400, outMs: 700, speaker: "speaker_1" }],
    }
    expect(speakerViewAutoRegions(data, speakerViewContext(twoCams, transcript, { packClip: true }))).toEqual([])
    // A batch whose clips show different cameras cannot be framed as one.
    const otherCam = { ...clipOnlyGuest, sources: [{ ...CAM, id: "cam2" }], segments: [{ id: "s1", video: "cam2", inMs: 400, outMs: 700, speaker: "speaker_1" }] }
    expect(speakerViewAutoRegions(data, speakerViewContext([clipOnlyHost, otherCam], transcript))).toEqual([])
  })

  it("one episode speaker, or more than six: none, as for one edit", () => {
    const solo = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 300, speaker: "speaker_0" }] }
    expect(speakerViewAutoRegions(data, speakerViewContext(clipOnlyHost, solo, { packClip: true }))).toEqual([])
    const seven = { version: 1, words: NAMES.slice(0, 7).map((speaker, i) => ({ text: "w", startMs: i * 100, endMs: i * 100 + 50, speaker })) }
    expect(speakerViewAutoRegions(data, speakerViewContext(clipOnlyHost, seven, { packClip: true }))).toEqual([])
  })
})

describe("a pack's boxes ignore stray speaker labels (decided 2026-10-18)", () => {
  const MIN = 60_000
  /** One word per [speaker, startMs, lengthMs]. */
  const tx = (...words: Array<[string, number, number]>) => ({ version: 1, words: words.map(([speaker, startMs, ms]) => ({ text: "w", startMs, endMs: startMs + ms, speaker })) })
  const CAM = { id: "cam", url: "https://r2/ep.mp4", kind: "video" }
  const clip = { version: 1, sources: [CAM], segments: [{ id: "s1", video: "cam", inMs: 0, outMs: 5_000, speaker: "speaker_0" }] }
  const data = { autoRegions: true, targetAspect: "9:16", layout: "single" } as const

  it("the floor: 10 s, or 5% of the episode's talk", () => {
    expect(AUTO_REGIONS_PACK_MIN_TALK_MS).toBe(10_000)
    expect(AUTO_REGIONS_PACK_MIN_TALK_SHARE).toBe(0.05)
  })

  it("a two-person pack with a one-word speaker_2 gets halves, not thirds", () => {
    const t = tx(["speaker_0", 0, MIN], ["speaker_2", MIN, 300], ["speaker_1", MIN + 1_000, MIN])
    expect(speakerViewPackSpeakers(t)).toEqual(["speaker_0", "speaker_1"])
    const rows = speakerViewAutoRegions(data, speakerViewContext(clip, t, { packClip: true }))
    expect(rows.map((r) => r.speaker)).toEqual(["speaker_0", "speaker_1"])
    expect(rows).toEqual(autoSpeakerRegions(["speaker_0", "speaker_1"], "cam", canvasAspect("9:16"), AUTO_REGIONS_SOURCE_ASPECT))
    // One edit is not filtered: its boxes go to whoever is on screen.
    const both = { ...clip, segments: [...clip.segments, { id: "s2", video: "cam", inMs: MIN, outMs: MIN + 300, speaker: "speaker_2" }] }
    expect(speakerViewAutoRegions(data, speakerViewContext(both, t)).map((r) => r.speaker)).toEqual(["speaker_0", "speaker_2"])
  })

  it("a real guest with 5 minutes in a 3-hour episode still gets a box (over 10 s, though under 5%)", () => {
    const t = tx(["host", 0, 175 * MIN], ["guest", 175 * MIN, 5 * MIN], ["cough", 180 * MIN, 8_000])
    expect(speakerViewPackSpeakers(t)).toEqual(["host", "guest"])
  })

  it("a short episode: under 10 s counts when it is 5% of the talk", () => {
    expect(speakerViewPackSpeakers(tx(["a", 0, 8_000], ["b", 8_000, 1_000], ["c", 9_000, 300]))).toEqual(["a", "b"])
  })

  it("only one speaker really talks: no boxes", () => {
    const t = tx(["speaker_0", 0, MIN], ["speaker_1", MIN, 300])
    expect(speakerViewAutoRegions(data, speakerViewContext(clip, t, { packClip: true }))).toEqual([])
  })

  it("no talk at all (every word zero-length): no one has a share, so no one counts", () => {
    expect(speakerViewPackSpeakers(tx(["speaker_0", 0, 0], ["speaker_1", 100, 0], ["speaker_2", 200, 0]))).toEqual([])
  })
})
