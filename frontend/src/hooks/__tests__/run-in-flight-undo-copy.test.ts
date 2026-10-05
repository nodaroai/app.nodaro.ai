import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, cleanup } from "@testing-library/react"

/**
 * A paid run's mark (`__runsInFlight`, T100) against the two things that put
 * node data back or copy it: Undo and Redo, and Duplicate and paste. The
 * tokens are the runs this tab has out now. Undo and Redo keep each node's
 * live tokens and history holds none; a copy starts with none.
 *
 * Without that, an Undo past a run's start takes its token away while it is
 * out, so a freeze waiting for it lands at once and the result the run then
 * writes is dropped; an Undo of a finished run's result brings back a token
 * nothing will release; and a copy carries one nothing will release either.
 * The last two keep a downgraded canvas from ever freezing.
 *
 * The real store, the real undo hooks and the real `applyWorkflowAccess`; only
 * the access answer and the toast are mocked.
 */

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getWorkflowAccess: vi.fn(),
}))

import { useWorkflowStore, buildDuplicatedNodeData } from "@/hooks/use-workflow-store"
import { useUndoRedoSubscription, useUndoRedoActions, flushPendingUndoSnapshot } from "@/hooks/use-undo-redo"
import { useUndoRedoStore } from "@/hooks/use-undo-redo-store"
import { withRunInFlight } from "@/hooks/run-in-flight"
import { applyWorkflowAccess } from "@/hooks/workflow-access-mode"
import { isSaveRefused } from "@/hooks/workflow-save-refusal"
import { RUNS_IN_FLIGHT_KEY, runsInFlightOn } from "@/lib/run-in-flight-mark"
import { getWorkflowAccess, type WorkflowAccessInfo } from "@/lib/api"
import type { WorkflowNode } from "@/types/nodes"

const WF = "wf-1"
const READ_ONLY_REASON = "This workflow is read-only for you."
const PAID_RESULT = [{ url: "https://cdn/paid.png" }]

function node(id: string): WorkflowNode {
  return { id, type: "character", position: { x: 0, y: 0 }, data: { label: id, characterName: "Kira" } } as unknown as WorkflowNode
}

const st = () => useWorkflowStore.getState()
const nodeOf = (id: string) => st().nodes.find((n) => n.id === id)!
const dataOf = (id: string) => nodeOf(id).data as Record<string, unknown>
const marksOn = (id: string) => runsInFlightOn(nodeOf(id).data)
const holdsAMark = (n: { readonly data?: unknown }) => RUNS_IN_FLIGHT_KEY in ((n.data ?? {}) as object)

/** A run the test settles by hand. */
function heldRun() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** A run out on `n1` that writes its paid result once the test lets it. */
function runWritingItsResult() {
  const held = heldRun()
  const run = withRunInFlight("n1", async () => {
    await held.promise
    st().updateNodeData("n1", { customVariations: PAID_RESULT })
  })
  return { finish: async () => { held.resolve(); await run } }
}

function viewAnswer(): WorkflowAccessInfo {
  return { access: "view", workspaceId: null, visibility: "private", canChangeVisibility: false, canShare: false, canRun: false }
}

/** A re-check answers `view`: saves stop at once, and the freeze waits for the runs. */
async function lowerToView() {
  vi.mocked(getWorkflowAccess).mockResolvedValue({ data: viewAnswer() })
  await applyWorkflowAccess(WF)
  expect(isSaveRefused(st())).toBe(true)
}

function expectFrozen() {
  expect(st().isReadOnly).toBe(true)
  expect(st().readOnlyReason).toBe(READ_ONLY_REASON)
}

/** An edit in an undo step of its own. */
function edit(id: string, patch: Record<string, unknown>) {
  act(() => st().updateNodeData(id, patch))
  flushPendingUndoSnapshot()
}

let undo: () => void
let redo: () => void

beforeEach(() => {
  vi.clearAllMocks()
  useUndoRedoStore.getState().clear()
  useWorkflowStore.setState({ isReadOnly: false, readOnlyReason: null, saveRefusedFor: null })
  st().loadWorkflow(WF, "W", [node("n1"), node("n2")], [])
  useWorkflowStore.setState({ loadedAccess: { workflowId: WF, access: "edit" } })
  renderHook(() => useUndoRedoSubscription())
  const { result } = renderHook(() => useUndoRedoActions())
  undo = () => act(() => result.current.undo())
  redo = () => act(() => result.current.redo())
})

afterEach(() => {
  cleanup()
})

describe("Undo and Redo keep the runs a node has out now", () => {
  it("an Undo past a run's start keeps its mark: the freeze still waits, and lands after the result", async () => {
    edit("n1", { description: "an edit before the run" })
    const run = runWritingItsResult()
    await lowerToView()
    expect(st().isReadOnly).toBe(false)

    undo()
    expect(dataOf("n1").description).toBeUndefined()
    expect(marksOn("n1")).toHaveLength(1)
    expect(st().isReadOnly).toBe(false)

    await run.finish()
    expect(dataOf("n1").customVariations).toEqual(PAID_RESULT)
    expect(marksOn("n1")).toEqual([])
    expectFrozen()
  })

  it("a Redo while the run is out keeps its mark too", async () => {
    edit("n1", { description: "an edit before the run" })
    const run = runWritingItsResult()
    undo()
    redo()
    expect(dataOf("n1").description).toBe("an edit before the run")
    expect(marksOn("n1")).toHaveLength(1)

    await run.finish()
    expect(marksOn("n1")).toEqual([])
  })

  it("an Undo of a finished run's result brings no mark back, nor does a Redo: a downgrade then freezes at once", async () => {
    await runWritingItsResult().finish()
    flushPendingUndoSnapshot()
    expect(marksOn("n1")).toEqual([])

    undo()
    expect(dataOf("n1").customVariations).toBeUndefined()
    expect(marksOn("n1")).toEqual([])
    redo()
    expect(dataOf("n1").customVariations).toEqual(PAID_RESULT)
    expect(marksOn("n1")).toEqual([])

    await lowerToView()
    expectFrozen()
  })

  it("history holds no mark, though its steps were taken while a run was out", async () => {
    const run = runWritingItsResult()
    edit("n2", { description: "an edit during the run" })
    await run.finish()
    flushPendingUndoSnapshot()
    const { past } = useUndoRedoStore.getState()
    // The edit's step and the result's step, both taken while n1 held a token.
    expect(past).toHaveLength(2)
    expect(past.flatMap((step) => step.nodes).filter(holdsAMark)).toEqual([])

    // The state an Undo leaves for Redo is history too.
    const another = runWritingItsResult()
    undo()
    expect(useUndoRedoStore.getState().future[0].nodes.filter(holdsAMark)).toEqual([])
    await another.finish()
  })
})

describe("a copy starts without the runs its source has out", () => {
  it("Duplicate", async () => {
    const run = runWritingItsResult()
    act(() => st().duplicateNode("n1"))
    const copy = st().nodes.find((n) => n.id !== "n1" && n.id !== "n2")!
    expect(runsInFlightOn(copy.data)).toEqual([])
    expect(marksOn("n1")).toHaveLength(1)

    await run.finish()
    await lowerToView()
    expectFrozen()
  })

  it("Duplicate of several nodes", async () => {
    const run = runWritingItsResult()
    act(() => st().duplicateNodes(["n1", "n2"]))
    expect(st().nodes).toHaveLength(4)
    expect(st().nodes.filter((n) => n.id !== "n1").filter(holdsAMark)).toEqual([])

    await run.finish()
    await lowerToView()
    expectFrozen()
  })

  it("paste: the clipboard carries the node's data whole, and the pasted copy has no mark", async () => {
    const run = runWritingItsResult()
    const clipboard = JSON.parse(JSON.stringify({ nodes: [nodeOf("n1")] })).nodes[0] as WorkflowNode
    expect(runsInFlightOn(clipboard.data)).toHaveLength(1)
    expect(runsInFlightOn(buildDuplicatedNodeData(clipboard, {}, { n1: "pasted" }))).toEqual([])
    await run.finish()
  })
})
