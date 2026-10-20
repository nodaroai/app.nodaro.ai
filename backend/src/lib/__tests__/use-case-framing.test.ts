/**
 * Where a framed use-case render's boxes come from (decided 2026-10-17): the
 * even split by speaker (`static`), Speaker Frames following faces
 * (`tracking`), or `auto` — tracking while Speaker Frames is priced. These are
 * the pure parts a builder composes; the builders' tracking branches have
 * their own tests.
 */
import { describe, it, expect } from "vitest"
import {
  SPEAKER_FRAMES_PRICED,
  TIGHTEN_EPISODE_DEFAULTS,
  USE_CASE_FRAMES_NODE_ID,
  USE_CASE_FRAMING_SOURCES,
  resolveUseCaseFramingSource,
  usecaseAutoFraming,
  usecaseFramesNode,
  usecaseFramesWires,
  buildTightenEpisodeGraph,
  initialRunNodeIds,
  renderFinalRunSet,
  resolveTightenEpisodeSettings,
  usecaseDescriptor,
  usecaseRecordings,
  type UseCaseSources,
} from "@nodaro/render-rules"

describe("framing source (decided 2026-10-17)", () => {
  it("offers auto, static and tracking", () => {
    expect([...USE_CASE_FRAMING_SOURCES]).toEqual(["auto", "static", "tracking"])
  })

  it("auto follows the Speaker Frames price flag", () => {
    expect(usecaseAutoFraming({ framesPriced: true })).toBe("tracking")
    expect(usecaseAutoFraming({ framesPriced: false })).toBe("static")
    expect(usecaseAutoFraming()).toBe(SPEAKER_FRAMES_PRICED ? "tracking" : "static")
  })

  it("absent reads as the caller's default; unknown values too", () => {
    expect(resolveUseCaseFramingSource(undefined, "static")).toBe("static")
    expect(resolveUseCaseFramingSource("nonsense", "static")).toBe("static")
    expect(resolveUseCaseFramingSource(3, "static")).toBe("static")
    expect(resolveUseCaseFramingSource("tracking", "static")).toBe("tracking")
    expect(resolveUseCaseFramingSource("static", "tracking")).toBe("static")
    expect(resolveUseCaseFramingSource("auto", "static")).toBe(usecaseAutoFraming())
    // An `auto` default resolves too: a resolved choice is never `auto`.
    expect(resolveUseCaseFramingSource(undefined, "auto")).toBe(usecaseAutoFraming())
  })
})

describe("the Speaker Frames step a framed chain adds when tracking", () => {
  it("is one Speaker Frames node at a fixed id, on the shared grid", () => {
    const n = usecaseFramesNode(3, 2)
    expect(n).toEqual({ id: USE_CASE_FRAMES_NODE_ID, type: "speaker-frames", position: { x: 960, y: 440 }, data: { fieldMappings: {}, label: "Follow Faces" } })
    expect(USE_CASE_FRAMES_NODE_ID).toBe("uc-frames")
  })

  const wires = (edges: ReturnType<typeof usecaseFramesWires>) => edges.map((e) => `${e.source}.${e.sourceHandle}>${e.target}.${e.targetHandle}`)

  it("reads the edit and the transcript, and its tracks feed the render", () => {
    const edges = usecaseFramesWires({ edl: { nodeId: "uc-plan", handle: "edl" }, transcript: { nodeId: "uc-transcribe", handle: "json" }, renderId: "uc-render" })
    expect(wires(edges)).toEqual(["uc-plan.edl>uc-frames.edl", "uc-transcribe.json>uc-frames.transcript", "uc-frames.tracks>uc-render.tracks"])
    expect(edges.every((e) => e.id === `uc-e-${e.source}-${e.sourceHandle}-${e.target}-${e.targetHandle}`)).toBe(true)
  })

  it("in video mode, samples the video instead of an edit", () => {
    const edges = usecaseFramesWires({ video: { nodeId: "uc-source", handle: "video" }, transcript: { nodeId: "uc-transcribe", handle: "json" }, renderId: "uc-render" })
    expect(wires(edges)).toEqual(["uc-source.video>uc-frames.video", "uc-transcribe.json>uc-frames.transcript", "uc-frames.tracks>uc-render.tracks"])
  })

  it("refuses a call that names neither an edit nor a video", () => {
    expect(() => usecaseFramesWires({ transcript: { nodeId: "uc-transcribe", handle: "json" }, renderId: "uc-render" })).toThrow(/edit or a video/)
  })
})

/**
 * Tighten Episode framed and following faces (decided 2026-10-17): a framed
 * episode whose framing source resolves to `tracking` adds Speaker Frames
 * after the render; its tracks feed Speaker View. Absent (a saved node, an
 * API caller that never sends it) reads `static`: the even split, exactly as
 * before. The resolved settings carry `framingSource` only when it is
 * `tracking` (a setting equal to the behaviour before it is omitted), so every
 * stored run's settings read as they always did.
 */
describe("Tighten Episode framed and following faces", () => {
  const video = { url: "https://r2/ep.mp4", kind: "video" as const, durationSec: 3600 }
  const resolve = (framingSource?: string, extra: Record<string, unknown> = {}) =>
    resolveTightenEpisodeSettings({ ...TIGHTEN_EPISODE_DEFAULTS, framing: { aspect: "9:16", layout: "stacked" }, ...(framingSource ? { framingSource } : {}), ...extra }, "video")
  const framed = (framingSource?: string, extra: Record<string, unknown> = {}) => buildTightenEpisodeGraph(resolve(framingSource, extra), { media: video })
  const wires = (g: { readonly edges: ReadonlyArray<{ source: string; sourceHandle: string; target: string; targetHandle: string }> }) =>
    g.edges.map((e) => `${e.source}.${e.sourceHandle}>${e.target}.${e.targetHandle}`)
  const hasFrames = (g: ReturnType<typeof framed>) => g.nodes.some((n) => n.type === "speaker-frames")

  it("no framingSource: the static split, exactly as before (a saved node keeps its run), and no key in the settings", () => {
    expect(hasFrames(framed())).toBe(false)
    expect("framingSource" in resolve()).toBe(false)
    expect(framed("static")).toEqual(framed())
    expect("framingSource" in resolve("static")).toBe(false)
    expect(hasFrames(framed("nonsense"))).toBe(false)
  })

  it("tracking: Speaker Frames reads the plan's edit and the transcript; its tracks feed Speaker View", () => {
    const g = framed("tracking")
    expect(resolve("tracking").framingSource).toBe("tracking")
    expect(g.nodes.find((n) => n.id === USE_CASE_FRAMES_NODE_ID)!.type).toBe("speaker-frames")
    expect(wires(g)).toEqual(expect.arrayContaining(["uc-plan.edl>uc-frames.edl", "uc-transcribe.json>uc-frames.transcript", "uc-frames.tracks>uc-render.tracks"]))
  })

  it("tracking adds only Speaker Frames and its three wires: everything else is the static graph", () => {
    const s = framed()
    const t = framed("tracking")
    expect(t.nodes.filter((n) => n.id !== USE_CASE_FRAMES_NODE_ID)).toEqual(s.nodes)
    expect(t.edges.filter((e) => e.source !== USE_CASE_FRAMES_NODE_ID && e.target !== USE_CASE_FRAMES_NODE_ID)).toEqual(s.edges)
    expect(t.outputMap).toEqual(s.outputMap)
  })

  it("auto follows the Speaker Frames price flag", () => {
    expect(hasFrames(framed("auto"))).toBe(usecaseAutoFraming() === "tracking")
    expect("framingSource" in resolve("auto")).toBe(usecaseAutoFraming() === "tracking")
  })

  it("tracking without framing (Apply EDL) adds nothing — there is nothing to frame", () => {
    const settings = resolveTightenEpisodeSettings({ framingSource: "tracking" }, "video")
    expect("framingSource" in settings).toBe(false)
    expect(hasFrames(buildTightenEpisodeGraph(settings, { media: video }))).toBe(false)
  })

  it("an audio episode (audio recording, or audio output) never tracks", () => {
    const raw = { framing: { aspect: "9:16", layout: "stacked" }, framingSource: "tracking" }
    expect("framingSource" in resolveTightenEpisodeSettings(raw, "audio")).toBe(false)
    expect("framingSource" in resolveTightenEpisodeSettings({ ...raw, output: "audio" }, "video")).toBe(false)
    const g = buildTightenEpisodeGraph(resolveTightenEpisodeSettings(raw, "audio"), { media: { url: "https://r2/ep.m4a", kind: "audio" } })
    expect(hasFrames(g)).toBe(false)
  })

  it("the descriptor resolves it, and lists it among the settings a run sends", () => {
    const d = usecaseDescriptor("tighten-episode")
    expect(d.settingKeys).toContain("framingSource")
    expect(d.resolveSettings({ framing: { aspect: "9:16", layout: "stacked" }, framingSource: "tracking" }, "video")).toMatchObject({ framingSource: "tracking" })
  })

  it("review on: Speaker Frames runs in the first run; Render final never re-runs it (its tracks are read at rest)", () => {
    const g = framed("tracking", { reviewBeforeRender: true })
    expect(initialRunNodeIds(g)).toContain(USE_CASE_FRAMES_NODE_ID)
    expect([...renderFinalRunSet("uc-render", g.nodes, g.edges)]).not.toContain(USE_CASE_FRAMES_NODE_ID)
  })

  const cam = (n: number) => ({ url: `https://r2/c${n}.mp4`, kind: "video" as const, durationSec: 3600 })
  const masterAudio = { url: "https://r2/m.wav", kind: "audio" as const, durationSec: 3600 }
  const multicam = (framingSource: string | undefined, sources: UseCaseSources, extra: Record<string, unknown> = {}) => {
    const shape = { recordings: usecaseRecordings(sources).length, masterAudio: !!sources.masterAudio }
    return buildTightenEpisodeGraph(
      resolveTightenEpisodeSettings({ framing: { aspect: "9:16", layout: "stacked" }, ...(framingSource ? { framingSource } : {}), ...extra }, "video", shape),
      sources,
    )
  }

  it("multicam + tracking: Speaker Frames reads the switched edit and its renamed transcript", () => {
    const g = multicam("tracking", { media: cam(1), moreMedia: [cam(2)], masterAudio })
    expect(wires(g)).toEqual(expect.arrayContaining(["uc-switch.edl>uc-frames.edl", "uc-switch.transcript>uc-frames.transcript", "uc-frames.tracks>uc-render.tracks"]))
    expect(wires(g).some((w) => w.startsWith("uc-plan.edl>uc-frames"))).toBe(false)
  })

  it("one camera + Master audio (no switch) + tracking: Speaker Frames reads the plan's edit and Transcribe's transcript", () => {
    const g = multicam("tracking", { media: cam(1), masterAudio })
    expect(g.nodes.some((n) => n.type === "camera-switch")).toBe(false)
    expect(wires(g)).toEqual(expect.arrayContaining(["uc-plan.edl>uc-frames.edl", "uc-transcribe.json>uc-frames.transcript", "uc-frames.tracks>uc-render.tracks"]))
  })

  it("multicam without tracking is the multicam graph as before", () => {
    const sources = { media: cam(1), moreMedia: [cam(2)], masterAudio }
    expect(multicam(undefined, sources).nodes.some((n) => n.type === "speaker-frames")).toBe(false)
    const s = multicam("static", sources)
    const t = multicam("tracking", sources)
    expect(t.nodes.filter((n) => n.id !== USE_CASE_FRAMES_NODE_ID)).toEqual(s.nodes)
    expect(t.edges.filter((e) => e.source !== USE_CASE_FRAMES_NODE_ID && e.target !== USE_CASE_FRAMES_NODE_ID)).toEqual(s.edges)
  })

  it("multicam, review on: Render final re-runs Camera Switch but never Speaker Frames", () => {
    const g = multicam("tracking", { media: cam(1), moreMedia: [cam(2), cam(3)], masterAudio }, { reviewBeforeRender: true })
    expect(initialRunNodeIds(g)).toContain(USE_CASE_FRAMES_NODE_ID)
    const runs = renderFinalRunSet("uc-render", g.nodes, g.edges)
    expect(runs.has("uc-switch")).toBe(true)
    expect(runs.has(USE_CASE_FRAMES_NODE_ID)).toBe(false)
  })

  it("multicam audio episode never tracks", () => {
    const g = multicam("tracking", { media: cam(1), moreMedia: [cam(2)], masterAudio }, { output: "audio" })
    expect(g.nodes.some((n) => n.type === "speaker-frames")).toBe(false)
  })
})
