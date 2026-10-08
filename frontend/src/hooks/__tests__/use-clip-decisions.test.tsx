import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { EDITED_EDL_VERSION, editPlanBasis, resolveEditPlanOutput } from "@nodaro/shared"

vi.mock("@xyflow/react", () => ({
  applyNodeChanges: vi.fn((_changes, nodes) => nodes),
  applyEdgeChanges: vi.fn((_changes, edges) => edges),
  addEdge: vi.fn((connection, edges) => [...edges, connection]),
}))

import { useWorkflowStore } from "../use-workflow-store"
import { useClipDecisions, type ClipDecisionsSource } from "../use-clip-decisions"
import { flushPendingReviews, REVIEW_WRITE_IDLE_MS } from "@/lib/edl-review/write-review"

/**
 * A clip set's review decisions (A4-1): Keep writes at once, a hook edit is
 * debounced, and the pending write is flushed before a run, a close, unmount
 * and `pagehide`, so a hook typed just before Render final is in the run's
 * plan value.
 */
const clip = (i: number) => ({
  version: 1,
  sources: [{ id: "cam", url: "https://cdn.test/cam.mp4", kind: "video" }],
  segments: [{ id: `c${i}`, inMs: i * 10_000, outMs: i * 10_000 + 5_000, video: "cam" }],
  dropped: [],
  meta: { title: `Clip ${i}`, hook: `Hook ${i}` },
})
const PLAN = [clip(0), clip(1), clip(2)]

function load(data: Record<string, unknown> = {}) {
  useWorkflowStore.setState({
    nodes: [{ id: "plan", type: "edit-plan", position: { x: 0, y: 0 }, data: { mode: "clips", generatedJson: PLAN, ...data } }] as never,
    edges: [],
    isReadOnly: false,
  })
}
const planData = () => useWorkflowStore.getState().nodes.find((n) => n.id === "plan")!.data as Record<string, unknown>
const source = (over: Partial<ClipDecisionsSource> = {}): ClipDecisionsSource => ({
  planId: "plan",
  plan: PLAN,
  editedEdl: planData().editedEdl,
  locked: false,
  ...over,
})
/** The hook a run would read for row `row` from the plan as stored. */
const runHook = (row: number) => {
  const out = resolveEditPlanOutput(planData().generatedJson, planData().editedEdl)
  return JSON.parse(out.listResults![row]!).meta.hook
}

beforeEach(() => {
  vi.useFakeTimers()
  load()
})
afterEach(() => vi.useRealTimers())

describe("useClipDecisions", () => {
  it("opens on every clip kept, as planned", () => {
    const { result } = renderHook(() => useClipDecisions(source()))
    expect(result.current.decisions).toEqual([{ keep: true }, { keep: true }, { keep: true }])
    expect(result.current.canEdit).toBe(true)
  })

  it("opens on the stored review when it was made on this plan", () => {
    load({ editedEdl: { v: EDITED_EDL_VERSION, kind: "clips", basis: editPlanBasis(PLAN), clips: [{ keep: false }, { keep: true, hook: "x" }, { keep: true }] } })
    const { result } = renderHook(() => useClipDecisions(source()))
    expect(result.current.decisions).toEqual([{ keep: false }, { keep: true, hook: "x" }, { keep: true }])
  })

  it("Keep writes at once", () => {
    const { result } = renderHook(() => useClipDecisions(source()))
    act(() => result.current.setKeep(1, false))
    expect(planData().editedEdl).toMatchObject({ kind: "clips", clips: [{ keep: true }, { keep: false }, { keep: true }] })
    act(() => result.current.setKeep(1, true))
    expect(planData().editedEdl).toBeUndefined()
  })

  it("Keep all and Drop all set the named clips in ONE write, and leave the others alone (A4-2, R15 a)", () => {
    const { result } = renderHook(() => useClipDecisions(source()))
    const writes = vi.spyOn(useWorkflowStore.getState(), "updateNodeData")
    act(() => result.current.setKeepFor([0, 2], false))
    expect(writes).toHaveBeenCalledTimes(1)
    expect(planData().editedEdl).toMatchObject({ kind: "clips", clips: [{ keep: false }, { keep: true }, { keep: false }] })
    act(() => result.current.setKeepFor([0, 2], true))
    expect(planData().editedEdl).toBeUndefined()
    expect(writes).toHaveBeenCalledTimes(2)
    writes.mockRestore()
  })

  it("Drop all keeps the hooks typed so far, flushed with it", () => {
    const { result } = renderHook(() => useClipDecisions(source()))
    act(() => result.current.setHook(1, "typed"))
    act(() => result.current.setKeepFor([0, 1, 2], false))
    expect(planData().editedEdl).toMatchObject({ clips: [{ keep: false }, { keep: false, hook: "typed" }, { keep: false }] })
  })

  it("a hook edit is written once the typing pauses", () => {
    const { result } = renderHook(() => useClipDecisions(source()))
    act(() => result.current.setHook(0, "Nobody tells"))
    act(() => result.current.setHook(0, "Nobody tells you"))
    expect(result.current.decisions![0]).toEqual({ keep: true, hook: "Nobody tells you" })
    expect(result.current.pendingReview?.clips[0]).toEqual({ keep: true, hook: "Nobody tells you" })
    expect(planData().editedEdl).toBeUndefined()
    act(() => vi.advanceTimersByTime(REVIEW_WRITE_IDLE_MS))
    expect(runHook(0)).toBe("Nobody tells you")
  })

  it("flush writes a hook typed just before Render final, so the run reads it", () => {
    const { result } = renderHook(() => useClipDecisions(source()))
    act(() => result.current.setHook(2, "Typed at the last moment"))
    act(() => result.current.flush())
    expect(runHook(2)).toBe("Typed at the last moment")
  })

  it("Keep flushes a pending hook with it", () => {
    const { result } = renderHook(() => useClipDecisions(source()))
    act(() => result.current.setHook(0, "Hook kept"))
    act(() => result.current.setKeep(1, false))
    expect(runHook(0)).toBe("Hook kept")
  })

  it("Reset removes the hook (the plan's reads again) and an empty hook is kept as empty", () => {
    const { result } = renderHook(() => useClipDecisions(source()))
    act(() => result.current.setHook(0, ""))
    act(() => result.current.flush())
    expect(runHook(0)).toBe("")
    act(() => result.current.resetHook(0))
    expect(result.current.decisions![0]).toEqual({ keep: true })
    expect(planData().editedEdl).toBeUndefined()
    expect(runHook(0)).toBe("Hook 0")
  })

  it("unmount, pagehide and the editor's beforeunload flush write the pending hook", () => {
    const first = renderHook(() => useClipDecisions(source()))
    act(() => first.result.current.setHook(0, "on unmount"))
    first.unmount()
    expect(runHook(0)).toBe("on unmount")

    const second = renderHook(() => useClipDecisions(source()))
    act(() => second.result.current.setHook(1, "on pagehide"))
    act(() => {
      window.dispatchEvent(new Event("pagehide"))
    })
    expect(runHook(1)).toBe("on pagehide")

    act(() => second.result.current.setHook(2, "on beforeunload"))
    flushPendingReviews()
    expect(runHook(2)).toBe("on beforeunload")
    second.unmount()
  })

  it("does nothing while locked (R9 a), or with no clip set", () => {
    const { result } = renderHook(() => useClipDecisions(source({ locked: true })))
    expect(result.current.canEdit).toBe(false)
    act(() => result.current.setKeep(0, false))
    act(() => result.current.setKeepFor([0, 1], false))
    act(() => result.current.setHook(0, "x"))
    act(() => result.current.flush())
    expect(planData().editedEdl).toBeUndefined()
    const none = renderHook(() => useClipDecisions(source({ plan: PLAN[0] })))
    expect(none.result.current.decisions).toBeNull()
    expect(none.result.current.canEdit).toBe(false)
  })

  it("reseeds on a re-plan", () => {
    const { result, rerender } = renderHook((props: ClipDecisionsSource) => useClipDecisions(props), { initialProps: source() })
    act(() => result.current.setKeep(0, false))
    const replanned = [clip(0), clip(1)]
    load({ generatedJson: replanned })
    rerender(source({ plan: replanned, editedEdl: undefined }))
    expect(result.current.decisions).toEqual([{ keep: true }, { keep: true }])
  })
})
