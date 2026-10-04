// The run ESTIMATE gates the run: Execute-All refuses when the balance is below
// it. Two things were silently priced as "one":
//   - a per-output-minute render (Apply EDL): the model cost is a RATE, and a
//     45-minute cut that reserves 450 was quoted at 10;
//   - Edit Plan's `clips` fan-out: the render and caption nodes run once per
//     clip, but only `list` sources were ever counted.
// On the shipped podcast templates that let a run pass the precheck, charge
// Transcribe + Edit Plan, then fail at the render's reserve.
import { describe, it, expect, vi } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, resolve, relative } from "node:path"

vi.mock("@/components/editor/config-panels/helpers", () => ({
  getModelIdentifier: (n: { type?: string }) => n.type ?? "",
}))

import { FAN_OUT_EACH_TYPES } from "@nodaro/shared"
import { EACH_WIRE_FAN_OUT, getCostMultiplier, getFanOutMultiplier, getPricingUnits, NO_RERUNS, PRODUCER_FAN_OUT } from "../types"
import { estimateRunCredits } from "../estimate-run-credits"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

const n = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as WorkflowNode
const e = (source: string, target: string, targetHandle: string, outputMode?: string): WorkflowEdge =>
  ({ id: `${source}-${target}`, source, target, targetHandle, ...(outputMode ? { data: { outputMode } } : {}) }) as WorkflowEdge
const ids = (...nodes: WorkflowNode[]): ReadonlySet<string> => new Set(nodes.map((x) => x.id))
const edlOf = (minutes: number) => ({
  version: 1, clock: "master", sources: [{ id: "v", url: "https://cdn/v.mp4", kind: "video" }],
  segments: [{ id: "s", inMs: 0, outMs: minutes * 60_000, video: "v" }],
})

/** The per-unit model costs the live cache would return (credits). */
const RATE: Record<string, number> = { transcribe: 10, "edit-plan": 240, "apply-edl": 10, "add-captions": 20, "generate-image": 5, "image-to-video": 50 }
const cachedCost = (id: string) => RATE[id]

describe("getPricingUnits", () => {
  it("is 1 for every node that is not priced per unit", () => {
    const img = n("i", "generate-image")
    expect(getPricingUnits(img, [img], [], NO_RERUNS)).toBe(1)
  })
  it("is the render's minutes for apply-edl", () => {
    const master = n("m", "upload-audio", { metadata: { durationSeconds: 45 * 60 } })
    const plan = n("ep", "edit-plan", { mode: "tighten" })
    const ae = n("ae", "apply-edl")
    const edges = [e("m", "ep", "sources"), e("ep", "ae", "edl")]
    expect(getPricingUnits(ae, [master, plan, ae], edges, ids(plan, ae))).toBe(45)
  })

  // The workflow run reserves 10 credits per 5 s of a trim's output (the
  // single-node route's price); its one-unit row times these units is that.
  it("is the 5-second steps of a trim's output, and the steps of an Assemble Narrated Video", () => {
    const trim = { id: "t", type: "trim-video", position: { x: 0, y: 0 }, data: { trimMode: "time", startTime: 0, endTime: 60 } } as never
    expect(getPricingUnits(trim, [trim], [], NO_RERUNS)).toBe(12)
    const assemble = { id: "a", type: "assemble-narrated-video", position: { x: 0, y: 0 }, data: {} } as never
    const blocks = Array.from({ length: 7 }, (_, i) => ({ id: `e${i}`, source: `v${i}`, target: "a", targetHandle: "video" })) as never
    expect(getPricingUnits(assemble, [assemble], blocks, NO_RERUNS)).toBe(5)
  })

  // LTX 2.3 Pro Extend reserves its per-second row × the seconds it adds (the
  // model's default 6 when none is set); every other extend is one row.
  it("is the seconds an LTX 2.3 Pro extend adds", () => {
    const ltx = n("x", "extend-video", { provider: "ltx-2.3-pro", duration: 20 })
    expect(getPricingUnits(ltx, [ltx], [], NO_RERUNS)).toBe(20)
    const ltxDefault = n("y", "extend-video", { provider: "ltx-2.3-pro" })
    expect(getPricingUnits(ltxDefault, [ltxDefault], [], NO_RERUNS)).toBe(6)
    const veo = n("z", "extend-video", { provider: "veo-extend", duration: 20 })
    expect(getPricingUnits(veo, [veo], [], NO_RERUNS)).toBe(1)
  })
})

describe("fan-out — Edit Plan clips", () => {
  const plan = (data: Record<string, unknown>) => n("ep", "edit-plan", data)
  const ae = n("ae", "apply-edl")
  const edges = [e("ep", "ae", "edl")]
  const replans = ids(n("ep", "edit-plan"))

  it("re-planning: fans out `count` renders (default 8, capped at 50)", () => {
    expect(getFanOutMultiplier(ae, [plan({ mode: "clips", count: 5 }), ae], edges, replans)).toBe(5)
    expect(getFanOutMultiplier(ae, [plan({ mode: "clips" }), ae], edges, replans)).toBe(8)
    expect(getFanOutMultiplier(ae, [plan({ mode: "clips", count: 9000 }), ae], edges, replans)).toBe(50)
  })
  it("re-planning: never counts fewer than a persisted plan holds", () => {
    const p = plan({ mode: "clips", count: 3, generatedJson: [{}, {}, {}, {}, {}, {}] })
    expect(getFanOutMultiplier(ae, [p, ae], edges, replans)).toBe(6)
  })
  it("NOT re-planning: the persisted plan is what iterates — exactly", () => {
    const p = plan({ mode: "clips", count: 8, generatedJson: [{}, {}, {}] })
    expect(getFanOutMultiplier(ae, [p, ae], edges, NO_RERUNS)).toBe(3)
  })
  it("does not fan out for tighten / chapters", () => {
    expect(getFanOutMultiplier(ae, [plan({ mode: "tighten", count: 5 }), ae], edges, replans)).toBe(1)
    expect(getFanOutMultiplier(ae, [plan({ mode: "chapters" }), ae], edges, replans)).toBe(1)
  })

  // Both engines fan out on the SHAPE of the persisted plan. A user can switch
  // the mode setting without re-running, leaving a clips array on a "tighten"
  // node (or a tighten object on a "clips" node).
  it("NOT re-planning: keys on the persisted plan's shape, not the current mode setting", () => {
    const switchedToTighten = plan({ mode: "tighten", generatedJson: [{}, {}, {}, {}] })
    expect(getFanOutMultiplier(ae, [switchedToTighten, ae], edges, NO_RERUNS)).toBe(4)
    const switchedToClips = plan({ mode: "clips", count: 8, generatedJson: { version: 1, segments: [] } })
    expect(getFanOutMultiplier(ae, [switchedToClips, ae], edges, NO_RERUNS)).toBe(1)
  })
  it("NOT re-planning with no plan yet (a fresh template): falls back to what the settings ask for", () => {
    expect(getFanOutMultiplier(ae, [plan({ mode: "clips", count: 5 }), ae], edges, NO_RERUNS)).toBe(5)
    expect(getFanOutMultiplier(ae, [plan({ mode: "tighten" }), ae], edges, NO_RERUNS)).toBe(1)
  })
  it("re-planning: keys on the mode setting — the persisted shape is about to be replaced", () => {
    const switchedToTighten = plan({ mode: "tighten", generatedJson: [{}, {}, {}, {}] })
    expect(getFanOutMultiplier(ae, [switchedToTighten, ae], edges, replans)).toBe(1)
  })

  // The edge can carry a range / list selector both engines honour ("first 3").
  it("counts only the clips the edge's selector keeps", () => {
    const first3 = [{ ...e("ep", "ae", "edl"), data: { selectorMode: "range", rangeFrom: "1", rangeTo: "3" } } as WorkflowEdge]
    expect(getFanOutMultiplier(ae, [plan({ mode: "clips", count: 8 }), ae], first3, replans)).toBe(3)
    const picked = [{ ...e("ep", "ae", "edl"), data: { selectorMode: "list", listExpression: "1,4" } } as WorkflowEdge]
    expect(getFanOutMultiplier(ae, [plan({ mode: "clips", generatedJson: [{}, {}, {}, {}, {}] }), ae], picked, NO_RERUNS)).toBe(2)
    const justOne = [{ ...e("ep", "ae", "edl"), data: { selectorMode: "range", rangeFrom: "2", rangeTo: "2" } } as WorkflowEdge]
    expect(getFanOutMultiplier(ae, [plan({ mode: "clips", count: 8 }), ae], justOne, replans)).toBe(1)
  })
})

describe("fan-out — inherited down a clips chain, and ONLY a clips chain", () => {
  const p = n("ep", "edit-plan", { mode: "clips", count: 5 })
  const ae = n("ae", "apply-edl")
  const cap = n("cap", "add-captions")
  const all = ids(p, ae, cap)

  it('Clip Pack: captions across an explicit "each" edge run once per clip', () => {
    const edges = [e("ep", "ae", "edl"), e("ae", "cap", "in", "each")]
    expect(getFanOutMultiplier(cap, [p, ae, cap], edges, all)).toBe(5)
  })
  it('an ordinary edge (default "last") from the fanned-out render still runs once', () => {
    const edges = [e("ep", "ae", "edl"), e("ae", "cap", "in")]
    expect(getFanOutMultiplier(cap, [p, ae, cap], edges, all)).toBe(1)
  })

  // Deliberately NOT general. A Selector / list transform runs ONCE over its whole
  // list, and other "each" chains were never inherited: those graphs must price
  // exactly what they priced before this change.
  it("leaves every other graph's multiplier unchanged", () => {
    const list = n("l", "list", { items: "a\nb\nc\nd" })
    const img = n("img", "generate-image")
    const i2v = n("v", "image-to-video")
    const viaEach = [e("l", "img", "prompt"), e("img", "v", "image", "each")]
    expect(getFanOutMultiplier(img, [list, img, i2v], viaEach, ids(list, img, i2v))).toBe(4)
    expect(getFanOutMultiplier(i2v, [list, img, i2v], viaEach, ids(list, img, i2v))).toBe(1)

    const sel = n("s", "selector")
    const afterSelector = [e("l", "s", "in"), e("s", "img", "prompt")]
    expect(getFanOutMultiplier(img, [list, sel, img], afterSelector, ids(list, sel, img))).toBe(1)
  })

  it("terminates on a cycle", () => {
    const a = n("a", "add-captions"), b = n("b", "add-captions")
    const edges = [e("a", "b", "in", "each"), e("b", "a", "in", "each")]
    expect(getFanOutMultiplier(a, [a, b], edges, ids(a, b))).toBe(1)
  })
})

describe("fan-out — Content Ideas", () => {
  const ideas = (data: Record<string, unknown>) => n("ci", "content-ideas", data)
  const script = n("s", "generate-script")
  const edges = [e("ci", "s", "prompt")]
  const reruns = ids(n("ci", "content-ideas"))

  it("running: one script per requested idea — the count, clamped like the run (1–10, default 5)", () => {
    expect(getFanOutMultiplier(script, [ideas({ count: 7 }), script], edges, reruns)).toBe(7)
    expect(getFanOutMultiplier(script, [ideas({}), script], edges, reruns)).toBe(5)
    expect(getFanOutMultiplier(script, [ideas({ count: 99 }), script], edges, reruns)).toBe(10)
    expect(getFanOutMultiplier(script, [ideas({ count: 1 }), script], edges, reruns)).toBe(1)
  })
  it("running: the count wins over briefs a previous run left", () => {
    expect(getFanOutMultiplier(script, [ideas({ count: 5, ideaBriefs: ["a", "b"] }), script], edges, reruns)).toBe(5)
  })
  it("NOT running: the saved briefs are what iterate — exactly", () => {
    expect(getFanOutMultiplier(script, [ideas({ count: 5, ideaBriefs: ["a", " ", "b", "c"] }), script], edges, NO_RERUNS)).toBe(3)
  })
  it("NOT running with nothing saved yet (a fresh template): the count", () => {
    expect(getFanOutMultiplier(script, [ideas({ count: 4 }), script], edges, NO_RERUNS)).toBe(4)
  })
  it("honours the edge: a selector keeps fewer; a non-each edge runs once", () => {
    const first2 = [{ ...e("ci", "s", "prompt"), data: { selectorMode: "range", rangeFrom: "1", rangeTo: "2" } } as WorkflowEdge]
    expect(getFanOutMultiplier(script, [ideas({ count: 5 }), script], first2, reruns)).toBe(2)
    expect(getFanOutMultiplier(script, [ideas({ count: 5 }), script], [e("ci", "s", "prompt", "last")], reruns)).toBe(1)
  })
})

// A fan-out producer the estimate cannot size is priced as ONE downstream run:
// the balance precheck then passes a run that cannot finish. Every
// FAN_OUT_EACH_TYPES member is either a list operation (counted from its items)
// or declares its count in PRODUCER_FAN_OUT.
describe("every fan-out producer is sized by the estimate", () => {
  const LIST_OPERATIONS = new Set(["list", "split-text", "filter-list", "deduplicate", "merge-lists", "sort-list", "selector"])
  it("a FAN_OUT_EACH_TYPES member that is not a list operation has a PRODUCER_FAN_OUT entry", () => {
    const unsized = [...FAN_OUT_EACH_TYPES].filter((t) => !LIST_OPERATIONS.has(t) && !(t in PRODUCER_FAN_OUT))
    expect(unsized).toEqual([])
  })
  it("PRODUCER_FAN_OUT names only fan-out producers", () => {
    for (const t of Object.keys(PRODUCER_FAN_OUT)) expect(FAN_OUT_EACH_TYPES.has(t), t).toBe(true)
  })
})

describe("estimateRunCredits — the shipped Steal the Format template", () => {
  const TEMPLATE = resolve(__dirname, "../../../../../../backend/src/lib/tutorial-seed/templates/steal-the-format.json")
  const doc = JSON.parse(readFileSync(TEMPLATE, "utf8")) as { nodes: WorkflowNode[]; edges: WorkflowEdge[] }

  it("whole run: the script node is priced for the one idea its wire picks", () => {
    const script = doc.nodes.find((x) => x.data && (x.data as { label?: string }).label === "Script")!
    const runs = ids(...doc.nodes.filter((x) => x.type !== "sticky-note"))
    expect(getCostMultiplier(script, doc.nodes, doc.edges, runs)).toBe(1)
  })

  it("set back to Each, the same wire prices one script per idea", () => {
    const script = doc.nodes.find((x) => x.data && (x.data as { label?: string }).label === "Script")!
    const ideas = doc.nodes.find((x) => x.type === "content-ideas")!
    const each = doc.edges.map((e) => (e.target === script.id ? { ...e, data: { outputMode: "each" } } : e)) as WorkflowEdge[]
    const runs = ids(...doc.nodes.filter((x) => x.type !== "sticky-note"))
    expect(getCostMultiplier(script, doc.nodes, each, runs)).toBe((ideas.data as { count: number }).count)
  })
})

describe("estimateRunCredits — the shipped podcast template shapes", () => {
  const master = n("m", "upload-audio", { metadata: { durationSeconds: 45 * 60 } })
  const tr = n("tr", "transcribe")

  it("Tighten Episode, whole run: the render is priced for the episode, not one minute", () => {
    const plan = n("ep", "edit-plan", { mode: "tighten" })
    const ae = n("ae", "apply-edl")
    const nodes = [master, tr, plan, ae]
    const edges = [e("m", "tr", "audio"), e("m", "ep", "sources"), e("tr", "ep", "transcript"), e("ep", "ae", "edl")]
    // transcribe 10 + edit-plan 240 + apply-edl 10/min × 45 min = 700 (was 260).
    expect(estimateRunCredits([tr, plan, ae], nodes, edges, cachedCost)).toBe(10 + 240 + 450)
  })

  it("Tighten Episode, render only (run-from-here): the plan on the canvas is priced EXACTLY", () => {
    const plan = n("ep", "edit-plan", { mode: "tighten", generatedJson: edlOf(20) })
    const ae = n("ae", "apply-edl")
    const nodes = [master, tr, plan, ae]
    const edges = [e("m", "ep", "sources"), e("ep", "ae", "edl")]
    expect(estimateRunCredits([ae], nodes, edges, cachedCost)).toBe(200) // 20 min, not the 45-min episode
    expect(getCostMultiplier(ae, nodes, edges, NO_RERUNS)).toBe(20)
  })

  it("Clip Pack, whole run: render AND captions are priced per clip", () => {
    const plan = n("ep", "edit-plan", { mode: "clips", count: 5, targetDurationSec: 60 })
    const ae = n("ae", "apply-edl")
    const cap = n("cap", "add-captions")
    const nodes = [master, tr, plan, ae, cap]
    const edges = [
      e("m", "tr", "audio"), e("m", "ep", "sources"), e("tr", "ep", "transcript"),
      e("ep", "ae", "edl"), e("ae", "cap", "in", "each"),
    ]
    // apply-edl: 10/min × 2 min × 5 clips = 100; add-captions: 20 × 5 = 100.
    expect(estimateRunCredits([tr, plan, ae, cap], nodes, edges, cachedCost)).toBe(10 + 240 + 100 + 100)
  })
})

// An invariant, not a convention: a cost loop that multiplies by the fan-out
// alone re-opens the one-minute render quote. Only `types.ts` (where
// `getCostMultiplier` is composed) may reference `getFanOutMultiplier`.
describe("every estimate loop multiplies by getCostMultiplier", () => {
  const SRC = resolve(__dirname, "../../../..")
  function* sourceFiles(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      if (name === "__tests__" || name === "node_modules") continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) yield* sourceFiles(full)
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield full
    }
  }
  it("the scan really covers the estimate loops (guard against a vacuous pass)", () => {
    const rels = [...sourceFiles(SRC)].map((f) => relative(SRC, f))
    for (const must of [
      "components/editor/workflow-editor/estimate-run-credits.ts",
      "components/editor/workflow-editor/workflow-editor-main.tsx",
      "components/presentation/presentation-view.tsx",
    ]) expect(rels).toContain(must)
  })
  it("no source file outside workflow-editor/types.ts references getFanOutMultiplier", () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file)
      if (rel === "components/editor/workflow-editor/types.ts") continue
      if (readFileSync(file, "utf8").includes("getFanOutMultiplier")) offenders.push(rel)
    }
    expect(offenders, `use getCostMultiplier (fan-out × per-minute units) in:\n${offenders.join("\n")}`).toEqual([])
  })
})

// Camera Switch in a clips chain (decided 2026-10-04): it runs once per clip, its
// EDL fans Apply EDL out once per clip BY DEFAULT, and its transcript edge (the
// same for every clip) never multiplies anything.
describe("fan-out — through Camera Switch in a clips chain (B5)", () => {
  const p = n("ep", "edit-plan", { mode: "clips", count: 6 })
  const cs = n("cs", "camera-switch")
  const ae = n("ae", "apply-edl")
  const cap = n("cap", "add-captions")
  const all = ids(p, cs, ae, cap)
  const h = (source: string, target: string, sourceHandle: string, targetHandle: string, outputMode?: string): WorkflowEdge =>
    ({ id: `${source}-${sourceHandle}-${target}`, source, target, sourceHandle, targetHandle, ...(outputMode ? { data: { outputMode } } : {}) }) as WorkflowEdge
  const edges = [h("ep", "cs", "edl", "edl"), h("cs", "ae", "edl", "edl"), h("cs", "ae", "transcript", "transcript")]

  it("Camera Switch runs once per clip, and so does the render after it (no outputMode set)", () => {
    expect(getFanOutMultiplier(cs, [p, cs, ae], edges, all)).toBe(6)
    expect(getFanOutMultiplier(ae, [p, cs, ae], edges, all)).toBe(6)
  })
  it("captions across an explicit each from the render inherit the clips through Camera Switch", () => {
    const withCaptions = [...edges, h("ae", "cap", "out", "in", "each")]
    expect(getFanOutMultiplier(cap, [p, cs, ae, cap], withCaptions, all)).toBe(6)
  })
  it("a switch that is NOT re-running renders the batch it holds — not Edit Plan's clip count", () => {
    const held = n("cs", "camera-switch", { __listResults: ["a", "b", "c"] })
    expect(getFanOutMultiplier(ae, [p, held, ae], edges, ids(ae))).toBe(3)
    // Re-running, it fans out per clip of the plan again.
    expect(getFanOutMultiplier(ae, [p, held, ae], edges, ids(p, held, ae))).toBe(6)
  })
  it("an each set by hand on the transcript edge counts nothing (it never lists)", () => {
    const transcriptEach = [h("ep", "cs", "edl", "edl"), h("cs", "ae", "transcript", "transcript", "each")]
    expect(getFanOutMultiplier(ae, [p, cs, ae], transcriptEach, all)).toBe(1)
  })
  it("the EDL edge set to Selected renders once; the transcript edge alone never fans out", () => {
    const selected = [h("ep", "cs", "edl", "edl"), h("cs", "ae", "edl", "edl", "last"), h("cs", "ae", "transcript", "transcript")]
    expect(getFanOutMultiplier(ae, [p, cs, ae], selected, all)).toBe(1)
    const transcriptOnly = [h("ep", "cs", "edl", "edl"), h("cs", "ae", "transcript", "transcript")]
    expect(getFanOutMultiplier(ae, [p, cs, ae], transcriptOnly, all)).toBe(1)
  })
})

describe("a Social Search wire set to Each", () => {
  const post = (i: number) => ({ id: `instagram:${i}`, platform: "instagram", url: `https://www.instagram.com/reel/${i}/`, text: "", author: { handle: "a", name: "A" }, metrics: {}, media: { kind: "video" }, hashtags: [], extra: {} })
  const va = n("va", "video-analysis", {})

  it("prices the next node once per post the search holds", () => {
    const search = n("s", "social-search", { generatedJson: [post(1), post(2)], keepPicks: true })
    const nodes = [search, va]
    expect(getCostMultiplier(va, nodes, [e("s", "va", "video", "each")], ids(va))).toBe(2)
    expect(getCostMultiplier(va, nodes, [e("s", "va", "video", "each")], ids(search, va))).toBe(2)
  })

  it("prices a fresh search by the posts a run passes on, and a plain wire once", () => {
    const search = n("s", "social-search", { generatedJson: [post(1), post(2)], pickTop: 3 })
    const nodes = [search, va]
    expect(getCostMultiplier(va, nodes, [e("s", "va", "video", "each")], ids(search, va))).toBe(3)
    expect(getCostMultiplier(va, nodes, [e("s", "va", "video")], ids(va))).toBe(1)
  })

  it("is sized outside the default fan-out list", () => {
    expect(FAN_OUT_EACH_TYPES.has("social-search")).toBe(false)
    expect("social-search" in EACH_WIRE_FAN_OUT).toBe(true)
  })
})
