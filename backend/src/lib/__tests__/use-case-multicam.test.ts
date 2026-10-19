/**
 * The multicam front every use-case builder puts before its plan when a run
 * has two or more recordings or a Master audio (decided 2026-10-17), the
 * Camera Switch node between a plan and its render, the route's refusal of
 * recordings that cannot run, and the run's kind from its recordings' kinds.
 */
import { describe, it, expect } from "vitest"
import {
  MULTICAM_NODE_IDS as M,
  MULTICAM_SPEAKER_MAP_TYPE,
  USE_CASE_CAMERAS_DEFAULTS as C0,
  usecaseIsMulticam,
  usecaseMulticamFront,
  usecaseMulticamSoundNode,
  usecaseRecordingsKind,
  usecaseCamerasReportOf,
  usecaseRecordingsProblem,
  usecaseRunRecordings,
  usecaseSoundRecordingIndex,
  usecaseSwitchNode,
  usecaseSwitchWires,
} from "@nodaro/render-rules"

const v = (n: number) => ({ url: `https://r2/cam${n}.mp4`, kind: "video" as const, durationSec: 3600 })
const a = (name: string) => ({ url: `https://r2/${name}.wav`, kind: "audio" as const, durationSec: 3600 })
const wires = (f: { readonly edges: ReadonlyArray<{ source: string; sourceHandle: string; target: string; targetHandle: string }> }) =>
  f.edges.map((e) => `${e.source}.${e.sourceHandle}>${e.target}.${e.targetHandle}`)

describe("the multicam front (decided 2026-10-17)", () => {
  it("3 cameras + Master audio, not synced: Audio Sync over all four, Speaker Map over all four (master and wide are no one's camera)", () => {
    const f = usecaseMulticamFront({ media: v(1), moreMedia: [v(2), v(3)], masterAudio: a("master") }, { ...C0, wide: 3 })
    expect(f.masterId).toBe("uc-master")
    expect(f.wideId).toBe("uc-cam-3")
    expect(f.videoCameraIds).toEqual(["uc-source", "uc-cam-2", "uc-cam-3"])
    expect(f.sound).toEqual({ nodeId: "uc-master", pip: "audio" })
    expect(f.planSourceIds).toEqual(["uc-master", "uc-source", "uc-cam-2", "uc-cam-3"])
    expect(f.planSourceConfig).toEqual({ "uc-master": { role: "master-audio" }, "uc-source": { role: "camera" }, "uc-cam-2": { role: "camera" }, "uc-cam-3": { role: "wide" } })
    expect(f.nodes.find((n) => n.id === M.sync)!.data).toMatchObject({ reference: "uc-master", sourceOrder: f.planSourceIds })
    expect(f.nodes.find((n) => n.id === M.map)).toMatchObject({ type: MULTICAM_SPEAKER_MAP_TYPE, data: { masterSourceId: "uc-master", wideSourceId: "uc-cam-3", sourceOrder: f.planSourceIds } })
    expect(wires(f)).toEqual([
      "uc-master.audio>uc-sync.sources", "uc-source.video>uc-sync.sources", "uc-cam-2.video>uc-sync.sources", "uc-cam-3.video>uc-sync.sources",
      "uc-master.audio>uc-map.sources", "uc-source.video>uc-map.sources", "uc-cam-2.video>uc-map.sources", "uc-cam-3.video>uc-map.sources",
      "uc-sync.json>uc-map.offsets", "uc-transcribe.json>uc-map.transcript",
    ])
    expect(f.offsets).toEqual({ nodeId: M.sync, handle: "json" })
    expect(f.map).toEqual({ nodeId: M.map, handle: "json" })
  })
  it("already in sync: no Audio Sync, Speaker Map reads no offsets", () => {
    const f = usecaseMulticamFront({ media: v(1), moreMedia: [v(2)], masterAudio: a("master") }, { ...C0, synced: true })
    expect(f.nodes.some((n) => n.id === M.sync)).toBe(false)
    expect(f.offsets).toBeNull()
    expect(wires(f)).not.toContain("uc-sync.json>uc-map.offsets")
    expect(f.map).toEqual({ nodeId: M.map, handle: "json" })
  })
  it("no Master audio: the wide (else Camera 1) is also the sound, as a second audio source", () => {
    const f = usecaseMulticamFront({ media: v(1), moreMedia: [v(2)] }, { ...C0, wide: 2 })
    expect(f.nodes.find((n) => n.id === "uc-master")).toMatchObject({ type: "upload-audio", data: { url: "https://r2/cam2.mp4", metadata: { durationSeconds: 3600 } } })
    expect(f.sound).toEqual({ nodeId: "uc-master", pip: "audio" })
    expect(f.planSourceIds).toEqual(["uc-master", "uc-source", "uc-cam-2"])
    const noWide = usecaseMulticamFront({ media: v(1), moreMedia: [v(2)] }, C0)
    expect(noWide.nodes.find((n) => n.id === "uc-master")!.data).toMatchObject({ url: "https://r2/cam1.mp4" })
  })
  it("an audio-only recording among them is the master; no duplicate", () => {
    const f = usecaseMulticamFront({ media: a("mixer"), moreMedia: [v(2), v(3)] }, C0)
    expect(f.masterId).toBe("uc-source")
    expect(f.sound).toEqual({ nodeId: "uc-source", pip: "audio" })
    expect(f.nodes.some((n) => n.id === "uc-master")).toBe(false)
    expect(f.videoCameraIds).toEqual(["uc-cam-2", "uc-cam-3"])
    expect(f.planSourceConfig).toEqual({ "uc-source": { role: "master-audio" }, "uc-cam-2": { role: "camera" }, "uc-cam-3": { role: "camera" } })
  })
  it("one camera + Master audio: Audio Sync, no Speaker Map, no Camera Switch", () => {
    const f = usecaseMulticamFront({ media: v(1), masterAudio: a("master") }, C0)
    expect(f.offsets).toEqual({ nodeId: M.sync, handle: "json" })
    expect(f.map).toBeNull()
    expect(usecaseSwitchNode(f, C0, 4, 1)).toBeNull()
  })
  it("withMap: true asks for Speaker Map on one camera; false never builds it", () => {
    expect(usecaseMulticamFront({ media: v(1), masterAudio: a("master") }, C0, { withMap: true }).map).toEqual({ nodeId: M.map, handle: "json" })
    const off = usecaseMulticamFront({ media: v(1), moreMedia: [v(2), v(3)], masterAudio: a("master") }, C0, { withMap: false })
    expect(off.map).toBeNull()
    expect(off.nodes.some((n) => n.id === M.map)).toBe(false)
  })
  it("the recordings are named by their place: Camera n, Master audio, and the sound a camera repeats", () => {
    const f = usecaseMulticamFront({ media: v(1), moreMedia: [v(2)], masterAudio: a("master") }, C0)
    expect(f.nodes.filter((n) => n.type.startsWith("upload-")).map((n) => [n.id, n.data.label])).toEqual([
      ["uc-source", "Camera 1"], ["uc-cam-2", "Camera 2"], ["uc-master", "Master audio"],
    ])
    const repeat = usecaseMulticamFront({ media: v(1), moreMedia: [v(2)] }, { ...C0, wide: 2 })
    expect(repeat.nodes.find((n) => n.id === "uc-master")!.data.label).toBe("Sound (Camera 2)")
    const mixer = usecaseMulticamFront({ media: v(1), moreMedia: [a("mixer")] }, C0)
    expect(mixer.nodes.find((n) => n.id === "uc-cam-2")!.data.label).toBe("Recording 2 (sound)")
  })
  it("the Camera Switch node: hints off, the override as ordinal → camera id, an audio-only position ignored", () => {
    const f = usecaseMulticamFront({ media: a("mixer"), moreMedia: [v(2), v(3)] }, C0)
    const sw = usecaseSwitchNode(f, { ...C0, speakerCameras: { "1": 3, "2": 0, "3": 1 } }, 4, 1)!
    expect(sw).toMatchObject({ id: M.switch, type: "camera-switch", data: { layoutHints: false, speakerMapByOrder: { "1": "uc-cam-3", "2": "" } } })
    expect(usecaseSwitchNode(f, C0, 4, 1)!.data).not.toHaveProperty("speakerMapByOrder")
  })
  it("the switch's three wires: the plan's edit, the transcript, the map", () => {
    const f = usecaseMulticamFront({ media: v(1), moreMedia: [v(2)], masterAudio: a("master") }, C0)
    expect(wires({ edges: usecaseSwitchWires(f, { nodeId: "uc-plan", handle: "edl" }) })).toEqual([
      "uc-plan.edl>uc-switch.edl", "uc-transcribe.json>uc-switch.transcript", "uc-map.json>uc-switch.speakerMap",
    ])
  })
  it("a builder names the transcript Speaker Map and Camera Switch read (its own Transcribe's id), else uc-transcribe's", () => {
    const own = { nodeId: "x-transcribe", handle: "json" }
    const f = usecaseMulticamFront({ media: v(1), moreMedia: [v(2)] }, C0, { transcript: own })
    expect(wires(f)).toContain("x-transcribe.json>uc-map.transcript")
    expect(wires({ edges: usecaseSwitchWires(f, { nodeId: "uc-plan", handle: "edl" }, own) })).toContain("x-transcribe.json>uc-switch.transcript")
    expect(wires(usecaseMulticamFront({ media: v(1), moreMedia: [v(2)] }, C0))).toContain("uc-transcribe.json>uc-map.transcript")
  })
  it("one recording without a master is not multicam", () => {
    expect(usecaseIsMulticam({ media: v(1) })).toBe(false)
    expect(usecaseIsMulticam({ media: v(1), moreMedia: [] })).toBe(false)
    expect(usecaseIsMulticam({ media: v(1), masterAudio: a("master") })).toBe(true)
    expect(() => usecaseMulticamFront({ media: v(1) }, C0)).toThrow()
  })
  it("Master audio on the same file as a camera is one source used twice: built as the no-master sound is (a camera's own track)", () => {
    const same = usecaseMulticamFront({ media: v(1), moreMedia: [v(2)], masterAudio: { ...v(2), kind: "audio" } }, C0)
    const repeat = usecaseMulticamFront({ media: v(1), moreMedia: [v(2)] }, { ...C0, wide: 2 })
    // The same graph as the no-master run whose sound is Camera 2 (only the
    // labels and the wide role differ): Camera 2 stays a camera, its track is the clock.
    const urls = (f: typeof same) => f.nodes.filter((n) => n.type.startsWith("upload-")).map((n) => [n.id, n.type, n.data.url])
    expect(urls(same)).toEqual(urls(repeat))
    expect(wires(same)).toEqual(wires(repeat))
    expect(same.planSourceIds).toEqual(repeat.planSourceIds)
    expect(same.planSourceConfig).toEqual({ "uc-master": { role: "master-audio" }, "uc-source": { role: "camera" }, "uc-cam-2": { role: "camera" } })
    expect(same.videoCameraIds).toEqual(["uc-source", "uc-cam-2"])
  })
})

describe("the sound a multicam run listens to", () => {
  it("usecaseMulticamSoundNode: the master, else an audio-only recording, else the wide (or Camera 1) once more", () => {
    expect(usecaseMulticamSoundNode({ media: v(1), moreMedia: [v(2)], masterAudio: a("master") }, C0)).toMatchObject({ id: "uc-master", type: "upload-audio", data: { url: "https://r2/master.wav" } })
    expect(usecaseMulticamSoundNode({ media: v(1), moreMedia: [a("mixer")] }, C0)).toMatchObject({ id: "uc-cam-2", type: "upload-audio" })
    expect(usecaseMulticamSoundNode({ media: v(1), moreMedia: [v(2)] }, { ...C0, wide: 2 })).toMatchObject({ id: "uc-master", data: { url: "https://r2/cam2.mp4" } })
  })
  it("usecaseSoundRecordingIndex: which recording the sound repeats (one rule for the builder and the estimate)", () => {
    expect(usecaseSoundRecordingIndex(["video", "video", "video"], 3, false)).toBe(2)
    expect(usecaseSoundRecordingIndex(["video", "video"], null, false)).toBe(0)
    expect(usecaseSoundRecordingIndex(["video", "video"], null, true)).toBeNull()
    expect(usecaseSoundRecordingIndex(["audio", "video"], null, false)).toBeNull()
  })
})

describe("usecaseRecordingsProblem (the route's refusal, the editor's badge)", () => {
  it("six in all, the master and the sound's slot counted (decided 2026-10-17)", () => {
    expect(usecaseRecordingsProblem({ kinds: ["video", "video", "video", "video", "video", "video"], masterAudio: false, cameras: undefined })?.code).toBe("too_many_recordings")
    expect(usecaseRecordingsProblem({ kinds: ["video", "video", "video", "video", "video"], masterAudio: false, cameras: undefined })).toBeNull()
    expect(usecaseRecordingsProblem({ kinds: ["video", "video", "video", "video", "video", "video"], masterAudio: true, cameras: undefined })?.code).toBe("too_many_recordings")
    expect(usecaseRecordingsProblem({ kinds: ["video", "video", "video", "video", "video"], masterAudio: true, cameras: undefined })).toBeNull()
    expect(usecaseRecordingsProblem({ kinds: ["audio", "video", "video", "video", "video", "video"], masterAudio: false, cameras: undefined })).toBeNull()
  })
  it("two audio-only recordings, or one beside Master audio", () => {
    expect(usecaseRecordingsProblem({ kinds: ["audio", "audio", "video"], masterAudio: false, cameras: undefined })?.code).toBe("recordings_two_audio_only")
    expect(usecaseRecordingsProblem({ kinds: ["audio", "video"], masterAudio: true, cameras: undefined })?.code).toBe("recordings_two_audio_only")
  })
  it("a wide camera past the last recording, or on one without picture", () => {
    expect(usecaseRecordingsProblem({ kinds: ["video", "video"], masterAudio: false, cameras: { wide: 3 } })?.code).toBe("wide_camera_out_of_range")
    expect(usecaseRecordingsProblem({ kinds: ["audio", "video", "video"], masterAudio: false, cameras: { wide: 1 } })?.code).toBe("wide_camera_out_of_range")
    expect(usecaseRecordingsProblem({ kinds: ["video", "video"], masterAudio: false, cameras: { wide: 2 } })).toBeNull()
    expect(usecaseRecordingsProblem({ kinds: ["video", "video"], masterAudio: false, cameras: { wide: null } })).toBeNull()
  })
  it("one recording: never a problem here (the P1 refusals stay where they are)", () => {
    expect(usecaseRecordingsProblem({ kinds: ["audio"], masterAudio: false, cameras: { wide: 4 } })).toBeNull()
  })
  it("every refusal says what to do", () => {
    const p = usecaseRecordingsProblem({ kinds: ["video", "video", "video", "video", "video", "video"], masterAudio: false, cameras: undefined })!
    expect(p.message).toMatch(/Up to 6 recordings/)
  })
})

describe("usecaseRecordingsKind (one rule: the route, the expansion, the audio lock — decided 2026-10-18)", () => {
  it("video when any recording has picture; audio when none known has picture and one is audio; nothing known → undefined", () => {
    expect(usecaseRecordingsKind(["audio", "video", "video"])).toBe("video")
    expect(usecaseRecordingsKind(["audio", "audio"])).toBe("audio")
    expect(usecaseRecordingsKind(["video"])).toBe("video")
    expect(usecaseRecordingsKind([undefined, "audio"])).toBe("audio")
    expect(usecaseRecordingsKind([])).toBeUndefined()
    expect(usecaseRecordingsKind([undefined])).toBeUndefined()
  })
})

describe("usecaseRunRecordings (both engines' one rule — decided 2026-10-19)", () => {
  const rec = (nodeId: string, url = `https://r2/${nodeId}.mp4`) => ({ nodeId, url })
  const base = { data: {}, maxRecordings: 6, takesMaster: true, settings: { output: "video", cameras: { wide: 2 } } } as const

  it("a Master audio from the SAME upstream node as a recording is no master, whatever its URL (a Split Media's audio beside its video)", () => {
    const run = usecaseRunRecordings({ ...base, wired: [rec("split", "https://r2/split-video.mp4")], master: { nodeId: "split", url: "https://r2/split-audio.m4a" }, multicam: true })
    expect(run.masterAudioUrl).toBeUndefined()
    expect(run.recordings.map((r) => r.url)).toEqual(["https://r2/split-video.mp4"])
    expect(run.settings).toEqual({ output: "video" })
  })
  it("a Master audio from another node is sent (the route compares the files: the same file there is no master)", () => {
    const run = usecaseRunRecordings({ ...base, wired: [rec("a")], master: { nodeId: "mic", url: "https://r2/a.mp4" }, multicam: true })
    expect(run.masterAudioUrl).toBe("https://r2/a.mp4")
    expect(run.settings).toEqual(base.settings)
  })
  it("the Cameras settings ride only on a run of two or more recordings or a master; never for a viewer who may not use Speaker Map", () => {
    expect(usecaseRunRecordings({ ...base, wired: [rec("a"), rec("b")], multicam: true }).settings).toEqual(base.settings)
    expect(usecaseRunRecordings({ ...base, wired: [rec("a")], multicam: true }).settings).toEqual({ output: "video" })
    const off = usecaseRunRecordings({ ...base, wired: [rec("a"), rec("b")], master: { nodeId: "mic", url: "https://r2/m.wav" }, multicam: false })
    expect(off).toEqual({ recordings: [rec("a")], settings: { output: "video" }, sendsCameras: false })
  })
  it("a type that does not take Master audio never sends one", () => {
    expect(usecaseRunRecordings({ ...base, takesMaster: false, wired: [rec("a")], master: { nodeId: "mic", url: "https://r2/m.wav" }, multicam: true }).masterAudioUrl).toBeUndefined()
  })
})

describe("usecaseCamerasReportOf (the wrapper's `cameras`, the engine's `useCaseCameras`, the node's saved field — one reader)", () => {
  const report = { speakers: [{ speaker: "speaker_0", ordinal: 1, camera: 2, marginDb: 7.5 }, { speaker: "speaker_1", ordinal: 2, camera: null, marginDb: null }], syncNotes: ["s"], mapNotes: ["m"] }
  it("a report reads as itself", () => expect(usecaseCamerasReportOf(report)).toEqual(report))
  it("not a report: nothing", () => {
    for (const raw of [undefined, null, "x", [], { speakers: [] }, { speakers: "x", syncNotes: [], mapNotes: [] }]) expect(usecaseCamerasReportOf(raw)).toBeUndefined()
  })
  it("a speaker row or a note of another shape is dropped; an unknown camera or margin is null", () => {
    expect(usecaseCamerasReportOf({ speakers: [null, { speaker: 1 }, { speaker: "s", ordinal: 1, camera: "2", marginDb: Infinity }], syncNotes: [1, "ok"], mapNotes: [] }))
      .toEqual({ speakers: [{ speaker: "s", ordinal: 1, camera: null, marginDb: null }], syncNotes: ["ok"], mapNotes: [] })
  })
})
