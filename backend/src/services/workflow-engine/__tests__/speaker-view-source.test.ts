/**
 * Every source of a video-fed Speaker View is checked before anything charges
 * (decided 2026-10-12, R5): a source that exists at run start is measured then;
 * one the run produces (Generate Video, Trim) is awaited by every paid node that
 * feeds the Speaker View, and measured the moment it exists — Transcribe waits
 * until the source exists and is checked, then runs.
 */
import { describe, expect, it, vi } from "vitest"
import { ClipMeasureError, type MeasuredClip } from "../../../lib/clip-measure.js"
import {
  speakerViewDispatchGate,
  speakerViewRunStartSourceCheck,
  speakerViewSourceOrderingEdges,
  videoFedSpeakerViews,
  type SpeakerViewSourceDeps,
} from "../speaker-view-source.js"
import { buildExecutionLevels, isSourceNode } from "../execution-graph.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

const node = (id: string, type: string, data: Record<string, unknown> = {}): SimpleNode => ({ id, type, data }) as SimpleNode
const wire = (source: string, target: string, targetHandle: string | null = null, sourceHandle: string | null = null): SimpleEdge =>
  ({ id: `${source}-${target}-${targetHandle ?? ""}`, source, target, sourceHandle, targetHandle })

const VIDEO = "https://cdn.example.test/uploads/videos/clip.mp4"
const executable = (type: string) => !isSourceNode(type) && type !== "group"
const ordering = (nodes: SimpleNode[], edges: SimpleEdge[]) => speakerViewSourceOrderingEdges(nodes, edges, executable)

/** gv (Generate Video) -> sv (video); voice -> tx (Transcribe) -> sv (transcript) and -> sf (Speaker Frames) -> sv (tracks); plus a side branch. */
function inRunGraph(svData: Record<string, unknown> = {}) {
  const nodes = [
    node("prompt", "text-prompt", { text: "a cat" }),
    node("gv", "generate-video", {}),
    node("voice", "upload-audio", { url: "https://cdn.example.test/a.mp3" }),
    node("tx", "transcribe", {}),
    node("sf", "speaker-frames", {}),
    node("sv", "speaker-view", { label: "Vertical cut", ...svData }),
    node("other", "generate-image", {}),
  ]
  const edges = [
    wire("prompt", "gv"),
    wire("gv", "sv", "video"),
    wire("voice", "tx", "audio"),
    wire("tx", "sf", "transcript"),
    wire("sf", "sv", "tracks"),
    wire("tx", "sv", "transcript"),
  ]
  return { nodes, edges }
}

const done = (output: Record<string, unknown>): NodeExecutionState => ({ status: "completed", output }) as unknown as NodeExecutionState

function deps(over: Partial<SpeakerViewSourceDeps> = {}) {
  const measure = vi.fn(async (_url: string): Promise<MeasuredClip> => ({ durationMs: 14_600, width: 3840, height: 2160, faces: "present" }))
  const d: SpeakerViewSourceDeps = { measure, videoModeLive: () => true, ...over }
  return { d, measure }
}

describe("videoFedSpeakerViews", () => {
  it("lists a Speaker View with a video wire, its label, its source, its aspect and its face opt-in", () => {
    const { nodes, edges } = inRunGraph({ targetAspect: "4:5", requireFaces: true })
    expect(videoFedSpeakerViews(nodes, edges)).toEqual([
      { id: "sv", label: "Vertical cut", videoSourceId: "gv", targetAspect: "4:5", requireFaces: true },
    ])
  })
  it("leaves out an edit-fed one, a skipped one, and one with both (refused elsewhere)", () => {
    const g = inRunGraph()
    expect(videoFedSpeakerViews(g.nodes, [...g.edges, wire("sf", "sv", "edl")])).toEqual([])
    expect(videoFedSpeakerViews(inRunGraph({ skipped: true }).nodes, g.edges)).toEqual([])
    expect(videoFedSpeakerViews(inRunGraph({ edl: { version: 1 } }).nodes, g.edges)).toEqual([])
    expect(videoFedSpeakerViews(g.nodes, g.edges.filter((e) => e.targetHandle !== "video"))).toEqual([])
  })
  it("names the node by its type when it has no label, never its id", () => {
    const g = inRunGraph()
    g.nodes[5] = node("sv", "speaker-view", {})
    expect(videoFedSpeakerViews(g.nodes, g.edges)[0]?.label).toBe("Speaker View")
  })
})

describe("speakerViewSourceOrderingEdges", () => {
  it("makes every paid node that feeds the Speaker View, and is not the source's own chain, wait for the source", () => {
    const { nodes, edges } = inRunGraph()
    const extra = ordering(nodes, edges)
    expect(extra.map((e) => `${e.source}->${e.target}`).sort()).toEqual(["gv->sf", "gv->tx"])
  })
  it("adds nothing for the source's own upstream, the Speaker View itself, source nodes or unrelated nodes", () => {
    const { nodes, edges } = inRunGraph()
    const targets = new Set(ordering(nodes, edges).map((e) => e.target))
    for (const id of ["prompt", "gv", "sv", "voice", "other"]) expect(targets.has(id)).toBe(false)
  })
  it("an upload is pre-resolved, so ordering behind it moves no node to a later level", () => {
    const { nodes, edges } = inRunGraph()
    nodes[1] = node("gv", "upload-video", { url: VIDEO })
    const levels = buildExecutionLevels(nodes, edges, new Set(["gv", "voice", "prompt"]))
    expect(levels[0]?.map((n) => n.id)).toContain("tx")
  })
  it("never creates a cycle: a node upstream of the source is not ordered after it", () => {
    const { nodes, edges } = inRunGraph()
    nodes.push(node("trim", "trim-video", {}))
    edges.push(wire("gv", "trim"), wire("trim", "tx", "audio"))
    const extra = ordering(nodes, edges.map((e) => (e.target === "sv" && e.targetHandle === "video" ? { ...e, source: "trim" } : e)))
    expect(extra.every((e) => e.source === "trim")).toBe(true)
    expect(extra.map((e) => e.target)).not.toContain("gv")
    expect(() => buildExecutionLevels(nodes, [...edges.filter((e) => !(e.target === "sv" && e.targetHandle === "video")), wire("trim", "sv", "video")])).not.toThrow()
  })
  it("F7: two video-fed Speaker Views whose orderings would close a loop together still leave every node runnable", () => {
    // A -> S2 -> SV2 and B -> S1 -> SV1; A also feeds SV1 and B also feeds SV2.
    // Alone, S1 -> A (for SV1) and S2 -> B (for SV2) are each acyclic; together
    // they close A -> S2 -> B -> S1 -> A, which would silently drop all four nodes.
    const nodes = [
      node("A", "transcribe"), node("B", "transcribe"),
      node("S1", "generate-video"), node("S2", "generate-video"),
      node("SV1", "speaker-view", { label: "One" }), node("SV2", "speaker-view", { label: "Two" }),
    ]
    const edges = [
      wire("A", "S2"), wire("B", "S1"),
      wire("S1", "SV1", "video"), wire("S2", "SV2", "video"),
      wire("A", "SV1", "transcript"), wire("B", "SV2", "transcript"),
    ]
    const placed = buildExecutionLevels(nodes, edges).flat().map((n) => n.id).sort()
    expect(placed).toEqual(["A", "B", "S1", "S2", "SV1", "SV2"])
    // And at least one of the two orderings is kept (the loop is broken, not both dropped).
    expect(ordering(nodes, edges).length).toBe(1)
  })
  it("buildExecutionLevels puts Transcribe after the source it would otherwise have run beside", () => {
    const { nodes, edges } = inRunGraph()
    const levelOf = (id: string) => buildExecutionLevels(nodes, edges).findIndex((lvl) => lvl.some((n) => n.id === id))
    expect(levelOf("tx")).toBeGreaterThan(levelOf("gv"))
    expect(levelOf("sv")).toBeGreaterThan(levelOf("tx"))
  })
  it("is empty for a graph with no video-fed Speaker View", () => {
    const { nodes, edges } = inRunGraph()
    expect(ordering(nodes, edges.filter((e) => e.targetHandle !== "video"))).toEqual([])
  })
})

describe("speakerViewRunStartSourceCheck: a source that exists at run start", () => {
  const upload = () => {
    const g = inRunGraph()
    g.nodes[1] = node("gv", "upload-video", { url: VIDEO })
    return g
  }
  const states = (): Record<string, NodeExecutionState> => ({ gv: done({ videoUrl: VIDEO }) })

  it("measures the source once and passes a wide one", async () => {
    const g = upload()
    const { d, measure } = deps()
    await expect(speakerViewRunStartSourceCheck({ runNodes: g.nodes, nodes: g.nodes, edges: g.edges, nodeStates: states(), deps: d })).resolves.toBeNull()
    expect(measure).toHaveBeenCalledTimes(1)
    expect(measure).toHaveBeenCalledWith(VIDEO)
  })

  it("D18 for every source, not only an upload with a saved size: refuses a measured narrow one, naming the LABEL and saying nothing was charged", async () => {
    const g = upload()
    const { d } = deps({ measure: vi.fn(async () => ({ durationMs: 5000, width: 1080, height: 1920 })) })
    const msg = await speakerViewRunStartSourceCheck({ runNodes: g.nodes, nodes: g.nodes, edges: g.edges, nodeStates: states(), deps: d })
    expect(msg).toMatch(/1080×1920/)
    expect(msg).toContain('Speaker View node "Vertical cut"')
    expect(msg).not.toMatch(/\bsv\b/)
    expect(msg).toMatch(/nothing was charged/)
  })

  it("R2: refuses a faceless clip only for a node that opts in", async () => {
    const faceless = { measure: vi.fn(async () => ({ durationMs: 5000, width: 3840, height: 2160, faces: "none" as const })) }
    const opted = upload(); opted.nodes[5] = node("sv", "speaker-view", { label: "Vertical cut", requireFaces: true })
    expect(await speakerViewRunStartSourceCheck({ runNodes: opted.nodes, nodes: opted.nodes, edges: opted.edges, nodeStates: states(), deps: deps(faceless).d })).toMatch(/no faces/i)
    const plain = upload()
    expect(await speakerViewRunStartSourceCheck({ runNodes: plain.nodes, nodes: plain.nodes, edges: plain.edges, nodeStates: states(), deps: deps(faceless).d })).toBeNull()
  })

  it("says why a clip cannot be measured, with the node's label", async () => {
    const g = upload()
    const { d } = deps({ measure: vi.fn(async () => { throw new ClipMeasureError("no-picture", "This file has no picture, so Speaker View has nothing to frame.") }) })
    const msg = await speakerViewRunStartSourceCheck({ runNodes: g.nodes, nodes: g.nodes, edges: g.edges, nodeStates: states(), deps: d })
    expect(msg).toContain("no picture")
    expect(msg).toContain('"Vertical cut"')
  })

  it("leaves a source the run has yet to produce for the dispatch gate, and measures nothing", async () => {
    const g = inRunGraph()
    const { d, measure } = deps()
    await expect(speakerViewRunStartSourceCheck({ runNodes: g.nodes, nodes: g.nodes, edges: g.edges, nodeStates: {}, deps: d })).resolves.toBeNull()
    expect(measure).not.toHaveBeenCalled()
  })

  it("does nothing for a Speaker View the run does not execute, or while Speaker View has no price", async () => {
    const g = upload()
    const a = deps()
    expect(await speakerViewRunStartSourceCheck({ runNodes: [], nodes: g.nodes, edges: g.edges, nodeStates: states(), deps: a.d })).toBeNull()
    const b = deps({ videoModeLive: () => false })
    expect(await speakerViewRunStartSourceCheck({ runNodes: g.nodes, nodes: g.nodes, edges: g.edges, nodeStates: states(), deps: b.d })).toBeNull()
    expect(a.measure).not.toHaveBeenCalled()
    expect(b.measure).not.toHaveBeenCalled()
  })

  it("measures a source shared by two Speaker Views once", async () => {
    const g = upload()
    g.nodes.push(node("sv2", "speaker-view", { label: "Square cut", targetAspect: "1:1" }))
    g.edges.push(wire("gv", "sv2", "video"), wire("tx", "sv2", "transcript"))
    const { d, measure } = deps()
    await speakerViewRunStartSourceCheck({ runNodes: g.nodes, nodes: g.nodes, edges: g.edges, nodeStates: states(), deps: d })
    expect(measure).toHaveBeenCalledTimes(1)
  })
})

describe("speakerViewDispatchGate: a source the run produces", () => {
  const narrow = () => deps({ measure: vi.fn(async () => ({ durationMs: 5000, width: 1080, height: 1920 })) })

  it("lets Transcribe run when the source is wide, then not again for the next paid node (one measurement)", async () => {
    const g = inRunGraph()
    const states: Record<string, NodeExecutionState> = { gv: done({ videoUrl: VIDEO }) }
    const { d, measure } = deps()
    await expect(speakerViewDispatchGate(g.nodes.find((n) => n.id === "tx")!, g.nodes, g.edges, states, d)).resolves.toBeUndefined()
    await expect(speakerViewDispatchGate(g.nodes.find((n) => n.id === "sf")!, g.nodes, g.edges, states, d)).resolves.toBeUndefined()
    expect(measure).toHaveBeenCalledTimes(1)
  })

  it("refuses Transcribe with the label and the clip's size once the source exists and is too narrow, so Transcribe never charges", async () => {
    const g = inRunGraph()
    const states: Record<string, NodeExecutionState> = { gv: done({ videoUrl: VIDEO }) }
    const err = await speakerViewDispatchGate(g.nodes.find((n) => n.id === "tx")!, g.nodes, g.edges, states, narrow().d).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/1080×1920/)
    expect((err as Error).message).toContain('Speaker View node "Vertical cut"')
    // Every later paid node is refused with the same verdict, from the one measurement.
    await expect(speakerViewDispatchGate(g.nodes.find((n) => n.id === "sf")!, g.nodes, g.edges, states, narrow().d)).rejects.toThrow(/1080×1920/)
  })

  it("does not gate the source itself, its own upstream, the Speaker View, or an unrelated node", async () => {
    const g = inRunGraph()
    const states: Record<string, NodeExecutionState> = { gv: done({ videoUrl: VIDEO }) }
    const { d, measure } = narrow()
    for (const id of ["prompt", "gv", "sv", "other"]) {
      await expect(speakerViewDispatchGate(g.nodes.find((n) => n.id === id)!, g.nodes, g.edges, states, d)).resolves.toBeUndefined()
    }
    expect(measure).not.toHaveBeenCalled()
  })

  it("cannot look at a source that has not produced anything yet, and lets the node's own dispatch judge it", async () => {
    const g = inRunGraph()
    const { d, measure } = narrow()
    await expect(speakerViewDispatchGate(g.nodes.find((n) => n.id === "tx")!, g.nodes, g.edges, {}, d)).resolves.toBeUndefined()
    expect(measure).not.toHaveBeenCalled()
  })

  it("F4: gates only when the Speaker View is part of the run; a partial run that leaves it out is not refused", async () => {
    const g = inRunGraph()
    const states: Record<string, NodeExecutionState> = { gv: done({ videoUrl: VIDEO }) }
    const tx = g.nodes.find((n) => n.id === "tx")!
    const out = narrow()
    // Run selected / Run from here on Transcribe alone: sv is not in the run.
    await expect(speakerViewDispatchGate(tx, g.nodes, g.edges, states, out.d, undefined, new Set(["tx"]))).resolves.toBeUndefined()
    expect(out.measure).not.toHaveBeenCalled()
    // The same node, with the Speaker View in the run, is refused.
    await expect(speakerViewDispatchGate(tx, g.nodes, g.edges, states, narrow().d, undefined, new Set(["tx", "sv"]))).rejects.toThrow(/1080×1920/)
  })

  it("F4: an unknown run set (nested graph, legacy caller) keeps gating every view", async () => {
    const g = inRunGraph()
    const states: Record<string, NodeExecutionState> = { gv: done({ videoUrl: VIDEO }) }
    await expect(speakerViewDispatchGate(g.nodes.find((n) => n.id === "tx")!, g.nodes, g.edges, states, narrow().d, undefined, undefined)).rejects.toThrow(/1080×1920/)
  })

  it("F4: with two Speaker Views, only the one in the run is judged", async () => {
    const g = inRunGraph()
    g.nodes.push(node("sv2", "speaker-view", { label: "Wide cut", targetAspect: "16:9" }))
    g.edges.push(wire("gv", "sv2", "video"), wire("tx", "sv2", "transcript"))
    const states: Record<string, NodeExecutionState> = { gv: done({ videoUrl: VIDEO }) }
    const tx = g.nodes.find((n) => n.id === "tx")!
    // 1280x720 leaves room for 9:16 (sv) but not for 16:9 (sv2).
    const clip = () => deps({ measure: vi.fn(async () => ({ durationMs: 5000, width: 1280, height: 720 })) }).d
    await expect(speakerViewDispatchGate(tx, g.nodes, g.edges, states, clip(), undefined, new Set(["tx", "sv"]))).resolves.toBeUndefined()
    await expect(speakerViewDispatchGate(tx, g.nodes, g.edges, states, clip(), undefined, new Set(["tx", "sv2"]))).rejects.toThrow(/Wide cut/)
  })

  it("is off while Speaker View has no price", async () => {
    const g = inRunGraph()
    const { d, measure } = deps({ videoModeLive: () => false })
    await speakerViewDispatchGate(g.nodes.find((n) => n.id === "tx")!, g.nodes, g.edges, { gv: done({ videoUrl: VIDEO }) }, d)
    expect(measure).not.toHaveBeenCalled()
  })

  it("costs nothing in a graph with no Speaker View", async () => {
    const { d, measure } = deps()
    await speakerViewDispatchGate(node("x", "transcribe"), [node("x", "transcribe")], [], {}, d)
    expect(measure).not.toHaveBeenCalled()
  })
})
