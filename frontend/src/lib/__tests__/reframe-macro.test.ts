/**
 * "Reframe" (D11 (d), decided 2026-10-11): the canvas macro that drops
 * Transcribe (speakers) -> Speaker Frames -> Speaker View, wired and grouped.
 * Pure planner, so the canvas applies it as one undo step.
 */
import { describe, expect, it } from "vitest"
import {
  REFRAME_CHILD_TYPES,
  REFRAME_LAYOUT,
  REFRAME_VIDEO_INPUT,
  isReframeGroup,
  planReframeMacro,
  planReframeVideoFanOut,
  reframeChildren,
  reframeNeedsVideo,
  videoOutputHandleOf,
} from "../reframe-macro"
import { orderNodesParentFirst } from "@/components/editor/workflow-editor/group-coords"
import { NODE_DEF_MAP, type WorkflowEdge, type WorkflowNode } from "@/types/nodes"

const node = (id: string, type: string, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data }, ...extra }) as unknown as WorkflowNode
const edge = (id: string, source: string, sourceHandle: string, target: string, targetHandle: string) =>
  ({ id, source, sourceHandle, target, targetHandle }) as unknown as WorkflowEdge

const IDS = { group: "node_10", transcribe: "node_11", frames: "node_12", view: "node_13" }
const DEFAULTS = {
  transcribe: { label: "Transcribe", provider: "elevenlabs-stt", language: "auto", fieldMappings: {} },
  frames: { label: "Speaker Frames", fieldMappings: {} },
  view: { label: "Speaker View", quality: "final", fieldMappings: {} },
}
const plan = (graph: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }, extra: Record<string, unknown> = {}) => {
  const out = planReframeMacro(graph, { position: { x: 100, y: 100 }, ids: IDS, defaults: DEFAULTS, ...extra })
  return out
}
const wires = (edges: WorkflowEdge[], from: number) =>
  edges.slice(from).map(({ source, sourceHandle, target, targetHandle }) => ({ source, sourceHandle, target, targetHandle }))

describe("planReframeMacro", () => {
  it("drops a Reframe group holding Transcribe, Speaker Frames and Speaker View", () => {
    const out = plan({ nodes: [], edges: [] })
    expect(out.nodes.map((n) => [n.id, n.type, n.parentId])).toEqual([
      ["node_10", "group", undefined],
      ["node_11", "transcribe", "node_10"],
      ["node_12", "speaker-frames", "node_10"],
      ["node_13", "speaker-view", "node_10"],
    ])
    const group = out.nodes[0]
    expect(isReframeGroup(group)).toBe(true)
    expect(group.data).toMatchObject({ label: "Reframe", macro: "reframe" })
    expect(out.groupId).toBe("node_10")
  })

  it("seeds speaker detection on Transcribe and 9:16 / Cut / glide on Speaker View", () => {
    const out = plan({ nodes: [], edges: [] })
    expect(out.nodes.find((n) => n.type === "transcribe")!.data).toMatchObject({ provider: "elevenlabs-stt", diarize: true })
    expect(out.nodes.find((n) => n.type === "speaker-view")!.data).toMatchObject({ targetAspect: "9:16", switchType: "cut", motion: "glide" })
  })

  it("starts Speaker View at PREVIEW quality whatever its default is (D17, decided 2026-10-12)", () => {
    const out = plan({ nodes: [], edges: [] })
    // DEFAULTS.view above says "final": the macro overrides it, so the first run is the cheap one.
    expect(out.nodes.find((n) => n.type === "speaker-view")!.data).toMatchObject({ quality: "proxy" })
  })

  it("wires the transcript to both, the face tracks into Speaker View, and nothing else without a video", () => {
    const out = plan({ nodes: [], edges: [] })
    expect(wires(out.edges, 0)).toEqual([
      { source: "node_11", sourceHandle: "json", target: "node_12", targetHandle: "transcript" },
      { source: "node_11", sourceHandle: "json", target: "node_13", targetHandle: "transcript" },
      { source: "node_12", sourceHandle: "tracks", target: "node_13", targetHandle: "tracks" },
    ])
    expect(out.wiredVideo).toBe(false)
  })

  it("wires a known video into all three inputs, from the same output", () => {
    const base = { nodes: [node("up", "upload-video")], edges: [] }
    const out = plan(base, { video: { source: "up", sourceHandle: "video" } })
    expect(wires(out.edges, 0).slice(0, 3)).toEqual([
      { source: "up", sourceHandle: "video", target: "node_11", targetHandle: "audio" },
      { source: "up", sourceHandle: "video", target: "node_12", targetHandle: "video" },
      { source: "up", sourceHandle: "video", target: "node_13", targetHandle: "video" },
    ])
    expect(out.wiredVideo).toBe(true)
  })

  it("keeps every wire on a handle the node declares (an undeclared pip is an invisible edge)", () => {
    const out = plan({ nodes: [node("up", "upload-video")], edges: [] }, { video: { source: "up", sourceHandle: "video" } })
    const typeOf = new Map(out.nodes.map((n) => [n.id, n.type]))
    typeOf.set("up", "upload-video")
    for (const e of out.edges) {
      expect(NODE_DEF_MAP.get(typeOf.get(e.source) as never)!.outputs, `${e.source}.${e.sourceHandle}`).toContain(e.sourceHandle)
      expect(NODE_DEF_MAP.get(typeOf.get(e.target) as never)!.inputs, `${e.target}.${e.targetHandle}`).toContain(e.targetHandle)
    }
  })

  it("pins the ElevenLabs provider on Transcribe whatever the default is (speaker detection comes only from it)", () => {
    const out = plan({ nodes: [], edges: [] }, { defaults: { ...DEFAULTS, transcribe: { ...DEFAULTS.transcribe, provider: "some-other-stt" } } })
    expect(out.nodes.find((n) => n.type === "transcribe")!.data).toMatchObject({ provider: "elevenlabs-stt", diarize: true })
  })

  it("places each child inside the group (group-local coordinates) and renders parent-first", () => {
    const out = plan({ nodes: [node("a", "text-prompt")], edges: [] })
    const group = out.nodes.find((n) => n.type === "group")!
    expect(group).toMatchObject({ width: REFRAME_LAYOUT.group.width, height: REFRAME_LAYOUT.group.height })
    for (const type of REFRAME_CHILD_TYPES) {
      const c = out.nodes.find((n) => n.type === type)!
      expect(c.position).toEqual(REFRAME_LAYOUT[type])
      expect(c.position.x + 240).toBeLessThanOrEqual(REFRAME_LAYOUT.group.width)
    }
    expect(orderNodesParentFirst(out.nodes).map((n) => n.id)).toEqual(out.nodes.map((n) => n.id))
  })

  it("lands clear of existing nodes", () => {
    const out = plan({ nodes: [node("a", "text-prompt", {}, { position: { x: 100, y: 100 }, width: 300, height: 200 })], edges: [] })
    const g = out.nodes.find((n) => n.type === "group")!
    const overlaps = g.position.x < 400 && g.position.x + REFRAME_LAYOUT.group.width > 100 && g.position.y < 300 && g.position.y + REFRAME_LAYOUT.group.height > 100
    expect(overlaps).toBe(false)
  })

  it("lands BESIDE an existing group when dropped inside it (groups do not nest, decided 2026-10-12)", () => {
    const frame = node("frame", "group", { label: "Mine" }, { position: { x: 0, y: 0 }, width: 800, height: 600 })
    const out = plan({ nodes: [frame], edges: [] })
    const g = out.nodes.find((n) => n.id === IDS.group)!
    expect(g.parentId).toBeUndefined()
    // Clear of the frame, not on top of it...
    const clear = g.position.x >= 800 || g.position.x + REFRAME_LAYOUT.group.width <= 0 || g.position.y >= 600 || g.position.y + REFRAME_LAYOUT.group.height <= 0
    expect(clear).toBe(true)
    // ...and next to it, not somewhere across the canvas: within one group width of its right edge.
    expect(g.position.x).toBeLessThan(800 + REFRAME_LAYOUT.group.width + 400)
    expect(out.nodes.some((n) => n.id === "frame")).toBe(true)
  })

  it("lands beside the frame even when something already sits to its right", () => {
    const frame = node("frame", "group", { label: "Mine" }, { position: { x: 0, y: 0 }, width: 800, height: 600 })
    const blocker = node("blk", "text-prompt", {}, { position: { x: 840, y: 0 }, width: 300, height: 300 })
    const out = plan({ nodes: [frame, blocker], edges: [] })
    const g = out.nodes.find((n) => n.id === IDS.group)!
    const rect = { x: g.position.x, y: g.position.y, w: REFRAME_LAYOUT.group.width, h: REFRAME_LAYOUT.group.height }
    const hits = (r: { x: number; y: number; w: number; h: number }) => rect.x < r.x + r.w && rect.x + rect.w > r.x && rect.y < r.y + r.h && rect.y + rect.h > r.y
    expect(hits({ x: 0, y: 0, w: 800, h: 600 })).toBe(false)
    expect(hits({ x: 840, y: 0, w: 300, h: 300 })).toBe(false)
  })

  it("focuses the new group and leaves the rest of the graph alone", () => {
    const base = { nodes: [node("a", "text-prompt", {}, { selected: true })], edges: [edge("e0", "a", "text", "b", "text")] }
    const out = plan(base)
    expect(out.nodes.find((n) => n.id === "a")!.selected).toBe(false)
    expect(out.nodes.find((n) => n.id === "node_10")!.selected).toBe(true)
    expect(out.edges[0]).toBe(base.edges[0])
  })

  it("never changes the graph it is given", () => {
    const base = { nodes: [node("a", "text-prompt", {}, { selected: true })], edges: [] }
    const before = JSON.stringify(base)
    plan(base)
    expect(JSON.stringify(base)).toBe(before)
  })
})

describe("videoOutputHandleOf", () => {
  it("finds the output that emits a video, and none on a node without one", () => {
    expect(videoOutputHandleOf({ type: "upload-video" })).toBe("video")
    expect(videoOutputHandleOf({ type: "text-prompt" })).toBeUndefined()
  })
})

describe("the Reframe group once placed", () => {
  const placed = () => {
    const out = plan({ nodes: [node("up", "upload-video"), node("up2", "upload-video"), node("aud", "upload-audio"), node("txt", "text-prompt")], edges: [] })
    return { nodes: out.nodes, edges: out.edges, kids: reframeChildren(out.nodes, "node_10") }
  }

  it("is badged 'Wire a video' until any of the three video inputs has a wire", () => {
    const { nodes, edges } = placed()
    expect(reframeNeedsVideo(nodes, edges, "node_10")).toBe(true)
    expect(reframeNeedsVideo(nodes, [...edges, edge("v", "up", "video", "node_13", "video")], "node_10")).toBe(false)
  })

  it("is not badged when it is not a Reframe group, or a child has been deleted", () => {
    const { nodes, edges } = placed()
    expect(reframeNeedsVideo(nodes, edges, "up")).toBe(false)
    expect(reframeNeedsVideo(nodes.filter((n) => n.id !== "node_12"), edges, "node_10")).toBe(false)
  })

  it.each(REFRAME_CHILD_TYPES)("wires the other two when the first video lands on %s", (type) => {
    const { nodes, edges, kids } = placed()
    const handle = REFRAME_VIDEO_INPUT[type]
    const extra = planReframeVideoFanOut(nodes, edges, { source: "up", sourceHandle: "video", target: kids[type]!.id, targetHandle: handle })
    const others = REFRAME_CHILD_TYPES.filter((t) => t !== type)
    expect(extra.map((e) => [e.target, e.targetHandle])).toEqual(others.map((t) => [kids[t]!.id, REFRAME_VIDEO_INPUT[t]]))
    for (const e of extra) expect([e.source, e.sourceHandle]).toEqual(["up", "video"])
  })

  it("fans out once: a second video, or a rewire, never drags the others along", () => {
    const { nodes, edges, kids } = placed()
    const withOne = [...edges, edge("v", "up", "video", "node_13", "video")]
    expect(planReframeVideoFanOut(nodes, withOne, { source: "up2", sourceHandle: "video", target: kids.transcribe!.id, targetHandle: "audio" })).toEqual([])
  })

  it("does not fan out an audio (or any non-video) source dropped on Transcribe's audio pin", () => {
    // Transcribe's `audio` accepts audio or video, so Upload Audio -> Transcribe is a normal
    // wire. Fanning it into the two `video` inputs would be an invalid wire.
    const { nodes, edges, kids } = placed()
    const audio = planReframeVideoFanOut(nodes, edges, { source: "aud", sourceHandle: "audio", target: kids.transcribe!.id, targetHandle: "audio" })
    expect(audio).toEqual([])
    expect(planReframeVideoFanOut(nodes, edges, { source: "txt", sourceHandle: "text", target: kids.transcribe!.id, targetHandle: "audio" })).toEqual([])
    expect(planReframeVideoFanOut(nodes, edges, { source: "aud", target: kids.transcribe!.id, targetHandle: "audio" })).toEqual([])
    expect(planReframeVideoFanOut(nodes, edges, { source: "ghost", sourceHandle: "video", target: kids.transcribe!.id, targetHandle: "audio" })).toEqual([])
  })

  it("an audio wire on Transcribe's pin is not a video: the badge stays and a later video still fans out", () => {
    const { nodes, edges, kids } = placed()
    const withAudio = [...edges, edge("a", "aud", "audio", kids.transcribe!.id, "audio")]
    expect(reframeNeedsVideo(nodes, withAudio, "node_10")).toBe(true)
    // From Speaker View's pin: Speaker Frames is wired, Transcribe keeps its audio and gets no second wire.
    const fromView = planReframeVideoFanOut(nodes, withAudio, { source: "up", sourceHandle: "video", target: kids["speaker-view"]!.id, targetHandle: "video" })
    expect(fromView.map((e) => [e.target, e.targetHandle])).toEqual([[kids["speaker-frames"]!.id, "video"]])
    const fromFrames = planReframeVideoFanOut(nodes, withAudio, { source: "up", sourceHandle: "video", target: kids["speaker-frames"]!.id, targetHandle: "video" })
    expect(fromFrames.map((e) => [e.target, e.targetHandle])).toEqual([[kids["speaker-view"]!.id, "video"]])
  })

  it("a VIDEO wired on Transcribe's pin does count, and a later video lands as a plain wire", () => {
    const { nodes, edges, kids } = placed()
    const withVideo = [...edges, edge("v", "up", "video", kids.transcribe!.id, "audio")]
    expect(reframeNeedsVideo(nodes, withVideo, "node_10")).toBe(false)
    expect(planReframeVideoFanOut(nodes, withVideo, { source: "up2", sourceHandle: "video", target: kids["speaker-view"]!.id, targetHandle: "video" })).toEqual([])
  })

  it("ignores a wire that is not a video into a video input, or comes from inside the group", () => {
    const { nodes, edges, kids } = placed()
    expect(planReframeVideoFanOut(nodes, edges, { source: "up", sourceHandle: "video", target: kids["speaker-view"]!.id, targetHandle: "transcript" })).toEqual([])
    expect(planReframeVideoFanOut(nodes, edges, { source: kids.transcribe!.id, sourceHandle: "json", target: kids["speaker-view"]!.id, targetHandle: "video" })).toEqual([])
    expect(planReframeVideoFanOut(nodes, edges, { source: "up", sourceHandle: "video", target: "up2", targetHandle: "video" })).toEqual([])
  })
})
