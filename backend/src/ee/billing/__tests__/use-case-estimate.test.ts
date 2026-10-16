/**
 * A use-case node's estimate is its built chain, wired to its real source and
 * priced by the ordinary rules, plus its per-run fee (decided 2026-10-13).
 * Static prices, unmarked; the render is quoted at the episode's length, and
 * Speaker View at its complex rate before the edit is known.
 *
 * The engine is tested at its static rows. The public docs state the CHARGED
 * price (docs/nodes/processing-video/tighten-episode.md, "What the estimate
 * shows"), so each worked example there is pinned at the end of this file:
 * its steps, as price ids, sum to the engine's figure at the static rows, and
 * the same steps priced by `statedPrices()` (the rule the docs census holds
 * every figure to) sum to the figure the page states.
 */
import { describe, it, expect, vi } from "vitest"
vi.mock("@/lib/config.js", async (orig) => ({ ...(await orig<typeof import("@/lib/config.js")>()), hasCredits: () => false }))
const flag = vi.hoisted(() => ({ on: true }))
vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => flag.on }))
import { CREDIT_COSTS, CreditsService, STATIC_CREDIT_COSTS, estimateRunSetCredits, estimateWorkflowCredits } from "../credits.js"
import { statedPrices } from "../stated-prices.js"
import { buildTightenEpisodeGraph, renderFinalRunSet, renderRunOverrides, TIGHTEN_EPISODE_DEFAULTS, toStoredInlineGraph } from "@nodaro/render-rules"

const video = (sec: number) => ({ id: "rec", type: "upload-video", data: { url: "https://r2/ep.mp4", metadata: { durationSeconds: sec } } })
const audio = (sec: number) => ({ id: "rec", type: "upload-audio", data: { url: "https://r2/ep.m4a", metadata: { durationSeconds: sec } } })
const bed = { id: "bed", type: "upload-audio", data: { url: "https://r2/bed.mp3" } }
const node = (data: Record<string, unknown>) => ({ id: "t1", type: "tighten-episode", data: { label: "Tighten Episode", ...data } })
const wire = (srcHandle: "video" | "audio") => ({ source: "rec", target: "t1", sourceHandle: srcHandle, targetHandle: "media" })
const music = { source: "bed", target: "t1", sourceHandle: "audio", targetHandle: "music" }
const framed = { framing: { aspect: "9:16", layout: "stacked" } }

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

/** One step of a worked example: a price id and its units (minutes for a per-minute row; Edit Plan's
 *  stepped ids are not static rows, so its per-minute row stands in at the step's minutes). */
type Step = readonly [id: string, units?: number]
const listOf = (steps: readonly Step[]) => steps.reduce((t, [id, units = 1]) => t + STATIC_CREDIT_COSTS[id]! * units, 0)
const chargedOf = (steps: readonly Step[]) => steps.reduce((t, [id, units = 1]) => t + statedPrices().credits(id, units)!, 0)

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
