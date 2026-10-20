/**
 * The editor prices a use-case node (Tighten Episode) as the chain it builds,
 * wired to its real source, plus its fee — the expansion the server prices
 * with (`expandUseCaseNodes`, @nodaro/render-rules). The server's half, on the
 * same graphs, is the shared run-estimate parity fixture.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { buildTightenEpisodeGraph, TIGHTEN_EPISODE_DEFAULTS } from "@nodaro/render-rules"

// Speaker Frames' availability to the viewer (the estimate's only reader of it). Default: not withheld —
// what the unmocked module answers before availability lands, so every other case reads as before.
const frames = vi.hoisted(() => ({ withheld: false }))
vi.mock("@/lib/use-case-frames-viewer", async (orig) => ({
  ...(await orig<typeof import("@/lib/use-case-frames-viewer")>()),
  usecaseFramesWithheld: () => frames.withheld,
}))
import { withRunOverrides } from "@nodaro/shared/nodes"
import { estimateRunCreditLines, estimateRunCredits, estimateWholeRun, runModelIds, usecaseNodeCredits, wholeRunExecutable } from "../estimate-run-credits"

/* eslint-disable @typescript-eslint/no-explicit-any */
const rec = { id: "rec", type: "upload-video", position: { x: 0, y: 0 }, data: { label: "Rec", url: "https://r2/ep.mp4", assetId: "", metadata: { durationSeconds: 3600 }, fieldMappings: {} } }
const t1 = { id: "t1", type: "tighten-episode", position: { x: 0, y: 0 }, data: { label: "Tighten Episode", fieldMappings: {}, captions: false } }
const wire = { id: "e", source: "rec", target: "t1", sourceHandle: "video", targetHandle: "media" }
const price: Record<string, number> = { "use-case-fee:tighten-episode": 10 }
const cached = (id: string) => price[id]

const list = (urls: string[]) => ({
  id: "ls",
  type: "list",
  position: { x: 0, y: 0 },
  data: { label: "Episodes", columns: [{ id: "default", name: "Items", handleId: "col_default", type: "video-url" }], rows: urls.map((u) => [u]) },
})
const eachWire = { id: "le", source: "ls", target: "t1", sourceHandle: "col_default", targetHandle: "media", data: { outputMode: "each" } }

describe("the editor prices a use-case node as its chain + the fee (same expansion as the server)", () => {
  it("parity with the hand-built chain on the same source", () => {
    const g = buildTightenEpisodeGraph({ ...TIGHTEN_EPISODE_DEFAULTS, captions: false }, { media: { url: "https://r2/ep.mp4", kind: "video", durationSec: 3600 } })
    const chainNodes = g.nodes.map((n) => ({ ...n, data: { ...n.data } })) as never[]
    const chainEdges = g.edges as never[]
    const chain = estimateWholeRun(chainNodes, chainEdges, cached).total
    expect(chain).toBeGreaterThan(0)
    expect(usecaseNodeCredits("t1", [rec, t1] as never[], [wire] as never[], cached)).toBe(chain + 10)
    expect(estimateWholeRun([rec, t1] as never[], [wire] as never[], cached).total).toBe(chain + 10)
  })

  it("asks for the inner steps' prices and the fee on a cold cache", () => {
    const ids = runModelIds(wholeRunExecutable([rec, t1] as never[]), [rec, t1] as never[], [wire] as never[])
    expect(ids).toContain("use-case-fee:tighten-episode")
    expect(ids.some((id) => id.startsWith("edit-plan"))).toBe(true)
    expect(estimateWholeRun([rec, t1] as never[], [wire] as never[], () => undefined).uncachedModelIds).toContain("use-case-fee:tighten-episode")
  })

  it("one line per use-case node, named after it — never a line per inner step", () => {
    const lines = estimateRunCreditLines([t1] as never[], [rec, t1] as never[], [wire] as never[], cached)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ nodeId: "t1", label: "Tighten Episode" })
    expect(lines[0]!.credits).toBe(usecaseNodeCredits("t1", [rec, t1] as never[], [wire] as never[], cached))
  })

  it("a List into it runs the chain and pays the fee once per item — never the fan-out twice", () => {
    const one = usecaseNodeCredits("t1", [list(["https://r2/a.mp4"]), t1] as never[], [eachWire] as never[], cached)
    const three = usecaseNodeCredits("t1", [list(["https://r2/a.mp4", "https://r2/b.mp4", "https://r2/c.mp4"]), t1] as never[], [eachWire] as never[], cached)
    expect(one).toBeGreaterThan(10)
    expect(three).toBe(3 * one)
  })

  it("a review-on run quotes its first part only (captions run in its Render final)", () => {
    const withCaptions = { ...t1, data: { ...t1.data, captions: true } }
    const reviewOn = { ...t1, data: { ...t1.data, captions: true, reviewBeforeRender: true } }
    const whole = usecaseNodeCredits("t1", [rec, withCaptions] as never[], [wire] as never[], cached)
    const firstPart = usecaseNodeCredits("t1", [rec, reviewOn] as never[], [wire] as never[], cached)
    expect(firstPart).toBeLessThan(whole)
  })

  it("no use-case node on the graph: nothing changes", () => {
    const g = buildTightenEpisodeGraph({ ...TIGHTEN_EPISODE_DEFAULTS, captions: false }, { media: { url: "https://r2/ep.mp4", kind: "video", durationSec: 3600 } })
    const nodes = g.nodes.map((n) => ({ ...n, position: { x: 0, y: 0 }, data: { ...n.data } })) as any[]
    const lines = estimateRunCreditLines(wholeRunExecutable(nodes), nodes, g.edges as never[], cached)
    expect(lines.map((l) => l.nodeId).sort()).toEqual(wholeRunExecutable(nodes).map((n) => n.id).sort())
  })

  it("a node queued to run its Render final is priced as that final: its render at final and what follows, no fee", () => {
    const pending = { mode: "render-final", jobId: "job-1" }
    const reviewOn = { ...t1, data: { ...t1.data, captions: true, reviewBeforeRender: true, useCaseContinue: pending } }
    // The hand-built final chain: the same settings with review off, its render at final.
    const g = buildTightenEpisodeGraph(
      { ...TIGHTEN_EPISODE_DEFAULTS, captions: true },
      { media: { url: "https://r2/ep.mp4", kind: "video", durationSec: 3600 } },
    )
    const chainNodes = g.nodes.map((n) => ({ ...n, data: { ...n.data } })) as never[]
    const finalPart = (chainNodes as Array<{ id: string }>).filter((n) => n.id === "uc-render" || n.id === "uc-captions")
    const expected = estimateRunCredits(finalPart as never[], chainNodes, g.edges as never[], cached)
    expect(expected).toBeGreaterThan(0)
    expect(usecaseNodeCredits("t1", [rec, reviewOn] as never[], [wire] as never[], cached)).toBe(expected)
    // No fee asked for, and none quoted.
    const ids = runModelIds([reviewOn] as never[], [rec, reviewOn] as never[], [wire] as never[])
    expect(ids).not.toContain("use-case-fee:tighten-episode")
  })

  it("a node continuing from where it failed still holds its fee (only a Render final has none)", () => {
    const fromFailed = { ...t1, data: { ...t1.data, useCaseContinue: { mode: "from-failed", jobId: "job-1" } } }
    expect(runModelIds([fromFailed] as never[], [rec, fromFailed] as never[], [wire] as never[])).toContain("use-case-fee:tighten-episode")
  })

  it("a Render final is quoted on the PREVIEW's settings, never the node's later ones", () => {
    // Captions on when the preview ran; turned off on the node since.
    const pending = { mode: "render-final", jobId: "job-1", settings: { ...TIGHTEN_EPISODE_DEFAULTS, captions: true, reviewBeforeRender: true } }
    const changed = { ...t1, data: { ...t1.data, captions: false, reviewBeforeRender: true, useCaseContinue: pending } }
    const g = buildTightenEpisodeGraph(
      { ...TIGHTEN_EPISODE_DEFAULTS, captions: true },
      { media: { url: "https://r2/ep.mp4", kind: "video", durationSec: 3600 } },
    )
    const chainNodes = g.nodes.map((n) => ({ ...n, data: { ...n.data } })) as never[]
    const withCaptions = estimateRunCredits((chainNodes as Array<{ id: string }>).filter((n) => n.id === "uc-render" || n.id === "uc-captions") as never[], chainNodes, g.edges as never[], cached)
    expect(usecaseNodeCredits("t1", [rec, changed] as never[], [wire] as never[], cached)).toBe(withCaptions)
  })
})

describe("what follows a review-on use-case node waits for its Render final, and is not quoted", () => {
  // The stop rule is on: a node after the Preview never runs in this run.
  beforeEach(() => { window.__NODARO_RUNTIME__ = { previewStopRule: true } })
  afterEach(() => { delete window.__NODARO_RUNTIME__ })

  const img = { id: "img", type: "generate-image", position: { x: 0, y: 0 }, data: { label: "Img", provider: "nano-banana", prompt: "a cover", fieldMappings: {} } }
  const out = { id: "o", source: "t1", target: "img", sourceHandle: "media", targetHandle: "image" }
  const imgPrice = (id: string) => price[id] ?? 7

  it("review on: the whole run's quote excludes what follows (equals the graph without it)", () => {
    const reviewOn = { ...t1, data: { ...t1.data, reviewBeforeRender: true } }
    const alone = estimateWholeRun([rec, reviewOn] as never[], [wire] as never[], imgPrice).total
    expect(alone).toBeGreaterThan(0)
    expect(estimateWholeRun([rec, reviewOn, img] as never[], [wire, out] as never[], imgPrice).total).toBe(alone)
  })

  it("review off: what follows is quoted", () => {
    const alone = estimateWholeRun([rec, t1] as never[], [wire] as never[], imgPrice).total
    expect(estimateWholeRun([rec, t1, img] as never[], [wire, out] as never[], imgPrice).total).toBeGreaterThan(alone)
  })
})

describe("a continuation saved on the graph is priced as the fresh run the server runs", () => {
  it("the saved graph, read as a plain run reads it (as the editor loads it), quotes a fresh run and its fee", () => {
    const stale = { ...t1, data: { ...t1.data, useCaseContinue: { mode: "render-final", jobId: "job-old" } } }
    const fresh = estimateWholeRun([rec, t1] as never[], [wire] as never[], cached).total
    const loaded = withRunOverrides([rec, stale] as never[], undefined)
    expect(estimateWholeRun(loaded, [wire] as never[], cached).total).toBe(fresh)
    // Read raw, the stale flag would quote a fee-less final: the load boundary is what keeps them equal.
    expect(estimateWholeRun([rec, stale] as never[], [wire] as never[], cached).total).not.toBe(fresh)
  })
})


describe("a framed Tighten's framing source in the editor's quote (decided 2026-10-20; docs: 1121 following faces, 1103 the even split)", () => {
  afterEach(() => { frames.withheld = false })

  // The charged figures the docs page states for a 60-minute 9:16 stacked episode, captions off.
  const charged: Record<string, number> = {
    "elevenlabs-stt": 25,
    "silence-detect": 11,
    "edit-plan:tighten:standard:60m": 264,
    "speaker-frames:8u": 18,
    "speaker-view:complex:60u": 792,
    "use-case-fee:tighten-episode": 11,
  }
  const framed = (framingSource?: string) =>
    ({ ...t1, data: { ...t1.data, framing: { aspect: "9:16", layout: "stacked" }, ...(framingSource ? { framingSource } : {}) } })
  const idsOf = (framingSource?: string) => runModelIds(wholeRunExecutable([rec, framed(framingSource)] as never[]), [rec, framed(framingSource)] as never[], [wire] as never[])
  const quoteOf = (framingSource?: string) => usecaseNodeCredits("t1", [rec, framed(framingSource)] as never[], [wire] as never[], (id) => charged[id])
  const speakerFrames = (ids: string[]) => ids.filter((id) => id.startsWith("speaker-frames"))

  it("auto and tracking follow faces for a viewer Speaker Frames is available to: 8 blocks (3,604 s × 2 = 7,208 frames), 1121 in all", () => {
    for (const source of ["auto", "tracking"]) {
      expect(speakerFrames(idsOf(source))).toEqual(["speaker-frames", "speaker-frames:8u"])
      expect(quoteOf(source)).toBe(1121)
    }
  })
  it("static, or no framing source at all (a node saved before it existed), is the even split: no Speaker Frames, 1103", () => {
    for (const source of ["static", undefined]) {
      expect(speakerFrames(idsOf(source))).toEqual([])
      expect(quoteOf(source)).toBe(1103)
    }
  })
  it("a viewer Speaker Frames is withheld from: auto is quoted as the even split; tracking (refused at run) still as asked", () => {
    frames.withheld = true
    expect(speakerFrames(idsOf("auto"))).toEqual([])
    expect(quoteOf("auto")).toBe(1103)
    expect(quoteOf("static")).toBe(1103)
    expect(quoteOf("tracking")).toBe(1121)
  })
})
