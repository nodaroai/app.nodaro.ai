/**
 * The server's half of the run-estimate parity (decided 2026-10-07): the
 * listing a template stores (at the 180-minute cap: fixed + 180 × per
 * minute), the server's RUN estimate (`estimateWorkflowCredits`: the app
 * runner's seeded quote, the API and MCP quotes,
 * `/v1/credits/estimate-workflow`, the Render final quote and balance check)
 * and the editor's run estimate (`estimateRunCreditLines` — also the app
 * runner's live estimate, the figure an app run is checked against) quote
 * ONE figure for the same graph. All three read `@nodaro/render-rules`: the
 * render's minutes (`resolveApplyEdlEstimateMinutes`), the runs a node makes
 * (`nodeFanOut`) and the providers it runs (`nodeProviders`, each at its own
 * price).
 *
 * A graph whose render is set to Preview — the four podcast templates (decided
 * 2026-10-08) — is listed in two parts, and each part is one of those quotes:
 * its preview part is the run estimate of a whole run (the whole graph at its
 * saved settings), its final part the run estimate of its Render final (the
 * render at Final and every node after it, the set the editor, the API and the
 * app runner run).
 *
 * All of that holds with the preview stop rule (PREVIEW_STOP_RULE_ENABLED)
 * off, which this file sets rather than reading the environment. With it on, a
 * run stops at the Preview, so its estimate leaves out the nodes after the
 * render and quotes less than the preview part; a describe pins that figure
 * for each template.
 *
 * The sync writes the four with their render at Preview only where the rule
 * is on (decided 2026-10-08, `templateForPreviewStopRule`); where it is off it
 * writes the render at Final, and the graph it writes, listing included,
 * quotes one figure again: the last describe pins it.
 *
 * The fixture holds the expected base totals and the base price of every
 * credit id the cases read; the editor's half
 * (frontend/src/lib/__tests__/run-estimate-parity.test.ts) prices the same
 * graphs from that same price table, so a total that moves on one side only
 * fails one half.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { renderFinalRunSet, renderRunOverrides } from "@nodaro/render-rules"
import { EDIT_PLAN_MAX_MINUTES, editPlanFlatCreditId, editPlanMinutesBaseCredits, editPlanRateCreditId, parseEditPlanMinutesCreditId, videoSfxCreditId, withRunOverrides } from "@nodaro/shared"
import { CreditsService, STATIC_CREDIT_COSTS } from "../../../ee/billing/credits.js"
import { templateForPreviewStopRule } from "../preview-gate.js"
import type { TutorialTemplateDoc } from "../types.js"

// The preview stop rule (PREVIEW_STOP_RULE_ENABLED) changes what a RUN
// estimate counts, so it is set explicitly here and never read from the
// environment: off for every case below but the last describe, which turns it
// on.
const stopRule = vi.hoisted(() => ({ on: false }))
vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => stopRule.on }))
beforeEach(() => {
  stopRule.on = false
})

const here = dirname(fileURLToPath(import.meta.url))
const templatesDir = join(here, "..", "templates")

type Node = { id: string; type: string; data?: Record<string, unknown> }
type Edge = { id?: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data?: Record<string, unknown> }
type Graph = { nodes: Node[]; edges: Edge[] }

const fixture = JSON.parse(readFileSync(join(here, "fixtures", "run-estimate-parity.json"), "utf8")) as {
  prices: Record<string, number>
  templates: Record<string, number>
  templateFinals: Record<string, number>
  templateRunsWithStopRule: Record<string, number>
  templatesSyncedWithoutStopRule: Record<string, number>
  graphs: Record<string, Graph & { credits: number }>
}

const PODCAST = ["podcast-clip-pack", "podcast-multicam-cut", "podcast-tighten-episode", "podcast-trailer-formats"]
const docs = new Map(
  readdirSync(templatesDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(templatesDir, f), "utf8")) as TutorialTemplateDoc)
    .map((t) => [t.slug, t] as const),
)
const templates = new Map([...docs].map(([slug, t]) => [slug, { nodes: t.nodes as Node[], edges: t.edges as Edge[] }] as const))

/** The listing at the 180-minute cap: what it quotes when no recording is known. */
function listingAtCap({ nodes, edges }: Graph): number {
  const { preview, final } = listingPartsAtCap({ nodes, edges })
  return preview + final
}

/** Each part of the listing at the 180-minute cap. */
function listingPartsAtCap({ nodes, edges }: Graph): { preview: number; final: number } {
  const l = CreditsService.estimateWorkflowBaseListing(nodes, edges, "template")
  return { preview: l.preview + 180 * l.previewPerMinute, final: l.final + 180 * l.finalPerMinute }
}

/** The run estimate of a render's Render final: its run set, the render at Final. */
function renderFinalEstimate({ nodes, edges }: Graph, renderId: string): number {
  const set = renderFinalRunSet(renderId, nodes, edges)
  const priced = withRunOverrides(nodes, renderRunOverrides(renderId, "final", set))
  return CreditsService.estimateWorkflowBaseCredits(priced, edges, { runNodeIds: set })
}

const cases: Array<[string, Graph, number]> = [
  ...PODCAST.map((slug) => [slug, templates.get(slug)!, fixture.templates[slug]!] as [string, Graph, number]),
  ...Object.entries(fixture.graphs).map(([name, g]) => [name, g, g.credits] as [string, Graph, number]),
]

describe("the fixture's prices are the server's base prices", () => {
  // An `edit-plan:<mode>:<tier>:<N>m` id is never stored: it is its mode/tier's
  // flat row plus its rate row times N (`editPlanMinutesBaseCredits`, one
  // formula for every lookup), so it is pinned through those two rows.
  const staticPrice = (id: string): number | undefined => {
    const plan = parseEditPlanMinutesCreditId(id)
    if (!plan) return STATIC_CREDIT_COSTS[id]
    const flat = STATIC_CREDIT_COSTS[editPlanFlatCreditId(plan.mode, plan.tier)]
    const rate = STATIC_CREDIT_COSTS[editPlanRateCreditId(plan.mode, plan.tier)]
    return flat === undefined || rate === undefined ? undefined : editPlanMinutesBaseCredits(flat, rate, plan.minutes)
  }
  it.each(Object.entries(fixture.prices))("%s", (id, credits) => {
    expect(staticPrice(id)).toBe(credits)
  })
  it("the edit-plan ids it reads are priced at the 180-minute cap", () => {
    for (const id of Object.keys(fixture.prices).filter((i) => i.startsWith("edit-plan:"))) {
      expect(parseEditPlanMinutesCreditId(id)?.minutes, id).toBe(EDIT_PLAN_MAX_MINUTES)
    }
  })
})

describe("the fixture covers the four podcast templates", () => {
  it("every one, and nothing else", () => {
    expect(Object.keys(fixture.templates).sort()).toEqual(PODCAST)
    expect(Object.keys(fixture.templateFinals).sort()).toEqual(PODCAST)
    for (const slug of PODCAST) expect(templates.has(slug), slug).toBe(true)
  })
})

describe("the server's run estimate quotes what the listing lists", () => {
  it.each(cases)("%s", (name, graph, credits) => {
    const { nodes, edges } = graph
    // A graph with no Preview render has no final part: its whole listing is the run.
    expect(listingPartsAtCap(graph), `${name}: listing at the cap`).toEqual({ preview: credits, final: fixture.templateFinals[name] ?? 0 })
    expect(CreditsService.estimateWorkflowBaseCredits(nodes, edges), `${name}: run estimate`).toBe(credits)
    expect(CreditsService.estimateWorkflowBaseCredits(nodes, edges, { scope: "whole-graph" }), `${name}: whole-graph run estimate`).toBe(credits)
  })
})

describe("a template's Render final quotes the listing's final part", () => {
  it.each(PODCAST)("%s", (slug) => {
    const graph = templates.get(slug)!
    const renders = graph.nodes.filter((n) => n.type === "apply-edl")
    // One render, set to Preview (decided 2026-10-08): the run stops at it.
    expect(renders.map((n) => n.data?.quality), slug).toEqual(["proxy"])
    expect(renderFinalEstimate(graph, renders[0]!.id), `${slug}: Render final run estimate`).toBe(fixture.templateFinals[slug])
  })
})

describe("several providers on one node", () => {
  const img = (data: Record<string, unknown>): Node => ({ id: "img", type: "generate-image", data: { provider: "gpt-image-2", ...data } })
  const run = (n: Node) => CreditsService.estimateWorkflowBaseCredits([n], [])
  const a = run(img({ provider: "gpt-image-2" }))
  const b = run(img({ provider: "nano-banana-pro" }))
  it("the run estimate prices each provider at its own price", () => {
    expect(a).not.toBe(b)
    expect(run(img({ providers: ["gpt-image-2", "nano-banana-pro"] }))).toBe(a + b)
  })
  it("times the Repeat count", () => {
    expect(run(img({ providers: ["gpt-image-2", "nano-banana-pro"], repeatCount: 3 }))).toBe(3 * (a + b))
  })
  it("one provider in the list is a single-provider run", () => {
    expect(run(img({ providers: ["nano-banana-pro"] }))).toBe(a)
  })
})

describe("a Render final run prices only its own nodes, at the render's real length", () => {
  // A tighten whose plan is saved: the plan is outside the run, so its EDL's
  // own length (2.5 minutes → 3) is what renders.
  const seg = (inMs: number, outMs: number) => ({ id: `s${inMs}`, inMs, outMs, video: "v" })
  const edl = { version: 1, clock: "master", sources: [{ id: "v", url: "https://cdn/v.mp4", kind: "video" }], segments: [seg(0, 150_000)] }
  const nodes: Node[] = [
    { id: "rec", type: "upload-video", data: {} },
    { id: "plan", type: "edit-plan", data: { mode: "tighten", planTier: "standard", generatedJson: edl } },
    { id: "render", type: "apply-edl", data: { quality: "final" } },
  ]
  const edges: Edge[] = [
    { source: "rec", target: "plan", targetHandle: "sources" },
    { source: "plan", target: "render", sourceHandle: "edl", targetHandle: "edl" },
  ]
  it("3 minutes of the saved plan, not 1", () => {
    const run = CreditsService.estimateWorkflowBaseCredits(nodes, edges, { runNodeIds: new Set(["render"]) })
    expect(run).toBe(3 * STATIC_CREDIT_COSTS["apply-edl"]!)
  })
  it("the whole run re-plans: the render follows the episode, at the 180-minute cap", () => {
    const run = CreditsService.estimateWorkflowBaseCredits(nodes, edges, { runNodeIds: new Set(["plan", "render"]) })
    const plan = CreditsService.estimateWorkflowBaseCredits(nodes, edges, { runNodeIds: new Set(["plan"]) })
    expect(run - plan).toBe(180 * STATIC_CREDIT_COSTS["apply-edl"]!)
  })
})

describe("a step priced by the length it is given, on a render's output", () => {
  // Trim, Loop and Combine Videos on a render are priced at the render's
  // estimated minutes (the ceiling when the episode is unknown), as the
  // listing prices them; a chain of them at the length each passes on.
  const chain = (mode: string, steps: Node[], extraEdges: Edge[] = []): Graph => ({
    nodes: [
      { id: "rec", type: "upload-video", data: {} },
      { id: "plan", type: "edit-plan", data: { mode, planTier: "standard" } },
      { id: "render", type: "apply-edl", data: { quality: "final" } },
      ...steps,
    ],
    edges: [
      { source: "rec", target: "plan", targetHandle: "sources" },
      { source: "rec", target: "render", targetHandle: "sources" },
      { source: "plan", target: "render", sourceHandle: "edl", targetHandle: "edl" },
      ...extraEdges,
    ],
  })
  const trim = (id: string, data: Record<string, unknown> = {}): Node => ({ id, type: "trim-video", data })
  const loop = (id: string, data: Record<string, unknown> = {}): Node => ({ id, type: "loop-video", data })
  const combine = (id: string): Node => ({ id, type: "combine-videos", data: {} })
  const wire = (source: string, target: string, targetHandle = "in"): Edge => ({ source, target, targetHandle })

  // Linear in the length it is given: the listing at the cap IS the run estimate.
  const linear: Array<[string, Graph]> = [
    ["a Combine Videos of a trailer render and a second recording", chain("trailer", [{ id: "intro", type: "upload-video", data: {} }, combine("c")], [wire("render", "c"), wire("intro", "c")])],
    ["a Combine Videos of a tighten render (per minute of the episode) and a second recording", chain("tighten", [{ id: "intro", type: "upload-video", data: {} }, combine("c")], [wire("render", "c"), wire("intro", "c")])],
    ["a Trim of a tighten render", chain("tighten", [trim("t")], [wire("render", "t")])],
    ["a Loop of a trailer render", chain("trailer", [loop("l")], [wire("render", "l")])],
  ]
  it.each(linear)("%s: the run estimate is the listing at the cap", (_name, { nodes, edges }) => {
    expect(CreditsService.estimateWorkflowBaseCredits(nodes, edges, { scope: "whole-graph" })).toBe(listingAtCap({ nodes, edges }))
  })

  // A chain, or a step whose price is not linear in its input (Trim to the
  // first N seconds, Loop by duration): the listing is the steepest rise per
  // minute, so at the cap it is never below the run estimate, and above it by
  // no more than that rounding up or that steepness.
  const chained: Array<[string, Graph]> = [
    ["a Loop in repeat mode, then a Combine, on a tighten render", chain("tighten", [loop("l", { repeatCount: 3 }), combine("c")], [wire("render", "l"), wire("l", "c")])],
    ["a Trim to the first 20 seconds, then a Combine, on a tighten render", chain("tighten", [trim("t", { trimMode: "keep-first-seconds", keepFirstSeconds: 20 }), combine("c")], [wire("render", "t"), wire("t", "c")])],
  ]
  it.each(chained)("%s: the listing at the cap is never below the run estimate", (_name, { nodes, edges }) => {
    const run = CreditsService.estimateWorkflowBaseCredits(nodes, edges, { scope: "whole-graph" })
    expect(listingAtCap({ nodes, edges })).toBeGreaterThanOrEqual(run)
  })

  it("a Combine Videos on a render is priced at the render's length, not the fallback length", () => {
    const { nodes, edges } = chain("tighten", [{ id: "intro", type: "upload-video", data: {} }, combine("c")], [wire("render", "c"), wire("intro", "c")])
    const onRender = CreditsService.estimateWorkflowBaseCredits(nodes, edges, { scope: "whole-graph", runNodeIds: new Set(["c"]) })
    const twoUnknown = CreditsService.estimateWorkflowBaseCredits(
      [{ id: "a", type: "upload-video", data: {} }, { id: "b", type: "upload-video", data: {} }, combine("c")],
      [wire("a", "c"), wire("b", "c")],
      { runNodeIds: new Set(["c"]) },
    )
    expect(onRender).toBeGreaterThan(twoUnknown * 100)
  })
  // Video SFX is priced by a row per clip length, at most 300 seconds. On a
  // render's output (whose length a run estimate knows) it is that length's
  // row, as the listing lists it (decided 2026-10-07), not the 8-second row an
  // unmeasured clip is charged.
  const sfx = (id = "sfx"): Node => ({ id, type: "video-sfx", data: {} })
  const sfxCredits = (graph: Graph): number => {
    const without = { nodes: graph.nodes.filter((n) => n.type !== "video-sfx"), edges: graph.edges.filter((e) => e.target !== "sfx") }
    return (
      CreditsService.estimateWorkflowBaseCredits(graph.nodes, graph.edges, { scope: "whole-graph" }) -
      CreditsService.estimateWorkflowBaseCredits(without.nodes, without.edges, { scope: "whole-graph" })
    )
  }
  const sfxRow = (sec: number): number => STATIC_CREDIT_COSTS[videoSfxCreditId(sec)]!
  const sfxOn: Array<[string, Graph, number]> = [
    ["a trailer render (its 2 minutes)", chain("trailer", [sfx()], [wire("render", "sfx", "video")]), sfxRow(120)],
    ["a tighten render (the episode, capped at 300 seconds)", chain("tighten", [sfx()], [wire("render", "sfx", "video")]), sfxRow(300)],
    ["a Trim to the first 20 seconds of a tighten render", chain("tighten", [trim("t", { trimMode: "keep-first-seconds", keepFirstSeconds: 20 }), sfx()], [wire("render", "t"), wire("t", "sfx", "video")]), sfxRow(20)],
    ["a Loop (3 copies) of a trailer render: 360 seconds, capped at 300", chain("trailer", [loop("l", { repeatCount: 3 }), sfx()], [wire("render", "l"), wire("l", "sfx", "video")]), sfxRow(300)],
    ["a Video SFX after another (the clip passes on)", chain("trailer", [sfx("first"), sfx()], [wire("render", "first", "video"), wire("first", "sfx", "video")]), sfxRow(120)],
  ]
  it.each(sfxOn)("a Video SFX on %s: the run estimate prices the clip's length row", (_name, graph, row) => {
    expect(sfxCredits(graph)).toBe(row + (graph.nodes.some((n) => n.id === "first") ? sfxRow(120) : 0))
  })
  it.each(sfxOn.slice(0, 2))("a Video SFX on %s: the run estimate is the listing at the cap", (_name, { nodes, edges }) => {
    expect(CreditsService.estimateWorkflowBaseCredits(nodes, edges, { scope: "whole-graph" })).toBe(listingAtCap({ nodes, edges }))
  })
  it("a Video SFX with its prompt wired before the video is priced by the video wire's length", () => {
    const { nodes, edges } = chain("trailer", [sfx(), { id: "txt", type: "text-prompt", data: {} }], [wire("txt", "sfx", "prompt"), wire("render", "sfx", "video")])
    expect(sfxCredits({ nodes, edges })).toBe(sfxRow(120))
  })
  it("a Video SFX on a video whose length a run estimate cannot follow keeps the 8-second row", () => {
    const { nodes, edges } = chain("trailer", [sfx()], [wire("rec", "sfx", "video")])
    expect(sfxCredits({ nodes, edges })).toBe(sfxRow(8))
  })

})

describe("with the preview stop rule on, a template's run stops at its Preview", () => {
  // A run's estimate leaves out every node the Preview render gates (they run
  // at Render final), so it quotes the preview part less that tail. The
  // listing is not a run estimate: it still counts the whole graph, and so
  // does a whole-graph estimate.
  beforeEach(() => {
    stopRule.on = true
  })
  it("the fixture covers the four podcast templates", () => {
    expect(Object.keys(fixture.templateRunsWithStopRule).sort()).toEqual(PODCAST)
  })
  it.each(PODCAST)("%s", (slug) => {
    const graph = templates.get(slug)!
    const { nodes, edges } = graph
    const run = fixture.templateRunsWithStopRule[slug]!
    expect(CreditsService.estimateWorkflowBaseCredits(nodes, edges), `${slug}: run estimate`).toBe(run)
    expect(run, `${slug}: never above the preview part`).toBeLessThanOrEqual(fixture.templates[slug]!)
    expect(CreditsService.estimateWorkflowBaseCredits(nodes, edges, { scope: "whole-graph" }), `${slug}: whole-graph run estimate`).toBe(fixture.templates[slug])
    expect(listingPartsAtCap(graph), `${slug}: listing at the cap`).toEqual({ preview: fixture.templates[slug], final: fixture.templateFinals[slug] })
    const render = nodes.find((n) => n.type === "apply-edl")!
    expect(renderFinalEstimate(graph, render.id), `${slug}: Render final run estimate`).toBe(fixture.templateFinals[slug])
  })
})

describe("the template the sync writes, in each state of the preview stop rule", () => {
  // Rule on: the template as authored, render at Preview — every figure above.
  // Rule off: the render at Final (decided 2026-10-08), so a run renders the
  // delivery and runs the nodes after it, and the listing stored with it, its
  // run estimate and a whole-graph estimate all quote one figure.
  it("the fixture covers the four podcast templates", () => {
    expect(Object.keys(fixture.templatesSyncedWithoutStopRule).sort()).toEqual(PODCAST)
  })

  it.each(PODCAST)("%s: rule on, the authored graph and its listing", (slug) => {
    stopRule.on = true
    const doc = templateForPreviewStopRule(docs.get(slug)!, true)
    const { nodes, edges } = { nodes: doc.nodes as Node[], edges: doc.edges as Edge[] }
    expect(nodes.filter((n) => n.type === "apply-edl").map((n) => n.data?.quality), slug).toEqual(["proxy"])
    expect(listingPartsAtCap({ nodes, edges }), `${slug}: listing at the cap`).toEqual({ preview: fixture.templates[slug], final: fixture.templateFinals[slug] })
    expect(doc.estimatedCredits! + 180 * (doc.estimatedPerMinuteCredits ?? 0), `${slug}: the listing stored`).toBe(fixture.templates[slug]! + fixture.templateFinals[slug]!)
    expect(CreditsService.estimateWorkflowBaseCredits(nodes, edges), `${slug}: run estimate`).toBe(fixture.templateRunsWithStopRule[slug])
  })

  it.each(PODCAST)("%s: rule off, the Final graph and its listing quote one figure", (slug) => {
    const doc = templateForPreviewStopRule(docs.get(slug)!, false)
    const { nodes, edges } = { nodes: doc.nodes as Node[], edges: doc.edges as Edge[] }
    const credits = fixture.templatesSyncedWithoutStopRule[slug]!
    expect(nodes.filter((n) => n.type === "apply-edl").map((n) => n.data?.quality), slug).toEqual(["final"])
    expect(listingPartsAtCap({ nodes, edges }), `${slug}: listing at the cap`).toEqual({ preview: credits, final: 0 })
    expect(doc.estimatedCredits! + 180 * (doc.estimatedPerMinuteCredits ?? 0), `${slug}: the listing stored`).toBe(credits)
    expect(CreditsService.estimateWorkflowBaseCredits(nodes, edges), `${slug}: run estimate`).toBe(credits)
    expect(CreditsService.estimateWorkflowBaseCredits(nodes, edges, { scope: "whole-graph" }), `${slug}: whole-graph run estimate`).toBe(credits)
  })
})
