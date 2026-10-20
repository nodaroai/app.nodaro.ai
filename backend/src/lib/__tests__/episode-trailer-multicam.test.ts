/**
 * Trailer on two or more recordings or a Master audio (decided 2026-10-17):
 * the multicam front before the trailer plan, Camera Switch between the plan
 * and the render with two or more cameras, then the one-recording tail (intro
 * card, one Social Media Format per format) unchanged. One recording builds
 * P2's graph byte for byte (the identity fixtures cover every row), and its
 * resolved settings carry no `cameras` (a setting equal to the behaviour
 * before multicam is omitted).
 */
import { describe, it, expect } from "vitest"
import {
  EPISODE_TRAILER_DEFAULTS,
  USE_CASE_CAMERAS_DEFAULTS,
  buildEpisodeTrailerGraph,
  initialRunNodeIds,
  renderFinalRunSet,
  resolveEpisodeTrailerSettings,
  usecaseDescriptor,
  usecaseTriesEvery,
} from "@nodaro/render-rules"

const cam = (n: number) => ({ url: `https://r2/c${n}.mp4`, kind: "video" as const, durationSec: 3600 })
const master = { url: "https://r2/m.wav", kind: "audio" as const, durationSec: 3600 }
const three = { media: cam(1), moreMedia: [cam(2), cam(3)], masterAudio: master }
const wires = (g: ReturnType<typeof buildEpisodeTrailerGraph>) => g.edges.map((e) => `${e.source}.${e.sourceHandle}>${e.target}.${e.targetHandle}`)
const settings = (raw: Record<string, unknown> = {}, shape = { recordings: 3, masterAudio: true }) => resolveEpisodeTrailerSettings(raw, "video", shape)

describe("Trailer on three cameras + Master audio (decided 2026-10-17)", () => {
  const g = buildEpisodeTrailerGraph(settings({ cameras: { wide: 3 } }), three)
  it("node set: the front, Transcribe on the sound, the trailer plan, Camera Switch, the render, then the formats", () => {
    expect(g.nodes.map((n) => [n.id, n.type])).toEqual([
      ["uc-source", "upload-video"], ["uc-cam-2", "upload-video"], ["uc-cam-3", "upload-video"], ["uc-master", "upload-audio"],
      ["uc-sync", "audio-sync"], ["uc-map", "speaker-map"],
      ["uc-transcribe", "transcribe"], ["uc-plan", "edit-plan"], ["uc-switch", "camera-switch"], ["uc-render", "apply-edl"],
      ["uc-format-9x16", "social-media-format"], ["uc-format-1x1", "social-media-format"], ["uc-format-4x5", "social-media-format"],
    ])
  })
  it("the plan reads every recording with its role and the offsets; the render reads the switched edit and its renamed transcript", () => {
    const w = wires(g)
    expect(w).toEqual(expect.arrayContaining([
      "uc-master.audio>uc-transcribe.audio",
      "uc-master.audio>uc-plan.sources", "uc-source.video>uc-plan.sources", "uc-cam-2.video>uc-plan.sources", "uc-cam-3.video>uc-plan.sources",
      "uc-sync.json>uc-plan.offsets", "uc-transcribe.json>uc-plan.transcript",
      "uc-plan.edl>uc-switch.edl", "uc-transcribe.json>uc-switch.transcript", "uc-map.json>uc-switch.speakerMap",
      "uc-switch.edl>uc-render.edl", "uc-switch.transcript>uc-render.transcript",
      "uc-render.media>uc-format-9x16.media",
    ]))
    // The render resolves each camera from the edit (no sources wire), as the Multicam Cut template's does.
    expect(w.some((e) => e.endsWith(">uc-render.sources"))).toBe(false)
    expect(g.nodes.find((n) => n.id === "uc-plan")!.data).toMatchObject({
      label: "Trailer Plan", mode: "trailer", planTier: "standard",
      sourceOrder: ["uc-master", "uc-source", "uc-cam-2", "uc-cam-3"],
      sourceConfig: { "uc-master": { role: "master-audio" }, "uc-source": { role: "camera" }, "uc-cam-2": { role: "camera" }, "uc-cam-3": { role: "wide" } },
    })
    expect(g.nodes.find((n) => n.id === "uc-render")!.data).toMatchObject({ label: "Apply Cut", output: "video", quality: "final", crossfadeMs: 0 })
    expect(g.nodes.find((n) => n.id === "uc-switch")!.data).toMatchObject({ layoutHints: false })
  })
  it("the output map is the formats one, plus the multicam steps whose notes the run reports", () => {
    expect(g.outputMap).toMatchObject({
      kind: "formats",
      formats: [
        { format: "9:16", ref: { nodeId: "uc-format-9x16", handle: "media" } },
        { format: "1:1", ref: { nodeId: "uc-format-1x1", handle: "media" } },
        { format: "4:5", ref: { nodeId: "uc-format-4x5", handle: "media" } },
      ],
      preview: { nodeId: "uc-render", handle: "media" },
      json: { nodeId: "uc-plan", handle: "edl" },
      transcript: { nodeId: "uc-transcribe", handle: "json" },
      planNodeId: "uc-plan",
      renderNodeId: "uc-render",
      multicam: { sync: { nodeId: "uc-sync", handle: "json" }, map: { nodeId: "uc-map", handle: "json" } },
    })
  })
  it("the override reaches the switch as camera ids", () => {
    const o = buildEpisodeTrailerGraph(settings({ cameras: { wide: 3, speakerCameras: { "1": 2, "2": 0 } } }), three)
    expect(o.nodes.find((n) => n.id === "uc-switch")!.data).toMatchObject({ speakerMapByOrder: { "1": "uc-cam-2", "2": "" } })
  })
  it("an intro card: Combine Videos after the render, every format reads it (P2's tail, unchanged)", () => {
    const c = buildEpisodeTrailerGraph(settings({ formats: ["16:9"] }), { ...three, introCard: { url: "https://r2/card.mp4", durationSec: 6 } })
    expect(wires(c)).toEqual(expect.arrayContaining(["uc-intro.video>uc-combine.in", "uc-render.media>uc-combine.in", "uc-combine.video>uc-format-16x9.media"]))
    expect(c.nodes.find((n) => n.id === "uc-combine")!.data).toMatchObject({ clipOrder: ["uc-intro", "uc-render"] })
    expect(c.nodes.find((n) => n.id === "uc-intro")!.data).toMatchObject({ metadata: { durationSeconds: 6 } })
  })
  it("review on: the first run is everything up to the proxy render, the switch included", () => {
    const r = buildEpisodeTrailerGraph(settings({ reviewBeforeRender: true }), three)
    expect(r.nodes.find((n) => n.id === "uc-render")!.data.quality).toBe("proxy")
    expect(initialRunNodeIds(r)).toEqual(["uc-source", "uc-cam-2", "uc-cam-3", "uc-master", "uc-sync", "uc-map", "uc-transcribe", "uc-plan", "uc-switch", "uc-render"])
  })
  it("its Render final re-runs Camera Switch on the reviewed cut, then the render and the formats (never the plan)", () => {
    const r = buildEpisodeTrailerGraph(settings({ reviewBeforeRender: true }), three)
    expect([...renderFinalRunSet("uc-render", r.nodes, r.edges)].sort()).toEqual(["uc-format-1x1", "uc-format-4x5", "uc-format-9x16", "uc-render", "uc-switch"])
  })
  it("its formats still try every one; no multicam step does (a failed Audio Sync, Speaker Map or Camera Switch is upstream of every format)", () => {
    const tries = usecaseTriesEvery(g)
    for (const id of ["uc-sync", "uc-map", "uc-switch", "uc-render", "uc-plan"]) expect(tries.has(id)).toBe(false)
    expect(g.nodes.filter((n) => tries.has(n.id)).map((n) => n.type)).toEqual(["social-media-format", "social-media-format", "social-media-format"])
  })
  it("already in sync: no Audio Sync, and the output map names only Speaker Map", () => {
    const s = buildEpisodeTrailerGraph(settings({ cameras: { synced: true } }), three)
    expect(s.nodes.some((n) => n.type === "audio-sync")).toBe(false)
    expect(wires(s).some((e) => e.endsWith(">uc-plan.offsets"))).toBe(false)
    expect(s.outputMap.multicam).toEqual({ map: { nodeId: "uc-map", handle: "json" } })
  })
  it("one camera + Master audio: Audio Sync, then the render on the plan (no Speaker Map, no switch)", () => {
    const one = buildEpisodeTrailerGraph(settings({}, { recordings: 1, masterAudio: true }), { media: cam(1), masterAudio: master })
    expect(one.nodes.map((n) => n.type)).toEqual(["upload-video", "upload-audio", "audio-sync", "transcribe", "edit-plan", "apply-edl", "social-media-format", "social-media-format", "social-media-format"])
    expect(wires(one)).toEqual(expect.arrayContaining(["uc-plan.edl>uc-render.edl", "uc-transcribe.json>uc-render.transcript"]))
    expect(one.outputMap.multicam).toEqual({ sync: { nodeId: "uc-sync", handle: "json" } })
  })
  it("one camera + Master audio, already in sync: no multicam step, and the output map names none", () => {
    const one = buildEpisodeTrailerGraph(settings({ cameras: { synced: true } }, { recordings: 1, masterAudio: true }), { media: cam(1), masterAudio: master })
    expect("multicam" in one.outputMap).toBe(false)
  })
  it("no Master audio: the wide repeated as the sound", () => {
    const n = buildEpisodeTrailerGraph(settings({ cameras: { wide: 2 } }, { recordings: 2, masterAudio: false }), { media: cam(1), moreMedia: [cam(2)] })
    expect(n.nodes.find((x) => x.id === "uc-master")!.data).toMatchObject({ url: "https://r2/c2.mp4" })
    expect(wires(n)).toEqual(expect.arrayContaining(["uc-master.audio>uc-transcribe.audio", "uc-master.audio>uc-sync.sources"]))
  })
  it("a sound-only recording beside two cameras is the sound (its own id), the cameras cut between", () => {
    const n = buildEpisodeTrailerGraph(settings({}, { recordings: 3, masterAudio: false }), { media: { url: "https://r2/mixer.wav", kind: "audio" }, moreMedia: [cam(2), cam(3)] })
    expect(wires(n)).toEqual(expect.arrayContaining(["uc-source.audio>uc-transcribe.audio", "uc-map.json>uc-switch.speakerMap"]))
    expect(n.nodes.some((x) => x.id === "uc-master")).toBe(false)
  })
})

describe("the Cameras setting is resolved only for several recordings or a master (a setting equal to the behaviour before multicam is omitted)", () => {
  it("one recording: no `cameras` key, whatever the node holds", () => {
    expect("cameras" in resolveEpisodeTrailerSettings({ cameras: { wide: 1 } }, "video")).toBe(false)
    expect("cameras" in resolveEpisodeTrailerSettings({ cameras: { wide: 1 } }, "video", { recordings: 1, masterAudio: false })).toBe(false)
  })
  it("several recordings: the resolved Cameras", () => {
    expect(resolveEpisodeTrailerSettings({ cameras: { wide: 2, synced: true } }, "video", { recordings: 2, masterAudio: false }).cameras).toEqual({ wide: 2, synced: true, speakerCameras: {} })
    expect(resolveEpisodeTrailerSettings({}, "video", { recordings: 1, masterAudio: true }).cameras).toEqual(USE_CASE_CAMERAS_DEFAULTS)
  })
  it("the descriptor forwards the shape and builds every recording it is given (the whole sources, not only the first)", () => {
    const d = usecaseDescriptor("episode-trailer")
    const s = d.resolveSettings({ cameras: { wide: 2 } }, "video", { recordings: 2, masterAudio: false })
    expect(s).toMatchObject({ cameras: { wide: 2 } })
    expect(d.build(s, { media: cam(1), moreMedia: [cam(2)] }).nodes.map((n) => n.id)).toContain("uc-cam-2")
  })
  it("settings that carry no Cameras build on the defaults", () => {
    const g = buildEpisodeTrailerGraph(EPISODE_TRAILER_DEFAULTS, three)
    expect(g.nodes.some((n) => n.type === "audio-sync")).toBe(true)
    expect(g.nodes.find((n) => n.id === "uc-plan")!.data).toMatchObject({ sourceConfig: { "uc-cam-3": { role: "camera" } } })
  })
})

describe("one recording", () => {
  it("P2's graph, byte for byte (the identity fixtures cover every row): no multicam step and no `multicam` key", () => {
    const one = buildEpisodeTrailerGraph(resolveEpisodeTrailerSettings({}, "video"), { media: cam(1) })
    expect(one.nodes.some((n) => ["audio-sync", "speaker-map", "camera-switch"].includes(n.type) || n.id.startsWith("uc-cam") || n.id === "uc-master")).toBe(false)
    expect("multicam" in one.outputMap).toBe(false)
    expect(one.nodes.find((n) => n.id === "uc-source")!.data.label).toBe("Episode recording")
  })
})
