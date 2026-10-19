/**
 * The audio lock is an invariant of the graph (decided 2026-10-18): the
 * workflow store keeps it on every wire change — no panel mounted — in the
 * same write as the change (one undo step), gives the person's settings back
 * when a video is wired again, lets a manual edit made in between win, and
 * restores an undo snapshot as it was.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }) }))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { adoptedAsStored } from "@/hooks/workflow-store-adopted"
import { USE_CASE_SPECS, USE_CASE_NODE_TYPES, usecaseRowOf, type UseCaseBuilderKey } from "@nodaro/render-rules"
import { USE_CASE_AUDIO_LOCKS, usecaseAudioLockFailSafe, usecaseAudioLockGraph, usecaseAudioLockPatch } from "@/lib/use-case-audio-lock"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

const CUSTOM = { aspect: "16:9", layout: "grid", switchType: "zoom", emphasisStyle: "dim" }
const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } }) as unknown as WorkflowNode
const VIDEO = node("vid", "upload-video", { videoUrl: "https://r2/ep.mp4" })
const AUDIO = node("aud", "upload-audio", { audioUrl: "https://r2/ep.mp3" })
const wire = (source: "vid" | "aud", target: string): WorkflowEdge =>
  ({ id: `e-${source}-${target}`, source, sourceHandle: source === "vid" ? "video" : "audio", target, targetHandle: "media" }) as unknown as WorkflowEdge

const dataOf = (id: string) => useWorkflowStore.getState().nodes.find((n) => n.id === id)!.data as Record<string, unknown>
const connect = (source: "vid" | "aud", target: string) =>
  act(() => useWorkflowStore.getState().onConnect({ source, sourceHandle: source === "vid" ? "video" : "audio", target, targetHandle: "media" }))
const unwire = (target: string) =>
  act(() => useWorkflowStore.setState({ edges: useWorkflowStore.getState().edges.filter((e) => e.target !== target) }))

/** How many store writes an action makes, and the node's data after the first. */
function writesOf(action: () => void, id: string): { count: number; first: Record<string, unknown> | undefined } {
  let count = 0
  let first: Record<string, unknown> | undefined
  const unsub = useWorkflowStore.subscribe((s) => {
    count += 1
    first ??= s.nodes.find((n) => n.id === id)?.data as Record<string, unknown>
  })
  act(action)
  unsub()
  return { count, first }
}

afterEach(() => {
  act(() => useWorkflowStore.setState({ nodes: [], edges: [], isDirty: false, isReadOnly: false }))
})

describe("which node types have the lock: the use-case specs' audioForced", () => {
  it("the map is each use-case type's spec audioForced, for exactly the types whose spec declares one", () => {
    const declared = USE_CASE_NODE_TYPES.flatMap((t) => {
      const forced = USE_CASE_SPECS[usecaseRowOf(t).builder as UseCaseBuilderKey].audioForced
      return forced ? [[t, forced] as const] : []
    })
    expect(Object.keys(USE_CASE_AUDIO_LOCKS).sort()).toEqual(declared.map(([t]) => t).sort())
    for (const [t, forced] of declared) expect(USE_CASE_AUDIO_LOCKS[t], t).toBe(forced)
    // Both audio-taking nodes lock (never vacuous): Tighten Episode's output and captions, Clip Pack's framing and captions.
    expect(USE_CASE_AUDIO_LOCKS["tighten-episode"]).toEqual({ output: "audio", captions: false })
    expect(USE_CASE_AUDIO_LOCKS["clip-pack"]).toEqual({ framing: null, captions: false })
  })
})

describe("the store keeps the audio lock on every wire change, no panel mounted", () => {
  it("Clip Pack: a video with custom framing → audio wired (off, remembered, ONE write) → video wired again (restored)", () => {
    act(() => useWorkflowStore.setState({ nodes: [VIDEO, AUDIO, node("cp", "clip-pack", { framing: CUSTOM, captions: false, captionStyle: "bouncy" })], edges: [wire("vid", "cp")] }))
    expect(dataOf("cp").framing).toEqual(CUSTOM)
    unwire("cp")
    // The lock rides the wire's own write: one undo step.
    const locked = writesOf(() => useWorkflowStore.getState().onConnect({ source: "aud", sourceHandle: "audio", target: "cp", targetHandle: "media" }), "cp")
    expect(locked.count).toBe(1)
    expect(locked.first).toMatchObject({ framing: null, captions: false, settingsBeforeAudio: { framing: CUSTOM, captions: false } })
    unwire("cp")
    // Nothing wired: nothing changes.
    expect(dataOf("cp")).toMatchObject({ framing: null, captions: false })
    const restored = writesOf(() => useWorkflowStore.getState().onConnect({ source: "vid", sourceHandle: "video", target: "cp", targetHandle: "media" }), "cp")
    expect(restored.count).toBe(1)
    expect(dataOf("cp")).toMatchObject({ framing: CUSTOM, captions: false, captionStyle: "bouncy" })
    expect(dataOf("cp").settingsBeforeAudio).toBeUndefined()
  })

  it("Tighten Episode: Output and Captions come back on the video wire; its framing was never cleared", () => {
    act(() => useWorkflowStore.setState({ nodes: [VIDEO, AUDIO, node("t1", "tighten-episode", { output: "video", captions: false, framing: { aspect: "9:16", layout: "stacked" } })], edges: [] }))
    connect("aud", "t1")
    expect(dataOf("t1")).toMatchObject({ output: "audio", captions: false, settingsBeforeAudio: { output: "video", captions: false }, framing: { aspect: "9:16", layout: "stacked" } })
    unwire("t1")
    connect("vid", "t1")
    expect(dataOf("t1")).toMatchObject({ output: "video", captions: false, framing: { aspect: "9:16", layout: "stacked" } })
    expect(dataOf("t1").settingsBeforeAudio).toBeUndefined()
  })

  it("a node that was audio from the start comes back at the run's defaults", () => {
    act(() => useWorkflowStore.setState({ nodes: [VIDEO, AUDIO, node("cp", "clip-pack")], edges: [] }))
    connect("aud", "cp")
    expect(dataOf("cp")).toMatchObject({ framing: null, captions: false, settingsBeforeAudio: {} })
    unwire("cp")
    connect("vid", "cp")
    expect(dataOf("cp").framing).toBeUndefined()
    expect(dataOf("cp").captions).toBeUndefined()
  })

  it("a paste or import straight onto the store keeps it too", () => {
    act(() => useWorkflowStore.setState({ nodes: [VIDEO, AUDIO, node("cp", "clip-pack", { captions: true })], edges: [] }))
    act(() => useWorkflowStore.setState({ edges: [wire("aud", "cp")] }))
    expect(dataOf("cp")).toMatchObject({ captions: false, settingsBeforeAudio: { captions: true } })
  })

  it("an edit made while nothing (or audio) is wired wins: the next video wire gives back the edit", () => {
    act(() => useWorkflowStore.setState({ nodes: [VIDEO, AUDIO, node("cp", "clip-pack", { framing: CUSTOM, captions: true })], edges: [] }))
    connect("aud", "cp")
    unwire("cp")
    // The person picks a new framing while nothing is wired; captions untouched stay remembered.
    act(() => useWorkflowStore.getState().updateNodeData("cp", { framing: { ...CUSTOM, aspect: "1:1", layout: "single" } }))
    expect(dataOf("cp").settingsBeforeAudio).toEqual({ captions: true, framing: { ...CUSTOM, aspect: "1:1", layout: "single" } })
    connect("vid", "cp")
    expect(dataOf("cp")).toMatchObject({ captions: true, framing: { ...CUSTOM, aspect: "1:1", layout: "single" } })
    // While audio is wired, an edit (an agent's) wins too; the forced value itself is not an edit.
    unwire("cp")
    connect("aud", "cp")
    expect(dataOf("cp").settingsBeforeAudio).toEqual({ captions: true, framing: { ...CUSTOM, aspect: "1:1", layout: "single" } })
    act(() => useWorkflowStore.getState().updateNodeData("cp", { framing: CUSTOM }))
    expect((dataOf("cp").settingsBeforeAudio as Record<string, unknown>).framing).toEqual(CUSTOM)
    // …while the stored setting stays forced: the data still reads as the run reads it.
    expect(dataOf("cp").framing).toBeNull()
  })

  it("an upstream node's Output switched between video and audio (no wire change) locks, then gives back", () => {
    act(() => useWorkflowStore.setState({
      nodes: [VIDEO, node("t1", "tighten-episode", { output: "video" }), node("cp", "clip-pack", { framing: CUSTOM, captions: true })],
      edges: [wire("vid", "t1"), { id: "e-t1-cp", source: "t1", sourceHandle: "media", target: "cp", targetHandle: "media" } as unknown as WorkflowEdge],
    }))
    expect(dataOf("cp")).toMatchObject({ framing: CUSTOM, captions: true })
    act(() => useWorkflowStore.getState().updateNodeData("t1", { output: "audio" }))
    expect(dataOf("cp")).toMatchObject({ framing: null, captions: false, settingsBeforeAudio: { framing: CUSTOM, captions: true } })
    act(() => useWorkflowStore.getState().updateNodeData("t1", { output: "video" }))
    expect(dataOf("cp")).toMatchObject({ framing: CUSTOM, captions: true })
    expect(dataOf("cp").settingsBeforeAudio).toBeUndefined()
  })

  it("a chain locks in one write: Upload Audio → Tighten Episode → Clip Pack (Clip Pack sees Tighten's forced audio)", () => {
    // Clip Pack ahead of Tighten in the node list: it settles on the second pass.
    act(() => useWorkflowStore.setState({ nodes: [AUDIO, node("cp", "clip-pack", { captions: true }), node("t1", "tighten-episode", { output: "video", captions: true })], edges: [] }))
    const chain = [wire("aud", "t1"), { id: "e-t1-cp", source: "t1", sourceHandle: "media", target: "cp", targetHandle: "media" } as unknown as WorkflowEdge]
    const writes = writesOf(() => useWorkflowStore.setState({ edges: chain }), "cp")
    expect(writes.count).toBe(1)
    expect(dataOf("t1")).toMatchObject({ output: "audio", captions: false, settingsBeforeAudio: { output: "video", captions: true } })
    expect(dataOf("cp")).toMatchObject({ framing: null, captions: false, settingsBeforeAudio: { captions: true } })
  })

  it("an edge write that changes no wire's kind (a selection) touches no node data", () => {
    act(() => useWorkflowStore.setState({ nodes: [VIDEO, AUDIO, node("cp", "clip-pack", { captions: true })], edges: [wire("aud", "cp")] }))
    const nodesBefore = useWorkflowStore.getState().nodes
    act(() => useWorkflowStore.getState().onEdgesChange([{ type: "select", id: "e-aud-cp", selected: true }]))
    act(() => useWorkflowStore.setState({ edges: useWorkflowStore.getState().edges.map((e) => ({ ...e, selected: false })) }))
    expect(useWorkflowStore.getState().nodes).toBe(nodesBefore)
  })

  const snapshotOf = (g: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }) =>
    ({ ...g, name: "W", characterDefinitions: [], flowPromptTemplates: {}, presentationSettings: undefined, savedViewport: undefined }) as never

  it("a graph adopted as stored (an agent wired audio; a save conflict's merge) is taken as it is; the panel's first fail-safe write remembers, and a video gives it back", () => {
    act(() => useWorkflowStore.setState({ nodes: [VIDEO, AUDIO], edges: [] }))
    const t1 = node("t1", "tighten-episode", { output: "video", captions: true })
    const adopted = { nodes: [VIDEO, AUDIO, t1], edges: [wire("aud", "t1")] }
    act(() => useWorkflowStore.setState(adoptedAsStored({ ...adopted, lastSavedSnapshot: snapshotOf(adopted) })))
    expect(dataOf("t1")).toMatchObject({ output: "video", captions: true })
    expect(dataOf("t1").settingsBeforeAudio).toBeUndefined()
    // The marker is the write's, never the state's: not held, and not even typed on it.
    expect("adoptedAsStored" in useWorkflowStore.getState()).toBe(false)
    // @ts-expect-error `adoptedAsStored` is no field of WorkflowState
    void useWorkflowStore.getState().adoptedAsStored
    // Opening the panel: its fail-safe writes the forced values; the store remembers what the node held, in that write.
    const snap = usecaseAudioLockFailSafe("audio", dataOf("t1"), { output: "audio", captions: false })!
    act(() => useWorkflowStore.getState().updateNodeData("t1", snap))
    expect(dataOf("t1")).toMatchObject({ output: "audio", captions: false, settingsBeforeAudio: { output: "video", captions: true } })
    unwire("t1")
    connect("vid", "t1")
    expect(dataOf("t1")).toMatchObject({ output: "video", captions: true })
  })

  it("a write that sets a save's baseline WITH the graph is still locked: only the merge's marker adopts as stored", () => {
    act(() => useWorkflowStore.setState({ nodes: [VIDEO, AUDIO], edges: [] }))
    const t1 = node("t1", "tighten-episode", { output: "video", captions: true })
    const graph = { nodes: [VIDEO, AUDIO, t1], edges: [wire("aud", "t1")] }
    act(() => useWorkflowStore.setState({ ...graph, lastSavedSnapshot: snapshotOf(graph) }))
    expect(dataOf("t1")).toMatchObject({ output: "audio", captions: false, settingsBeforeAudio: { output: "video", captions: true } })
  })

  it("an undo restores the snapshot as it was — never read as an edit", () => {
    act(() => useWorkflowStore.setState({ nodes: [VIDEO, AUDIO, node("cp", "clip-pack", { captions: true })], edges: [] }))
    connect("aud", "cp")
    unwire("cp")
    const before = { nodes: useWorkflowStore.getState().nodes, edges: useWorkflowStore.getState().edges }
    act(() => useWorkflowStore.getState().updateNodeData("cp", { captions: true }))
    act(() => useWorkflowStore.getState().restoreSnapshot({ ...before, characterDefinitions: [], flowPromptTemplates: {}, workflowName: "W" } as never))
    expect(dataOf("cp")).toMatchObject({ captions: false, settingsBeforeAudio: { captions: true } })
  })
})

describe("the rule itself", () => {
  const F = { framing: null, captions: false }
  it("one write: forced values with what was set; a lock in place keeps its memory; nothing wired → nothing", () => {
    expect(usecaseAudioLockPatch("audio", { captions: true }, F)).toEqual({ settingsBeforeAudio: { captions: true }, framing: null, captions: false })
    expect(usecaseAudioLockPatch("audio", { framing: null, captions: false, settingsBeforeAudio: { captions: true } }, F)).toBeUndefined()
    expect(usecaseAudioLockPatch(undefined, { captions: true }, F)).toBeUndefined()
    expect(usecaseAudioLockPatch("video", { captions: true }, F)).toBeUndefined()
  })
  it("the panel's fail-safe only snaps, never remembers", () => {
    expect(usecaseAudioLockFailSafe("audio", { captions: true }, F)).toEqual(F)
    expect(usecaseAudioLockFailSafe("video", { captions: true }, F)).toBeUndefined()
  })
  it("a graph with no locked node is handed back as it is", () => {
    const nodes = [VIDEO]
    expect(usecaseAudioLockGraph([], [], nodes, [])).toBe(nodes)
  })
})
