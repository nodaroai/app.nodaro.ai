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
import { parseUnitQuoteCreditId, videoGenerationCreditId, videoSfxCreditId } from "@nodaro/shared/credits"
import { VIDEO_DURATION_AUTO } from "@nodaro/shared/model-catalog"
import { PREVIEW_RENDER_NODE_TYPES, REVIEW_HOLDING_USE_CASE_TYPES, rendersAsPreview, withRunOverrides } from "@nodaro/shared/nodes"
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
  /** The Render final part of a graph that has one (a Tighten Episode set to review first). */
  graphFinals: Record<string, number>
}

type Graph = { nodes: WorkflowNode[]; edges: WorkflowEdge[] }
const template = (slug: string): Graph => JSON.parse(readFileSync(join(SEED, "templates", `${slug}.json`), "utf8")) as Graph

/**
 * The fixture's table; an id it does not hold fails the case (a price the
 * server half never checked) — except a per-unit run's whole price
 * (`<rate>:<units>u`), which the estimate asks first and, unanswered, prices
 * as the rate's row × the units: at these unmarked base prices, the same figure.
 */
function pricesFrom(table: Record<string, number>) {
  const missing = new Set<string>()
  const cachedCost = (id: string) => {
    if (!(id in table) && !parseUnitQuoteCreditId(id)) missing.add(id)
    return table[id]
  }
  return { cachedCost, missing }
}

/** A template's render: Apply EDL, or Speaker View in the vertical speaker clip. */
const isRender = (n: WorkflowNode): boolean => PREVIEW_RENDER_NODE_TYPES.has(n.type)

/** The editor's Render final of a template, through whichever step reviews:
 *  its render (as handleRenderFinal prices it: the run set, the render at
 *  Final) or its use-case node set to review first (Tighten Episode, Clip Pack,
 *  Trailer: the node's run-only override, the node alone). */
function templateFinal({ nodes, edges }: Graph, cachedCost: (id: string) => number | undefined): number {
  const render = nodes.find(isRender)
  if (!render) {
    const node = nodes.find((n) => REVIEW_HOLDING_USE_CASE_TYPES.has(n.type))!
    const overridden = withRunOverrides(nodes, { [node.id]: { useCaseContinue: { mode: "render-final", jobId: "job-1" } } })
    return estimateRunCredits(overridden.filter((n) => n.id === node.id), overridden, edges, cachedCost)
  }
  const runSet = renderFinalRunSet(render.id, nodes, edges)
  const overridden = withRunOverrides(nodes, renderRunOverrides(render.id, "final", runSet))
  return estimateRunCredits(liveExecutable(overridden).filter((n) => runSet.has(n.id)), overridden, edges, cachedCost)
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
  it.each(Object.entries(fixture.templateFinals))("%s", (slug, credits) => {
    const { cachedCost, missing } = pricesFrom(fixture.prices)
    const total = templateFinal(template(slug), cachedCost)
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

describe("a Seedance 2.5 node's reference task type is quoted at the length it runs at", () => {
  // The editor's half: the price id names the row of the length the shared
  // resolver gives the run (an Edit whose clips are all 4–30 s runs at Auto; an
  // Extend at Auto runs at the model's default length), and the server's quote
  // of the run is keyed with the declaration, so switching the setting
  // re-quotes. These rows use a local price table and the same shared id
  // builder, so they pin which ROW the editor names, not an amount. That the
  // server RESERVES under that same row is pinned on the server side:
  // backend/src/routes/__tests__/video-priced-selection.test.ts and
  // backend/src/ee/billing/__tests__/seedance-task-type-estimate.test.ts.
  const CLIP = "https://cdn.example/clip.mp4"
  const upload = (sec?: number): WorkflowNode => ({
    id: "clip", type: "upload-video", position: { x: 0, y: 0 },
    data: { label: "clip", url: CLIP, ...(sec !== undefined ? { generatedResults: [{ url: CLIP, duration: sec }] } : {}) },
  }) as WorkflowNode
  const gv = (data: Record<string, unknown> = {}): WorkflowNode => ({
    id: "gv", type: "generate-video", position: { x: 0, y: 0 },
    data: { label: "gv", provider: "seedance-2-5", resolution: "720p", aspectRatio: "16:9", duration: 5, prompt: "a shot", ...data },
  }) as WorkflowNode
  const wired = [{ id: "e1", source: "clip", target: "gv", sourceHandle: "video", targetHandle: "videoReferences" }] as WorkflowEdge[]
  // The rows, built with the one shared builder the server's route uses too.
  const idAt = (duration: number) =>
    videoGenerationCreditId({ provider: "seedance-2-5", duration, nodeType: "image-to-video", resolution: "720p", hasVideoRef: true })
  const AUTO_ID = idAt(VIDEO_DURATION_AUTO)
  const PRICES: Record<string, number> = { [idAt(5)]: 500, [idAt(8)]: 800, [AUTO_ID]: 3000 }
  const quoted = (nodes: WorkflowNode[], edges: WorkflowEdge[] = wired): number =>
    estimateRunCredits(nodes.filter(isExecutableNode), nodes, edges, (id) => PRICES[id])

  it("the three rows are distinct ids", () => {
    expect(new Set([idAt(5), idAt(8), AUTO_ID]).size).toBe(3)
  })

  it("Edit with a 6 s clip, stored 16:9 at 5 s, is quoted the automatic-length price", () => {
    expect(quoted([upload(6), gv({ referenceTaskType: "edit" })])).toBe(PRICES[AUTO_ID])
  })

  it("Edit with a 3 s clip is quoted as the node without the setting", () => {
    expect(quoted([upload(3), gv({ referenceTaskType: "edit" })])).toBe(quoted([upload(3), gv()]))
    expect(quoted([upload(3), gv()])).toBe(PRICES[idAt(5)])
  })

  it("Extend with an automatic length is quoted at 8 s", () => {
    expect(quoted([upload(6), gv({ referenceTaskType: "extend", duration: VIDEO_DURATION_AUTO })])).toBe(PRICES[idAt(8)])
  })

  it("Edit with a clip whose length the editor does not know is quoted the automatic-length price", () => {
    expect(quoted([upload(), gv({ referenceTaskType: "edit" })])).toBe(PRICES[AUTO_ID])
  })

  it("Edit on a draft is quoted as Edit without Draft, at the draft's 480p rows", () => {
    // A draft declares as any other run does: the automatic-length row, at 480p.
    const draft = { draft: true }
    const ids = (n: WorkflowNode) => runModelIds([n], [upload(6), n], wired).filter((id) => !id.startsWith("seedance-ref-quote:"))
    const draftAutoId = videoGenerationCreditId({ provider: "seedance-2-5", duration: VIDEO_DURATION_AUTO, nodeType: "image-to-video", resolution: "720p", draft: true, hasVideoRef: true })
    expect(ids(gv({ ...draft, referenceTaskType: "edit" }))).toEqual([draftAutoId])
    expect(ids(gv({ ...draft, referenceTaskType: "edit" }))).not.toEqual(ids(gv(draft)))
    // The same node at 480p without Draft asks for the same row.
    expect(ids(gv({ ...draft, referenceTaskType: "edit" }))).toEqual(ids(gv({ referenceTaskType: "edit", resolution: "480p" })))
  })

  it("a node without the setting asks for exactly today's ids", () => {
    const ids = runModelIds([gv()], [upload(6), gv()], wired)
    expect(ids).toContain(idAt(5))
    expect(ids).not.toContain(AUTO_ID)
    const key = ids.find((id) => id.startsWith("seedance-ref-quote:"))!
    expect(key).not.toContain("referenceTaskType")
  })

  it("the server's quote is asked with the declaration, and is what the run is quoted when it is in", () => {
    const node = gv({ referenceTaskType: "edit" })
    const ids = runModelIds([node], [upload(6), node], wired)
    expect(ids).toContain(AUTO_ID)
    const key = ids.find((id) => id.startsWith("seedance-ref-quote:"))!
    expect(JSON.parse(key.slice("seedance-ref-quote:".length))).toMatchObject({ referenceTaskType: "edit" })
    const withoutSetting = runModelIds([gv()], [upload(6), gv()], wired).find((id) => id.startsWith("seedance-ref-quote:"))
    expect(key).not.toBe(withoutSetting)
    const cachedCost = (id: string) => (id === key ? 4321 : PRICES[id])
    expect(estimateRunCredits([node], [upload(6), node], wired, cachedCost)).toBe(4321)
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
  it("a Video SFX on a trailer render is the row of its 40 seconds", () => {
    const { nodes, edges } = render("trailer")
    expect(sfxOn([...nodes, sfx], [...edges, wire("render", "sfx", "video")])).toBe(sfxRow(40))
  })
  it("a Video SFX on a tighten render is the 300-second row, the most a run accepts", () => {
    const { nodes, edges } = render("tighten")
    expect(sfxOn([...nodes, sfx], [...edges, wire("render", "sfx", "video")])).toBe(sfxRow(300))
  })
  it("a chain: a Loop of 8 copies of a trailer render is 320 seconds, capped at the 300-second row", () => {
    const { nodes, edges } = render("trailer")
    const loop = node("l", "loop-video", { repeatCount: 8 })
    expect(sfxOn([...nodes, loop, sfx], [...edges, wire("render", "l"), wire("l", "sfx", "video")])).toBe(sfxRow(300))
  })
  it("a chain: a Trim to the first 20 seconds hands the Video SFX 20 seconds", () => {
    const { nodes, edges } = render("tighten")
    const trim = node("t", "trim-video", { trimMode: "keep-first-seconds", keepFirstSeconds: 20 })
    expect(sfxOn([...nodes, trim, sfx], [...edges, wire("render", "t"), wire("t", "sfx", "video")])).toBe(sfxRow(20))
  })
  it("its prompt wired before the video does not move the video wire's length", () => {
    const { nodes, edges } = render("trailer")
    expect(sfxOn([...nodes, sfx, node("txt", "text-prompt")], [...edges, wire("txt", "sfx", "prompt"), wire("render", "sfx", "video")])).toBe(sfxRow(40))
  })
  it("a video whose length it cannot follow is quoted at the 300-second row, the most its run can be charged", () => {
    const { nodes, edges } = render("trailer")
    expect(sfxOn([...nodes, sfx], [...edges, wire("rec", "sfx", "video")])).toBe(sfxRow(300))
  })
  it("the rows it names are the ones asked for, so a cold cache fetches them", () => {
    const { nodes, edges } = render("trailer")
    const all = [...nodes, sfx]
    const ids = runModelIds(all.filter(isExecutableNode), all, [...edges, wire("render", "sfx", "video")])
    expect(ids).toContain(videoSfxCreditId(40))
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
    const final = templateFinal({ nodes, edges }, cachedCost)
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
    expect(nodes.filter(isRender).map((n) => (n.data as { quality?: string }).quality), slug).toEqual(["final"])
    const { cachedCost, missing } = pricesFrom(fixture.prices)
    expect(estimateRunCredits(nodes.filter(isExecutableNode), nodes, edges, cachedCost), `${slug}: editor run estimate`).toBe(credits)
    expect(computeLiveRunEstimate({ nodes, edges }, cachedCost).total, `${slug}: app runner's live estimate`).toBe(credits)
    expect(estimateWholeRun(nodes, edges, cachedCost).total, `${slug}: Execute-workflow badge`).toBe(credits)
    expect([...missing], `${slug}: credit ids the fixture does not price`).toEqual([])
  })
})

describe("a Tighten Episode's Render final quotes the listing's final part", () => {
  // The node's run-only override, the node alone: the server's half is in
  // backend/.../run-estimate-parity.test.ts.
  it.each(Object.entries(fixture.graphFinals))("%s", (name, credits) => {
    const { nodes, edges } = fixture.graphs[name]!
    const node = nodes.find((n) => n.type === "tighten-episode")!
    const overridden = withRunOverrides(nodes, { [node.id]: { useCaseContinue: { mode: "render-final", jobId: "job-1" } } })
    const { cachedCost, missing } = pricesFrom(fixture.prices)
    const total = estimateRunCredits(overridden.filter((n) => n.id === node.id), overridden, edges, cachedCost)
    expect([...missing], `${name}: credit ids the fixture does not price`).toEqual([])
    expect(total, name).toBe(credits)
  })
})
