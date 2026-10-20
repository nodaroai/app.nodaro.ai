/**
 * Clip Pack on two or more recordings or a Master audio (decided 2026-10-17):
 * the multicam plan chain before the clips plan, Camera Switch ONCE PER CLIP
 * between the plan and the per-clip render with two or more cameras, then the
 * one-recording tail (captions per clip). Following faces: ONE Speaker Frames
 * run over the whole pack. One recording builds P2's graph byte for byte (the
 * identity fixtures cover every row), and its resolved settings carry neither
 * `cameras` nor `framingSource` unless it follows faces.
 */
import { describe, it, expect } from "vitest"
import {
  CLIP_PACK_DEFAULTS,
  MULTICAM_NODE_IDS,
  USE_CASE_CAMERAS_DEFAULTS,
  buildClipPackGraph,
  initialRunNodeIds,
  renderFinalRunSet,
  resolveClipPackSettings,
  usecaseDescriptor,
  usecaseTriesEvery,
} from "@nodaro/render-rules"
import { FAN_IN_TARGETS, defaultEdgeOutputMode, isFanInEdge } from "@nodaro/shared/nodes"

const cam = (n: number) => ({ url: `https://r2/c${n}.mp4`, kind: "video" as const, durationSec: 3600 })
const masterAudio = { url: "https://r2/m.wav", kind: "audio" as const, durationSec: 3600 }
const src = { media: cam(1), moreMedia: [cam(2)], masterAudio }
const shape = { recordings: 2, masterAudio: true }
const wires = (g: ReturnType<typeof buildClipPackGraph>) => g.edges.map((e) => `${e.source}.${e.sourceHandle}>${e.target}.${e.targetHandle}${e.data ? "(each)" : ""}`)
const typeOf = (g: ReturnType<typeof buildClipPackGraph>, id: string) => g.nodes.find((n) => n.id === id)?.type

describe("Clip Pack on two cameras + Master audio (decided 2026-10-17)", () => {
  it("Camera Switch runs once per clip (Edit Plan's clip set fans it out); each switched clip is its own render", () => {
    const g = buildClipPackGraph(resolveClipPackSettings({ framingSource: "static" }, "video", shape), src)
    expect(wires(g)).toEqual(expect.arrayContaining(["uc-plan.edl>uc-switch.edl", "uc-map.json>uc-switch.speakerMap", "uc-switch.edl>uc-render.edl", "uc-switch.transcript>uc-render.transcript"]))
    expect(g.outputMap).toMatchObject({ kind: "clips", multicam: { map: { nodeId: "uc-map", handle: "json" } } })
    // Every per-clip wire keeps its type's default: Edit Plan's clip set and Camera Switch's edl fan out; its transcript is one value.
    expect(defaultEdgeOutputMode("camera-switch", "edl")).toBe("each")
    expect(defaultEdgeOutputMode("camera-switch", "transcript")).toBe("last")
    expect(g.edges.filter((e) => e.target === "uc-switch" || e.source === "uc-switch").every((e) => e.data === undefined)).toBe(true)
  })

  it("node set: the front, Transcribe on the sound, the clips plan, Camera Switch, the render, the captions", () => {
    const g = buildClipPackGraph(resolveClipPackSettings({}, "video", shape), src)
    expect(g.nodes.map((n) => [n.id, n.type])).toEqual([
      ["uc-source", "upload-video"], ["uc-cam-2", "upload-video"], ["uc-master", "upload-audio"],
      ["uc-sync", "audio-sync"], ["uc-map", "speaker-map"],
      ["uc-transcribe", "transcribe"], ["uc-plan", "edit-plan"], ["uc-switch", "camera-switch"], ["uc-render", "speaker-view"], ["uc-captions", "add-captions"],
    ])
    expect(g.nodes.find((n) => n.id === "uc-plan")!.data).toMatchObject({
      label: "Find Clips", mode: "clips", count: 8, targetDurationSec: 60, targetAspect: "9:16",
      sourceOrder: ["uc-master", "uc-source", "uc-cam-2"],
      sourceConfig: { "uc-master": { role: "master-audio" }, "uc-source": { role: "camera" }, "uc-cam-2": { role: "camera" } },
    })
    // The render resolves each camera from the edit (no sources wire), as the Multicam Cut template's does.
    expect(wires(g).some((e) => e.endsWith(">uc-render.sources"))).toBe(false)
    expect(wires(g)).toContain("uc-render.video>uc-captions.in(each)")
    expect(g.outputMap).toMatchObject({ media: { nodeId: "uc-captions", handle: "video-out" }, preview: { nodeId: "uc-render", handle: "video" }, renderNodeId: "uc-render", planNodeId: "uc-plan" })
  })

  it("no framing: Apply EDL per clip on the switched edit and its renamed transcript", () => {
    const g = buildClipPackGraph(resolveClipPackSettings({ framing: null, captions: false }, "video", shape), src)
    expect(typeOf(g, "uc-render")).toBe("apply-edl")
    expect(g.nodes.find((n) => n.id === "uc-render")!.data).toMatchObject({ output: "video", quality: "final", crossfadeMs: 0 })
    expect(wires(g)).toEqual(expect.arrayContaining(["uc-switch.edl>uc-render.edl", "uc-switch.transcript>uc-render.transcript"]))
    expect(g.outputMap.media).toEqual({ nodeId: "uc-render", handle: "media" })
  })

  it("following faces: ONE Speaker Frames run over every switched clip (its edl wire folds the pack)", () => {
    const g = buildClipPackGraph(resolveClipPackSettings({ framingSource: "tracking" }, "video", shape), src)
    expect(wires(g)).toEqual(expect.arrayContaining(["uc-switch.edl>uc-frames.edl", "uc-switch.transcript>uc-frames.transcript", "uc-frames.tracks>uc-render.tracks"]))
    expect(FAN_IN_TARGETS["speaker-frames"]).toEqual(["edl"])
    expect(isFanInEdge("speaker-frames", "edl")).toBe(true)
  })

  it("the tracks are ONE value every clip's render reads (Speaker Frames never fans out): the pack's boxes stay one rule", () => {
    expect(defaultEdgeOutputMode("speaker-frames", "tracks")).toBe("last")
    const g = buildClipPackGraph(resolveClipPackSettings({ framingSource: "tracking" }, "video", shape), src)
    expect(g.edges.find((e) => e.source === "uc-frames" && e.target === "uc-render")!.data).toBeUndefined()
    // Every clip renders on the same automatic boxes (P2's pack rule), the tracks on top.
    expect(g.nodes.find((n) => n.id === "uc-render")!.data).toMatchObject({ autoRegions: true })
  })

  it("Render final of a reviewed pack re-runs Camera Switch on the kept clips; never Speaker Frames", () => {
    const g = buildClipPackGraph(resolveClipPackSettings({ framingSource: "tracking", reviewBeforeRender: true }, "video", shape), src)
    const set = [...renderFinalRunSet("uc-render", g.nodes, g.edges)]
    expect(set).toContain("uc-switch")
    expect(set).not.toContain("uc-frames")
    expect(initialRunNodeIds(g)).toEqual(expect.arrayContaining(["uc-switch", "uc-frames", "uc-render"]))
    expect(initialRunNodeIds(g)).not.toContain("uc-captions")
  })

  it("every clip's switch is tried: the switch joins the try-every list, last (decided 2026-10-18)", () => {
    const g = buildClipPackGraph(resolveClipPackSettings({}, "video", shape), src)
    expect(g.nodes.some((n) => n.id === MULTICAM_NODE_IDS.switch)).toBe(true)
    expect([...usecaseTriesEvery(g)]).toEqual(["uc-render", "uc-captions", "uc-switch"])
    expect(usecaseDescriptor("clip-pack").triesEvery).toEqual(["uc-render", "uc-captions", MULTICAM_NODE_IDS.switch])
  })

  it("the override reaches the switch as camera ids", () => {
    const g = buildClipPackGraph(resolveClipPackSettings({ cameras: { speakerCameras: { "1": 2, "2": 0 } } }, "video", shape), src)
    expect(g.nodes.find((n) => n.id === "uc-switch")!.data).toMatchObject({ layoutHints: false, speakerMapByOrder: { "1": "uc-cam-2", "2": "" } })
  })

  it("one camera + Master audio: Audio Sync, then the render on the plan's clips (no Speaker Map, no switch)", () => {
    const g = buildClipPackGraph(resolveClipPackSettings({}, "video", { recordings: 1, masterAudio: true }), { media: cam(1), masterAudio })
    expect(g.nodes.map((n) => n.type)).toEqual(["upload-video", "upload-audio", "audio-sync", "transcribe", "edit-plan", "speaker-view", "add-captions"])
    expect(wires(g)).toEqual(expect.arrayContaining(["uc-plan.edl>uc-render.edl", "uc-transcribe.json>uc-render.transcript"]))
    expect(g.outputMap.multicam).toEqual({ sync: { nodeId: "uc-sync", handle: "json" } })
  })

  it("already in sync, one camera + Master audio: no multicam step, and the output map names none", () => {
    const g = buildClipPackGraph(resolveClipPackSettings({ cameras: { synced: true } }, "video", { recordings: 1, masterAudio: true }), { media: cam(1), masterAudio })
    expect("multicam" in g.outputMap).toBe(false)
  })

  it("recordings that are all sound only (refused by the route; a canvas may wire them) make audio clips of the sound", () => {
    const sound = { url: "https://r2/mixer.wav", kind: "audio" as const }
    const g = buildClipPackGraph(resolveClipPackSettings({}, "audio", { recordings: 2, masterAudio: false }), { media: sound, moreMedia: [{ ...sound, url: "https://r2/b.wav" }] })
    expect(g.nodes.map((n) => n.type)).toEqual(["upload-audio", "transcribe", "edit-plan", "apply-edl"])
    expect(g.nodes.find((n) => n.id === "uc-render")!.data).toMatchObject({ output: "audio" })
  })
})

describe("one recording", () => {
  it("following faces: Speaker Frames over the plan's clip set (one run), tracks into the per-clip render", () => {
    const g = buildClipPackGraph(resolveClipPackSettings({ framingSource: "tracking" }, "video"), { media: cam(1) })
    expect(wires(g)).toEqual(expect.arrayContaining(["uc-plan.edl>uc-frames.edl", "uc-transcribe.json>uc-frames.transcript", "uc-frames.tracks>uc-render.tracks"]))
    // Appended after P2's chain: the static graph's nodes and wires come first, unchanged.
    const stat = buildClipPackGraph(resolveClipPackSettings({}, "video"), { media: cam(1) })
    expect(g.nodes.slice(0, 4)).toEqual(stat.nodes.slice(0, 4))
  })
  it("no framingSource on a saved node: the even split, P2's graph (identity)", () => {
    expect(buildClipPackGraph(resolveClipPackSettings({}, "video"), { media: cam(1) }).nodes.some((n) => n.type === "speaker-frames")).toBe(false)
    expect("framingSource" in resolveClipPackSettings({}, "video")).toBe(false)
    expect("framingSource" in resolveClipPackSettings({ framingSource: "static" }, "video")).toBe(false)
  })
  it("no framing, or an audio recording: a framing source is inert", () => {
    expect("framingSource" in resolveClipPackSettings({ framing: null, framingSource: "tracking" }, "video")).toBe(false)
    expect("framingSource" in resolveClipPackSettings({ framingSource: "tracking" }, "audio")).toBe(false)
    expect(buildClipPackGraph(resolveClipPackSettings({ framingSource: "tracking" }, "audio"), { media: { url: "https://r2/a.wav", kind: "audio" } }).nodes.some((n) => n.type === "speaker-frames")).toBe(false)
  })
  it("one recording: no `cameras` key, whatever the node holds; no multicam step and no `multicam` key", () => {
    expect("cameras" in resolveClipPackSettings({ cameras: { wide: 1 } }, "video")).toBe(false)
    expect("cameras" in resolveClipPackSettings({ cameras: { wide: 1 } }, "video", { recordings: 1, masterAudio: false })).toBe(false)
    const one = buildClipPackGraph(resolveClipPackSettings({}, "video"), { media: cam(1) })
    expect(one.nodes.some((n) => ["audio-sync", "speaker-map", "camera-switch"].includes(n.type))).toBe(false)
    expect("multicam" in one.outputMap).toBe(false)
  })
  it("several recordings: the resolved Cameras; settings that carry none build on the defaults", () => {
    expect(resolveClipPackSettings({ cameras: { wide: 2, synced: true } }, "video", shape).cameras).toEqual({ wide: 2, synced: true, speakerCameras: {} })
    expect(resolveClipPackSettings({}, "video", { recordings: 1, masterAudio: true }).cameras).toEqual(USE_CASE_CAMERAS_DEFAULTS)
    expect(buildClipPackGraph(CLIP_PACK_DEFAULTS, src).nodes.some((n) => n.type === "audio-sync")).toBe(true)
  })
  it("the descriptor forwards the shape and builds every recording it is given (the whole sources, not only the first)", () => {
    const d = usecaseDescriptor("clip-pack")
    const s = d.resolveSettings({ cameras: { wide: 2 } }, "video", { recordings: 2, masterAudio: false })
    expect(s).toMatchObject({ cameras: { wide: 2 } })
    expect(d.build(s, { media: cam(1), moreMedia: [cam(2)] }).nodes.map((n) => n.id)).toContain("uc-cam-2")
  })
})
