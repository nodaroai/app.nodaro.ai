import { describe, it, expect } from "vitest"
import {
  EPISODE_TRAILER_DEFAULTS,
  TRAILER_FORMAT_SPECS,
  TRAILER_NODE_IDS as ID,
  buildEpisodeTrailerGraph,
  initialRunNodeIds,
  resolveEpisodeTrailerSettings,
  usecaseDescriptor,
  usecaseTriesEvery,
} from "@nodaro/render-rules"

const media = { url: "https://r2/ep.mp4", kind: "video" as const, durationSec: 3600 }
const wires = (g: ReturnType<typeof buildEpisodeTrailerGraph>) => g.edges.map((e) => `${e.source}.${e.sourceHandle}>${e.target}.${e.targetHandle}`)

describe("Trailer builds transcribe → Edit Plan (trailer) → Apply EDL → [intro] → one format per choice", () => {
  it("defaults: 9:16, 1:1, 4:5; standard; review off", () => {
    expect(EPISODE_TRAILER_DEFAULTS).toEqual({ formats: ["9:16", "1:1", "4:5"], reviewBeforeRender: false, planTier: "standard", instructions: "", styleGuide: "" })
  })
  it("formats: unknown dropped, duplicates merged, in the fixed order; none left = the defaults", () => {
    expect(resolveEpisodeTrailerSettings({ formats: ["16:9", "9:16", "9:16", "2:1"] }, "video").formats).toEqual(["9:16", "16:9"])
    // Deliberately the defaults: the route refuses an empty list (400), every other reader gets a buildable graph.
    expect(resolveEpisodeTrailerSettings({ formats: [] }, "video").formats).toEqual(["9:16", "1:1", "4:5"])
    expect(resolveEpisodeTrailerSettings({ formats: ["2:1"] }, "video").formats).toEqual(["9:16", "1:1", "4:5"])
    expect(resolveEpisodeTrailerSettings(undefined, "video").formats).toEqual(["9:16", "1:1", "4:5"])
  })
  it("an unknown plan tier or a non-boolean review falls back to its default", () => {
    expect(resolveEpisodeTrailerSettings({ planTier: "ultra", reviewBeforeRender: "yes" }, "video")).toMatchObject({ planTier: "standard", reviewBeforeRender: false })
  })
  it("golden graph without an intro card", () => {
    const g = buildEpisodeTrailerGraph(EPISODE_TRAILER_DEFAULTS, { media })
    expect(g.nodes.map((n) => [n.id, n.type])).toEqual([
      [ID.source, "upload-video"], [ID.transcribe, "transcribe"], [ID.plan, "edit-plan"], [ID.render, "apply-edl"],
      ["uc-format-9x16", "social-media-format"], ["uc-format-1x1", "social-media-format"], ["uc-format-4x5", "social-media-format"],
    ])
    expect(g.nodes.find((n) => n.id === ID.plan)!.data).toMatchObject({ mode: "trailer", planTier: "standard", sourceOrder: [ID.source] })
    expect(g.nodes.find((n) => n.id === ID.render)!.data).toMatchObject({ output: "video", quality: "final", crossfadeMs: 0 })
    expect(g.nodes.find((n) => n.id === "uc-format-9x16")!.data).toMatchObject({ specKey: "instagram:story-reel", method: "pad", padColor: "#000000" })
    expect(wires(g)).toEqual([
      `${ID.source}.video>${ID.transcribe}.audio`, `${ID.source}.video>${ID.plan}.sources`, `${ID.source}.video>${ID.render}.sources`,
      `${ID.transcribe}.json>${ID.plan}.transcript`, `${ID.plan}.edl>${ID.render}.edl`,
      `${ID.render}.media>uc-format-9x16.media`, `${ID.render}.media>uc-format-1x1.media`, `${ID.render}.media>uc-format-4x5.media`,
    ])
    expect(g.outputMap).toEqual({
      kind: "formats",
      formats: [
        { format: "9:16", ref: { nodeId: "uc-format-9x16", handle: "media" } },
        { format: "1:1", ref: { nodeId: "uc-format-1x1", handle: "media" } },
        { format: "4:5", ref: { nodeId: "uc-format-4x5", handle: "media" } },
      ],
      preview: { nodeId: ID.render, handle: "media" },
      json: { nodeId: ID.plan, handle: "edl" },
      transcript: { nodeId: ID.transcribe, handle: "json" },
      planNodeId: ID.plan,
      renderNodeId: ID.render,
    })
  })
  it("every format is padded, never cropped (16:9 is a 1920×1080 landscape)", () => {
    const g = buildEpisodeTrailerGraph({ ...EPISODE_TRAILER_DEFAULTS, formats: ["9:16", "1:1", "4:5", "16:9"] }, { media })
    const formats = g.nodes.filter((n) => n.type === "social-media-format")
    expect(formats).toHaveLength(4)
    for (const f of formats) expect(f.data).toMatchObject({ method: "pad", padColor: "#000000" })
    expect(TRAILER_FORMAT_SPECS["16:9"]).toMatchObject({ specKey: "x:x-video", platform: "x", contentType: "x-video" })
  })
  it("an intro card plays first through Combine Videos, which every format reads", () => {
    const g = buildEpisodeTrailerGraph({ ...EPISODE_TRAILER_DEFAULTS, formats: ["16:9"] }, { media, introCard: { url: "https://r2/card.mp4" } })
    expect(g.nodes.find((n) => n.id === ID.combine)!.data).toMatchObject({ clipOrder: [ID.intro, ID.render], transition: "cut" })
    expect(wires(g)).toEqual(expect.arrayContaining([
      `${ID.intro}.video>${ID.combine}.in`, `${ID.render}.media>${ID.combine}.in`, `${ID.combine}.video>uc-format-16x9.media`,
    ]))
    expect(g.nodes.find((n) => n.id === "uc-format-16x9")!.data).toMatchObject({ specKey: TRAILER_FORMAT_SPECS["16:9"].specKey })
  })
  it("the intro card's probed length is declared on its node, as the recording's is", () => {
    const g = buildEpisodeTrailerGraph(EPISODE_TRAILER_DEFAULTS, { media, introCard: { url: "https://r2/card.mp4", durationSec: 6 } })
    expect(g.nodes.find((n) => n.id === ID.intro)!.data).toMatchObject({ url: "https://r2/card.mp4", metadata: { durationSeconds: 6 } })
    const unknown = buildEpisodeTrailerGraph(EPISODE_TRAILER_DEFAULTS, { media, introCard: { url: "https://r2/card.mp4" } })
    expect(unknown.nodes.find((n) => n.id === ID.intro)!.data).not.toHaveProperty("metadata")
  })
  it("review on: the render is a preview and the first run stops at it", () => {
    const g = buildEpisodeTrailerGraph({ ...EPISODE_TRAILER_DEFAULTS, reviewBeforeRender: true }, { media })
    expect(g.nodes.find((n) => n.id === ID.render)!.data.quality).toBe("proxy")
    expect(initialRunNodeIds(g)).toEqual([ID.source, ID.transcribe, ID.plan, ID.render])
  })
  it("its formats try every one (decided 2026-10-18), whichever formats a run chose; no other use-case node's steps do", () => {
    const formatIds = Object.values(TRAILER_FORMAT_SPECS).map((s) => s.nodeId)
    expect(usecaseDescriptor("episode-trailer").triesEvery).toEqual(formatIds)
    expect([...usecaseTriesEvery({ nodeType: "episode-trailer" })]).toEqual(formatIds)
    // Every format node a build makes is in the set, and nothing else is.
    const g = buildEpisodeTrailerGraph({ ...EPISODE_TRAILER_DEFAULTS, formats: ["9:16", "1:1", "4:5", "16:9"] }, { media, introCard: { url: "https://r2/card.mp4" } })
    expect(g.nodes.filter((n) => usecaseTriesEvery(g).has(n.id)).map((n) => n.type)).toEqual(["social-media-format", "social-media-format", "social-media-format", "social-media-format"])
    for (const type of ["tighten-episode", "episode-chapters"]) expect(usecaseTriesEvery({ nodeType: type }).size).toBe(0)
    expect(usecaseTriesEvery({ nodeType: "not-a-use-case" }).size).toBe(0)
  })
  it("three cameras + Master audio: the plan reads every recording with its role and the offsets; Camera Switch sits between the plan and the render (decided 2026-10-17)", () => {
    const cam = (n: number) => ({ url: `https://r2/c${n}.mp4`, kind: "video" as const, durationSec: 3600 })
    const g = buildEpisodeTrailerGraph(
      resolveEpisodeTrailerSettings({ cameras: { wide: 3 } }, "video", { recordings: 3, masterAudio: true }),
      { media: cam(1), moreMedia: [cam(2), cam(3)], masterAudio: { url: "https://r2/m.wav", kind: "audio", durationSec: 3600 } },
    )
    expect(wires(g)).toEqual(expect.arrayContaining([
      "uc-master.audio>uc-transcribe.audio", "uc-sync.json>uc-plan.offsets", "uc-plan.edl>uc-switch.edl", "uc-map.json>uc-switch.speakerMap", "uc-switch.edl>uc-render.edl",
    ]))
    expect(g.outputMap).toMatchObject({ kind: "formats", multicam: { map: { nodeId: "uc-map", handle: "json" } } })
  })
  it("one recording: no multicam step and no `multicam` key (the identity fixture's Trailer rows pin the hashes)", () => {
    const g = buildEpisodeTrailerGraph(resolveEpisodeTrailerSettings({}, "video"), { media: { url: "https://r2/c1.mp4", kind: "video", durationSec: 3600 } })
    expect(g.nodes.some((n) => ["audio-sync", "speaker-map", "camera-switch"].includes(n.type))).toBe(false)
    expect("multicam" in g.outputMap).toBe(false)
  })
  it("never shares objects between builds", () => {
    const a = buildEpisodeTrailerGraph(EPISODE_TRAILER_DEFAULTS, { media })
    const b = buildEpisodeTrailerGraph(EPISODE_TRAILER_DEFAULTS, { media })
    expect(a).toEqual(b)
    expect(a.nodes[0]).not.toBe(b.nodes[0])
  })
})
