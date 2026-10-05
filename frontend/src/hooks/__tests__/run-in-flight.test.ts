import { describe, it, expect, vi, beforeEach } from "vitest"
import { EXECUTION_DATA_KEYS, TRANSIENT_RUNTIME_KEYS, stripTransientRuntimeData } from "@nodaro/shared"

/**
 * `withRunInFlight`, the one way a paid run outside the executors marks the
 * node its result lands on (T100). The real store; only the toast is mocked.
 * What each run does with it is in `workflow-viewer-mode-page-runs` and
 * `workflow-viewer-mode-setup-runs`; the guard that every such call goes
 * through it is `paid-run-mark-guard`.
 */

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}))

import { toast } from "sonner"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { isSkipUndoCapture } from "@/hooks/undo-flags"
import { withRunInFlight } from "@/hooks/run-in-flight"
import { showsARunInFlight } from "@/hooks/workflow-access-mode"
import { RUNS_IN_FLIGHT_KEY, runsInFlightOn } from "@/lib/run-in-flight-mark"
import type { WorkflowNode } from "@/types/nodes"

const WF = "wf-1"

function node(id: string): WorkflowNode {
  return { id, type: "character", position: { x: 0, y: 0 }, data: { label: id } } as unknown as WorkflowNode
}

const nodeOf = (id: string) => useWorkflowStore.getState().nodes.find((n) => n.id === id)!
const marksOn = (id: string) => runsInFlightOn(nodeOf(id).data)
const inFlight = (id: string) => showsARunInFlight(nodeOf(id))

/** A run the test settles by hand. */
function heldRun<T>() {
  let settle: { resolve: (value: T) => void; reject: (err: unknown) => void } = { resolve: () => {}, reject: () => {} }
  const promise = new Promise<T>((resolve, reject) => {
    settle = { resolve, reject }
  })
  return { promise, ...settle }
}

beforeEach(() => {
  vi.clearAllMocks()
  useWorkflowStore.getState().loadWorkflow(WF, "W", [node("n1"), node("n2")], [])
})

describe("withRunInFlight", () => {
  it("marks the node before the run starts, and clears the mark once it ends", async () => {
    const held = heldRun<string>()
    let markedWhenStarted = false
    const run = withRunInFlight("n1", () => {
      markedWhenStarted = inFlight("n1")
      return held.promise
    })
    expect(markedWhenStarted).toBe(true)
    expect(inFlight("n2")).toBe(false)

    held.resolve("done")
    await expect(run).resolves.toBe("done")
    expect(inFlight("n1")).toBe(false)
    expect(marksOn("n1")).toEqual([])
  })

  it("clears the mark when the run fails, and lets the failure through", async () => {
    const held = heldRun<never>()
    const run = withRunInFlight("n1", () => held.promise)
    expect(inFlight("n1")).toBe(true)

    held.reject(new Error("refused"))
    await expect(run).rejects.toThrow("refused")
    expect(inFlight("n1")).toBe(false)
  })

  it("gives each run its own token: one ending leaves the other's mark", async () => {
    const first = heldRun<void>()
    const second = heldRun<void>()
    const a = withRunInFlight("n1", () => first.promise)
    const b = withRunInFlight("n1", () => second.promise)
    expect(marksOn("n1")).toHaveLength(2)

    first.resolve()
    await a
    expect(marksOn("n1")).toHaveLength(1)
    expect(inFlight("n1")).toBe(true)

    second.resolve()
    await b
    expect(inFlight("n1")).toBe(false)
  })

  it("keep(): the mark outlives the run until its release is called, once", async () => {
    let release: () => void = () => {}
    await withRunInFlight("n1", async (mark) => {
      release = mark.keep()
    })
    expect(inFlight("n1")).toBe(true)

    // Another run on the node comes and goes; the kept mark stays.
    await withRunInFlight("n1", async () => {})
    expect(marksOn("n1")).toHaveLength(1)

    release()
    expect(inFlight("n1")).toBe(false)
    // A second release takes nothing else with it.
    const other = heldRun<void>()
    const run = withRunInFlight("n1", () => other.promise)
    release()
    expect(inFlight("n1")).toBe(true)
    other.resolve()
    await run
  })

  it("keep(): a run that throws after keeping is still released", async () => {
    await expect(
      withRunInFlight("n1", async (mark) => {
        mark.keep()
        throw new Error("after keep")
      }),
    ).rejects.toThrow("after keep")
    expect(inFlight("n1")).toBe(false)
  })

  it("sends nothing on a read-only canvas, and says why", async () => {
    useWorkflowStore.setState({ isReadOnly: true, readOnlyReason: "This workflow is read-only for you." })
    const run = vi.fn(async () => "paid")
    await expect(withRunInFlight("n1", run)).resolves.toBeUndefined()
    expect(run).not.toHaveBeenCalled()
    expect(marksOn("n1")).toEqual([])
    expect(toast.error).toHaveBeenCalledWith("This workflow is read-only for you.")
  })

  it("sends nothing for a node that is not on the canvas", async () => {
    const run = vi.fn(async () => "paid")
    await expect(withRunInFlight("gone", run)).resolves.toBeUndefined()
    expect(run).not.toHaveBeenCalled()
  })

  it("runs on a canvas whose saves are refused while its freeze waits", async () => {
    // Only read-only stops it: a refused save is the state whose runs still
    // paint, and this run's own mark holds the freeze until its result lands.
    useWorkflowStore.setState({ saveRefusedFor: WF })
    const run = vi.fn(async () => "paid")
    await expect(withRunInFlight("n1", run)).resolves.toBe("paid")
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("clears its mark even once the canvas is read-only", async () => {
    // updateNodeData is a no-op on a read-only canvas: a release written
    // through it would leave the mark behind.
    const held = heldRun<void>()
    const run = withRunInFlight("n1", () => held.promise)
    useWorkflowStore.setState({ isReadOnly: true, readOnlyReason: "read-only" })
    held.resolve()
    await run
    expect(marksOn("n1")).toEqual([])
  })

  it("dirties nothing and adds no undo step", async () => {
    const skipped: boolean[] = []
    const stop = useWorkflowStore.subscribe(() => skipped.push(isSkipUndoCapture()))
    const held = heldRun<void>()
    const run = withRunInFlight("n1", () => held.promise)
    held.resolve()
    await run
    stop()
    expect(skipped).toEqual([true, true])
    expect(useWorkflowStore.getState().isDirty).toBe(false)
  })

  it("leaves nothing to clear after a reload replaced the node", async () => {
    const held = heldRun<void>()
    const run = withRunInFlight("n1", () => held.promise)
    useWorkflowStore.getState().loadWorkflow(WF, "W", [node("n1")], [])
    expect(inFlight("n1")).toBe(false)
    held.resolve()
    await run
    expect(marksOn("n1")).toEqual([])
  })
})

describe("the mark is never saved", () => {
  it("is transient run state, which the save payload strips", () => {
    expect(TRANSIENT_RUNTIME_KEYS.has(RUNS_IN_FLIGHT_KEY)).toBe(true)
    expect(EXECUTION_DATA_KEYS.has(RUNS_IN_FLIGHT_KEY)).toBe(true)
    const [saved] = stripTransientRuntimeData([{ data: { label: "n1", [RUNS_IN_FLIGHT_KEY]: ["run-1"] } }])
    expect(saved.data).toEqual({ label: "n1" })
  })
})
