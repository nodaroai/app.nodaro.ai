/**
 * The editor's half of the run-estimate parity (decided 2026-10-07): once a
 * graph is on the canvas, the editor's whole-run estimate
 * (`estimateRunCreditLines`, Execute-All with every executable node
 * re-running) quotes the figure the template's listing lists at the
 * 180-minute cap and the server's run estimate quotes. The server's half,
 * which owns the fixture, is
 * backend/src/lib/tutorial-seed/__tests__/run-estimate-parity.test.ts.
 *
 * The app runner's live estimate (`computeLiveRunEstimate` — the figure a
 * published app's run is gated on) and the editor's Execute-workflow badge
 * (`estimateWholeRun`) are the fourth and fifth sides: the same graph, the
 * same total.
 *
 * A template whose render is set to Preview (the four podcast templates,
 * decided 2026-10-08) lists a second part, its Render final: the editor's
 * Render final quotes it (the render at Final and every node after it).
 *
 * All of that holds with the preview stop rule off, which this file sets
 * rather than reading the deployment's /config.js. With it on, a run stops at
 * the Preview and its estimate leaves out the nodes after the render; a
 * describe pins that figure, the one the server's half pins too.
 *
 * The sync writes those templates with their render at Preview only where the
 * rule is on (decided 2026-10-08); where it is off it writes each render set
 * to Preview at Final. The last describe opens that graph in the editor: its
 * run estimate quotes the listing stored with it, the server's half pins both.
 *
 * The editor is priced from the fixture's price table alone (the backend half
 * pins that table to the server's base prices), so the totals can only agree
 * when both sides read the same credit ids, the same minutes, the same runs
 * and the same providers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { rendersAsPreview, videoSfxCreditId, withRunOverrides } from "@nodaro/shared"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { estimateRunCreditLines, estimateRunCredits, estimateWholeRun, runModelIds } from "@/components/editor/workflow-editor/estimate-run-credits"
import { computeLiveRunEstimate } from "@/hooks/use-live-run-estimate"
import { isExecutableNode } from "@/components/editor/workflow-editor/types"
import { renderFinalRunSet, renderRunOverrides } from "@/components/editor/workflow-editor/render-final-set"
import { liveExecutable } from "@/components/editor/workflow-editor/run-from-here-set"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const stopRule = vi.hoisted(() => ({ on: false }))
vi.mock("@/lib/runtime-config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/runtime-config")>()),
  runtimePreviewStopRule: () => stopRule.on,
}))
beforeEach(() => {
  stopRule.on = false
})

const HERE = dirname(fileURLToPath(import.meta.url))
const SEED = join(HERE, "../../../../backend/src/lib/tutorial-seed")
const fixture = JSON.parse(readFileSync(join(SEED, "__tests__/fixtures/run-estimate-parity.json"), "utf8")) as {
  prices: Record<string, number>
  templates: Record<string, number>
  templateFinals: Record<string, number>
  templateRunsWithStopRule: Record<string, number>
  templatesSyncedWithoutStopRule: Record<string, number>
  graphs: Record<string, { nodes: WorkflowNode[]; edges: WorkflowEdge[]; credits: number }>
}

type Graph = { nodes: WorkflowNode[]; edges: WorkflowEdge[] }
const template = (slug: string): Graph => JSON.parse(readFileSync(join(SEED, "templates", `${slug}.json`), "utf8")) as Graph

/** The fixture's table; an id it does not hold fails the case (a price the server half never checked). */
function pricesFrom(table: Record<string, number>) {
  const missing = new Set<string>()
  const cachedCost = (id: string) => {
    if (!(id in table)) missing.add(id)
    return table[id]
  }
  return { cachedCost, missing }
}

const cases: Array<[string, Graph, number]> = [
  ...Object.entries(fixture.templates).map(([slug, credits]) => [slug, template(slug), credits] as [string, Graph, number]),
  ...Object.entries(fixture.graphs).map(([name, g]) => [name, { nodes: g.nodes, edges: g.edges }, g.credits] as [string, Graph, number]),
]

describe("the editor's run estimate quotes what the listing lists and the server estimates", () => {
  it.each(cases)("%s", (name, { nodes, edges }, credits) => {
    const executable = nodes.filter(isExecutableNode)
    const { cachedCost, missing } = pricesFrom(fixture.prices)
    const total = estimateRunCredits(executable, nodes, edges, cachedCost)
    expect([...missing], `${name}: credit ids the fixture does not price`).toEqual([])
    expect(total, name).toBe(credits)
  })
})

describe("the editor's Render final quotes the listing's final part", () => {
  // As handleRenderFinal prices it: the run set, the render at Final.
  it.each(Object.entries(fixture.templateFinals))("%s", (slug, credits) => {
    const { nodes, edges } = template(slug)
    const render = nodes.find((n) => n.type === "apply-edl")!
    const runSet = renderFinalRunSet(render.id, nodes, edges)
    const overridden = withRunOverrides(nodes, renderRunOverrides(render.id, "final", runSet))
    const { cachedCost, missing } = pricesFrom(fixture.prices)
    const total = estimateRunCredits(liveExecutable(overridden).filter((n) => runSet.has(n.id)), overridden, edges, cachedCost)
    expect([...missing], `${slug}: credit ids the fixture does not price`).toEqual([])
    expect(total, slug).toBe(credits)
  })
})

describe("the app runner's live estimate quotes the same figure", () => {
  it.each(cases)("%s", (name, { nodes, edges }, credits) => {
    const { cachedCost } = pricesFrom(fixture.prices)
    expect(computeLiveRunEstimate({ nodes, edges }, cachedCost).total, name).toBe(credits)
  })
})

describe("the Execute-workflow badge quotes the same figure", () => {
  it.each(cases)("%s", (name, { nodes, edges }, credits) => {
    const { cachedCost } = pricesFrom(fixture.prices)
    expect(estimateWholeRun(nodes, edges, cachedCost).total, name).toBe(credits)
  })
})

describe("several providers on one node", () => {
  const PRICES: Record<string, number> = { "gpt-image-2": 15, "nano-banana-pro": 45 }
  const img = (data: Record<string, unknown>): WorkflowNode =>
    ({ id: "img", type: "generate-image", position: { x: 0, y: 0 }, data: { label: "Image", provider: "gpt-image-2", ...data } }) as WorkflowNode
  const lines = (n: WorkflowNode) => estimateRunCreditLines([n], [n], [], (id) => PRICES[id])

  it("prices each provider at its own price, on the node's one line", () => {
    const l = lines(img({ providers: ["gpt-image-2", "nano-banana-pro"] }))
    expect(l).toHaveLength(1)
    expect(l[0]!.credits).toBe(15 + 45)
  })
  it("times the Repeat count", () => {
    expect(lines(img({ providers: ["gpt-image-2", "nano-banana-pro"], repeatCount: 3 }))[0]!.credits).toBe(3 * (15 + 45))
  })
  it("one provider in the list is a single-provider run", () => {
    expect(lines(img({ provider: "gpt-image-2", providers: ["nano-banana-pro"] }))[0]!.credits).toBe(15)
  })
})

describe("every provider's price is asked for", () => {
  const img: WorkflowNode = {
    id: "img", type: "generate-image", position: { x: 0, y: 0 },
    data: { label: "Image", provider: "gpt-image-2", providers: ["gpt-image-2", "nano-banana-pro"] },
  } as WorkflowNode
  const cold = () => undefined

  it("the run's ids name each of several providers", () => {
    expect(runModelIds([img], [img], [])).toEqual(expect.arrayContaining(["gpt-image-2", "nano-banana-pro"]))
  })
  it("the live estimate reports each provider's price as uncached, so the runner fetches it", () => {
    expect(computeLiveRunEstimate({ nodes: [img], edges: [] }, cold).uncachedModelIds).toEqual(
      expect.arrayContaining(["gpt-image-2", "nano-banana-pro"]),
    )
  })
  it("the badge reports each provider's price as uncached, so the editor fetches it", () => {
    expect(estimateWholeRun([img], [], cold).uncachedModelIds).toEqual(expect.arrayContaining(["gpt-image-2", "nano-banana-pro"]))
  })
})

describe("a step priced by the length it is given, on a render's output", () => {
  // The server's half (the same graphs against the listing) is in
  // backend/.../run-estimate-parity.test.ts: Trim, Loop and Combine Videos on a
  // render are priced at the render's estimated minutes, a chain at the length
  // each passes on, not at the estimators' fallback length.
  const node = (id: string, type: string, data: Record<string, unknown> = {}): WorkflowNode =>
    ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as WorkflowNode
  const wire = (source: string, target: string, targetHandle = "in"): WorkflowEdge =>
    ({ id: `${source}-${target}`, source, target, targetHandle }) as WorkflowEdge
  const stepCredits = (nodes: WorkflowNode[], edges: WorkflowEdge[], id: string): number => {
    const { cachedCost } = pricesFrom(fixture.prices)
    return estimateRunCreditLines(nodes.filter(isExecutableNode), nodes, edges, cachedCost).find((l) => l.nodeId === id)!.credits
  }
  const render = (mode: string): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } => ({
    nodes: [
      node("rec", "upload-video"),
      node("plan", "edit-plan", { mode, planTier: "standard" }),
      node("render", "apply-edl", { quality: "final" }),
      node("intro", "upload-video"),
      node("c", "combine-videos"),
    ],
    edges: [
      { id: "e1", source: "rec", target: "plan", targetHandle: "sources" } as WorkflowEdge,
      { id: "e2", source: "plan", target: "render", sourceHandle: "edl", targetHandle: "edl" } as WorkflowEdge,
      wire("render", "c"),
      wire("intro", "c"),
    ],
  })
  const fallbackCombine = stepCredits(
    [node("a", "upload-video"), node("b", "upload-video"), node("c", "combine-videos")],
    [wire("a", "c"), wire("b", "c")],
    "c",
  )

  it("a Combine Videos on a tighten render is priced at 180 minutes, not the fallback length", () => {
    const { nodes, edges } = render("tighten")
    expect(stepCredits(nodes, edges, "c")).toBeGreaterThan(fallbackCombine * 100)
  })
  it("a Combine Videos on a trailer render is priced at the trailer's own length", () => {
    const { nodes, edges } = render("trailer")
    const c = stepCredits(nodes, edges, "c")
    expect(c).toBeGreaterThan(fallbackCombine)
    expect(c).toBeLessThan(stepCredits(render("tighten").nodes, render("tighten").edges, "c"))
  })
  it("a chain: a Trim to the first 20 seconds hands the Combine 20 seconds, not the render's length", () => {
    const { nodes, edges } = render("tighten")
    const trim = node("t", "trim-video", { trimMode: "keep-first-seconds", keepFirstSeconds: 20 })
    const chained = [...nodes, trim]
    const chainEdges = [...edges.filter((e) => e.source !== "render" || e.target !== "c"), wire("render", "t"), wire("t", "c")]
    expect(stepCredits(chained, chainEdges, "c")).toBeLessThan(stepCredits(nodes, edges, "c") / 100)
  })
  it("a source it cannot follow keeps the fallback length", () => {
    const noRender = render("tighten").nodes.filter((n) => n.id !== "render" && n.id !== "plan")
    expect(stepCredits(noRender, [wire("rec", "c"), wire("intro", "c")], "c")).toBe(fallbackCombine)
  })
  // Video SFX is priced by a row per clip length, at most 300 seconds. On a
  // render's output it is that length's row, as the listing lists it
  // (decided 2026-10-07), not the 8-second row of an unmeasured clip.
  const sfxRow = (sec: number): number => fixture.prices[videoSfxCreditId(sec)]!
  const sfxOn = (nodes: WorkflowNode[], edges: WorkflowEdge[]): number => stepCredits(nodes, edges, "sfx")
  const sfx = node("sfx", "video-sfx")
  it("a Video SFX on a trailer render is the render's 2-minute row", () => {
    const { nodes, edges } = render("trailer")
    expect(sfxOn([...nodes, sfx], [...edges, wire("render", "sfx", "video")])).toBe(sfxRow(120))
  })
  it("a Video SFX on a tighten render is the 300-second row, the most a run accepts", () => {
    const { nodes, edges } = render("tighten")
    expect(sfxOn([...nodes, sfx], [...edges, wire("render", "sfx", "video")])).toBe(sfxRow(300))
  })
  it("a chain: a Loop of 3 copies of a trailer render is 360 seconds, capped at the 300-second row", () => {
    const { nodes, edges } = render("trailer")
    const loop = node("l", "loop-video", { repeatCount: 3 })
    expect(sfxOn([...nodes, loop, sfx], [...edges, wire("render", "l"), wire("l", "sfx", "video")])).toBe(sfxRow(300))
  })
  it("a chain: a Trim to the first 20 seconds hands the Video SFX 20 seconds", () => {
    const { nodes, edges } = render("tighten")
    const trim = node("t", "trim-video", { trimMode: "keep-first-seconds", keepFirstSeconds: 20 })
    expect(sfxOn([...nodes, trim, sfx], [...edges, wire("render", "t"), wire("t", "sfx", "video")])).toBe(sfxRow(20))
  })
  it("its prompt wired before the video does not move the video wire's length", () => {
    const { nodes, edges } = render("trailer")
    expect(sfxOn([...nodes, sfx, node("txt", "text-prompt")], [...edges, wire("txt", "sfx", "prompt"), wire("render", "sfx", "video")])).toBe(sfxRow(120))
  })
  it("a video whose length it cannot follow keeps the 8-second row", () => {
    const { nodes, edges } = render("trailer")
    expect(sfxOn([...nodes, sfx], [...edges, wire("rec", "sfx", "video")])).toBe(sfxRow(8))
  })
  it("the rows it names are the ones asked for, so a cold cache fetches them", () => {
    const { nodes, edges } = render("trailer")
    const all = [...nodes, sfx]
    const ids = runModelIds(all.filter(isExecutableNode), all, [...edges, wire("render", "sfx", "video")])
    expect(ids).toContain(videoSfxCreditId(120))
  })

})

describe("with the preview stop rule on, a template's run stops at its Preview", () => {
  // Every run estimate leaves out the nodes the Preview render gates; the
  // Render final still quotes the listing's final part.
  beforeEach(() => {
    stopRule.on = true
  })
  it.each(Object.entries(fixture.templateRunsWithStopRule))("%s", (slug, credits) => {
    const { nodes, edges } = template(slug)
    const { cachedCost, missing } = pricesFrom(fixture.prices)
    expect(estimateRunCredits(nodes.filter(isExecutableNode), nodes, edges, cachedCost), `${slug}: editor run estimate`).toBe(credits)
    expect(computeLiveRunEstimate({ nodes, edges }, cachedCost).total, `${slug}: app runner's live estimate`).toBe(credits)
    expect(estimateWholeRun(nodes, edges, cachedCost).total, `${slug}: Execute-workflow badge`).toBe(credits)
    const render = nodes.find((n) => n.type === "apply-edl")!
    const runSet = renderFinalRunSet(render.id, nodes, edges)
    const overridden = withRunOverrides(nodes, renderRunOverrides(render.id, "final", runSet))
    const final = estimateRunCredits(liveExecutable(overridden).filter((n) => runSet.has(n.id)), overridden, edges, cachedCost)
    expect(final, `${slug}: Render final`).toBe(fixture.templateFinals[slug])
    expect([...missing], `${slug}: credit ids the fixture does not price`).toEqual([])
  })
})

describe("with the preview stop rule off, the template the sync writes renders at Final", () => {
  // Each render set to Preview, written at Final: a whole run renders the
  // delivery and runs the nodes after it, at the listing stored with it.
  const atFinal = ({ nodes, edges }: Graph): Graph => ({
    nodes: withRunOverrides(nodes, Object.fromEntries(nodes.filter((n) => rendersAsPreview(n)).map((n) => [n.id, { quality: "final" }]))),
    edges,
  })
  it.each(Object.entries(fixture.templatesSyncedWithoutStopRule))("%s", (slug, credits) => {
    const { nodes, edges } = atFinal(template(slug))
    expect(nodes.filter((n) => n.type === "apply-edl").map((n) => (n.data as { quality?: string }).quality), slug).toEqual(["final"])
    const { cachedCost, missing } = pricesFrom(fixture.prices)
    expect(estimateRunCredits(nodes.filter(isExecutableNode), nodes, edges, cachedCost), `${slug}: editor run estimate`).toBe(credits)
    expect(computeLiveRunEstimate({ nodes, edges }, cachedCost).total, `${slug}: app runner's live estimate`).toBe(credits)
    expect(estimateWholeRun(nodes, edges, cachedCost).total, `${slug}: Execute-workflow badge`).toBe(credits)
    expect([...missing], `${slug}: credit ids the fixture does not price`).toEqual([])
  })
})
