import { getWorkflowAccess, isNotFoundError, type WorkflowAccessLevel } from "@/lib/api"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { recheckedAccess } from "@/lib/workflow-content"

/**
 * Ask the server what this person may do with the workflow just loaded, and
 * put the canvas into the matching mode.
 *
 * The row policies already decide what the canvas may READ — that is why the
 * load succeeded. They decide what it may WRITE too, but silently, by refusing
 * a save that has already been typed. So the canvas asks up front instead of
 * letting somebody work for ten minutes into a wall.
 *
 * And it asks again while the workflow stays open (T97,
 * `use-workflow-access-recheck.ts`), because a load's answer is only what was
 * true when it was given. Every re-check comes through here, so it applies its
 * answer exactly as the load applies the first one — and writes it into the
 * store's `loadedAccess` too, the record that decides whether the canvas
 * subscribes to the row or polls for it (`mayHoldStoredRow`).
 *
 * Its own module, and exported, because the alternative was three branches and
 * a race guard buried inside a two-hundred-line load closure that no test can
 * reach. A rule that decides whether a person can work is not a good place for
 * "covered by inspection".
 */
export async function applyWorkflowAccess(workflowId: string): Promise<void> {
  // The record this answer may replace, read before asking: the one the load
  // just wrote, or the one a re-check found.
  const askedUnder = useWorkflowStore.getState().loadedAccess

  const answer = await askAccess(workflowId)
  // Fire-and-forget by design: a failed check leaves the canvas exactly as it
  // is, with the server still refusing anything it should. The opposite choice
  // would freeze somebody's own work on a network blip — and a re-check runs
  // exactly when one is likely, as a laptop wakes and its tab is shown again.
  // A failure is not evidence that anything changed; the next re-check asks.
  if (!answer) return

  // Late answers are dropped. Opening two workflows in quick succession
  // would otherwise let the first one's verdict land on the second — and the
  // visible version of that bug is somebody's own work going read-only. A
  // reload of the same workflow counts too: it replaced the record this answer
  // was asked under, and asks its own question.
  const state = useWorkflowStore.getState()
  if (state.workflowId !== workflowId || state.loadedAccess !== askedUnder) return

  // Written only over a record the load wrote for this workflow: without one
  // (a failed load) the canvas stays unknown, and unknown fails closed.
  // A record that did not change is not written again: the canvas reads it,
  // and a new object would re-render it on every re-check.
  const loadedAccess = askedUnder?.workflowId === workflowId ? recheckedAccess(askedUnder, answer.access) : askedUnder
  const changed = loadedAccess !== askedUnder

  // Two different things can be true, and only one of them freezes the
  // canvas.
  if (answer.access === "view" || answer.access === "none") {
    useWorkflowStore.setState({
      isReadOnly: true,
      // Deliberately claims nothing about MEMBERSHIP. The same `view` answer
      // reaches an outside collaborator, a member of a class whose settings
      // only allow reading, and the CREATOR of a workflow in an archived
      // workspace — and telling that last person they are "not a member" of
      // their own class is both false and baffling. What is true of all
      // three is the part worth saying.
      readOnlyReason: "This workflow is read-only for you.",
      ...(changed ? { loadedAccess } : {}),
    })
    return
  }

  // A wider answer than the record's opens the subscription again. It never
  // lifts read-only: a canvas a `view` answer made read-only may be holding
  // the reader's projection, and an editor saves the graph back whole — saving
  // that would erase the owner's drafts (T21 / T77). The next load reads the
  // workflow as its editor may hold it.
  if (changed) useWorkflowStore.setState({ loadedAccess })

  // The case the reason field exists for, and the one nobody can work out
  // unaided: they may edit — the canvas responds, saves land — and Run does
  // nothing, because running spends the workspace's credits and that takes
  // membership. The canvas stays writable; only Run has something to explain.
  if (!answer.canRun) {
    useWorkflowStore.setState({
      runBlockedReason: "You can edit this, but only members of its workspace can run it.",
    })
  }
}

/**
 * The server's answer, or null when there is none to be had. `none` is an
 * answer: the route turns away a caller with no access at all with the same
 * 404 it gives an id that does not exist, as every by-id route does.
 */
async function askAccess(workflowId: string): Promise<{ access: WorkflowAccessLevel; canRun: boolean } | null> {
  try {
    const { data } = await getWorkflowAccess(workflowId)
    return { access: data.access, canRun: data.canRun }
  } catch (err) {
    return isNotFoundError(err) ? { access: "none", canRun: false } : null
  }
}
