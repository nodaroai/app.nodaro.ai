/**
 * Speaker Layout's built chain (decided 2026-10-17): the whole recording,
 * framed by speaker, the same length — no plan, no cut. One recording is
 * Speaker View's video mode on it; two or more recordings (or a Master audio)
 * are Speaker Map's whole-recording edit, through Camera Switch with two or
 * more cameras, into Speaker View.
 */
import { describe, it, expect } from "vitest"
import {
  SPEAKER_LAYOUT_DEFAULTS,
  SPEAKER_LAYOUT_NODE_IDS as ID,
  USE_CASE_SPECS,
  buildSpeakerLayoutGraph,
  initialRunNodeIds,
  isStoredInlineGraph,
  renderFinalRunSet,
  resolveSpeakerLayoutSettings,
  speakerViewAutoSpeakers,
  speakerViewContext,
  speakerViewVideoEdit,
  speakerViewWireSettings,
  toStoredInlineGraph,
  usecaseAutoFraming,
  usecaseDescriptor,
  usecasePlanNodeId,
  usecaseRenderNodeId,
  usecaseTypeOfBuilder,
  validSpeakerSwitches,
} from "@nodaro/render-rules"

const video = { url: "https://r2/ep.mp4", kind: "video" as const, durationSec: 3600 }
const wires = (g: ReturnType<typeof buildSpeakerLayoutGraph>) => g.edges.map((e) => `${e.source}.${e.sourceHandle}>${e.target}.${e.targetHandle}`)

describe("Speaker Layout (decided 2026-10-17)", () => {
  it("defaults: 9:16, stacked, cut, scale; framing source auto, resolved; review off", () => {
    expect(SPEAKER_LAYOUT_DEFAULTS).toMatchObject({ targetAspect: "9:16", layout: "stacked", switchType: "cut", emphasisStyle: "scale", reviewBeforeRender: false })
    // Read through its descriptor, an absent framing source is the spec's absent default: auto (decided 2026-10-20).
    const d = usecaseDescriptor(usecaseTypeOfBuilder("speakerLayout"))
    expect(d.absentFramingSource).toBe("auto")
    expect((d.resolveSettings({}, "video") as { framingSource?: string }).framingSource).toBe(usecaseAutoFraming())
    expect((d.resolveSettings(undefined, "video") as { framingSource?: string }).framingSource).toBe(usecaseAutoFraming())
    expect((d.resolveSettings({ framingSource: "auto" }, "video") as { framingSource?: string }).framingSource).toBe(usecaseAutoFraming())
    expect((d.resolveSettings({ framingSource: "static" }, "video") as { framingSource?: string }).framingSource).toBe("static")
  })

  it("the default switch is the first one Speaker View's rule allows for the default layout (decided 2026-10-20: never a greyed choice)", () => {
    const D = SPEAKER_LAYOUT_DEFAULTS
    const drawn = resolveSpeakerLayoutSettings({}, "video")
    expect(drawn.layout).toBe(D.layout)
    const first = validSpeakerSwitches({ targetAspect: D.targetAspect, layout: D.layout }).find((o) => o.allowed)
    expect(D.switchType).toBe(first?.id)
    expect(drawn.switchType).toBe(D.switchType)
  })

  it("a new node: it always carries its Cameras settings and its framing source (nothing omitted)", () => {
    const s = resolveSpeakerLayoutSettings({ framingSource: "static" }, "video")
    expect(s).toHaveProperty("cameras")
    expect(s.framingSource).toBe("static")
  })

  it("one recording, even split: Speaker View's video mode on the recording, automatic boxes, the transcript wired", () => {
    const g = buildSpeakerLayoutGraph(resolveSpeakerLayoutSettings({ framingSource: "static" }, "video"), { media: video })
    expect(g.nodes.map((n) => [n.id, n.type])).toEqual([[ID.source, "upload-video"], [ID.transcribe, "transcribe"], [ID.render, "speaker-view"]])
    expect(g.nodes.find((n) => n.id === ID.render)!.data).toMatchObject({ quality: "final", targetAspect: "9:16", layout: "stacked", switchType: "cut", emphasisStyle: "scale", autoRegions: true, autoRegionsTalkFloor: true })
    expect(wires(g)).toEqual([`${ID.source}.video>${ID.transcribe}.audio`, `${ID.source}.video>${ID.render}.video`, `${ID.transcribe}.json>${ID.render}.transcript`])
    expect(g.outputMap).toEqual({ kind: "layout", media: { nodeId: ID.render, handle: "video" }, preview: { nodeId: ID.render, handle: "video" }, json: { nodeId: ID.render, handle: "json" }, transcript: { nodeId: ID.render, handle: "transcript" }, renderNodeId: ID.render })
    expect(usecasePlanNodeId(g.outputMap)).toBeNull()
    expect(usecaseRenderNodeId(g.outputMap)).toBe(ID.render)
  })

  it("one recording, following faces: Speaker Frames on the video, its tracks into Speaker View", () => {
    const g = buildSpeakerLayoutGraph(resolveSpeakerLayoutSettings({ framingSource: "tracking" }, "video"), { media: video })
    expect(wires(g)).toEqual(expect.arrayContaining([`${ID.source}.video>uc-frames.video`, `${ID.transcribe}.json>uc-frames.transcript`, `uc-frames.tracks>${ID.render}.tracks`]))
  })

  it("three cameras + Master audio: Speaker Map's whole-recording edit → Camera Switch → Speaker View", () => {
    const cam = (n: number) => ({ url: `https://r2/c${n}.mp4`, kind: "video" as const, durationSec: 3600 })
    const g = buildSpeakerLayoutGraph(
      resolveSpeakerLayoutSettings({ framingSource: "static", cameras: { wide: 3 } }, "video", { recordings: 3, masterAudio: true }),
      { media: cam(1), moreMedia: [cam(2), cam(3)], masterAudio: { url: "https://r2/m.wav", kind: "audio", durationSec: 3600 } },
    )
    expect(wires(g)).toEqual(expect.arrayContaining([
      "uc-master.audio>uc-transcribe.audio", "uc-map.edl>uc-switch.edl", "uc-transcribe.json>uc-switch.transcript", "uc-map.json>uc-switch.speakerMap",
      "uc-switch.edl>uc-render.edl", "uc-switch.transcript>uc-render.transcript",
    ]))
    expect(g.nodes.some((n) => n.type === "edit-plan")).toBe(false)
    expect(g.outputMap).toMatchObject({ kind: "layout", multicam: { sync: { nodeId: "uc-sync", handle: "json" }, map: { nodeId: "uc-map", handle: "json" } } })
  })

  it("one camera + Master audio: Speaker Map still makes the edit (no Camera Switch); Speaker View reads it", () => {
    const g = buildSpeakerLayoutGraph(resolveSpeakerLayoutSettings({ framingSource: "static" }, "video", { recordings: 1, masterAudio: true }), { media: video, masterAudio: { url: "https://r2/m.wav", kind: "audio" } })
    expect(g.nodes.some((n) => n.type === "camera-switch")).toBe(false)
    expect(wires(g)).toEqual(expect.arrayContaining(["uc-map.edl>uc-render.edl", "uc-transcribe.json>uc-render.transcript"]))
  })

  it("several recordings, following faces: Speaker Frames on the edit the render reads", () => {
    const cam = (n: number) => ({ url: `https://r2/c${n}.mp4`, kind: "video" as const })
    const g = buildSpeakerLayoutGraph(resolveSpeakerLayoutSettings({ framingSource: "tracking" }, "video", { recordings: 2, masterAudio: false }), { media: cam(1), moreMedia: [cam(2)] })
    expect(wires(g)).toEqual(expect.arrayContaining(["uc-switch.edl>uc-frames.edl", "uc-switch.transcript>uc-frames.transcript", `uc-frames.tracks>${ID.render}.tracks`]))
  })

  it("review on: the first run ends at the proxy render", () => {
    const g = buildSpeakerLayoutGraph(resolveSpeakerLayoutSettings({ reviewBeforeRender: true, framingSource: "static" }, "video"), { media: video })
    expect(g.nodes.find((n) => n.id === ID.render)!.data).toMatchObject({ quality: "proxy" })
    expect(initialRunNodeIds(g)).toEqual([ID.source, ID.transcribe, ID.render])
  })

  it("review on, several recordings: a Render final runs the render alone (the edit is read at rest, never re-run or re-charged)", () => {
    const cam = (n: number) => ({ url: `https://r2/c${n}.mp4`, kind: "video" as const })
    const cases = [
      { shape: { recordings: 2, masterAudio: false }, sources: { media: cam(1), moreMedia: [cam(2)] } },
      { shape: { recordings: 1, masterAudio: true }, sources: { media: cam(1), masterAudio: { url: "https://r2/m.wav", kind: "audio" as const } } },
    ]
    for (const { shape, sources } of cases) {
      for (const framingSource of ["static", "tracking"]) {
        const g = buildSpeakerLayoutGraph(resolveSpeakerLayoutSettings({ reviewBeforeRender: true, framingSource }, "video", shape), sources)
        expect([...renderFinalRunSet(g.outputMap.renderNodeId, g.nodes, g.edges)], JSON.stringify({ shape, framingSource })).toEqual([ID.render])
      }
    }
  })

  it("a layout the aspect does not draw is snapped as Speaker View snaps it; an unknown switch or emphasis falls back", () => {
    const s = resolveSpeakerLayoutSettings({ targetAspect: "9:16", layout: "side-by-side", switchType: "warp", emphasisStyle: "glow" }, "video")
    expect(s.layout).not.toBe("side-by-side")
    expect(s).toMatchObject({ switchType: SPEAKER_LAYOUT_DEFAULTS.switchType, emphasisStyle: "scale" })
  })

  it("the snapshot of a layout run is a stored use-case graph (its map has no plan)", () => {
    const settings = resolveSpeakerLayoutSettings({ framingSource: "static" }, "video")
    expect(isStoredInlineGraph(toStoredInlineGraph(buildSpeakerLayoutGraph(settings, { media: video }), settings))).toBe(true)
    const cam = (n: number) => ({ url: `https://r2/c${n}.mp4`, kind: "video" as const })
    const multi = resolveSpeakerLayoutSettings({}, "video", { recordings: 2, masterAudio: false })
    expect(isStoredInlineGraph(toStoredInlineGraph(buildSpeakerLayoutGraph(multi, { media: cam(1), moreMedia: [cam(2)] }), multi))).toBe(true)
  })

  it("the graph's type is read from its builder key, never a constant", () => {
    expect(buildSpeakerLayoutGraph(resolveSpeakerLayoutSettings({}, "video"), { media: video }).nodeType).toBe(usecaseTypeOfBuilder("speakerLayout"))
  })

  it("its spec: up to six recordings, a video needed, a whole-clip render, the clock's length, no list", () => {
    const d = usecaseDescriptor(usecaseTypeOfBuilder("speakerLayout"))
    expect(d).toMatchObject({ needsVideo: true, maxRecordings: 6, resultKind: "layout", wholeClipRender: true, outputLength: { kind: "clock" } })
    expect(d.triesEvery).toBeUndefined()
    expect(USE_CASE_SPECS.speakerLayout.settingKeys).toEqual(["targetAspect", "layout", "switchType", "emphasisStyle", "framingSource", "reviewBeforeRender", "cameras"])
  })
})

describe("Speaker Layout's boxes skip stray voices (decided 2026-10-18)", () => {
  // host and guest talk for minutes; "speaker_2" (a stray diarizer label) has 2 s in all
  const words = [
    ...Array.from({ length: 200 }, (_, i) => ({ text: "h", startMs: i * 2000, endMs: i * 2000 + 900, speaker: "speaker_0" })),
    ...Array.from({ length: 200 }, (_, i) => ({ text: "g", startMs: i * 2000 + 1000, endMs: i * 2000 + 1900, speaker: "speaker_1" })),
    { text: "x", startMs: 401_000, endMs: 403_000, speaker: "speaker_2" },
  ].sort((a, b) => a.startMs - b.startMs)
  const transcript = { version: 1, words }
  // The edit a run of Speaker View's video mode cuts from the recording (the real video-mode builder).
  const measured = speakerViewVideoEdit({ url: video.url, clip: { durationMs: 404_000, width: 1920, height: 1080 }, transcript, targetAspect: "9:16" })
  if (!measured.ok) throw new Error(measured.message)
  const ctx = speakerViewContext(measured.edl, transcript)
  const g = buildSpeakerLayoutGraph(resolveSpeakerLayoutSettings({ framingSource: "static" }, "video"), { media: video })
  const data = g.nodes.find((n) => n.id === ID.render)!.data as Record<string, unknown>

  it("the render asks for the talk-time floor; a speaker under it gets no box of their own", () => {
    expect(data.autoRegionsTalkFloor).toBe(true)
    expect(speakerViewAutoSpeakers(data as never, ctx)?.speakers).toEqual(["speaker_0", "speaker_1"])
    // Tighten and every other Speaker View: unchanged.
    expect(speakerViewAutoSpeakers({ ...data, autoRegionsTalkFloor: undefined } as never, ctx)?.speakers).toEqual(["speaker_0", "speaker_1", "speaker_2"])
  })

  it("the wire carries boxes for the two real speakers only, and never the flag itself", () => {
    const wire = speakerViewWireSettings(data as never, ctx) as Record<string, unknown>
    expect((wire.speakerRegions as Array<{ speaker: string }>).map((r) => r.speaker)).toEqual(["speaker_0", "speaker_1"])
    expect(wire).not.toHaveProperty("autoRegionsTalkFloor")
    expect(wire).not.toHaveProperty("autoRegions")
  })
})
