import { getWorkflowAccess } from "@/lib/api"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

/**
 * Ask the server what this person may do with the workflow just loaded, and
 * put the canvas into the matching mode.
 *
 * The row policies already decide what the canvas may READ — that is why the
 * load succeeded. They decide what it may WRITE too, but silently, by refusing
 * a save that has already been typed. So the canvas asks up front instead of
 * letting somebody work for ten minutes into a wall.
 *
 * Its own module, and exported, because the alternative was three branches and
 * a race guard buried inside a two-hundred-line load closure that no test can
 * reach. A rule that decides whether a person can work is not a good place for
 * "covered by inspection".
 */
export async function applyWorkflowAccess(workflowId: string): Promise<void> {
  try {
    const { data: access } = await getWorkflowAccess(workflowId)

    // Late answers are dropped. Opening two workflows in quick succession
    // would otherwise let the first one's verdict land on the second — and the
    // visible version of that bug is somebody's own work going read-only.
    if (useWorkflowStore.getState().workflowId !== workflowId) return

    // Two different things can be true, and only one of them freezes the
    // canvas.
    if (access.access === "view") {
      useWorkflowStore.setState({
        isReadOnly: true,
        // Deliberately claims nothing about MEMBERSHIP. The same `view` answer
        // reaches an outside collaborator, a member of a class whose settings
        // only allow reading, and the CREATOR of a workflow in an archived
        // workspace — and telling that last person they are "not a member" of
        // their own class is both false and baffling. What is true of all
        // three is the part worth saying.
        readOnlyReason: "This workflow is read-only for you.",
      })
      return
    }

    // The case the reason field exists for, and the one nobody can work out
    // unaided: they may edit — the canvas responds, saves land — and Run does
    // nothing, because running spends the workspace's credits and that takes
    // membership. The canvas stays writable; only Run has something to explain.
    if (!access.canRun) {
      useWorkflowStore.setState({
        runBlockedReason: "You can edit this, but only members of its workspace can run it.",
      })
    }
  } catch {
    // Fire-and-forget by design: a failed check leaves the canvas exactly as it
    // is today, with the server still refusing anything it should. The opposite
    // choice would freeze somebody's own work on a network blip.
  }
}
