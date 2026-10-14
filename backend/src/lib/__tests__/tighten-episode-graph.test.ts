/**
 * Tighten Episode's built chain (`@nodaro/render-rules`): the settings
 * resolver, the builder's goldens per branch (output, framing, captions,
 * music, review), the run-up-to-the-render subset, and the stored snapshot +
 * its hash. render-rules has no runner of its own; rebuild it
 * (`npm -w @nodaro/render-rules run build`) before running this.
 */
import { describe, it, expect } from "vitest"
import {
  TIGHTEN_EPISODE_DEFAULTS,
  TIGHTEN_NODE_IDS as ID,
  ancestorsOf,
  buildTightenEpisodeGraph,
  descendantsOf,
  drawnTightenFraming,
  initialRunNodeIds,
  isStoredInlineGraph,
  resolveTightenEpisodeSettings,
  tightenFramingLayouts,
  toStoredInlineGraph,
  usecaseFeeCreditId,
  usecaseGraphHash,
  type TightenEpisodeSettings,
} from "@nodaro/render-rules"

const VIDEO = { url: "https://r2/ep.mp4", kind: "video" as const, durationSec: 3600 }
const AUDIO = { url: "https://r2/ep.m4a", kind: "audio" as const, durationSec: 3300 }
const s = (over: Partial<TightenEpisodeSettings> = {}): TightenEpisodeSettings => ({ ...TIGHTEN_EPISODE_DEFAULTS, ...over })
const wires = (g: ReturnType<typeof buildTightenEpisodeGraph>) =>
  g.edges.map((e) => `${e.source}.${e.sourceHandle}->${e.target}.${e.targetHandle}`)
const typeOf = (g: ReturnType<typeof buildTightenEpisodeGraph>) => Object.fromEntries(g.nodes.map((n) => [n.id, n.type]))
const dataOf = (g: ReturnType<typeof buildTightenEpisodeGraph>, id: string) => g.nodes.find((n) => n.id === id)!.data

const CORE = [
  "uc-source.video->uc-transcribe.audio",
  "uc-source.video->uc-silence.in",
  "uc-source.video->uc-plan.sources",
  "uc-source.video->uc-render.sources",
  "uc-transcribe.json->uc-plan.transcript",
  "uc-silence.json->uc-plan.silence",
  "uc-plan.edl->uc-render.edl",
  "uc-transcribe.json->uc-render.transcript",
]

describe("resolveTightenEpisodeSettings", () => {
  it("defaults: video out, captions on (word-highlight), review off, standard tier, duck 75", () => {
    expect(resolveTightenEpisodeSettings(undefined, "video")).toEqual(TIGHTEN_EPISODE_DEFAULTS)
    expect(TIGHTEN_EPISODE_DEFAULTS).toEqual({
      output: "video", framing: null, captions: true, captionStyle: "word-highlight", reviewBeforeRender: false,
      planTier: "standard", instructions: "", styleGuide: "", musicDuckAmount: 75,
    })
  })
  it("an audio recording forces audio output and no captions", () => {
    expect(resolveTightenEpisodeSettings({ output: "video", captions: true }, "audio")).toMatchObject({ output: "audio", captions: false })
  })
  it("a video recording may ask for an audio episode (captions then off)", () => {
    expect(resolveTightenEpisodeSettings({ output: "audio", captions: true }, "video")).toMatchObject({ output: "audio", captions: false })
  })
  it("framing: aspect + layout on a video episode; none on audio; unknown values dropped", () => {
    expect(resolveTightenEpisodeSettings({ framing: { aspect: "9:16", layout: "stacked" } }, "video").framing).toEqual({ aspect: "9:16", layout: "stacked" })
    expect(resolveTightenEpisodeSettings({ framing: { aspect: "9:16", layout: "stacked" } }, "audio").framing).toBeNull()
    expect(resolveTightenEpisodeSettings({ framing: { aspect: "3:2", layout: "stacked" } }, "video").framing).toBeNull()
    expect(resolveTightenEpisodeSettings({ framing: { aspect: "9:16", layout: "carousel" } }, "video").framing).toBeNull()
  })
  it("a layout Speaker View does not draw at the aspect is snapped as the render snaps it (its twin)", () => {
    expect(resolveTightenEpisodeSettings({ framing: { aspect: "9:16", layout: "side-by-side" } }, "video").framing).toEqual({ aspect: "9:16", layout: "stacked" })
    expect(resolveTightenEpisodeSettings({ framing: { aspect: "16:9", layout: "stacked" } }, "video").framing).toEqual({ aspect: "16:9", layout: "side-by-side" })
  })
  it("a drawable layout is kept as asked", () => {
    for (const layout of ["auto", "single", "grid", "pip"] as const) {
      expect(resolveTightenEpisodeSettings({ framing: { aspect: "9:16", layout } }, "video").framing).toEqual({ aspect: "9:16", layout })
    }
  })
  it("the built Speaker View render carries the snapped layout", () => {
    const settings = resolveTightenEpisodeSettings({ framing: { aspect: "9:16", layout: "side-by-side" } }, "video")
    expect(dataOf(buildTightenEpisodeGraph(settings, { media: VIDEO }), ID.render)).toMatchObject({ targetAspect: "9:16", layout: "stacked" })
  })
  it("ignores unknown values instead of passing them on", () => {
    expect(resolveTightenEpisodeSettings({ planTier: "gold", captionStyle: "neon", musicDuckAmount: 400 }, "video"))
      .toMatchObject({ planTier: "standard", captionStyle: "word-highlight", musicDuckAmount: 100 })
  })
  it("returns a fresh framing object, never the caller's", () => {
    const framing = { aspect: "1:1", layout: "grid" }
    const resolved = resolveTightenEpisodeSettings({ framing }, "video")
    expect(resolved.framing).toEqual(framing)
    expect(resolved.framing).not.toBe(framing)
  })
})

describe("buildTightenEpisodeGraph — goldens", () => {
  it("video, captions off, no music, review off: the template chain rendering final", () => {
    const g = buildTightenEpisodeGraph(s({ captions: false }), { media: VIDEO })
    expect(typeOf(g)).toEqual({
      [ID.source]: "upload-video", [ID.transcribe]: "transcribe", [ID.silence]: "silence-detect",
      [ID.plan]: "edit-plan", [ID.render]: "apply-edl",
    })
    expect(wires(g)).toEqual(CORE)
    expect(dataOf(g, ID.source)).toMatchObject({ url: VIDEO.url, metadata: { durationSeconds: 3600 } })
    expect(dataOf(g, ID.transcribe)).toMatchObject({ provider: "elevenlabs-stt", language: "auto", diarize: true })
    expect(dataOf(g, ID.silence)).toMatchObject({ thresholdDb: -35, minSilenceMs: 700, padMs: 120 })
    expect(dataOf(g, ID.plan)).toMatchObject({ mode: "tighten", planTier: "standard", instructions: "", sourceOrder: [ID.source] })
    expect(dataOf(g, ID.plan)).not.toHaveProperty("executionStatus")
    expect(dataOf(g, ID.render)).toMatchObject({ output: "video", quality: "final", crossfadeMs: 0 })
    expect(g.outputMap).toEqual({
      media: { nodeId: ID.render, handle: "media" }, preview: { nodeId: ID.render, handle: "media" }, json: { nodeId: ID.plan, handle: "edl" },
      transcript: { nodeId: ID.transcribe, handle: "json" }, planNodeId: ID.plan, renderNodeId: ID.render,
    })
  })

  it("captions on: the render's media and its transcript feed Add Captions, which is the result", () => {
    const g = buildTightenEpisodeGraph(s(), { media: VIDEO })
    expect(wires(g)).toEqual([...CORE, "uc-render.media->uc-captions.in", "uc-render.json->uc-captions.transcript"])
    expect(dataOf(g, ID.captions)).toMatchObject({ style: "word-highlight", position: "bottom" })
    expect(g.outputMap.media).toEqual({ nodeId: ID.captions, handle: "video-out" })
  })

  it("a style guide rides the plan only when one is given", () => {
    expect(dataOf(buildTightenEpisodeGraph(s({ styleGuide: "keep the jokes" }), { media: VIDEO }), ID.plan)).toMatchObject({ styleGuide: "keep the jokes" })
    expect(dataOf(buildTightenEpisodeGraph(s(), { media: VIDEO }), ID.plan)).not.toHaveProperty("styleGuide")
  })

  it("review on: the render is a proxy preview; nothing else changes", () => {
    const g = buildTightenEpisodeGraph(s({ reviewBeforeRender: true }), { media: VIDEO })
    expect(dataOf(g, ID.render)).toMatchObject({ quality: "proxy" })
    expect(wires(g)).toEqual(wires(buildTightenEpisodeGraph(s(), { media: VIDEO })))
  })

  it("framing: the render is a Speaker View on automatic boxes, fed by the plan and the transcript; captions and music follow it", () => {
    const g = buildTightenEpisodeGraph(s({ framing: { aspect: "9:16", layout: "stacked" } }), { media: VIDEO, music: { url: "https://r2/bed.mp3" } })
    expect(typeOf(g)[ID.render]).toBe("speaker-view")
    expect(dataOf(g, ID.render)).toMatchObject({ quality: "final", targetAspect: "9:16", layout: "stacked", autoRegions: true })
    // The builder never draws boxes: Speaker View deals its own defaults over the speakers on screen.
    expect(dataOf(g, ID.render)).not.toHaveProperty("speakerRegions")
    expect(wires(g)).toEqual([
      ...CORE.filter((w) => w !== "uc-source.video->uc-render.sources"),
      "uc-render.video->uc-captions.in", "uc-render.transcript->uc-captions.transcript",
      "uc-render.video->uc-mix.in", "uc-music.audio->uc-mix.in",
      "uc-captions.video-out->uc-merge.in", "uc-mix.audio-out->uc-merge.in",
    ])
    expect(g.outputMap.preview).toEqual({ nodeId: ID.render, handle: "video" })
    expect(g.outputMap.renderNodeId).toBe(ID.render)
  })

  it("video + music: bed ducked under the render, ends with it, re-muxed over the captioned video", () => {
    const g = buildTightenEpisodeGraph(s({ musicDuckAmount: 60 }), { media: VIDEO, music: { url: "https://r2/bed.mp3" } })
    expect(wires(g)).toEqual([
      ...CORE,
      "uc-render.media->uc-captions.in", "uc-render.json->uc-captions.transcript",
      "uc-render.media->uc-mix.in", "uc-music.audio->uc-mix.in",
      "uc-captions.video-out->uc-merge.in", "uc-mix.audio-out->uc-merge.in",
    ])
    expect(dataOf(g, ID.mix)).toMatchObject({ trackOrder: [ID.render, ID.music], duckUnder: ID.render, duckAmount: 60, endAt: "voice" })
    expect(dataOf(g, ID.merge)).toMatchObject({ keepOriginalAudio: false })
    expect(g.outputMap.media).toEqual({ nodeId: ID.merge, handle: "video-out" })
  })

  it("video + music, captions off: the plain render is re-muxed with the mix", () => {
    const g = buildTightenEpisodeGraph(s({ captions: false }), { media: VIDEO, music: { url: "https://r2/bed.mp3" } })
    expect(wires(g)).toEqual([
      ...CORE,
      "uc-render.media->uc-mix.in", "uc-music.audio->uc-mix.in",
      "uc-render.media->uc-merge.in", "uc-mix.audio-out->uc-merge.in",
    ])
    expect(g.outputMap.media).toEqual({ nodeId: ID.merge, handle: "video-out" })
  })

  it("audio recording + music: an audio render mixed with the bed; the mix is the result", () => {
    const g = buildTightenEpisodeGraph(resolveTightenEpisodeSettings({}, "audio"), { media: AUDIO, music: { url: "https://r2/bed.mp3" } })
    expect(typeOf(g)[ID.source]).toBe("upload-audio")
    expect(wires(g)).toEqual([
      ...CORE.map((w) => w.replace("uc-source.video", "uc-source.audio")),
      "uc-render.media->uc-mix.in", "uc-music.audio->uc-mix.in",
    ])
    expect(dataOf(g, ID.render)).toMatchObject({ output: "audio" })
    expect(g.outputMap.media).toEqual({ nodeId: ID.mix, handle: "audio-out" })
  })

  it("a review-on run executes the chain up to the render; captions and music wait for Render final", () => {
    const g = buildTightenEpisodeGraph(s({ reviewBeforeRender: true }), { media: VIDEO, music: { url: "https://r2/bed.mp3" } })
    expect(initialRunNodeIds(g)).toEqual([ID.source, ID.transcribe, ID.silence, ID.plan, ID.render])
    expect(g.nodes.map((n) => n.id)).toEqual(expect.arrayContaining([ID.captions, ID.music, ID.mix, ID.merge]))
    expect(initialRunNodeIds(buildTightenEpisodeGraph(s(), { media: VIDEO }))).toBeNull()
  })

  it("an unknown source length leaves the length off (the estimate's 180-minute ceiling applies)", () => {
    const g = buildTightenEpisodeGraph(s(), { media: { url: VIDEO.url, kind: "video" } })
    expect(dataOf(g, ID.source)).not.toHaveProperty("metadata")
  })

  it("never mutates its inputs and returns fresh objects each call", () => {
    const settings = Object.freeze(s({ framing: Object.freeze({ aspect: "9:16" as const, layout: "stacked" as const }) }))
    const frozen = Object.freeze({ media: Object.freeze({ ...VIDEO }), music: Object.freeze({ url: "https://r2/bed.mp3" }) })
    const a = buildTightenEpisodeGraph(settings, frozen)
    const b = buildTightenEpisodeGraph(settings, frozen)
    expect(a).toEqual(b)
    expect(a.nodes[0]).not.toBe(b.nodes[0])
    expect(a.nodes[0]!.data).not.toBe(b.nodes[0]!.data)
  })
})

describe("graph walks (one pair, shared by every caller)", () => {
  const edges = [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
    { source: "x", target: "c" },
    { source: "c", target: "d" },
  ]
  it("ancestorsOf: every node with a path to the start, the start not included", () => {
    expect([...ancestorsOf("c", edges)].sort()).toEqual(["a", "b", "x"])
    expect([...ancestorsOf("a", edges)]).toEqual([])
  })
  it("descendantsOf: every node with a path from the start, the start not included", () => {
    expect([...descendantsOf("b", edges)].sort()).toEqual(["c", "d"])
    expect([...descendantsOf("d", edges)]).toEqual([])
  })
  it("the built graph's render reaches captions, music mix and merge, and no more", () => {
    const g = buildTightenEpisodeGraph(s(), { media: VIDEO, music: { url: "https://r2/bed.mp3" } })
    expect([...descendantsOf(ID.render, g.edges)].sort()).toEqual([ID.captions, ID.merge, ID.mix].sort())
  })
})

describe("snapshot + hash", () => {
  it("the hash is stable, 16 hex chars, and moves with any change", () => {
    const g = buildTightenEpisodeGraph(s(), { media: VIDEO })
    expect(usecaseGraphHash(g)).toMatch(/^[0-9a-f]{16}$/)
    expect(usecaseGraphHash(g)).toBe(usecaseGraphHash(buildTightenEpisodeGraph(s(), { media: VIDEO })))
    expect(usecaseGraphHash(g)).not.toBe(usecaseGraphHash(buildTightenEpisodeGraph(s({ planTier: "premium" }), { media: VIDEO })))
  })
  it("a stored snapshot carries the resolved settings, round-trips and is recognised", () => {
    const settings = resolveTightenEpisodeSettings({ framing: { aspect: "9:16", layout: "stacked" }, planTier: "premium" }, "video")
    const g = buildTightenEpisodeGraph(settings, { media: VIDEO })
    const stored = toStoredInlineGraph(g, settings)
    expect(stored.version).toBe(1)
    expect(stored.settings).toEqual(settings)
    expect(stored.settings.framing).not.toBe(settings.framing)
    expect(stored.hash).toBe(usecaseGraphHash(g))
    expect(isStoredInlineGraph(JSON.parse(JSON.stringify(stored)))).toBe(true)
  })
  it("a snapshot read back with its keys reordered (jsonb does) hashes the same", () => {
    const reverse = (o: object) => Object.fromEntries(Object.entries(o).reverse())
    const stored = toStoredInlineGraph(buildTightenEpisodeGraph(s(), { media: VIDEO, music: { url: "https://r2/bed.mp3" } }), s())
    const read = JSON.parse(JSON.stringify(stored)) as typeof stored
    const reordered = {
      ...read,
      nodes: read.nodes.map((n) => reverse({ ...n, data: reverse(n.data) }) as unknown as typeof n),
      edges: read.edges.map((e) => reverse(e) as unknown as typeof e),
      outputMap: reverse(read.outputMap) as unknown as typeof read.outputMap,
    }
    expect(usecaseGraphHash(reordered)).toBe(stored.hash)
  })
  it("the hash is over the graph alone: settings that do not change the graph do not move it", () => {
    // Music duck only reaches the graph through a mix node; without music it changes nothing the run does.
    const a = buildTightenEpisodeGraph(s({ musicDuckAmount: 75 }), { media: VIDEO })
    const b = buildTightenEpisodeGraph(s({ musicDuckAmount: 20 }), { media: VIDEO })
    expect(toStoredInlineGraph(a, s({ musicDuckAmount: 75 })).hash).toBe(toStoredInlineGraph(b, s({ musicDuckAmount: 20 })).hash)
  })
  it("refuses what is not a stored snapshot (an expunged execution holds {})", () => {
    const stored = toStoredInlineGraph(buildTightenEpisodeGraph(s(), { media: VIDEO }), s())
    expect(isStoredInlineGraph({})).toBe(false)
    expect(isStoredInlineGraph(null)).toBe(false)
    expect(isStoredInlineGraph([])).toBe(false)
    expect(isStoredInlineGraph({ version: 1, nodes: [], edges: [] })).toBe(false)
    expect(isStoredInlineGraph({ ...stored, version: 2 })).toBe(false)
    expect(isStoredInlineGraph({ ...stored, nodeType: "clip-pack" })).toBe(false)
    expect(isStoredInlineGraph({ ...stored, settings: undefined })).toBe(false)
    expect(isStoredInlineGraph({ ...stored, outputMap: { ...stored.outputMap, renderNodeId: 3 } })).toBe(false)
  })
  it("names the fee credit id", () => {
    expect(usecaseFeeCreditId("tighten-episode")).toBe("use-case-fee:tighten-episode")
  })
})

describe("the framing layouts the panel offers", () => {
  const ASPECTS = ["16:9", "9:16", "1:1", "4:5"] as const
  const ALL = ["auto", "single", "side-by-side", "stacked", "grid", "pip"] as const

  it("are the layouts Speaker View draws at the aspect as chosen", () => {
    expect(tightenFramingLayouts("16:9")).toEqual(["auto", "single", "side-by-side", "grid", "pip"])
    expect(tightenFramingLayouts("9:16")).toEqual(["auto", "single", "stacked", "grid", "pip"])
    expect(tightenFramingLayouts("1:1")).toEqual(["auto", "single", "side-by-side", "stacked", "grid", "pip"])
    expect(tightenFramingLayouts("4:5")).toEqual(["auto", "single", "stacked", "grid", "pip"])
  })

  it("are exactly the ones a run keeps: an offered pick is never snapped, any other is snapped as the run snaps it", () => {
    for (const aspect of ASPECTS) {
      const offered = tightenFramingLayouts(aspect)
      for (const layout of ALL) {
        const run = resolveTightenEpisodeSettings({ framing: { aspect, layout } }, "video").framing
        expect(run, `${aspect} ${layout}`).toEqual(drawnTightenFraming(aspect, layout))
        expect(run!.layout === layout, `${aspect} ${layout}`).toBe(offered.includes(layout))
        expect(offered, `${aspect} ${layout} snaps to an offered layout`).toContain(run!.layout)
      }
    }
  })

  it("a snapped layout is its twin at the other orientation", () => {
    expect(drawnTightenFraming("9:16", "side-by-side")).toEqual({ aspect: "9:16", layout: "stacked" })
    expect(drawnTightenFraming("16:9", "stacked")).toEqual({ aspect: "16:9", layout: "side-by-side" })
  })
})
