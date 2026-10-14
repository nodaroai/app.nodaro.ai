import { describe, it, expect } from "vitest"
import {
  AUTO_REGIONS_MAX_SPEAKERS,
  AUTO_REGIONS_SOURCE_ASPECT,
  autoSpeakerRegions,
  defaultSpeakerRegions,
  isDefaultSpeakerRegion,
  speakerViewAspectOf,
  speakerViewCanvas,
  speakerViewContext,
  speakerViewEstimateTier,
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

  it("one clip of several the node runs over (a list row, told by the caller): nothing is filled", () => {
    const row = speakerViewContext(edl(["Host", "Guest"]), undefined, { packClip: true })
    expect(row?.packClip).toBe(true)
    expect(speakerViewWireSettings({ layout: "single", targetAspect: "9:16", autoRegions: true }, row)).not.toHaveProperty("speakerRegions")
    // The pack judged whole (the panel's view of it) fills nothing either.
    expect(speakerViewWireSettings({ layout: "single", targetAspect: "9:16", autoRegions: true }, speakerViewContext([edl(["A", "B"]), edl(["A", "B"])])).speakerRegions).toBeUndefined()
  })

  it("the price estimate over a clip batch judges each clip as one of several", () => {
    // Pricing reads no region today; the funnel still gets the marker, so a
    // future region-priced tier cannot see boxes the run never draws.
    expect(speakerViewEstimateTier({ layout: "single", targetAspect: "9:16", autoRegions: true }, [edl(["A", "B"]), edl(["A", "B"])]))
      .toBe(speakerViewEstimateTier({ layout: "single", targetAspect: "9:16" }, [edl(["A", "B"]), edl(["A", "B"])]))
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
