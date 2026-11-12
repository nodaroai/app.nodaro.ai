// @test-watches backend/src/lib/__tests__/fixtures/seedance-hd-draft-quote.json
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { VIDEO_DURATION_AUTO } from "@nodaro/shared/model-catalog"
import { estimateRunCreditLines, runModelIds, wholeRunExecutable } from "@/components/editor/workflow-editor/estimate-run-credits"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import { seedanceHdQuoteIdFor } from "../seedance-hd-quote"
import { isSeedanceHdQuoteKey, parseSeedanceHdQuoteKey, seedanceHdDraftKey, seedanceHdQuoteKey } from "../seedance-hd-quote-key"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

/**
 * The editor's Run total for a Seedance 2.5 HD finalize whose draft the run
 * MAKES (decided 2026-11-12): the finalize at the length the draft's run
 * reserves for, as the server's workflow estimate quotes it — a draft with no
 * reference video at its length's `seedance-2-5-hd:{N}s` row, one with
 * reference videos at the server's quote of the draft's request
 * (`POST /v1/credits/seedance-hd-estimate`, `plannedDraft`).
 */

const node = (id: string, type: string, data: Record<string, unknown>): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const edge = (source: string, target: string, targetHandle: string): WorkflowEdge =>
  ({ id: `${source}->${target}:${targetHandle}`, source, target, sourceHandle: "video", targetHandle }) as WorkflowEdge

const draftGv = (data: Record<string, unknown> = {}) =>
  node("gv", "generate-video", { provider: "seedance-2-5", prompt: "a take", resolution: "480p", draft: true, ...data })
const finalize = (data: Record<string, unknown> = {}) => node("hd", "video-upscale", { provider: "seedance-2-5-hd", ...data })

/** The finalize's price id in a whole run of `nodes` (every executable node re-runs). */
function wholeRunId(nodes: WorkflowNode[], edges: WorkflowEdge[]): string | undefined {
  const hd = nodes.find((n) => n.id === "hd")!
  return seedanceHdQuoteIdFor(hd, nodes, edges, new Set(wholeRunExecutable(nodes).map((n) => n.id)))
}

describe("a draft with no reference video: the finalize row for the draft's priced length", () => {
  it.each<[string, Record<string, unknown>, string]>([
    ["Auto: the model's longest take", { duration: VIDEO_DURATION_AUTO }, "seedance-2-5-hd:30s"],
    ["a fixed 5 s", { duration: 5 }, "seedance-2-5-hd:5s"],
    ["no length set: the model's default", {}, "seedance-2-5-hd:8s"],
    ["a declaration that needs a reference video moves nothing", { duration: 5, referenceTaskType: "extend" }, "seedance-2-5-hd:5s"],
  ])("%s", (_name, data, id) => {
    const nodes = [draftGv(data), finalize()]
    expect(wholeRunId(nodes, [edge("gv", "hd", "video")])).toBe(id)
  })

  it("the run estimate fetches that row and prices the finalize at it", () => {
    const nodes = [draftGv({ duration: VIDEO_DURATION_AUTO }), finalize()]
    const edges = [edge("gv", "hd", "video")]
    const executable = wholeRunExecutable(nodes)
    expect(runModelIds(executable, nodes, edges)).toContain("seedance-2-5-hd:30s")
    const line = (cachedCost: (id: string) => number | undefined) =>
      estimateRunCreditLines(executable, nodes, edges, cachedCost).find((l) => l.nodeId === "hd")!.credits
    expect(line((id) => (id === "seedance-2-5-hd:30s" ? 16590 : id === "seedance-2-5-hd" ? 4424 : undefined))).toBe(16590)
    // Uncached: today's row, until the prefetch lands.
    expect(line((id) => (id === "seedance-2-5-hd" ? 4424 : undefined))).toBe(4424)
  })
})

describe("anything else is priced as before", () => {
  const today = (nodes: WorkflowNode[], edges: WorkflowEdge[]) => getModelIdentifier(nodes.find((n) => n.id === "hd")!, edges, nodes)

  it("no draft wired, or an upstream that is no draft: no quote id, today's row (the run refuses it)", () => {
    expect(wholeRunId([finalize()], [])).toBeUndefined()
    expect(today([finalize()], [])).toBe("seedance-2-5-hd")
    for (const nodes of [
      [draftGv({ draft: false, duration: 5 }), finalize()],
      [draftGv({ provider: "kling", duration: 5 }), finalize()],
      [node("gv", "upload-video", { url: "https://cdn.example/clip.mp4" }), finalize()],
    ]) {
      expect(wholeRunId(nodes, [edge("gv", "hd", "video")])).toBeUndefined()
    }
  })
})

describe("a run that only finalizes a draft that already exists: its exact price (decided 2026-11-12)", () => {
  it("the draft does not run again: the key of its task, priced as the node's pill prices it", () => {
    const nodes = [draftGv({ duration: VIDEO_DURATION_AUTO, generatedResults: [{ url: "https://cdn.example/draft.mp4" }], kieTaskId: "task-draft" }), finalize()]
    const edges = [edge("gv", "hd", "video")]
    expect(seedanceHdQuoteIdFor(nodes[1]!, nodes, edges, new Set(["hd"]))).toBe(seedanceHdDraftKey("task-draft"))
    // A run that makes a new draft: the reserved length.
    expect(wholeRunId(nodes, edges)).toBe("seedance-2-5-hd:30s")
  })

  it("a node that made a draft and then had Draft turned off (or another model chosen) hands on that take: its task, as the run takes it", () => {
    for (const later of [{ draft: false }, { provider: "kling" }]) {
      const nodes = [draftGv({ duration: VIDEO_DURATION_AUTO, generatedResults: [{ url: "https://cdn.example/draft.mp4" }], kieTaskId: "task-30s", ...later }), finalize()]
      expect(seedanceHdQuoteIdFor(nodes[1]!, nodes, [edge("gv", "hd", "video")], new Set(["hd"])), JSON.stringify(later)).toBe(seedanceHdDraftKey("task-30s"))
    }
  })

  it("a finalize that names its draft's task itself: that task, whatever runs", () => {
    const nodes = [draftGv({ duration: 5 }), finalize({ kieTaskId: "task-elsewhere" })]
    expect(wholeRunId(nodes, [edge("gv", "hd", "video")])).toBe(seedanceHdDraftKey("task-elsewhere"))
  })

  it("the Run total, Run from here on the finalize, the confirm and the precheck read that price; uncached, today's row", () => {
    const nodes = [draftGv({ duration: VIDEO_DURATION_AUTO, generatedResults: [{ url: "https://cdn.example/draft.mp4" }], kieTaskId: "task-draft" }), finalize()]
    const edges = [edge("gv", "hd", "video")]
    const key = seedanceHdDraftKey("task-draft")
    const hd = nodes[1]!
    expect(runModelIds([hd], nodes, edges)).toContain(key)
    const line = (cachedCost: (id: string) => number | undefined) => estimateRunCreditLines([hd], nodes, edges, cachedCost).find((l) => l.nodeId === "hd")!.credits
    expect(line((id) => (id === key ? 5214 : id === "seedance-2-5-hd" ? 4424 : undefined))).toBe(5214)
    expect(line((id) => (id === "seedance-2-5-hd" ? 4424 : undefined))).toBe(4424)
  })
})

describe("a Video to Video draft whose source clip is not wired", () => {
  const v2v = (data: Record<string, unknown>) => node("gv", "video-to-video", { provider: "seedance-2-5", prompt: "x", v2vResolution: "480p", draft: true, ...data })

  it("is counted as its run sends the clip: the node's own video URL", () => {
    const nodes = [v2v({ videoUrl: "https://cdn.example/source.mp4" }), finalize()]
    expect(parseSeedanceHdQuoteKey(wholeRunId(nodes, [edge("gv", "hd", "video")])!)).toStrictEqual({
      provider: "seedance-2-5", resolution: "480p", duration: VIDEO_DURATION_AUTO, draft: true, referenceVideoUrls: ["https://cdn.example/source.mp4"],
    })
  })

  it("…or, with none, one clip not known yet — never the 8 s row", () => {
    const nodes = [v2v({}), finalize()]
    expect(parseSeedanceHdQuoteKey(wholeRunId(nodes, [edge("gv", "hd", "video")])!)).toStrictEqual({
      provider: "seedance-2-5", resolution: "480p", duration: VIDEO_DURATION_AUTO, draft: true, referenceVideoUrls: [], unknownReferenceVideos: 1,
    })
  })
})

describe("every other node", () => {
  it("gets no quote id", () => {
    const nodes = [draftGv({ duration: 5 }), finalize(), node("topaz", "video-upscale", {}), node("veo", "video-upscale", { provider: "veo-1080p" })]
    const edges = [edge("gv", "hd", "video"), edge("gv", "topaz", "video"), edge("gv", "veo", "video")]
    for (const n of nodes.filter((x) => x.id !== "hd")) expect(seedanceHdQuoteIdFor(n, nodes, edges, new Set(nodes.map((x) => x.id))), n.id).toBeUndefined()
  })
})

/**
 * The editor's half of a shared fixture: a Seedance 2.5 draft edit of one
 * uploaded clip on Generate Video, and a Video to Video Seedance 2.5 Edit
 * draft of the same clip, each wired into a finalize. The server's half —
 * backend/src/ee/billing/__tests__/seedance-draft-finalize-estimate.test.ts —
 * holds the estimate route's quote of `editorPlannedDrafts` to the server's
 * workflow estimate of the same graph.
 */
describe("a draft with reference videos: the server's quote of the draft's own request", () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const fixture = JSON.parse(readFileSync(join(here, "../../../../backend/src/lib/__tests__/fixtures/seedance-hd-draft-quote.json"), "utf8")) as {
    nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>
    edges: WorkflowEdge[]
    editorPlannedDrafts: Record<string, Record<string, unknown>>
    existingDraftTaskId: string
  }
  const nodes = fixture.nodes.map((n) => node(n.id, n.type, n.data))
  const rerunIds = new Set(wholeRunExecutable(nodes).map((n) => n.id))

  it.each(["hd", "hd-v2v"])("%s: the request is the fixture's, key for key", (finalizeId) => {
    const id = seedanceHdQuoteIdFor(nodes.find((n) => n.id === finalizeId)!, nodes, fixture.edges, rerunIds)!
    expect(isSeedanceHdQuoteKey(id)).toBe(true)
    expect(parseSeedanceHdQuoteKey(id)).toStrictEqual(fixture.editorPlannedDrafts[finalizeId])
    expect(id).toBe(seedanceHdQuoteKey(fixture.editorPlannedDrafts[finalizeId] as never))
  })

  it("the run estimate fetches the quote and prices each finalize at it; uncached, at today's row", () => {
    const keys = ["hd", "hd-v2v"].map((id) => seedanceHdQuoteIdFor(nodes.find((n) => n.id === id)!, nodes, fixture.edges, rerunIds)!)
    const executable = wholeRunExecutable(nodes)
    expect(runModelIds(executable, nodes, fixture.edges)).toEqual(expect.arrayContaining(keys))
    const quoted = new Map([[keys[0]!, 4324], [keys[1]!, 4991]])
    const line = (cachedCost: (id: string) => number | undefined, id: string) =>
      estimateRunCreditLines(executable, nodes, fixture.edges, cachedCost).find((l) => l.nodeId === id)!.credits
    const cached = (id: string) => quoted.get(id) ?? (id === "seedance-2-5-hd" ? 4424 : undefined)
    expect(line(cached, "hd")).toBe(4324)
    expect(line(cached, "hd-v2v")).toBe(4991)
    expect(line((id) => (id === "seedance-2-5-hd" ? 4424 : undefined), "hd")).toBe(4424)
  })

  it("hd run alone: its draft exists, named by the task the server's half prices exactly", () => {
    const hd = nodes.find((n) => n.id === "hd")!
    expect(seedanceHdQuoteIdFor(hd, nodes, fixture.edges, new Set(["hd"]))).toBe(seedanceHdDraftKey(fixture.existingDraftTaskId))
  })

  it("a clip whose source re-runs is sent as not produced yet", () => {
    const producer = node("clip", "generate-video", { provider: "kling", prompt: "a clip", duration: 5, generatedVideoUrl: "https://cdn.example/old.mp4" })
    const withProducer = nodes.map((n) => (n.id === "clip" ? producer : n))
    const id = seedanceHdQuoteIdFor(withProducer.find((n) => n.id === "hd")!, withProducer, fixture.edges, new Set(wholeRunExecutable(withProducer).map((n) => n.id)))!
    expect(parseSeedanceHdQuoteKey(id)).toMatchObject({ referenceVideoUrls: [], unknownReferenceVideos: 1 })
  })
})
