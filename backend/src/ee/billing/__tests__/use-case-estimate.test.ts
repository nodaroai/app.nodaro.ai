// @test-watches backend/src/lib/tutorial-seed/templates/podcast-trailer-formats.json backend/src/lib/tutorial-seed/templates/podcast-clip-pack.json
/**
 * A use-case node's estimate is its built chain, wired to its real source and
 * priced by the ordinary rules, plus its per-run fee (decided 2026-10-13).
 * Static prices, unmarked; the render is quoted at the episode's length, and
 * Speaker View at its complex rate before the edit is known.
 *
 * The engine is tested at its static rows. The public docs state the CHARGED
 * price (docs/nodes/processing-video/tighten-episode.md, episode-chapters.md,
 * episode-trailer.md and clip-pack.md, "What the estimate shows"), so each worked example there is pinned in this file:
 * its steps, as price ids, sum to the engine's figure at the static rows, and
 * the same steps priced by `statedPrices()` (the rule the docs census holds
 * every figure to) sum to the figure the page states.
 *
 * Trailer's parity reference is the shipped `podcast-trailer-formats` template
 * itself (`templateTwin`): the chain the builder emits, priced as hand-built.
 * Clip Pack's is the shipped `podcast-clip-pack` template (`clipPackTemplateTwin`).
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect, vi } from "vitest"
vi.mock("@/lib/config.js", async (orig) => ({ ...(await orig<typeof import("@/lib/config.js")>()), hasCredits: () => false }))
const flag = vi.hoisted(() => ({ on: true }))
vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => flag.on }))
import { CREDIT_COSTS, CreditsService, STATIC_CREDIT_COSTS, estimateRunSetCredits, estimateWorkflowCredits } from "../credits.js"
import { statedPrices } from "../stated-prices.js"
import { EDITED_EDL_VERSION, editPlanBasis } from "@nodaro/shared/edl"
import {
  EPISODE_TRAILER_DEFAULTS,
  buildEpisodeTrailerGraph,
  buildTightenEpisodeGraph,
  editPlanRenderEstimateLength,
  renderFinalRunSet,
  renderRunOverrides,
  TIGHTEN_EPISODE_DEFAULTS,
  toStoredInlineGraph,
} from "@nodaro/render-rules"

const video = (sec: number) => ({ id: "rec", type: "upload-video", data: { url: "https://r2/ep.mp4", metadata: { durationSeconds: sec } } })
const audio = (sec: number) => ({ id: "rec", type: "upload-audio", data: { url: "https://r2/ep.m4a", metadata: { durationSeconds: sec } } })
const bed = { id: "bed", type: "upload-audio", data: { url: "https://r2/bed.mp3" } }
const node = (data: Record<string, unknown>) => ({ id: "t1", type: "tighten-episode", data: { label: "Tighten Episode", ...data } })
const wire = (srcHandle: "video" | "audio") => ({ source: "rec", target: "t1", sourceHandle: srcHandle, targetHandle: "media" })
const music = { source: "bed", target: "t1", sourceHandle: "audio", targetHandle: "music" }
const framed = { framing: { aspect: "9:16", layout: "stacked" } }
const chapters = (data: Record<string, unknown>) => ({ id: "c1", type: "episode-chapters", data: { label: "Chapters", ...data } })
const chaptersWire = (srcHandle: "video" | "audio") => ({ source: "rec", target: "c1", sourceHandle: srcHandle, targetHandle: "media" })

/** One step of a worked example: a price id and its units (minutes for a per-minute row; Edit Plan's
 *  stepped ids are not static rows, so its per-minute row stands in at the step's minutes). */
type Step = readonly [id: string, units?: number]
const listOf = (steps: readonly Step[]) => steps.reduce((t, [id, units = 1]) => t + STATIC_CREDIT_COSTS[id]! * units, 0)
const chargedOf = (steps: readonly Step[]) => steps.reduce((t, [id, units = 1]) => t + statedPrices().credits(id, units)!, 0)

describe("Tighten Episode estimate = its chain + 10 (static prices)", () => {
  it("(i) video 60 min, captions off: 882", async () => {
    expect(await estimateWorkflowCredits([video(3600), node({ captions: false })], [wire("video")])).toBe(882)
  })
  it("(ii) captions on: 932", async () => {
    expect(await estimateWorkflowCredits([video(3600), node({})], [wire("video")])).toBe(932)
  })
  it("(iii) audio 55 min: 832", async () => {
    expect(await estimateWorkflowCredits([audio(3300), node({})], [wire("audio")])).toBe(832)
  })
  for (const on of [true, false]) {
    it(`(iv) review on: the run up to the proxy render, captions left to Render final, stop-rule flag ${on ? "on" : "off"}: 342`, async () => {
      flag.on = on
      try {
        expect(await estimateWorkflowCredits([video(3600), node({ reviewBeforeRender: true })], [wire("video")])).toBe(342)
      } finally {
        flag.on = true
      }
    })
  }
  it("(iv-b) its Render final: the render at final + the captions, no fee: 650", async () => {
    const g = buildTightenEpisodeGraph(TIGHTEN_EPISODE_DEFAULTS, { media: { url: "https://r2/ep.mp4", kind: "video", durationSec: 3600 } })
    const nodes = g.nodes.map((n) => ({ id: n.id, type: n.type, data: { ...n.data } }))
    expect(await estimateRunSetCredits(nodes, g.edges, new Set(["uc-render", "uc-captions"]))).toBe(650)
  })
  it("(iv-c) the continue route's Render final on a review-on run's stored snapshot (render overridden to Final) is the same 650", async () => {
    const reviewOn = { ...TIGHTEN_EPISODE_DEFAULTS, reviewBeforeRender: true }
    const g = toStoredInlineGraph(buildTightenEpisodeGraph(reviewOn, { media: { url: "https://r2/ep.mp4", kind: "video", durationSec: 3600 } }), reviewOn)
    const runSet = renderFinalRunSet(g.outputMap.renderNodeId, g.nodes, g.edges)
    const overrides = renderRunOverrides(g.outputMap.renderNodeId, "final", runSet)
    const nodes = g.nodes.map((n) => ({ id: n.id, type: n.type, data: { ...n.data, ...(overrides[n.id] ?? {}) } }))
    expect([...runSet].sort()).toEqual(["uc-captions", "uc-render"])
    expect(await estimateRunSetCredits(nodes, g.edges, runSet)).toBe(650)
  })
  it("(v) captions + music: 972", async () => {
    expect(await estimateWorkflowCredits([video(3600), bed, node({})], [wire("video"), music])).toBe(972)
  })
  it("(vi) framing 9:16 stacked + captions: Speaker View is quoted at its complex rate until the edit is known (12/min): 1052", async () => {
    expect(await estimateWorkflowCredits([video(3600), node(framed)], [wire("video")])).toBe(1052)
  })
  it("(vii) framing + review on: the Speaker View preview (3/min), captions in Render final: 462", async () => {
    expect(await estimateWorkflowCredits([video(3600), node({ ...framed, reviewBeforeRender: true })], [wire("video")])).toBe(462)
  })
  it("parity: the node's estimate is its built chain's plus the fee", async () => {
    const g = buildTightenEpisodeGraph(TIGHTEN_EPISODE_DEFAULTS, { media: { url: "https://r2/ep.mp4", kind: "video", durationSec: 3600 } })
    const chain = await estimateWorkflowCredits(g.nodes.map((n) => ({ id: n.id, type: n.type, data: { ...n.data } })), g.edges)
    expect(await estimateWorkflowCredits([video(3600), node({})], [wire("video")])).toBe(chain + 10)
  })
  it("unknown length: the 180-minute ceiling (never under-quotes)", async () => {
    const unknown = await estimateWorkflowCredits([node({ captions: false })], [])
    expect(unknown).toBe(22 + 10 + 720 + 1800 + 10) // edit-plan:tighten:standard:180 = 4×180, render 10×180
  })
  it("a run subset that names the node prices its chain and its fee; one that does not, neither", async () => {
    const nodes = [video(3600), node({ captions: false })]
    expect(await estimateRunSetCredits(nodes, [wire("video")], new Set(["t1"]))).toBe(882)
    expect(await estimateRunSetCredits(nodes, [wire("video")], new Set(["rec"]))).toBe(0)
  })
  it("without wiring, the rest of the graph keeps the no-wiring reading; the node prices its own chain", async () => {
    // An unwired render with no wiring known is priced at the 180-minute ceiling (1800), not at its unwired floor.
    const render = { id: "cut", type: "apply-edl", data: { quality: "final" } }
    const rest = await estimateWorkflowCredits([render])
    expect(rest).toBe(1800)
    const alone = await estimateWorkflowCredits([node({ captions: false })], [])
    expect(await estimateWorkflowCredits([render, node({ captions: false })])).toBe(rest + alone)
  })
  describe("a node fed by a List runs once per item, each run with its own fee", () => {
    const list = { id: "L", type: "list", data: { items: "https://r2/a.mp4\nhttps://r2/b.mp4\nhttps://r2/c.mp4" } }
    const listWire = (data?: Record<string, unknown>) => ({ source: "L", target: "t1", sourceHandle: "text", targetHandle: "media", ...(data ? { data } : {}) })
    it("three items on an Each wire: three chains, three fees: 7686", async () => {
      expect(await estimateWorkflowCredits([list, node({ captions: false })], [listWire()])).toBe(3 * 2552 + 3 * 10)
      expect(await estimateWorkflowCredits([list, node({ captions: false })], [listWire({ outputMode: "each" })])).toBe(3 * 2552 + 3 * 10)
    })
    it("the wire set to All: one run of the chain, one fee: 2562", async () => {
      expect(await estimateWorkflowCredits([list, node({ captions: false })], [listWire({ outputMode: "all" })])).toBe(2552 + 10)
    })
  })
  it("its own charge is its fee: CREDIT_COSTS names the fee's pricing id", () => {
    expect(CREDIT_COSTS["tighten-episode"]!({})).toBe("use-case-fee:tighten-episode")
  })
})

describe("a step priced by its input's length, after the node, is priced at the episode's cut (decided 2026-10-16)", () => {
  // Its media leaves from the render, Add Captions, or the music merge or mix:
  // each keeps the cut's length, so the step after the node is priced exactly
  // as on the bare render (captions off), never at the 8-second fallback.
  const trim = { id: "trim", type: "trim-video", data: { trimMode: "seconds", trimStartSeconds: 0, trimEndSeconds: 0 } }
  const pitch = { id: "trim", type: "pitch-tempo", data: { tempo: 1 } }
  const out = { source: "t1", target: "trim", sourceHandle: "media", targetHandle: "in" }
  type G = { nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>; edges: Array<Record<string, unknown> & { source: string; target: string }> }
  const runDelta = async ({ nodes, edges }: G, step: G["nodes"][number]) =>
    (await estimateWorkflowCredits([...nodes, step], [...edges, out] as never)) - (await estimateWorkflowCredits(nodes, edges as never))
  // A listing on a recording the app's user replaces: fixed + per minute of it.
  const listing = ({ nodes, edges }: G) => CreditsService.estimateWorkflowBaseListing(nodes.map((n) => (n.id === "rec" ? { ...n, data: { url: n.data.url } } : n)), edges as never, "app", { replaceableMediaNodeIds: new Set(["rec"]) })
  const listDelta = ({ nodes, edges }: G, step: G["nodes"][number]) => {
    const a = listing({ nodes: [...nodes, step], edges: [...edges, out] })
    const b = listing({ nodes, edges })
    return { fixed: a.preview - b.preview, perMinute: a.previewPerMinute - b.previewPerMinute }
  }
  const bare: G = { nodes: [video(3600), node({ captions: false })], edges: [wire("video")] }
  const bareAudio: G = { nodes: [audio(1200), node({})], edges: [wire("audio")] }
  const videoCases: Array<[string, G]> = [
    ["captions on (the default)", { nodes: [video(3600), node({})], edges: [wire("video")] }],
    ["framing 9:16 stacked, captions on", { nodes: [video(3600), node(framed)], edges: [wire("video")] }],
    ["captions on, music bed", { nodes: [video(3600), bed, node({})], edges: [wire("video"), music] }],
    ["captions off, music bed", { nodes: [video(3600), bed, node({ captions: false })], edges: [wire("video"), music] }],
  ]
  it("on the bare render, a Trim of a 60-minute episode is priced at its 60 minutes (720 units), not 8 seconds", async () => {
    expect(await runDelta(bare, trim)).toBe(STATIC_CREDIT_COSTS["trim-video"]! * 720)
  })
  it.each(videoCases)("%s: the run estimate prices the Trim as on the bare render", async (_name, g) => {
    expect(await runDelta(g, trim)).toBe(await runDelta(bare, trim))
  })
  it.each(videoCases)("%s: the listing prices the Trim per minute of the episode, as on the bare render", (_name, g) => {
    const d = listDelta(g, trim)
    expect(d.perMinute).toBeGreaterThan(0)
    expect(d).toEqual(listDelta(bare, trim))
  })
  it("a 20-minute audio episode with a music bed: a Pitch & Tempo after it is priced as on the bare render (its 20 minutes)", async () => {
    const withBed: G = { nodes: [audio(1200), bed, node({})], edges: [wire("audio"), music] }
    expect(await runDelta(bareAudio, pitch)).toBe(STATIC_CREDIT_COSTS["pitch-tempo"]! * 20)
    expect(await runDelta(withBed, pitch)).toBe(await runDelta(bareAudio, pitch))
    expect(listDelta(withBed, pitch)).toEqual(listDelta(bareAudio, pitch))
    // Listed at its 30-minute price, the most a run of it is charged (tighten-episode.md, Steps after the node).
    expect(listDelta(withBed, pitch)).toEqual({ fixed: STATIC_CREDIT_COSTS["pitch-tempo"]! * 30, perMinute: 0 })
  })
  it("a Video SFX after the captioned episode is listed at its fixed 300-second price (it refuses a longer video)", () => {
    const sfx = { id: "trim", type: "video-sfx", data: {} }
    const g: G = { nodes: [video(3600), node({})], edges: [wire("video")] }
    const a = listing({ nodes: [...g.nodes, sfx], edges: [...g.edges, { ...out, targetHandle: "video" }] })
    const b = listing(g)
    expect({ fixed: a.preview - b.preview, perMinute: a.previewPerMinute - b.previewPerMinute }).toEqual({ fixed: STATIC_CREDIT_COSTS["replicate-mmaudio:300s"], perMinute: 0 })
  })
})

describe("the docs' worked examples, at the charged price (tighten-episode.md, What the estimate shows)", () => {
  const head: Step[] = [["elevenlabs-stt"], ["silence-detect"], ["edit-plan:tighten:standard:per-minute", 60]]
  const fee: Step = ["use-case-fee:tighten-episode"]
  const captions: Step = ["add-captions:kinetic"]
  const g60 = buildTightenEpisodeGraph(TIGHTEN_EPISODE_DEFAULTS, { media: { url: "https://r2/ep.mp4", kind: "video", durationSec: 3600 } })
  const cases: ReadonlyArray<{ name: string; steps: Step[]; engine: () => Promise<number>; docs: number }> = [
    { name: "60-min video, captions off", steps: [...head, ["apply-edl", 60], fee], engine: () => estimateWorkflowCredits([video(3600), node({ captions: false })], [wire("video")]), docs: 971 },
    { name: "60-min video, captions on", steps: [...head, ["apply-edl", 60], captions, fee], engine: () => estimateWorkflowCredits([video(3600), node({})], [wire("video")]), docs: 1026 },
    { name: "55-min audio (Edit Plan at its 60-minute step)", steps: [...head, ["apply-edl", 55], fee], engine: () => estimateWorkflowCredits([audio(3300), node({})], [wire("audio")]), docs: 916 },
    { name: "review on: the preview", steps: [...head, ["apply-edl:proxy", 60], fee], engine: () => estimateWorkflowCredits([video(3600), node({ reviewBeforeRender: true })], [wire("video")]), docs: 377 },
    {
      name: "review on: its Render final, no fee",
      steps: [["apply-edl", 60], captions],
      engine: () => estimateRunSetCredits(g60.nodes.map((n) => ({ id: n.id, type: n.type, data: { ...n.data } })), g60.edges, new Set(["uc-render", "uc-captions"])),
      docs: 715,
    },
    { name: "captions on, music bed", steps: [...head, ["apply-edl", 60], captions, fee, ["mix-audio"], ["merge-video-audio"]], engine: () => estimateWorkflowCredits([video(3600), bed, node({})], [wire("video"), music]), docs: 1070 },
    { name: "framing 9:16 stacked, captions on", steps: [...head, ["speaker-view:complex", 60], captions, fee], engine: () => estimateWorkflowCredits([video(3600), node(framed)], [wire("video")]), docs: 1158 },
    { name: "framing + review on: the preview", steps: [...head, ["speaker-view:complex:proxy", 60], fee], engine: () => estimateWorkflowCredits([video(3600), node({ ...framed, reviewBeforeRender: true })], [wire("video")]), docs: 509 },
    {
      name: "unknown length, captions off (the 180-minute ceiling)",
      steps: [["elevenlabs-stt"], ["silence-detect"], ["edit-plan:tighten:standard:per-minute", 180], ["apply-edl", 180], fee],
      engine: () => estimateWorkflowCredits([node({ captions: false })], []),
      docs: 2819,
    },
  ]
  for (const c of cases) {
    it(`${c.name}: the engine's steps, charged = ${c.docs}`, async () => {
      expect(listOf(c.steps)).toBe(await c.engine())
      expect(chargedOf(c.steps)).toBe(c.docs)
    })
  }
  it("a Trim after the node (Seconds, nothing cut), 60-minute video, captions on: the cut's 60 minutes = 7920, never the 8-second 22", async () => {
    const trim = { id: "trim", type: "trim-video", data: { trimMode: "seconds", trimStartSeconds: 0, trimEndSeconds: 0 } }
    const graph = [video(3600), node({})]
    const delta = (await estimateWorkflowCredits([...graph, trim], [wire("video"), { source: "t1", target: "trim", sourceHandle: "media", targetHandle: "in" }])) - (await estimateWorkflowCredits(graph, [wire("video")]))
    const steps: Step[] = [["trim-video", 720]]
    expect(listOf(steps)).toBe(delta)
    expect(chargedOf(steps)).toBe(7920)
    expect(chargedOf([["trim-video", 2]])).toBe(22)
  })
  it("a List of three recordings (Each), unknown length: three runs, each with its own fee = 8457", async () => {
    const list = { id: "L", type: "list", data: { items: "https://r2/a.mp4\nhttps://r2/b.mp4\nhttps://r2/c.mp4" } }
    const one: Step[] = [["elevenlabs-stt"], ["silence-detect"], ["edit-plan:tighten:standard:per-minute", 180], ["apply-edl", 180], fee]
    expect(3 * listOf(one)).toBe(await estimateWorkflowCredits([list, node({ captions: false })], [{ source: "L", target: "t1", sourceHandle: "text", targetHandle: "media" }]))
    expect(3 * chargedOf(one)).toBe(8457)
  })
})

describe("Chapters estimate = transcribe + Edit Plan (chapters) + 10", () => {
  it("45-min video, economy (the default tier): Edit Plan at its 60-minute step — 22 + 120 + 10", async () => {
    const steps: Step[] = [["elevenlabs-stt"], ["edit-plan:chapters:economy:per-minute", 60], ["use-case-fee:episode-chapters"]]
    expect(listOf(steps)).toBe(152)
    expect(await estimateWorkflowCredits([video(2700), chapters({})], [chaptersWire("video")])).toBe(listOf(steps))
  })
  it("unknown length: the 180-minute ceiling", async () => {
    expect(await estimateWorkflowCredits([chapters({})], [])).toBe(
      listOf([["elevenlabs-stt"], ["edit-plan:chapters:economy:per-minute", 180], ["use-case-fee:episode-chapters"]]),
    )
  })
  it("its own charge is its fee", () => expect(CREDIT_COSTS["episode-chapters"]!({})).toBe("use-case-fee:episode-chapters"))
})

describe("the docs' worked examples, at the charged price (episode-chapters.md, What the estimate shows)", () => {
  const fee: Step = ["use-case-fee:episode-chapters"]
  const chaptersCases: ReadonlyArray<{ name: string; steps: Step[]; engine: () => Promise<number>; docs: number }> = [
    {
      name: "45-min video, economy (Edit Plan at its 60-minute step)",
      steps: [["elevenlabs-stt"], ["edit-plan:chapters:economy:per-minute", 60], fee],
      engine: () => estimateWorkflowCredits([video(2700), chapters({})], [chaptersWire("video")]),
      docs: 168,
    },
    {
      name: "unknown length, economy (the 180-minute ceiling)",
      steps: [["elevenlabs-stt"], ["edit-plan:chapters:economy:per-minute", 180], fee],
      engine: () => estimateWorkflowCredits([chapters({})], []),
      docs: 432,
    },
  ]
  for (const c of chaptersCases) {
    it(`${c.name}: the engine's steps, charged = ${c.docs}`, async () => {
      expect(listOf(c.steps)).toBe(await c.engine())
      expect(chargedOf(c.steps)).toBe(c.docs)
    })
  }
})

const trailer = (data: Record<string, unknown>) => ({ id: "tr", type: "episode-trailer", data: { label: "Trailer", ...data } })
const trailerWire = { source: "rec", target: "tr", sourceHandle: "video", targetHandle: "media" }
const TRAILER_RENDER_MINUTES = editPlanRenderEstimateLength({ mode: "trailer" }, 3600).fixedMinutes

type TemplateNode = { id: string; type: string; data: Record<string, unknown> }
type TemplateEdge = { id?: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }
const TRAILER_TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "lib", "tutorial-seed", "templates", "podcast-trailer-formats.json")

/**
 * The shipped `podcast-trailer-formats` template as the chain Trailer builds
 * for a 60-minute video: its notes dropped, Apply Cut at final (review off),
 * its upload holding the recording's URL and length. Without `introSec` its
 * intro card and Combine Videos are removed (the formats read Apply Cut);
 * with it they stay, the card holding that URL and length. The first
 * `formats` format nodes are kept, in the template's order.
 */
function templateTwin({ formats, introSec }: { readonly formats: number; readonly introSec?: number }): [TemplateNode[], TemplateEdge[]] {
  const t = JSON.parse(readFileSync(TRAILER_TEMPLATE, "utf8")) as { nodes: TemplateNode[]; edges: TemplateEdge[] }
  const formatIds = t.nodes.filter((n) => n.type === "social-media-format").map((n) => n.id)
  const apply = t.nodes.find((n) => n.type === "apply-edl")!.id
  const combine = t.nodes.find((n) => n.type === "combine-videos")!.id
  const intro = introSec === undefined
  const dropped = new Set([
    ...t.nodes.filter((n) => n.type === "sticky-note").map((n) => n.id),
    ...(intro ? [combine, "trailer-intro"] : []),
    ...formatIds.slice(formats),
  ])
  const nodes = t.nodes
    .filter((n) => !dropped.has(n.id))
    .map((n) => {
      if (n.id === "trailer-src") return { ...n, data: { ...n.data, url: "https://r2/ep.mp4", metadata: { durationSeconds: 3600 } } }
      if (n.id === "trailer-intro") return { ...n, data: { ...n.data, url: "https://r2/card.mp4", metadata: { durationSeconds: introSec } } }
      if (n.id === apply) return { ...n, data: { ...n.data, quality: "final" } }
      return { ...n, data: { ...n.data } }
    })
  const edges = t.edges
    .map((e) => (intro && e.source === combine ? { ...e, source: apply, sourceHandle: "media" } : { ...e }))
    .filter((e) => !dropped.has(e.source) && !dropped.has(e.target))
  return [nodes, edges]
}

describe("Trailer estimate = its chain + 10", () => {
  it("the template twin is the chain the builder emits (no intro card, three formats)", () => {
    const [nodes, edges] = templateTwin({ formats: 3 })
    expect(nodes.map((n) => n.type)).toEqual(["upload-video", "transcribe", "edit-plan", "apply-edl", "social-media-format", "social-media-format", "social-media-format"])
    expect(edges.filter((e) => e.target.startsWith("trailer-format-")).every((e) => e.source === "trailer-apply" && e.sourceHandle === "media")).toBe(true)
  })
  it("60-min, three formats: transcribe, Edit Plan (trailer), the trailer render, three formats, the fee", async () => {
    expect(await estimateWorkflowCredits([video(3600), trailer({})], [trailerWire])).toBe(
      await estimateWorkflowCredits(...templateTwin({ formats: 3 })) + STATIC_CREDIT_COSTS["use-case-fee:episode-trailer"]!,
    )
  })
  it("one format costs less than three only by the formats' own price", async () => {
    const one = await estimateWorkflowCredits([video(3600), trailer({ formats: ["9:16"] })], [trailerWire])
    expect(one).toBe(await estimateWorkflowCredits(...templateTwin({ formats: 1 })) + STATIC_CREDIT_COSTS["use-case-fee:episode-trailer"]!)
  })
  it("an Add Captions after a three-format Trailer runs once per format", async () => {
    const cap = { id: "cap", type: "add-captions", data: { style: "word-highlight" } }
    const base = await estimateWorkflowCredits([video(3600), trailer({})], [trailerWire])
    expect(await estimateWorkflowCredits([video(3600), trailer({}), cap], [trailerWire, { source: "tr", target: "cap", sourceHandle: "media", targetHandle: "in" }])).toBe(base + 3 * STATIC_CREDIT_COSTS["add-captions:kinetic"]!)
  })
  it("review on: the preview run is quoted up to the proxy render", async () => {
    expect(await estimateWorkflowCredits([video(3600), trailer({ reviewBeforeRender: true })], [trailerWire])).toBe(
      listOf([["elevenlabs-stt"], ["edit-plan:trailer:standard:per-minute", 60], ["edit-plan:trailer:standard:flat"], ["apply-edl:proxy", TRAILER_RENDER_MINUTES], ["use-case-fee:episode-trailer"]]),
    )
  })
  it("its own charge is its fee", () => expect(CREDIT_COSTS["episode-trailer"]!({})).toBe("use-case-fee:episode-trailer"))
})

describe("Trailer with an intro card: Combine Videos is quoted on the card's probed length", () => {
  const fee = () => STATIC_CREDIT_COSTS["use-case-fee:episode-trailer"]!
  const built = (introSec?: number) =>
    buildEpisodeTrailerGraph(EPISODE_TRAILER_DEFAULTS, {
      media: { url: "https://r2/ep.mp4", kind: "video", durationSec: 3600 },
      introCard: { url: "https://r2/card.mp4", ...(introSec !== undefined ? { durationSec: introSec } : {}) },
    })
  const priced = (g: ReturnType<typeof built>) => estimateWorkflowCredits(g.nodes.map((n) => ({ id: n.id, type: n.type, data: { ...n.data } })), g.edges)

  it("the route's quote (its built graph, the card's length on it) is the template twin's with that card", async () => {
    for (const introSec of [4, 14]) {
      expect(await priced(built(introSec)), String(introSec)).toBe(await estimateWorkflowCredits(...templateTwin({ formats: 3, introSec })))
    }
  })
  it("the card's probed length rides on the built card (no fallback length is assumed)", () => {
    expect(built(14).nodes.find((n) => n.id === "uc-intro")!.data).toMatchObject({ metadata: { durationSeconds: 14 } })
    expect(built().nodes.find((n) => n.id === "uc-intro")!.data).not.toHaveProperty("metadata")
  })
  it("a wired card in a workflow: the node's chain with the real card, plus the fee", async () => {
    const card = { id: "card", type: "upload-video", data: { url: "https://r2/card.mp4", metadata: { durationSeconds: 14 } } }
    expect(await estimateWorkflowCredits([video(3600), card, trailer({})], [trailerWire, { source: "card", target: "tr", sourceHandle: "video", targetHandle: "introCard" }])).toBe(
      await estimateWorkflowCredits(...templateTwin({ formats: 3, introSec: 14 })) + fee(),
    )
  })
})

describe("Trailer's Render final, after a review: every format and what follows each, no fee", () => {
  it("the final part of a review-on Trailer: the render at final, the formats, a per-format Add Captions; no fee", async () => {
    const cap = { id: "cap", type: "add-captions", data: { style: "word-highlight" } }
    const capWire = { source: "tr", target: "cap", sourceHandle: "media", targetHandle: "in" }
    const preview = { ...trailer({ reviewBeforeRender: true }), id: "tr" }
    const finalNode = { ...preview, data: { ...preview.data, useCaseContinue: { mode: "render-final", jobId: "job-0" } } }
    const final = await estimateRunSetCredits([video(3600), finalNode, cap], [trailerWire, capWire], new Set(["tr", "cap"]))
    // The final chain priced whole (review off), minus its first run, minus the fee.
    const reviewOff = await estimateWorkflowCredits([video(3600), trailer({}), cap], [trailerWire, capWire])
    const firstRunSteps = listOf([["elevenlabs-stt"], ["edit-plan:trailer:standard:per-minute", 60], ["edit-plan:trailer:standard:flat"]])
    expect(final).toBe(reviewOff - firstRunSteps - STATIC_CREDIT_COSTS["use-case-fee:episode-trailer"]!)
    // Three formats, each followed by its own captions.
    const formatsOnly = await estimateRunSetCredits([video(3600), finalNode], [trailerWire], new Set(["tr"]))
    expect(final - formatsOnly).toBe(3 * STATIC_CREDIT_COSTS["add-captions:kinetic"]!)
  })
})

/** A trailer EDL of one cut of `sec` seconds from the recording. */
const trailerEdl = (sec: number) => ({
  version: 1,
  clock: "master",
  sources: [{ id: "rec", url: "https://r2/ep.mp4", kind: "video" }],
  segments: [{ id: "seg-0", inMs: 600_000, outMs: 600_000 + sec * 1000, video: "rec" }],
})
/** The plan a 35-second trailer run made, and a review of it that leaves the trailer `sec` seconds long. */
const PLAN_35 = trailerEdl(35)
const reviewOf = (sec: number) => ({ v: EDITED_EDL_VERSION, kind: "edl", basis: editPlanBasis(PLAN_35), edl: { segments: trailerEdl(sec).segments, dropped: [] } })
/** A review-on Trailer's Render final after a review that leaves the trailer `sec` seconds long. */
function reviewed(sec: number) {
  const preview = trailer({ reviewBeforeRender: true })
  return { ...preview, data: { ...preview.data, generatedJson: PLAN_35, editedEdl: reviewOf(sec), useCaseContinue: { mode: "render-final", jobId: "job-0" } } }
}

describe("the docs' worked examples, at the charged price (episode-trailer.md, What the estimate shows)", () => {
  const head: Step[] = [["elevenlabs-stt"], ["edit-plan:trailer:standard:per-minute", 60], ["edit-plan:trailer:standard:flat"]]
  const formats: Step = ["social-media-format", 3]
  const fee: Step = ["use-case-fee:episode-trailer"]
  // A 10-second card after the trailer's 40 seconds: 50 s, 10 started 5-second blocks.
  const card = { id: "card", type: "upload-video", data: { url: "https://r2/card.mp4", metadata: { durationSeconds: 10 } } }
  const cardWire = { source: "card", target: "tr", sourceHandle: "video", targetHandle: "introCard" }
  const preview = trailer({ reviewBeforeRender: true })
  // A real Render final carries the run's plan (the editor's node, the app's run state, /continue's quote).
  const finalNode = { ...preview, data: { ...preview.data, generatedJson: PLAN_35, useCaseContinue: { mode: "render-final", jobId: "job-0" } } }
  const trailerCases: ReadonlyArray<{ name: string; steps: Step[]; engine: () => Promise<number>; docs: number }> = [
    {
      name: "60-min video, three formats (the trailer at 40 seconds: one minute)",
      steps: [...head, ["apply-edl", 1], formats, fee],
      engine: () => estimateWorkflowCredits([video(3600), trailer({})], [trailerWire]),
      docs: 399,
    },
    {
      name: "60-min video, three formats, a 10-second intro card",
      steps: [...head, ["apply-edl", 1], ["combine-videos", 10], formats, fee],
      engine: () => estimateWorkflowCredits([video(3600), card, trailer({})], [trailerWire, cardWire]),
      docs: 509,
    },
    {
      name: "review on: the preview",
      steps: [...head, ["apply-edl:proxy", 1], fee],
      engine: () => estimateWorkflowCredits([video(3600), preview], [trailerWire]),
      docs: 324,
    },
    {
      name: "review on, no edits: its Render final on the 35-second cut the run made, every format, no fee",
      steps: [["apply-edl", 1], formats],
      engine: () => estimateRunSetCredits([video(3600), finalNode], [trailerWire], new Set(["tr"])),
      docs: 77,
    },
    {
      name: "review on, an edit that lengthens the trailer to 90 s: its Render final on that length",
      steps: [["apply-edl", 2], formats],
      engine: () => estimateRunSetCredits([video(3600), reviewed(90)], [trailerWire], new Set(["tr"])),
      docs: 88,
    },
  ]
  for (const c of trailerCases) {
    it(`${c.name}: the engine's steps, charged = ${c.docs}`, async () => {
      expect(listOf(c.steps)).toBe(await c.engine())
      expect(chargedOf(c.steps)).toBe(c.docs)
    })
  }
})

describe("Trailer is quoted at 40 seconds; its Render final on the cut the run made, with the review's edits (decided 2026-10-18)", () => {
  const card = { id: "card", type: "upload-video", data: { url: "https://r2/card.mp4", metadata: { durationSeconds: 10 } } }
  const cardWire = { source: "card", target: "tr", sourceHandle: "video", targetHandle: "introCard" }
  const steps = (s: Step[]) => listOf(s)
  it("a review-off run: the render at 40 seconds (one minute), Combine Videos on 40 s + the card", async () => {
    expect(TRAILER_RENDER_MINUTES).toBe(1)
    const without = await estimateWorkflowCredits([video(3600), trailer({})], [trailerWire])
    const withCard = await estimateWorkflowCredits([video(3600), card, trailer({})], [trailerWire, cardWire])
    expect(withCard - without).toBe(steps([["combine-videos", Math.ceil((40 + 10) / 5)]]))
  })
  it("a Render final after a Restore that lengthens the cut to 150 s: the render on its 3 minutes, Combine Videos on 150 s + the card", async () => {
    const final = await estimateRunSetCredits([video(3600), card, reviewed(150)], [trailerWire, cardWire], new Set(["tr"]))
    expect(final).toBe(steps([["apply-edl", 3], ["combine-videos", Math.ceil((150 + 10) / 5)], ["social-media-format", 3]]))
  })
  it("a Render final after an edit that shortens the cut to 20 s: Combine Videos on 20 s + the card, below the unedited cut's quote", async () => {
    const final = await estimateRunSetCredits([video(3600), card, reviewed(20)], [trailerWire, cardWire], new Set(["tr"]))
    expect(final).toBe(steps([["apply-edl", 1], ["combine-videos", Math.ceil((20 + 10) / 5)], ["social-media-format", 3]]))
    // The same Render final with no edits: the 35-second cut the run made, plus the card.
    const unedited = await estimateRunSetCredits([video(3600), card, { ...reviewed(20), data: { ...reviewed(20).data, editedEdl: undefined } }], [trailerWire, cardWire], new Set(["tr"]))
    expect(unedited).toBe(steps([["apply-edl", 1], ["combine-videos", Math.ceil((35 + 10) / 5)], ["social-media-format", 3]]))
    expect(final).toBeLessThan(unedited)
  })
})

const CLIP_PACK_TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "lib", "tutorial-seed", "templates", "podcast-clip-pack.json")

/**
 * The shipped `podcast-clip-pack` template as the chain an unframed Clip Pack
 * builds: its notes dropped, its upload holding the recording's URL and
 * length, Find Clips asked for `count` clips of `targetDurationSec`, Render
 * Clip at final (review off).
 */
function clipPackTemplateTwin({ durationSec, count, targetDurationSec }: { readonly durationSec: number; readonly count: number; readonly targetDurationSec: number }): [TemplateNode[], TemplateEdge[]] {
  const t = JSON.parse(readFileSync(CLIP_PACK_TEMPLATE, "utf8")) as { nodes: TemplateNode[]; edges: TemplateEdge[] }
  const notes = new Set(t.nodes.filter((n) => n.type === "sticky-note").map((n) => n.id))
  const nodes = t.nodes
    .filter((n) => !notes.has(n.id))
    .map((n) => {
      if (n.type === "upload-video") return { ...n, data: { ...n.data, url: "https://r2/ep.mp4", metadata: { durationSeconds: durationSec } } }
      if (n.type === "edit-plan") return { ...n, data: { ...n.data, count, targetDurationSec } }
      if (n.type === "apply-edl") return { ...n, data: { ...n.data, quality: "final" } }
      return { ...n, data: { ...n.data } }
    })
  return [nodes, t.edges.filter((e) => !notes.has(e.source) && !notes.has(e.target)).map((e) => ({ ...e }))]
}

const pack = (data: Record<string, unknown>) => ({ id: "cp", type: "clip-pack", data: { label: "Clip Pack", ...data } })
const packWire = { source: "rec", target: "cp", sourceHandle: "video", targetHandle: "media" }
const CLIP_MINUTES = editPlanRenderEstimateLength({ mode: "clips", targetDurationSec: 60 }, 3600).fixedMinutes

describe("Clip Pack estimate = its chain + 10", () => {
  it("the template twin is the chain the builder emits without framing", () => {
    const [nodes, edges] = clipPackTemplateTwin({ durationSec: 3600, count: 8, targetDurationSec: 60 })
    expect(nodes.map((n) => n.type)).toEqual(["upload-video", "transcribe", "edit-plan", "apply-edl", "add-captions"])
    expect(edges.find((e) => e.target === "clips-captions")).toMatchObject({ source: "clips-apply", sourceHandle: "media", data: { outputMode: "each" } })
  })
  it("without framing it is the hand-built clip-pack template, priced the same, plus the fee", async () => {
    const [nodes, edges] = clipPackTemplateTwin({ durationSec: 3600, count: 8, targetDurationSec: 60 })
    expect(await estimateWorkflowCredits([video(3600), pack({ framing: null })], [packWire])).toBe(
      (await estimateWorkflowCredits(nodes, edges)) + STATIC_CREDIT_COSTS["use-case-fee:clip-pack"]!,
    )
  })
  it("8 clips with the default framing: Speaker View and captions run once per clip", async () => {
    expect(await estimateWorkflowCredits([video(3600), pack({})], [packWire])).toBe(listOf([
      ["elevenlabs-stt"], ["edit-plan:clips:standard:per-minute", 60], ["edit-plan:clips:standard:flat"],
      ...Array.from({ length: 8 }, (): Step => ["speaker-view:complex", CLIP_MINUTES]),
      ...Array.from({ length: 8 }, (): Step => ["add-captions:kinetic"]),
      ["use-case-fee:clip-pack"],
    ]))
  })
  it("review on: the preview run is the per-clip proxy renders and the fee", async () => {
    expect(await estimateWorkflowCredits([video(3600), pack({ reviewBeforeRender: true })], [packWire])).toBe(listOf([
      ["elevenlabs-stt"], ["edit-plan:clips:standard:per-minute", 60], ["edit-plan:clips:standard:flat"],
      ...Array.from({ length: 8 }, (): Step => ["speaker-view:complex:proxy", CLIP_MINUTES]),
      ["use-case-fee:clip-pack"],
    ]))
  })
  it("a node after the pack's clips runs once per clip", async () => {
    const after = { id: "fmt", type: "social-media-format", data: { specKey: "instagram:story-reel", method: "pad" } }
    const base = await estimateWorkflowCredits([video(3600), pack({})], [packWire])
    expect(await estimateWorkflowCredits([video(3600), pack({}), after], [packWire, { source: "cp", target: "fmt", sourceHandle: "clips", targetHandle: "media" }]))
      .toBe(base + 8 * STATIC_CREDIT_COSTS["social-media-format"]!)
  })
  it("its own charge is its fee", () => expect(CREDIT_COSTS["clip-pack"]!({})).toBe("use-case-fee:clip-pack"))
})

/** A Clip Pack plan of `count` clips, each one cut of `sec` seconds from the recording. */
const clipPlan = (count: number, sec: number) =>
  Array.from({ length: count }, (_, i) => ({
    version: 1,
    clock: "master",
    sources: [{ id: "rec", url: "https://r2/ep.mp4", kind: "video" }],
    segments: [{ id: `clip-${i}`, inMs: i * 300_000, outMs: i * 300_000 + sec * 1000, video: "rec" }],
    dropped: [],
    meta: { title: `Clip ${i + 1}` },
  }))

describe("the docs' worked examples, at the charged price (clip-pack.md, What the estimate shows)", () => {
  const head: Step[] = [["elevenlabs-stt"], ["edit-plan:clips:standard:per-minute", 60], ["edit-plan:clips:standard:flat"]]
  const fee: Step = ["use-case-fee:clip-pack"]
  // Each clip is its own render, its minutes rounded on their own: n steps, never one step of n × minutes.
  const each = (n: number, step: Step): Step[] => Array.from({ length: n }, () => step)
  // The plan the review-on run made: 8 clips of 55 seconds (one started minute each).
  const PLAN = clipPlan(8, 55)
  const preview = pack({ reviewBeforeRender: true })
  const finalNode = { ...preview, data: { ...preview.data, generatedJson: PLAN, useCaseContinue: { mode: "render-final", jobId: "job-0" } } }
  const keep = [true, true, false, true, false, true, false, true]
  const fiveKept = {
    ...finalNode,
    data: { ...finalNode.data, editedEdl: { v: EDITED_EDL_VERSION, kind: "clips", basis: editPlanBasis(PLAN), clips: keep.map((k) => ({ keep: k })) } },
  }
  const packCases: ReadonlyArray<{ name: string; steps: Step[]; engine: () => Promise<number>; docs: number }> = [
    {
      name: "60-min video, 8 clips of 60 s, the default framing and captions (each clip quoted at 2 minutes)",
      steps: [...head, ...each(8, ["speaker-view:complex", CLIP_MINUTES]), ...each(8, ["add-captions:kinetic"]), fee],
      engine: () => estimateWorkflowCredits([video(3600), pack({})], [packWire]),
      docs: 978,
    },
    {
      name: "60-min video, 8 clips of 60 s, framing None (the template's chain), captions on",
      steps: [...head, ...each(8, ["apply-edl", CLIP_MINUTES]), ...each(8, ["add-captions:kinetic"]), fee],
      engine: () => estimateWorkflowCredits([video(3600), pack({ framing: null })], [packWire]),
      docs: 938,
    },
    {
      name: "review on: the preview (the per-clip Speaker View previews and the fee)",
      steps: [...head, ...each(8, ["speaker-view:complex:proxy", CLIP_MINUTES]), fee],
      engine: () => estimateWorkflowCredits([video(3600), preview], [packWire]),
      docs: 378,
    },
    {
      name: "review on: Render final of the 8 kept 55-second clips, each at its own minute, captioned, no fee",
      steps: [...each(8, ["speaker-view:complex", 1]), ...each(8, ["add-captions:kinetic"])],
      engine: () => estimateRunSetCredits([video(3600), finalNode], [packWire], new Set(["cp"])),
      docs: 552,
    },
    {
      name: "review on: Render final with 5 of the 8 clips kept: only the kept clips, no fee",
      steps: [...each(5, ["speaker-view:complex", 1]), ...each(5, ["add-captions:kinetic"])],
      engine: () => estimateRunSetCredits([video(3600), fiveKept], [packWire], new Set(["cp"])),
      docs: 345,
    },
  ]
  it("the estimate quotes each clip at twice its target length", () => expect(CLIP_MINUTES).toBe(2))
  it("unknown length: Edit Plan at its 180-minute ceiling, each clip still at twice its target", async () => {
    expect(await estimateWorkflowCredits([pack({})], [])).toBe(listOf([
      ["elevenlabs-stt"], ["edit-plan:clips:standard:per-minute", 180], ["edit-plan:clips:standard:flat"],
      ...each(8, ["speaker-view:complex", CLIP_MINUTES]), ...each(8, ["add-captions:kinetic"]), fee,
    ]))
  })
  for (const c of packCases) {
    it(`${c.name}: the engine's steps, charged = ${c.docs}`, async () => {
      expect(listOf(c.steps)).toBe(await c.engine())
      expect(chargedOf(c.steps)).toBe(c.docs)
    })
  }
})
