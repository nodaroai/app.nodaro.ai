/**
 * A Tighten Episode node running its Render final (`useCaseContinue:
 * { mode: "render-final" }`, an override of that run only) continues a run
 * that paid its fee (decided 2026-10-13): the one expansion builds its FINAL
 * chain and names as its run only the render and what follows it, with no
 * fee — so the server's estimate of that run is the hand-built final chain's
 * render-onward part, as the editor's is (use-case-estimate.test.ts).
 */
import { describe, it, expect, vi } from "vitest"

// The run estimate reads the price table only with a credit system: off here, the base prices.
vi.mock("@/lib/config.js", async (orig) => ({ ...(await orig<typeof import("@/lib/config.js")>()), hasCredits: () => false }))
import { buildTightenEpisodeGraph, expandUseCaseNodes, resolveTightenEpisodeSettings, runsUseCaseRenderFinal } from "@nodaro/render-rules"
import { CreditsService } from "../../ee/billing/credits.js"

const rec = { id: "rec", type: "upload-video", data: { url: "https://r2/ep.mp4", metadata: { durationSeconds: 3600 } } }
const settings = { captions: true, reviewBeforeRender: true }
const t1 = (data: Record<string, unknown> = {}) => ({ id: "t1", type: "tighten-episode", data: { ...settings, ...data } })
const fmt = { id: "fmt", type: "social-media-format", data: {} }
const edges = [
  { source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" },
  { source: "t1", target: "fmt", sourceHandle: "media", targetHandle: null },
]
const FINAL = { useCaseContinue: { mode: "render-final", jobId: "job-1" } }

describe("a use-case node running its Render final", () => {
  it("is read off its data", () => {
    expect(runsUseCaseRenderFinal(FINAL)).toBe(true)
    expect(runsUseCaseRenderFinal({ useCaseContinue: { mode: "from-failed", jobId: "j" } })).toBe(false)
    expect(runsUseCaseRenderFinal({})).toBe(false)
    // A Render final names the run it finishes: without that run the node runs fresh.
    expect(runsUseCaseRenderFinal({ useCaseContinue: { mode: "render-final" } })).toBe(false)
  })

  it("a render-final override naming no run is priced as the fresh run it is — fee and first run — never as a fee-less final", () => {
    // Review off, 60 minutes, captions on: the run route runs this fresh (no run to finish).
    const off = (data: Record<string, unknown> = {}) => t1({ reviewBeforeRender: false, ...data })
    const fresh = CreditsService.estimateWorkflowBaseCredits([rec, off(), fmt], edges, { runNodeIds: new Set(["t1"]) })
    const unnamed = CreditsService.estimateWorkflowBaseCredits([rec, off({ useCaseContinue: { mode: "render-final" } }), fmt], edges, { runNodeIds: new Set(["t1"]) })
    expect(unnamed).toBe(fresh)
    expect(expandUseCaseNodes([rec, off({ useCaseContinue: { mode: "render-final" } }), fmt], edges).fees).toHaveLength(1)
  })

  it("expands to its final chain: its render and what follows it run, no fee, consumers read the episode", () => {
    const x = expandUseCaseNodes([rec, t1(FINAL), fmt], edges)
    expect([...(x.members.get("t1") ?? [])].sort()).toEqual(["t1::uc-captions", "t1::uc-render"])
    expect(x.fees).toEqual([])
    expect(x.nodes.find((n) => n.id === "t1::uc-render")!.data).toMatchObject({ quality: "final" })
    // What follows the node reads the finished episode, not the preview.
    expect(x.edges).toContainEqual(expect.objectContaining({ source: "t1::uc-captions", target: "fmt" }))
    // A first run still pays and stops at its preview.
    expect(expandUseCaseNodes([rec, t1(), fmt], edges).fees).toHaveLength(1)
  })

  it("the server prices it as the hand-built final chain from its render on", () => {
    const chain = buildTightenEpisodeGraph(
      resolveTightenEpisodeSettings({ ...settings, reviewBeforeRender: false }, "video"),
      { media: { url: "https://r2/ep.mp4", kind: "video", durationSec: 3600 } },
    )
    const expected = CreditsService.estimateWorkflowBaseCredits(chain.nodes, chain.edges, { runNodeIds: new Set(["uc-render", "uc-captions"]) })
    expect(expected).toBeGreaterThan(0)
    const node = CreditsService.estimateWorkflowBaseCredits([rec, t1(FINAL), fmt], edges, { runNodeIds: new Set(["t1"]) })
    expect(node).toBe(expected)
  })
})

describe("a Render final is priced on the run's own cut", () => {
  const segs = (minutes: number) => [{ id: "a", sourceId: "s0", inMs: 0, outMs: minutes * 60_000 }]
  const plan = (minutes: number) => ({ version: 1, sources: [{ id: "s0", url: "https://r2/ep.mp4", role: "master" }], segments: segs(minutes), dropped: [] })

  it("the plan the node holds rides on the inner plan, with the edit", () => {
    const edit = { v: 1, kind: "edl", basis: "b", edl: { segments: segs(5), dropped: [] } }
    const x = expandUseCaseNodes([rec, t1({ ...FINAL, generatedJson: plan(10), editedEdl: edit }), fmt], edges)
    expect(x.nodes.find((n) => n.id === "t1::uc-plan")!.data).toMatchObject({ generatedJson: plan(10), editedEdl: edit })
    // A first run never reads an earlier run's plan.
    const first = expandUseCaseNodes([rec, t1({ generatedJson: plan(10) }), fmt], edges)
    expect(first.nodes.find((n) => n.id === "t1::uc-plan")!.data).not.toHaveProperty("generatedJson")
  })

  it("a cut that keeps 10 of 60 minutes is priced below the whole recording", () => {
    const short = CreditsService.estimateWorkflowBaseCredits([rec, t1({ ...FINAL, generatedJson: plan(10) }), fmt], edges, { runNodeIds: new Set(["t1"]) })
    const whole = CreditsService.estimateWorkflowBaseCredits([rec, t1(FINAL), fmt], edges, { runNodeIds: new Set(["t1"]) })
    expect(short).toBeLessThan(whole)
  })
})

describe("a Render final renders with the PREVIEW's settings (decided 2026-10-13)", () => {
  it("the server prices the continuation's settings, never the node's later ones", () => {
    // Captions were on when the preview ran; the node has them off since.
    const preview = { ...settings, captions: true }
    const node = t1({ captions: false, useCaseContinue: { mode: "render-final", jobId: "job-1", settings: preview } })
    const x = expandUseCaseNodes([rec, node, fmt], edges)
    expect([...(x.members.get("t1") ?? [])].sort()).toEqual(["t1::uc-captions", "t1::uc-render"])
    const chain = buildTightenEpisodeGraph(
      resolveTightenEpisodeSettings({ ...preview, reviewBeforeRender: false }, "video"),
      { media: { url: "https://r2/ep.mp4", kind: "video", durationSec: 3600 } },
    )
    const expected = CreditsService.estimateWorkflowBaseCredits(chain.nodes, chain.edges, { runNodeIds: new Set(["uc-render", "uc-captions"]) })
    expect(CreditsService.estimateWorkflowBaseCredits([rec, node, fmt], edges, { runNodeIds: new Set(["t1"]) })).toBe(expected)
  })
})

describe("a continuation SAVED on the graph is never priced as one (the engine drops it)", () => {
  // Saved, not this run's override: the run the engine executes is a fresh one
  // (fee and its first run), so every saved-graph quote prices exactly that.
  const stale = t1({ useCaseContinue: { mode: "render-final", jobId: "job-old" } })

  it("the run estimate of a saved graph prices a fresh run", async () => {
    const fresh = await CreditsService.estimateWorkflowCredits([rec, t1(), fmt], edges)
    expect(await CreditsService.estimateWorkflowCredits([rec, stale, fmt], edges)).toBe(fresh)
  })

  it("the listing of a saved graph prices a fresh run and its own Render final", () => {
    const fresh = CreditsService.estimateWorkflowBaseListing([rec, t1(), fmt], edges, "app")
    expect(CreditsService.estimateWorkflowBaseListing([rec, stale, fmt], edges, "app")).toEqual(fresh)
  })

  it("a Render final quote — the run's graph, its override merged once — still prices the final", async () => {
    const { estimateRunSetCredits } = await import("../../ee/billing/credits.js")
    const { withRunOverrides } = await import("@nodaro/shared/nodes")
    const run = withRunOverrides([rec, stale, fmt], { t1: FINAL })
    const final = await estimateRunSetCredits(run, edges, new Set(["t1"]))
    expect(final).toBe(await estimateRunSetCredits([rec, t1(FINAL), fmt], edges, new Set(["t1"])))
    expect(final).toBe(650)
  })
})

