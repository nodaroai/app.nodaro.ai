import { describe, it, expect } from "vitest"
import {
  CLIP_PACK_DEFAULTS,
  CLIP_PACK_DEFAULT_FRAMING,
  CLIP_PACK_NODE_IDS as ID,
  buildClipPackGraph,
  initialRunNodeIds,
  resolveClipPackSettings,
  tightenFramingLayouts,
  usecaseDescriptor,
  usecaseTriesEvery,
} from "@nodaro/render-rules"

const video = { url: "https://r2/ep.mp4", kind: "video" as const, durationSec: 3600 }
const wires = (g: ReturnType<typeof buildClipPackGraph>) =>
  g.edges.map((e) => `${e.source}.${e.sourceHandle}>${e.target}.${e.targetHandle}${e.data ? "(each)" : ""}`)

describe("Clip Pack builds transcribe → Edit Plan (clips) → one render per clip → [captions per clip]", () => {
  it("defaults (decided 2026-10-14): 8 clips of ~60 s, 9:16 stacked / pan / scale, karaoke captions, review off", () => {
    expect(CLIP_PACK_DEFAULTS).toMatchObject({ count: 8, targetDurationSec: 60, framing: CLIP_PACK_DEFAULT_FRAMING, captions: true, captionStyle: "karaoke", reviewBeforeRender: false, planTier: "standard" })
    expect(CLIP_PACK_DEFAULT_FRAMING).toEqual({ aspect: "9:16", layout: "stacked", switchType: "pan", emphasisStyle: "scale" })
  })

  it("clamps and falls back: count 1–50, length 5–180 s, an audio recording gets no framing and no captions", () => {
    expect(resolveClipPackSettings({ count: 200, targetDurationSec: 2 }, "video")).toMatchObject({ count: 50, targetDurationSec: 5 })
    expect(resolveClipPackSettings({ count: 0.4, targetDurationSec: 400 }, "video")).toMatchObject({ count: 1, targetDurationSec: 180 })
    expect(resolveClipPackSettings({ count: "x" }, "video").count).toBe(8)
    expect(resolveClipPackSettings({}, "audio")).toMatchObject({ framing: null, captions: false })
    expect(resolveClipPackSettings({ framing: null }, "video").framing).toBeNull()
    expect(resolveClipPackSettings({ framing: { aspect: "9:16", layout: "stacked", switchType: "warp" } }, "video").framing).toEqual(CLIP_PACK_DEFAULT_FRAMING)
  })

  it("framing is read field by field: a bad field takes its default, the valid ones are kept (decided 2026-10-18)", () => {
    // A bad emphasis never swaps out the aspect and layout.
    expect(resolveClipPackSettings({ framing: { aspect: "1:1", layout: "side-by-side", emphasisStyle: "glow" } }, "video").framing)
      .toEqual({ aspect: "1:1", layout: "side-by-side", switchType: "pan", emphasisStyle: "scale" })
    // A bad switch the same.
    expect(resolveClipPackSettings({ framing: { aspect: "16:9", layout: "side-by-side", switchType: "warp", emphasisStyle: "border+dim" } }, "video").framing)
      .toEqual({ aspect: "16:9", layout: "side-by-side", switchType: "pan", emphasisStyle: "border+dim" })
    // A missing layout is the default stacked, then snapped as Speaker View draws it at the aspect.
    expect(resolveClipPackSettings({ framing: { aspect: "1:1" } }, "video").framing).toEqual({ ...CLIP_PACK_DEFAULT_FRAMING, aspect: "1:1", layout: "stacked" })
    expect(tightenFramingLayouts("16:9")).not.toContain("stacked")
    expect(resolveClipPackSettings({ framing: { aspect: "16:9" } }, "video").framing).toMatchObject({ aspect: "16:9", layout: "side-by-side" })
    // An unknown aspect alone takes the default aspect, keeping the layout.
    expect(resolveClipPackSettings({ framing: { aspect: "21:9", layout: "single" } }, "video").framing).toMatchObject({ aspect: "9:16", layout: "single" })
    // Not an object at all: the default framing.
    expect(resolveClipPackSettings({ framing: "on" }, "video").framing).toEqual(CLIP_PACK_DEFAULT_FRAMING)
    // "none" and repeated atoms.
    expect(resolveClipPackSettings({ framing: { aspect: "9:16", layout: "stacked", emphasisStyle: "none" } }, "video").framing!.emphasisStyle).toBe("none")
    expect(resolveClipPackSettings({ framing: { aspect: "9:16", layout: "stacked", emphasisStyle: "scale+scale" } }, "video").framing!.emphasisStyle).toBe("scale")
  })

  it("golden graph with the default framing", () => {
    const g = buildClipPackGraph(CLIP_PACK_DEFAULTS, { media: video })
    expect(g.nodes.map((n) => [n.id, n.type])).toEqual([[ID.source, "upload-video"], [ID.transcribe, "transcribe"], [ID.plan, "edit-plan"], [ID.render, "speaker-view"], [ID.captions, "add-captions"]])
    expect(g.nodes.find((n) => n.id === ID.plan)!.data).toMatchObject({ mode: "clips", count: 8, targetDurationSec: 60, targetAspect: "9:16", planTier: "standard" })
    expect(g.nodes.find((n) => n.id === ID.render)!.data).toMatchObject({ quality: "final", targetAspect: "9:16", layout: "stacked", switchType: "pan", emphasisStyle: "scale", autoRegions: true })
    expect(g.nodes.find((n) => n.id === ID.captions)!.data).toMatchObject({ style: "karaoke", wordLevel: true, autoTranscribe: true })
    expect(wires(g)).toEqual([
      `${ID.source}.video>${ID.transcribe}.audio`, `${ID.source}.video>${ID.plan}.sources`,
      `${ID.transcribe}.json>${ID.plan}.transcript`, `${ID.plan}.edl>${ID.render}.edl`, `${ID.transcribe}.json>${ID.render}.transcript`,
      `${ID.render}.video>${ID.captions}.in(each)`,
    ])
    expect(g.outputMap).toEqual({
      kind: "clips",
      media: { nodeId: ID.captions, handle: "video-out" },
      preview: { nodeId: ID.render, handle: "video" },
      json: { nodeId: ID.plan, handle: "edl" },
      transcript: { nodeId: ID.transcribe, handle: "json" },
      planNodeId: ID.plan,
      renderNodeId: ID.render,
    })
  })

  it("no framing: Apply EDL at the recording's shape, the template's chain", () => {
    const g = buildClipPackGraph({ ...CLIP_PACK_DEFAULTS, framing: null }, { media: video })
    expect(g.nodes.find((n) => n.id === ID.render)!.type).toBe("apply-edl")
    expect(g.nodes.find((n) => n.id === ID.plan)!.data).not.toHaveProperty("targetAspect")
    expect(wires(g)).toContain(`${ID.source}.video>${ID.render}.sources`)
    expect(wires(g)).toContain(`${ID.render}.media>${ID.captions}.in(each)`)
    expect(wires(g)).not.toContain(`${ID.transcribe}.json>${ID.render}.transcript`)
  })

  it("an audio recording: audio clips, nothing after the render", () => {
    const g = buildClipPackGraph(resolveClipPackSettings({}, "audio"), { media: { url: "https://r2/ep.m4a", kind: "audio" } })
    expect(g.nodes.find((n) => n.id === ID.source)!.type).toBe("upload-audio")
    expect(g.nodes.find((n) => n.id === ID.render)!.data).toMatchObject({ output: "audio" })
    expect(g.nodes.some((n) => n.id === ID.captions)).toBe(false)
    expect(g.outputMap).toMatchObject({ media: { nodeId: ID.render, handle: "media" } })
  })

  it("review on: the first run stops at the per-clip previews", () => {
    const g = buildClipPackGraph({ ...CLIP_PACK_DEFAULTS, reviewBeforeRender: true }, { media: video })
    expect(g.nodes.find((n) => n.id === ID.render)!.data).toMatchObject({ quality: "proxy" })
    expect(initialRunNodeIds(g)).toEqual([ID.source, ID.transcribe, ID.plan, ID.render])
  })

  it("its registry entry: up to six recordings and a Master audio in, audio allowed, reviewable, a clip set", () => {
    const d = usecaseDescriptor("clip-pack")
    expect(d).toMatchObject({ label: "Clip Pack", route: "/v1/clip-pack", needsVideo: false, maxRecordings: 6, inputs: ["media", "masterAudio"], inputNodeIds: { media: ID.source, masterAudio: "uc-master" }, reviewable: true, resultKind: "clips" })
    expect(d.settingKeys).toEqual(["count", "targetDurationSec", "framing", "captions", "captionStyle", "reviewBeforeRender", "planTier", "instructions", "styleGuide", "cameras", "framingSource"])
    expect(d.build(d.resolveSettings({}, "video"), { media: video })).toEqual(buildClipPackGraph(CLIP_PACK_DEFAULTS, { media: video }))
  })

  it("its render, its captions and (on several cameras) its per-clip switch try every clip — the switch last; Tighten's and Chapters' steps do not", () => {
    expect(usecaseDescriptor("clip-pack").triesEvery).toEqual([ID.render, ID.captions, "uc-switch"])
    expect([...usecaseTriesEvery({ nodeType: "clip-pack" })]).toEqual([ID.render, ID.captions, "uc-switch"])
    // A Trailer's are its formats (episode-trailer-graph.test.ts); Tighten's and Chapters' steps keep the default.
    for (const type of ["tighten-episode", "episode-chapters"]) expect(usecaseTriesEvery({ nodeType: type }).size).toBe(0)
    expect(usecaseTriesEvery({ nodeType: "not-a-use-case" }).size).toBe(0)
  })

  it("is pure: fresh objects every call, the defaults never shared", () => {
    const a = buildClipPackGraph(CLIP_PACK_DEFAULTS, { media: video })
    const b = buildClipPackGraph(CLIP_PACK_DEFAULTS, { media: video })
    expect(a).toEqual(b)
    expect(a.nodes[0]).not.toBe(b.nodes[0])
    expect(resolveClipPackSettings({}, "video").framing).not.toBe(CLIP_PACK_DEFAULT_FRAMING)
  })
})
