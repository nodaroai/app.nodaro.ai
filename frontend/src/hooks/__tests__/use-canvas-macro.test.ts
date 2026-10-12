/**
 * Reframe on the live canvas (D11 (d), decided 2026-10-11): the macro is
 * inserted, wired and grouped as ONE store update (one undo step), the first
 * video wired into the group wires all three inputs, and the store refuses to
 * write a macro as a node (it is not a node type).
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@xyflow/react", async () => vi.importActual<typeof import("@xyflow/react")>("@xyflow/react"))
vi.mock("@/lib/parameter-node-prefs", () => ({
  getStickyParameterDisplayMode: vi.fn(() => "picks"),
  setStickyParameterDisplayMode: vi.fn(),
  getStickyLookPreviewStyle: vi.fn(() => undefined),
  setStickyLookPreviewStyle: vi.fn(),
}))
vi.mock("@/components/editor/workflow-editor/auto-execute", () => ({
  autoExecuteNode: vi.fn(),
  cascadeAutoExecute: vi.fn(),
}))
const toasts = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), success: vi.fn() }))
vi.mock("sonner", () => ({ toast: toasts }))
// Video mode open (R15: Speaker View AND Speaker Frames priced) unless a case says otherwise.
const flag = vi.hoisted(() => ({ priced: true, frames: true }))
vi.mock("@nodaro/render-rules", async (orig) =>
  (await import("@/test-utils/speaker-view-video-gate-mock")).withVideoGate(await orig<typeof import("@nodaro/render-rules")>(), flag),
)

import { useWorkflowStore } from "../use-workflow-store"
import { addNodeOrMacro, insertCanvasMacro, macroVideoSource } from "../use-canvas-macro"
import { reframeChildren, reframeNeedsVideo } from "@/lib/reframe-macro"
import type { WorkflowNode } from "@/types/nodes"

const initialState = useWorkflowStore.getState()
beforeEach(() => {
  useWorkflowStore.setState(initialState, true)
  vi.clearAllMocks()
  flag.priced = true
  flag.frames = true
})

const store = () => useWorkflowStore.getState()
const upload = (id = "up", extra: Record<string, unknown> = {}) =>
  ({ id, type: "upload-video", position: { x: 0, y: 0 }, data: { label: "Video", url: "https://x/v.mp4" }, ...extra }) as unknown as WorkflowNode
const handles = (edges: ReturnType<typeof store>["edges"]) =>
  edges.map((e) => `${e.source}.${e.sourceHandle}>${e.target}.${e.targetHandle}`).sort()

describe("insertCanvasMacro (Reframe)", () => {
  it("R15: refuses, adding nothing, while Speaker View or Speaker Frames is unpriced", () => {
    for (const [priced, frames] of [[true, false], [false, true]] as const) {
      flag.priced = priced
      flag.frames = frames
      useWorkflowStore.setState({ nodes: [upload()], edges: [] })
      expect(insertCanvasMacro("reframe", { x: 0, y: 0 }).outcome, `${priced}/${frames}`).toBe("refused")
      expect(store().nodes).toHaveLength(1)
      expect(store().edges).toHaveLength(0)
    }
  })

  it("inserts the group, its three nodes and their wires in ONE store update", () => {
    useWorkflowStore.setState({ nodes: [upload()], edges: [] })
    let updates = 0
    const unsub = useWorkflowStore.subscribe(() => { updates += 1 })
    const { outcome, groupId } = insertCanvasMacro("reframe", { x: 600, y: 100 })
    unsub()
    expect(outcome).toBe("added")
    // The edit itself is a single set(); anything else is the canvas centring.
    expect(updates).toBe(1)
    const kids = reframeChildren(store().nodes, groupId!)
    expect(Object.keys(kids).sort()).toEqual(["speaker-frames", "speaker-view", "transcribe"])
    expect(store().edges).toHaveLength(3)
    expect(store().isDirty).toBe(true)
  })

  it("gives the nodes their real defaults, with speaker detection, preview quality and 9:16 / Cut / glide", () => {
    insertCanvasMacro("reframe", { x: 0, y: 0 })
    const byType = (t: string) => store().nodes.find((n) => n.type === t)!
    expect(byType("transcribe").data).toMatchObject({ provider: "elevenlabs-stt", language: "auto", diarize: true })
    expect(byType("speaker-view").data).toMatchObject({ quality: "proxy", targetAspect: "9:16", switchType: "cut", motion: "glide" })
    expect(byType("speaker-frames").data).toMatchObject({ label: "Speaker Frames" })
  })

  it("wires the single selected video node into all three and leaves no badge", () => {
    useWorkflowStore.setState({ nodes: [upload("up", { selected: true })], edges: [] })
    const { groupId } = insertCanvasMacro("reframe", { x: 600, y: 100 })
    const kids = reframeChildren(store().nodes, groupId!)
    expect(handles(store().edges)).toEqual(
      [
        `up.video>${kids.transcribe!.id}.audio`,
        `up.video>${kids["speaker-frames"]!.id}.video`,
        `up.video>${kids["speaker-view"]!.id}.video`,
        `${kids.transcribe!.id}.json>${kids["speaker-frames"]!.id}.transcript`,
        `${kids.transcribe!.id}.json>${kids["speaker-view"]!.id}.transcript`,
        `${kids["speaker-frames"]!.id}.tracks>${kids["speaker-view"]!.id}.tracks`,
      ].sort(),
    )
    expect(reframeNeedsVideo(store().nodes, store().edges, groupId!)).toBe(false)
  })

  it("lands unwired, with the badge, when no video is selected or several are", () => {
    useWorkflowStore.setState({ nodes: [upload("a", { selected: true }), upload("b", { selected: true })], edges: [] })
    const { groupId } = insertCanvasMacro("reframe", { x: 600, y: 100 })
    expect(store().edges).toHaveLength(3)
    expect(reframeNeedsVideo(store().nodes, store().edges, groupId!)).toBe(true)
  })

  it("wires the video output the menu was opened from, whatever is selected", () => {
    useWorkflowStore.setState({ nodes: [upload("a", { selected: true }), upload("b")], edges: [] })
    const { groupId } = insertCanvasMacro("reframe", { x: 600, y: 100 }, { nodeId: "b", handleId: "video", direction: "source" })
    const kids = reframeChildren(store().nodes, groupId!)
    expect(store().edges.filter((e) => e.source === "b").map((e) => e.target).sort()).toEqual(
      [kids.transcribe!.id, kids["speaker-frames"]!.id, kids["speaker-view"]!.id].sort(),
    )
  })

  it("does not wire an input handle's drag, or a handle that is not a video", () => {
    const nodes = [upload("a"), { id: "t", type: "text-prompt", position: { x: 0, y: 0 }, data: { label: "T" } } as unknown as WorkflowNode]
    expect(macroVideoSource(nodes, { nodeId: "a", handleId: "video", direction: "target" })).toBeUndefined()
    expect(macroVideoSource(nodes, { nodeId: "t", handleId: "text", direction: "source" })).toBeUndefined()
    expect(macroVideoSource(nodes, { nodeId: "a", handleId: "video", direction: "source" })).toEqual({ source: "a", sourceHandle: "video" })
  })

  it("lands beside an existing group when dropped inside it: added, no toast, the frame untouched", () => {
    const frame = { id: "frame", type: "group", position: { x: 0, y: 0 }, width: 900, height: 700, data: { label: "Mine" } } as unknown as WorkflowNode
    useWorkflowStore.setState({ nodes: [frame], edges: [] })
    const out = insertCanvasMacro("reframe", { x: 100, y: 100 })
    expect(out.outcome).toBe("added")
    expect(store().nodes).toHaveLength(5)
    expect(toasts.error).not.toHaveBeenCalled()
    const group = store().nodes.find((n) => n.id === out.groupId)!
    expect(group.parentId).toBeUndefined()
    expect(group.position.x >= 900 || group.position.y >= 700 || group.position.x + 1080 <= 0 || group.position.y + 560 <= 0).toBe(true)
    expect(store().nodes.find((n) => n.id === "frame")).toMatchObject({ position: { x: 0, y: 0 }, width: 900, height: 700 })
  })

  it("wires only when exactly ONE video node is selected: a selected non-video beside it does not change that, two videos wire nothing", () => {
    const text = { id: "t", type: "text-prompt", position: { x: 0, y: 400 }, data: { label: "T" }, selected: true } as unknown as WorkflowNode
    useWorkflowStore.setState({ nodes: [upload("up", { selected: true }), text], edges: [] })
    const one = insertCanvasMacro("reframe", { x: 2000, y: 100 })
    expect(store().edges.filter((e) => e.source === "up")).toHaveLength(3)
    expect(reframeNeedsVideo(store().nodes, store().edges, one.groupId!)).toBe(false)
  })

  it("does nothing on a read-only canvas or while a run is in progress", () => {
    useWorkflowStore.setState({ isReadOnly: true })
    expect(insertCanvasMacro("reframe", { x: 0, y: 0 }).outcome).toBe("read-only")
    useWorkflowStore.setState({ isReadOnly: false, nodes: [{ id: "r", type: "generate-image", position: { x: 0, y: 0 }, data: { label: "g", executionStatus: "running" } } as unknown as WorkflowNode] })
    expect(insertCanvasMacro("reframe", { x: 0, y: 0 }).outcome).toBe("busy")
    expect(store().nodes).toHaveLength(1)
  })
})

describe("the first video wired into the group wires all three", () => {
  const placed = () => {
    useWorkflowStore.setState({ nodes: [upload("up"), upload("up2")], edges: [] })
    const { groupId } = insertCanvasMacro("reframe", { x: 600, y: 100 })
    return reframeChildren(store().nodes, groupId!)
  }

  it("fans out from any one of the three, as one update", () => {
    const kids = placed()
    let updates = 0
    const unsub = useWorkflowStore.subscribe(() => { updates += 1 })
    store().onConnect({ source: "up", sourceHandle: "video", target: kids["speaker-view"]!.id, targetHandle: "video" })
    unsub()
    expect(updates).toBe(1)
    const fromUp = store().edges.filter((e) => e.source === "up").map((e) => `${e.target}.${e.targetHandle}`).sort()
    expect(fromUp).toEqual([`${kids.transcribe!.id}.audio`, `${kids["speaker-frames"]!.id}.video`, `${kids["speaker-view"]!.id}.video`].sort())
  })

  it("does it once: a second video on one input leaves the other two on the first", () => {
    const kids = placed()
    store().onConnect({ source: "up", sourceHandle: "video", target: kids.transcribe!.id, targetHandle: "audio" })
    const before = store().edges.length
    store().onConnect({ source: "up2", sourceHandle: "video", target: kids["speaker-view"]!.id, targetHandle: "video" })
    expect(store().edges.length).toBe(before + 1)
  })
})

describe("a video fan-out when Transcribe already holds a non-video wire", () => {
  it("still wires the two video inputs, and leaves the audio wire on Transcribe alone", () => {
    const audio = { id: "aud", type: "upload-audio", position: { x: 0, y: 300 }, data: { label: "A", url: "https://x/a.mp3" } } as unknown as WorkflowNode
    useWorkflowStore.setState({ nodes: [upload("up"), audio], edges: [] })
    const { groupId } = insertCanvasMacro("reframe", { x: 600, y: 100 })
    const kids = reframeChildren(store().nodes, groupId!)
    store().onConnect({ source: "aud", sourceHandle: "audio", target: kids.transcribe!.id, targetHandle: "audio" })
    expect(reframeNeedsVideo(store().nodes, store().edges, groupId!)).toBe(true)
    store().onConnect({ source: "up", sourceHandle: "video", target: kids["speaker-view"]!.id, targetHandle: "video" })
    const intoTranscribe = store().edges.filter((e) => e.target === kids.transcribe!.id && e.targetHandle === "audio")
    expect(intoTranscribe.map((e) => e.source)).toEqual(["aud"])
    expect(store().edges.filter((e) => e.source === "up").map((e) => `${e.target}.${e.targetHandle}`).sort()).toEqual(
      [`${kids["speaker-frames"]!.id}.video`, `${kids["speaker-view"]!.id}.video`].sort(),
    )
  })
})

describe("a macro is not a node type", () => {
  it("is refused by the store's addNode and writes nothing", () => {
    expect(store().addNode("reframe" as never, { x: 0, y: 0 })).toBeUndefined()
    expect(store().nodes).toEqual([])
  })

  it("is routed to the macro by addNodeOrMacro, and a real node to addNode", () => {
    const group = addNodeOrMacro("reframe" as never, { x: 0, y: 0 })
    expect(store().nodes.find((n) => n.id === group)?.type).toBe("group")
    const text = addNodeOrMacro("text-prompt", { x: 3000, y: 0 })
    expect(store().nodes.find((n) => n.id === text)?.type).toBe("text-prompt")
  })
})
