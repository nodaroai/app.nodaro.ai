/**
 * Tighten Episode on two or more recordings or a Master audio (decided
 * 2026-10-17): the Multicam Cut template's chain behind the one-node settings.
 * One recording builds P1's graph byte for byte (the identity fixtures cover
 * every row), and its resolved settings carry no `cameras` (a setting equal to
 * the behaviour before multicam is omitted).
 */
import { describe, it, expect } from "vitest"
import {
  TIGHTEN_EPISODE_DEFAULTS,
  USE_CASE_CAMERAS_DEFAULTS,
  buildTightenEpisodeGraph,
  initialRunNodeIds,
  renderFinalRunSet,
  resolveTightenEpisodeSettings,
  usecaseDescriptor,
} from "@nodaro/render-rules"

const v = (n: number) => ({ url: `https://r2/cam${n}.mp4`, kind: "video" as const, durationSec: 5400 })
const master = { url: "https://r2/master.wav", kind: "audio" as const, durationSec: 5400 }
const shape = { recordings: 3, masterAudio: true }
const wires = (g: ReturnType<typeof buildTightenEpisodeGraph>) => g.edges.map((e) => `${e.source}.${e.sourceHandle}>${e.target}.${e.targetHandle}`)
const settings = (raw: Record<string, unknown> = {}) => resolveTightenEpisodeSettings({ ...TIGHTEN_EPISODE_DEFAULTS, captions: false, ...raw }, "video", shape)
const three = { media: v(1), moreMedia: [v(2), v(3)], masterAudio: master }

describe("Tighten Episode on three cameras + Master audio (the Multicam Cut template's chain, decided 2026-10-17)", () => {
  const g = buildTightenEpisodeGraph(settings({ cameras: { wide: 3 } }), three)
  it("node set", () => {
    expect(g.nodes.map((n) => [n.id, n.type])).toEqual([
      ["uc-source", "upload-video"], ["uc-cam-2", "upload-video"], ["uc-cam-3", "upload-video"], ["uc-master", "upload-audio"],
      ["uc-sync", "audio-sync"], ["uc-map", "speaker-map"],
      ["uc-transcribe", "transcribe"], ["uc-silence", "silence-detect"], ["uc-plan", "edit-plan"],
      ["uc-switch", "camera-switch"], ["uc-render", "apply-edl"],
    ])
  })
  it("sound, plan, switch and render wiring", () => {
    const w = wires(g)
    expect(w).toEqual(expect.arrayContaining([
      "uc-master.audio>uc-transcribe.audio", "uc-master.audio>uc-silence.in",
      "uc-master.audio>uc-plan.sources", "uc-source.video>uc-plan.sources", "uc-cam-2.video>uc-plan.sources", "uc-cam-3.video>uc-plan.sources",
      "uc-sync.json>uc-plan.offsets", "uc-transcribe.json>uc-plan.transcript", "uc-silence.json>uc-plan.silence",
      "uc-plan.edl>uc-switch.edl", "uc-transcribe.json>uc-switch.transcript", "uc-map.json>uc-switch.speakerMap",
      "uc-switch.edl>uc-render.edl", "uc-switch.transcript>uc-render.transcript",
    ]))
    expect(w.some((e) => e.endsWith(">uc-render.sources"))).toBe(false) // media resolves from the EDL
    expect(g.nodes.find((n) => n.id === "uc-plan")!.data).toMatchObject({ sourceOrder: ["uc-master", "uc-source", "uc-cam-2", "uc-cam-3"], sourceConfig: { "uc-cam-3": { role: "wide" }, "uc-master": { role: "master-audio" } } })
    expect(g.nodes.find((n) => n.id === "uc-render")!.data).toMatchObject({ output: "video", quality: "final" })
  })
  it("the output map names the plan and render as before, and the multicam steps whose notes the run reports", () => {
    expect(g.outputMap).toMatchObject({ media: { nodeId: "uc-render", handle: "media" }, planNodeId: "uc-plan", renderNodeId: "uc-render", multicam: { sync: { nodeId: "uc-sync", handle: "json" }, map: { nodeId: "uc-map", handle: "json" } } })
  })
  it("the override reaches the switch as camera ids", () => {
    const o = buildTightenEpisodeGraph(settings({ cameras: { wide: 3, speakerCameras: { "1": 2, "2": 0 } } }), three)
    expect(o.nodes.find((n) => n.id === "uc-switch")!.data).toMatchObject({ layoutHints: false, speakerMapByOrder: { "1": "uc-cam-2", "2": "" } })
  })
  it("review on: the first run is everything up to the proxy render, the switch included", () => {
    const r = buildTightenEpisodeGraph(settings({ reviewBeforeRender: true, captions: true }), three)
    expect(initialRunNodeIds(r)).toEqual(r.nodes.map((n) => n.id).filter((id) => id !== "uc-captions"))
  })
  it("its Render final re-runs Camera Switch on the reviewed cut, then the render and what follows (never the plan)", () => {
    const r = buildTightenEpisodeGraph(settings({ reviewBeforeRender: true, captions: true }), three)
    expect([...renderFinalRunSet("uc-render", r.nodes, r.edges)].sort()).toEqual(["uc-captions", "uc-render", "uc-switch"])
  })
  it("framed: Speaker View reads the switched edit and its renamed transcript (each camera's own shot: auto boxes are dealt only on one camera); captions read the render's transcript pip", () => {
    const f = buildTightenEpisodeGraph(settings({ captions: true, framing: { aspect: "9:16", layout: "stacked" } }), three)
    expect(f.nodes.find((n) => n.id === "uc-render")).toMatchObject({ type: "speaker-view", data: { targetAspect: "9:16", layout: "stacked", autoRegions: true } })
    expect(wires(f)).toEqual(expect.arrayContaining(["uc-switch.edl>uc-render.edl", "uc-switch.transcript>uc-render.transcript", "uc-render.transcript>uc-captions.transcript", "uc-render.video>uc-captions.in"]))
  })
  it("music: mixed under the render and merged back, as P1", () => {
    const m = buildTightenEpisodeGraph(settings(), { ...three, music: { url: "https://r2/bed.mp3" } })
    expect(wires(m)).toEqual(expect.arrayContaining(["uc-render.media>uc-mix.in", "uc-music.audio>uc-mix.in", "uc-render.media>uc-merge.in", "uc-mix.audio-out>uc-merge.in"]))
    expect(m.outputMap.media).toEqual({ nodeId: "uc-merge", handle: "video-out" })
  })
  it("already in sync: no Audio Sync, and the output map names only Speaker Map", () => {
    const s = buildTightenEpisodeGraph(settings({ cameras: { synced: true } }), three)
    expect(s.nodes.some((n) => n.type === "audio-sync")).toBe(false)
    expect(wires(s).some((e) => e.endsWith(">uc-plan.offsets"))).toBe(false)
    expect(s.outputMap.multicam).toEqual({ map: { nodeId: "uc-map", handle: "json" } })
  })
  it("one camera + Master audio: Audio Sync, then P1's render on the plan (no Speaker Map, no switch)", () => {
    const one = buildTightenEpisodeGraph(resolveTightenEpisodeSettings({ captions: false }, "video", { recordings: 1, masterAudio: true }), { media: v(1), masterAudio: master })
    expect(one.nodes.map((n) => n.type)).toEqual(["upload-video", "upload-audio", "audio-sync", "transcribe", "silence-detect", "edit-plan", "apply-edl"])
    expect(wires(one)).toEqual(expect.arrayContaining(["uc-plan.edl>uc-render.edl", "uc-transcribe.json>uc-render.transcript"]))
    expect(one.outputMap.multicam).toEqual({ sync: { nodeId: "uc-sync", handle: "json" } })
  })
  it("one camera + Master audio, already in sync: no multicam step, and the output map names none", () => {
    const one = buildTightenEpisodeGraph(resolveTightenEpisodeSettings({ captions: false, cameras: { synced: true } }, "video", { recordings: 1, masterAudio: true }), { media: v(1), masterAudio: master })
    expect("multicam" in one.outputMap).toBe(false)
  })
  it("no Master audio: the wide repeated as the sound", () => {
    const n = buildTightenEpisodeGraph(resolveTightenEpisodeSettings({ captions: false, cameras: { wide: 2 } }, "video", { recordings: 2, masterAudio: false }), { media: v(1), moreMedia: [v(2)] })
    expect(n.nodes.find((x) => x.id === "uc-master")!.data).toMatchObject({ url: "https://r2/cam2.mp4" })
    expect(wires(n)).toEqual(expect.arrayContaining(["uc-master.audio>uc-transcribe.audio", "uc-master.audio>uc-sync.sources"]))
  })
})

describe("an audio episode from several recordings is the sound's alone (nothing to cut to)", () => {
  const audio = (sources: Parameters<typeof buildTightenEpisodeGraph>[1], recordings: number, masterAudio: boolean) =>
    buildTightenEpisodeGraph(resolveTightenEpisodeSettings({ output: "audio" }, "video", { recordings, masterAudio }), sources)
  it("over Master audio: the master, then P1's audio chain; no camera, no Audio Sync, Speaker Map or Camera Switch", () => {
    const au = audio({ media: v(1), moreMedia: [v(2)], masterAudio: master }, 2, true)
    expect(au.nodes.map((n) => [n.id, n.type])).toEqual([
      ["uc-master", "upload-audio"], ["uc-transcribe", "transcribe"], ["uc-silence", "silence-detect"], ["uc-plan", "edit-plan"], ["uc-render", "apply-edl"],
    ])
    expect(au.nodes.find((n) => n.id === "uc-render")!.data).toMatchObject({ output: "audio" })
    expect(au.nodes.find((n) => n.id === "uc-plan")!.data).toMatchObject({ sourceOrder: ["uc-master"], sourceConfig: {} })
    expect(wires(au)).toEqual(expect.arrayContaining(["uc-master.audio>uc-render.sources", "uc-master.audio>uc-plan.sources"]))
    expect("multicam" in au.outputMap).toBe(false)
  })
  it("over an audio-only recording at position 2: that recording keeps its own id", () => {
    const au = audio({ media: v(1), moreMedia: [{ url: "https://r2/mixer.wav", kind: "audio" }] }, 2, false)
    expect(au.nodes.map((n) => n.id)).toEqual(["uc-cam-2", "uc-transcribe", "uc-silence", "uc-plan", "uc-render"])
  })
  it("no master and no audio-only recording: Camera 1's sound, as uc-master", () => {
    const au = audio({ media: v(1), moreMedia: [v(2)] }, 2, false)
    expect(au.nodes[0]).toMatchObject({ id: "uc-master", type: "upload-audio", data: { url: "https://r2/cam1.mp4" } })
    expect(au.nodes.some((n) => n.id.startsWith("uc-cam") || n.id === "uc-map" || n.id === "uc-sync")).toBe(false)
  })
  it("music under it, as P1's audio episode", () => {
    const au = buildTightenEpisodeGraph(resolveTightenEpisodeSettings({ output: "audio" }, "video", { recordings: 2, masterAudio: true }), { media: v(1), moreMedia: [v(2)], masterAudio: master, music: { url: "https://r2/bed.mp3" } })
    expect(au.outputMap.media).toEqual({ nodeId: "uc-mix", handle: "audio-out" })
  })
})

describe("the Cameras setting is resolved only for several recordings or a master (a setting equal to the behaviour before multicam is omitted)", () => {
  it("one recording: no `cameras` key, whatever the node holds", () => {
    expect("cameras" in resolveTightenEpisodeSettings({ cameras: { wide: 1 } }, "video")).toBe(false)
    expect("cameras" in resolveTightenEpisodeSettings({ cameras: { wide: 1 } }, "video", { recordings: 1, masterAudio: false })).toBe(false)
  })
  it("several recordings: the resolved Cameras", () => {
    expect(resolveTightenEpisodeSettings({ cameras: { wide: 2, synced: true } }, "video", { recordings: 2, masterAudio: false }).cameras).toEqual({ wide: 2, synced: true, speakerCameras: {} })
    expect(resolveTightenEpisodeSettings({}, "video", { recordings: 1, masterAudio: true }).cameras).toEqual(USE_CASE_CAMERAS_DEFAULTS)
  })
  it("the descriptor forwards the shape", () => {
    expect(usecaseDescriptor("tighten-episode").resolveSettings({ cameras: { wide: 2 } }, "video", { recordings: 2, masterAudio: false })).toMatchObject({ cameras: { wide: 2 } })
  })
  it("settings that carry no Cameras build on the defaults", () => {
    const g = buildTightenEpisodeGraph({ ...TIGHTEN_EPISODE_DEFAULTS, captions: false }, three)
    expect(g.nodes.some((n) => n.type === "audio-sync")).toBe(true)
    expect(g.nodes.find((n) => n.id === "uc-plan")!.data).toMatchObject({ sourceConfig: { "uc-cam-3": { role: "camera" } } })
  })
})

describe("one recording", () => {
  it("P1's graph, byte for byte (the identity fixtures cover every row)", () => {
    const one = buildTightenEpisodeGraph(resolveTightenEpisodeSettings({ ...TIGHTEN_EPISODE_DEFAULTS }, "video"), { media: v(1) })
    expect(one.nodes.some((n) => n.id.startsWith("uc-cam") || n.id === "uc-master")).toBe(false)
    expect("multicam" in one.outputMap).toBe(false)
    expect(one.nodes.find((n) => n.id === "uc-source")!.data.label).toBe("Episode recording")
  })
  it("the descriptor builds every recording it is given (the whole sources, not only the first)", () => {
    const d = usecaseDescriptor("tighten-episode")
    const g = d.build(d.resolveSettings({ captions: false }, "video", { recordings: 2, masterAudio: false }), { media: v(1), moreMedia: [v(2)] })
    expect(g.nodes.map((n) => n.id)).toContain("uc-cam-2")
  })
})
