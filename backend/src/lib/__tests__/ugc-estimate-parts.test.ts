/**
 * A graph's UGC videos for their estimate (`@nodaro/render-rules`): one video
 * per UGC Clips node, each with the nodes its estimate prices; each video's
 * inputs read through its own wires; and what of them a run executes. The
 * editor prices a run set with the server's figure for exactly these nodes, and
 * the server's estimate seam leaves exactly these out of its per-node sum.
 */
import { describe, expect, it } from "vitest"
import { UGC_ESTIMATE_PARTS, ugcChainInput, ugcChains, ugcEstimateRunParts, ugcSumPerNode } from "@nodaro/render-rules"

type N = { id: string; type: string; data: Record<string, unknown> }
type E = { source: string; target: string; sourceHandle?: string | null; targetHandle: string }
const n = (id: string, type: string, data: Record<string, unknown> = {}): N => ({ id, type, data })
const e = (source: string, target: string, targetHandle: string, sourceHandle: string | null = null): E => ({ source, target, targetHandle, sourceHandle })

/** The template's UGC video, with its join, overlay and captions; `p` prefixes every id (a second video). */
function video(p = "", script: Record<string, unknown> = { targetDurationSec: 20 }, creator: Record<string, unknown> = { source: "sampled", gender: "woman" }) {
  const id = (x: string) => `${p}${x}`
  const nodes: N[] = [
    n(id("site"), "text-prompt", { text: "Acme" }),
    n(id("shot1"), "upload-image", { url: "https://cdn.example/1.png" }),
    n(id("shot2"), "upload-image", { url: "https://cdn.example/2.png" }),
    n(id("shot3"), "upload-image", { url: "https://cdn.example/3.png" }),
    n(id("script"), "ugc-script", script),
    n(id("creator"), "ugc-creator", creator),
    n(id("clips"), "ugc-clips"), n(id("clip"), "ugc-clip", { rerender: {} }), n(id("cards"), "ugc-cards"),
    n(id("join"), "combine-videos", { transition: "cut" }), n(id("overlay"), "video-overlay"), n(id("captions"), "add-captions"),
  ]
  const edges: E[] = [
    e(id("site"), id("script"), "site"),
    e(id("shot1"), id("script"), "screenshot"), e(id("shot2"), id("script"), "screenshot2"), e(id("shot3"), id("script"), "screenshot3"),
    e(id("script"), id("creator"), "category", "category"),
    e(id("script"), id("clips"), "plan"), e(id("creator"), id("clips"), "creator"), e(id("clips"), id("clip"), "clip", "clips"),
    e(id("clip"), id("join"), "in"), e(id("clip"), id("cards"), "notes"), e(id("clips"), id("cards"), "plan", "plan-out"),
    e(id("clips"), id("cards"), "transcript", "transcript"), e(id("join"), id("cards"), "video"), e(id("join"), id("overlay"), "video"),
    e(id("cards"), id("overlay"), "layerPlan", "layerPlan"), e(id("cards"), id("captions"), "captionPlan", "captionPlan"), e(id("overlay"), id("captions"), "in"),
  ]
  return { nodes, edges }
}
const T = video()
const UGC_IDS = ["script", "creator", "clips", "clip", "cards"]
const FINISH = ["join", "overlay", "captions"]
/** What a toolbar Run executes: every node but the inputs. */
const runOf = (nodes: N[]) => nodes.filter((x) => x.type !== "text-prompt" && x.type !== "upload-image")
const pick = (nodes: N[], ...ids: string[]) => nodes.filter((x) => ids.includes(x.id))
const withData = (nodes: N[], id: string, data: Record<string, unknown>) => nodes.map((x) => (x.id === id ? { ...x, data: { ...x.data, ...data } } : x))
const partsOf = (r: ReturnType<typeof ugcEstimateRunParts>) => r?.chains.flatMap((c) => c.nodes.map((m) => m.part))

const KEPT_PLAN = (sec?: number) => ({ v: 1, hook: "h", beats: [{ line: "b" }], closer: { line: "c" }, ...(sec !== undefined ? { targetDurationSec: sec } : {}) })
const keptScript = (sec?: number) => ({ targetDurationSec: 15, keepResult: true, result: { plan: KEPT_PLAN(sec) } })
const KEPT_CREATOR = { keepResult: true, result: { v: 1, gender: "woman", identityImages: ["https://cdn.example/creator.png"] } }

describe("the graph's UGC videos", () => {
  it("one video per UGC Clips node: its script, creator, clip, cards and that chain's join, overlay and captions", () => {
    const [chain, ...rest] = ugcChains(T.nodes, T.edges)
    expect(rest).toEqual([])
    expect(chain).toMatchObject({ clipsId: "clips", scriptId: "script", creatorId: "creator" })
    expect(chain!.members).toEqual([
      { id: "script", part: "script" }, { id: "creator", part: "creator" }, { id: "clips", part: null }, { id: "clip", part: "clip" },
      { id: "cards", part: "cards" }, { id: "join", part: "join" }, { id: "overlay", part: "overlay" }, { id: "captions", part: "captions" },
    ])
  })

  it("an outro join and a logo overlay after the captions keep their own prices", () => {
    const nodes = [...T.nodes, n("intro", "upload-video"), n("outro", "combine-videos"), n("logo", "video-overlay", { layers: [{ imageUrl: "https://cdn.example/logo.png" }] })]
    const edges = [...T.edges, e("captions", "outro", "in"), e("intro", "outro", "in2"), e("outro", "logo", "video")]
    const members = ugcChains(nodes, edges)[0]!.members.map((m) => m.id)
    expect(members).not.toContain("outro")
    expect(members).not.toContain("logo")
    expect(members).toEqual([...UGC_IDS, ...FINISH])
  })

  it("a join with an input that is not the video's clips keeps its own price", () => {
    const nodes = [...T.nodes, n("intro", "upload-video")]
    const edges = [...T.edges, e("intro", "join", "in2")]
    expect(ugcChains(nodes, edges)[0]!.members.map((m) => m.id)).not.toContain("join")
  })

  it("an overlay with layers of its own, stored or wired, renders anyway: it keeps its own price", () => {
    const stored = withData(T.nodes, "overlay", { layers: [{ imageUrl: "https://cdn.example/badge.png" }] })
    expect(ugcChains(stored, T.edges)[0]!.members.map((m) => m.id)).not.toContain("overlay")
    const wiredNodes = [...T.nodes, n("badge", "upload-image", { url: "https://cdn.example/badge.png" })]
    const wired = [...T.edges, e("badge", "overlay", "overlay2")]
    expect(ugcChains(wiredNodes, wired)[0]!.members.map((m) => m.id)).not.toContain("overlay")
    // A stored slot with no image is no layer.
    expect(ugcChains(withData(T.nodes, "overlay", { layers: [{ imageUrl: "" }] }), T.edges)[0]!.members.map((m) => m.id)).toContain("overlay")
  })

  it("two captions on the one caption plan are each the video's captions, each priced", () => {
    const nodes = [...T.nodes, n("captions2", "add-captions")]
    const edges = [...T.edges, e("cards", "captions2", "captionPlan", "captionPlan")]
    const members = ugcChains(nodes, edges)[0]!.members
    expect(members.filter((m) => m.part === "captions").map((m) => m.id)).toEqual(["captions", "captions2"])
  })

  it("two videos are two chains, each reading its own script and creator, whatever the node order", () => {
    const b = video("b-", { targetDurationSec: 30 }, { source: "photo", gender: "man" })
    // Chain B's nodes listed first.
    const nodes = [...b.nodes, ...T.nodes]
    const edges = [...T.edges, ...b.edges]
    const chains = ugcChains(nodes, edges)
    expect(chains.map((c) => c.clipsId)).toEqual(["b-clips", "clips"])
    expect(chains.map((c) => ugcChainInput(c, nodes, edges).input)).toEqual([
      { targetDurationSec: 30, screenshotCount: 3, source: "photo" },
      { targetDurationSec: 20, screenshotCount: 3, source: "sampled" },
    ])
  })

  it("a UGC node wired into no UGC Clips is a video of its own, priced for its own part", () => {
    const nodes = [n("stray-script", "ugc-script", { targetDurationSec: 6 }), n("stray-creator", "ugc-creator", { source: "photo" }), ...T.nodes]
    const chains = ugcChains(nodes, T.edges)
    expect(chains.map((c) => c.members)).toEqual([
      [{ id: "script", part: "script" }, { id: "creator", part: "creator" }, { id: "clips", part: null }, { id: "clip", part: "clip" }, { id: "cards", part: "cards" }, { id: "join", part: "join" }, { id: "overlay", part: "overlay" }, { id: "captions", part: "captions" }],
      [{ id: "stray-script", part: "script" }],
      [{ id: "stray-creator", part: "creator" }],
    ])
    // The real video never reads the stray nodes.
    expect(ugcChainInput(chains[0]!, nodes, T.edges).input).toEqual({ targetDurationSec: 20, screenshotCount: 3, source: "sampled" })
  })
})

describe("what of the videos a run executes", () => {
  it("a toolbar Run prices every part of the video; the five UGC nodes and its three finish nodes are covered", () => {
    const r = ugcEstimateRunParts(runOf(T.nodes), T.nodes, T.edges)
    expect(partsOf(r)).toEqual(UGC_ESTIMATE_PARTS)
    expect([...r!.coveredIds].sort()).toEqual([...UGC_IDS, ...FINISH].sort())
  })

  it("a ▶ on UGC Script asks for the script alone", () => {
    const r = ugcEstimateRunParts(pick(T.nodes, "script"), T.nodes, T.edges)
    expect(r?.chains).toEqual([{ input: { targetDurationSec: 20, screenshotCount: 3, source: "sampled" }, lengthUnread: false, screenshotsUnread: false, nodes: [{ id: "script", part: "script", fanOutOf: "script" }] }])
  })

  it("a kept script runs nothing the estimate prices: no UGC part", () => {
    const nodes = withData(T.nodes, "script", keptScript(30))
    expect(ugcEstimateRunParts(pick(nodes, "script"), nodes, T.edges)).toBeNull()
  })

  it("Run from here on a kept creator prices only what follows it", () => {
    const nodes = withData(T.nodes, "creator", KEPT_CREATOR)
    const r = ugcEstimateRunParts(pick(nodes, "creator", "clips", "clip", "cards", ...FINISH), nodes, T.edges)
    expect(partsOf(r)).toEqual(["clip", "cards", "join", "overlay", "captions"])
    expect(r!.coveredIds.has("creator")).toBe(true)
  })

  it("a creator whose options wait is priced: its only run that goes on is a new draw", () => {
    const nodes = withData(T.nodes, "creator", { ...KEPT_CREATOR, candidates: [{ imageUrl: "https://cdn.example/a.png" }] })
    expect(partsOf(ugcEstimateRunParts(pick(nodes, "creator"), nodes, T.edges))).toEqual(["creator"])
  })

  it("UGC Clips alone is free: no UGC part", () => {
    expect(ugcEstimateRunParts(pick(T.nodes, "clips"), T.nodes, T.edges)).toBeNull()
  })

  it("a ▶ on an outro below the video is that node's own run, never the video's join", () => {
    const nodes = [...T.nodes, n("outro", "combine-videos")]
    const edges = [...T.edges, e("captions", "outro", "in")]
    expect(ugcEstimateRunParts(pick(nodes, "outro"), nodes, edges)).toBeNull()
  })

  it("UGC Clip's clips run as many times as its UGC Clips does: once, when UGC Clips is not in the run", () => {
    const whole = ugcEstimateRunParts(runOf(T.nodes), T.nodes, T.edges)
    expect(whole!.chains[0]!.nodes.find((m) => m.part === "clip")?.fanOutOf).toBe("clips")
    const clipOnly = ugcEstimateRunParts(pick(T.nodes, "clip"), T.nodes, T.edges)
    expect(clipOnly!.chains[0]!.nodes).toEqual([{ id: "clip", part: "clip", fanOutOf: null }])
  })

  it("two videos sharing a script: the script is in both, and counted once, at the larger of its figures", () => {
    const b = video("b-", { targetDurationSec: 30 })
    const nodes = [...T.nodes, ...b.nodes]
    const edges = [...T.edges, ...b.edges.filter((x) => !(x.source === "b-script" && x.target === "b-clips")), e("script", "b-clips", "plan")]
    const r = ugcEstimateRunParts(runOf(nodes), nodes, edges)
    const withScript = r!.chains.filter((c) => c.nodes.some((m) => m.id === "script"))
    expect(withScript).toHaveLength(2)
    // B's own (unwired) script is a video of its own.
    expect(r!.chains.some((c) => c.nodes.some((m) => m.id === "b-script"))).toBe(true)
    // Each video's figure for its nodes, added up with each node once.
    expect(ugcSumPerNode([{ id: "script", credits: 20 }, { id: "clip", credits: 900 }, { id: "script", credits: 25 }, { id: "b-clip", credits: 1500 }])).toBe(25 + 900 + 1500)
  })
})

describe("a video's input", () => {
  const chainOf = (nodes: N[], edges: E[] = T.edges) => ugcChains(nodes, edges)[0]!
  const everything = { run: { executes: () => true } }

  it("a kept script is priced at the length its saved plan was written to, never the setting", () => {
    const nodes = withData(T.nodes, "script", keptScript(60))
    expect(ugcChainInput(chainOf(nodes), nodes, T.edges, everything)).toEqual({
      // Its plan carries no screenshot: a talking-head plan, whatever is wired now.
      input: { targetDurationSec: 60, screenshotCount: 0, source: "sampled" },
      lengthUnread: false,
      screenshotsUnread: false,
    })
    // The graph's own estimate (publish, the API) reads it the same way.
    expect(ugcChainInput(chainOf(nodes), nodes, T.edges).input.targetDurationSec).toBe(60)
  })

  it("a run that leaves the script out hands on its saved plan: priced at that plan's length", () => {
    const nodes = withData(T.nodes, "script", { targetDurationSec: 15, result: { plan: KEPT_PLAN(45) } })
    const notScript = { run: { executes: (id: string) => id !== "script" } }
    expect(ugcChainInput(chainOf(nodes), nodes, T.edges, notScript).input.targetDurationSec).toBe(45)
    // A run that writes the script again reads the setting.
    expect(ugcChainInput(chainOf(nodes), nodes, T.edges, everything).input.targetDurationSec).toBe(15)
  })

  it("a saved plan handed on is priced at its own screenshot cards, never the script's wires now", () => {
    // Placeholders: a beat carries a screenshot; only that it does is read.
    const shot = { url: "https://cdn.example/1.png" }
    const withShots = (count: number, sec = 30) => ({ ...KEPT_PLAN(sec), beats: [0, 1, 2].map((i) => ({ line: `b${i}`, ...(i < count ? { screenshot: shot } : {}) })) })
    // Written with three screenshots, its wires removed since: three cards.
    const unwired = T.edges.filter((x) => !x.targetHandle.startsWith("screenshot"))
    const keptThree = withData(T.nodes, "script", { targetDurationSec: 15, keepResult: true, result: { plan: withShots(3) } })
    expect(ugcChainInput(chainOf(keptThree, unwired), keptThree, unwired, everything).input).toEqual({ targetDurationSec: 30, screenshotCount: 3, source: "sampled" })
    // Written as a talking head, three wired since: no cards.
    const keptNone = withData(T.nodes, "script", { targetDurationSec: 15, keepResult: true, result: { plan: withShots(0) } })
    expect(ugcChainInput(chainOf(keptNone), keptNone, T.edges, everything).input.screenshotCount).toBe(0)
    // The graph's own estimate (publish, the API) reads it the same way.
    expect(ugcChainInput(chainOf(keptNone), keptNone, T.edges).input.screenshotCount).toBe(0)
    // A run that leaves the script out hands on its plan; one that writes the script again reads the wires.
    const saved = withData(T.nodes, "script", { targetDurationSec: 15, result: { plan: withShots(0) } })
    expect(ugcChainInput(chainOf(saved), saved, T.edges, { run: { executes: (id: string) => id !== "script" } }).input.screenshotCount).toBe(0)
    expect(ugcChainInput(chainOf(saved), saved, T.edges, everything).input.screenshotCount).toBe(3)
    // A malformed beat counts no card, and the rest of the plan is read: never the wires.
    const oneBad = withData(T.nodes, "script", { targetDurationSec: 15, keepResult: true, result: { plan: { ...KEPT_PLAN(30), beats: [{ line: "a", screenshot: shot }, "junk", { line: "c", screenshot: "a string" }] } } })
    expect(ugcChainInput(chainOf(oneBad), oneBad, T.edges, everything)).toEqual({ input: { targetDurationSec: 30, screenshotCount: 1, source: "sampled" }, lengthUnread: false, screenshotsUnread: false })
    // A plan whose beats cannot be read at all: the wires are the best guess, and the figure says it was not checked.
    const unreadable = withData(T.nodes, "script", { targetDurationSec: 15, keepResult: true, result: { plan: { ...KEPT_PLAN(30), beats: "three" } } })
    expect(ugcChainInput(chainOf(unreadable), unreadable, T.edges, everything)).toEqual({ input: { targetDurationSec: 30, screenshotCount: 3, source: "sampled" }, lengthUnread: false, screenshotsUnread: true })
    // A script that writes its plan again reads its wires, with nothing to flag.
    expect(ugcChainInput(chainOf(saved), saved, T.edges, everything).screenshotsUnread).toBe(false)
  })

  it("a saved plan handed on with no readable length cannot be checked", () => {
    const nodes = withData(T.nodes, "script", keptScript())
    expect(ugcChainInput(chainOf(nodes), nodes, T.edges, everything).lengthUnread).toBe(true)
  })

  it("a run counts a screenshot slot when it will hold an image: an upload holding one, or any other producer", () => {
    const gen = T.nodes.map((x) => (x.id.startsWith("shot") ? n(x.id, "generate-image", { prompt: "p" }) : x))
    expect(ugcChainInput(chainOf(gen), gen, T.edges, everything).input.screenshotCount).toBe(3)
    const mixed = T.nodes.map((x) => (x.id === "shot3" ? n("shot3", "generate-image", { prompt: "p" }) : x))
    expect(ugcChainInput(chainOf(mixed), mixed, T.edges, everything).input.screenshotCount).toBe(3)
    const emptyUpload = withData(T.nodes, "shot2", { url: "" })
    expect(ugcChainInput(chainOf(emptyUpload), emptyUpload, T.edges, everything).input.screenshotCount).toBe(2)
    const resultOnly = withData(emptyUpload, "shot2", { generatedResults: [{ url: "https://cdn.example/r.png" }] })
    expect(ugcChainInput(chainOf(resultOnly), resultOnly, T.edges, everything).input.screenshotCount).toBe(3)
    const dangling = [...T.edges, e("gone", "script", "screenshot4")]
    expect(ugcChainInput(chainOf(T.nodes, dangling), T.nodes, dangling, everything).input.screenshotCount).toBe(3)
  })

  it("the graph as built counts every wired slot whose source exists (the runner fills an empty upload)", () => {
    const emptyUpload = withData(T.nodes, "shot2", { url: "" })
    expect(ugcChainInput(chainOf(emptyUpload), emptyUpload, T.edges).input.screenshotCount).toBe(3)
  })

  it("an app run reads its overrides: the runner's length, source and uploads", () => {
    const empty = T.nodes.map((x) => (x.id.startsWith("shot") ? { ...x, data: {} } : x))
    const overrides = { script: { targetDurationSec: 30 }, creator: { source: "photo" }, shot1: { url: "https://cdn.example/u.png" } }
    expect(ugcChainInput(chainOf(empty), empty, T.edges, { overrides }).input).toEqual({ targetDurationSec: 30, screenshotCount: 1, source: "photo" })
  })
})
