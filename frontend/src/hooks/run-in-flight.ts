import { toast } from "sonner"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { setSkipUndoCapture } from "@/hooks/undo-flags"
import { RUNS_IN_FLIGHT_KEY, runsInFlightOn } from "@/lib/run-in-flight-mark"

/** What a run inside {@link withRunInFlight} may do with its own mark. */
export interface RunInFlight {
  /**
   * Keep the node marked after the run returns, until the function handed back
   * is called. For a result that waits on the person: Refine's images wait to
   * be picked, and the pick is what writes the node. The caller then owns the
   * release and calls it once the result has landed or been set aside. A run
   * that throws is released all the same.
   */
  readonly keep: () => () => void
}

/**
 * The one way to start a paid run outside the executors whose result lands on
 * a canvas node through the store (T100). The node shows a run in flight
 * (`showsARunInFlight`) from before `run` starts until it ends, so a `view` or
 * `none` answer that reaches the canvas meanwhile waits for the result before
 * it turns the canvas read-only (`applyWorkflowAccess`).
 *
 * Every paid client call outside the executors sits lexically inside the
 * callback of this wrapper, or in an entry of the allowlist that says why it
 * does not need to: `hooks/__tests__/paid-run-mark-guard.test.ts`.
 *
 * Sends nothing on a canvas that is already read-only. The mark cannot be
 * written there, and a result could not be either, so the run would be paid
 * for and dropped: it is refused with the canvas's reason, as a Run is
 * (`refuseWhileReadOnly`, `run-handlers.ts`). `isReadOnly` alone: a canvas
 * whose saves are refused while its freeze waits for other runs still runs,
 * and this run's own mark holds the freeze until its result lands. Nor does
 * it start for a node that is not on the canvas: there is nowhere for its
 * result to go.
 *
 * Resolves with what `run` returns, or `undefined` when it was refused.
 */
export async function withRunInFlight<T>(
  nodeId: string,
  run: (mark: RunInFlight) => Promise<T>,
): Promise<T | undefined> {
  const release = holdNode(nodeId)
  if (!release) return undefined
  let kept = false
  const mark: RunInFlight = {
    keep: () => {
      kept = true
      return release
    },
  }
  try {
    const value = await run(mark)
    if (!kept) release()
    return value
  } catch (err) {
    release()
    throw err
  }
}

let lastToken = 0

/** Mark the node; returns the release, or null when nothing may start. */
function holdNode(nodeId: string): (() => void) | null {
  const { isReadOnly, readOnlyReason, nodes } = useWorkflowStore.getState()
  if (isReadOnly) {
    if (readOnlyReason) toast.error(readOnlyReason)
    return null
  }
  if (!nodes.some((node) => node.id === nodeId)) return null

  lastToken += 1
  const token = `run-${lastToken}`
  writeMarks(nodeId, (marks) => [...marks, token])
  let released = false
  return () => {
    if (released) return
    released = true
    writeMarks(nodeId, (marks) => marks.filter((mark) => mark !== token))
  }
}

/**
 * Written straight to the store, not through `updateNodeData`, for the release:
 * that is a no-op on a read-only canvas, and a release it swallowed would
 * leave the mark behind. Run state, like the other transient keys: no undo
 * step and nothing dirty (the `paintRunStates` pattern). A node that is gone,
 * or another workflow loaded meanwhile, has nothing to clear.
 */
function writeMarks(nodeId: string, next: (marks: readonly string[]) => readonly string[]): void {
  setSkipUndoCapture(true)
  try {
    useWorkflowStore.setState((state) => {
      let changed = false
      const nodes = state.nodes.map((node) => {
        if (node.id !== nodeId) return node
        const before = runsInFlightOn(node.data)
        const after = next(before)
        if (after.length === before.length) return node
        changed = true
        return { ...node, data: { ...node.data, [RUNS_IN_FLIGHT_KEY]: after.length > 0 ? after : undefined } }
      })
      return changed ? { nodes } : state
    })
  } finally {
    setSkipUndoCapture(false)
  }
}
