import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))

import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useReviewModel } from "@/hooks/use-review-model"
import { useReviewEdits } from "@/hooks/use-review-edits"
import { resetUndoStacks } from "@/lib/edl-review/undo-stack"
import { unloadNeedsPrompt, unloadSaveRequest } from "../unload-save"

/**
 * The editor's unload handlers with a review edit still pending (F1). The
 * inspector writes its edits debounced; the browser fires `beforeunload`
 * before `pagehide`, and both editor handlers read the store there. They must
 * write the pending edit first, or the last edit before a reload is lost.
 */
const PLAN = {
  version: 1,
  clock: "master",
  sources: [{ id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" }],
  segments: [
    { id: "s0", inMs: 0, outMs: 4000, video: "cam" },
    { id: "s1", inMs: 5000, outMs: 9000, video: "cam" },
  ],
  dropped: [{ inMs: 4000, outMs: 5000, reason: "filler" }],
}
const TRANSCRIPT = {
  version: 1,
  words: [
    { text: "So", startMs: 100, endMs: 400, speaker: "A" },
    { text: "the", startMs: 500, endMs: 800, speaker: "A" },
  ],
}
const at = { x: 0, y: 0 }
const AUTH = { projectId: "p1", supabaseUrl: "https://db.test", supabaseKey: "anon", token: "tok" }

function load() {
  useWorkflowStore.setState({
    nodes: [
      { id: "tr", type: "transcribe", position: at, data: { generatedJson: TRANSCRIPT } },
      { id: "plan", type: "edit-plan", position: at, data: { mode: "tighten", generatedJson: PLAN } },
      { id: "cut", type: "apply-edl", position: at, data: { quality: "proxy" } },
    ] as never,
    edges: [
      { id: "t", source: "tr", sourceHandle: "json", target: "plan", targetHandle: "transcript" },
      { id: "e", source: "plan", sourceHandle: "edl", target: "cut", targetHandle: "edl" },
    ] as never,
    isReadOnly: false,
    isDirty: false,
    workflowId: "wf-1",
    loadedUpdatedAt: null,
    saveRefusedFor: null,
  } as never)
}

function useEdits() {
  return useReviewEdits(useReviewModel("cut"))
}

beforeEach(() => {
  vi.useFakeTimers()
  resetUndoStacks()
  load()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("the editor's unload handlers write a pending review first", () => {
  it("the keepalive save carries the last edit, made inside the write's idle window", () => {
    const { result } = renderHook(useEdits)
    act(() => result.current.cutRange({ inMs: 100, outMs: 400 }))
    // Nothing else was dirty, and the debounced write has not landed.
    const request = unloadSaveRequest(AUTH)
    expect(request).not.toBeNull()
    const body = JSON.parse(request!.init.body as string) as { nodes: Array<{ id: string; data: Record<string, unknown> }> }
    const plan = body.nodes.find((n) => n.id === "plan")!
    expect(plan.data.editedEdl).toMatchObject({ v: 1, kind: "edl" })
  })

  it("the leave prompt shows when the only change is a pending review", () => {
    const { result } = renderHook(useEdits)
    act(() => result.current.cutRange({ inMs: 100, outMs: 400 }))
    expect(unloadNeedsPrompt()).toBe(true)
  })

  it("with nothing pending and nothing dirty, neither saves nor prompts", () => {
    renderHook(useEdits)
    expect(unloadSaveRequest(AUTH)).toBeNull()
    expect(unloadNeedsPrompt()).toBe(false)
  })

  it("a refused or read-only workflow is never saved on unload", () => {
    useWorkflowStore.setState({ isDirty: true, saveRefusedFor: "wf-1" } as never)
    expect(unloadSaveRequest(AUTH)).toBeNull()
    useWorkflowStore.setState({ saveRefusedFor: null, isReadOnly: true } as never)
    expect(unloadSaveRequest(AUTH)).toBeNull()
  })
})

describe("workflow-editor-main's beforeunload handlers go through unload-save", () => {
  const source = readFileSync(join(__dirname, "..", "workflow-editor-main.tsx"), "utf8")

  it("the save handler builds its request with unloadSaveRequest", () => {
    const start = source.indexOf("// Flush save on page unload")
    const handler = source.slice(start, source.indexOf('window.addEventListener("beforeunload"', start))
    expect(handler).toMatch(/unloadSaveRequest\(/)
    expect(handler).not.toMatch(/useWorkflowStore\.getState\(\)/)
  })

  it("the prompt handler asks unloadNeedsPrompt", () => {
    const start = source.indexOf("function handleBeforeUnload(e: BeforeUnloadEvent)")
    const handler = source.slice(start, source.indexOf("e.preventDefault()", start))
    expect(handler).toMatch(/unloadNeedsPrompt\(\)/)
    expect(handler).not.toMatch(/useWorkflowStore\.getState\(\)/)
  })
})
