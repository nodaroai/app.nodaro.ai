/**
 * A pinned line per workflow the copilot created this turn.
 *
 * It exists because a created workflow is the one thing the copilot can do
 * that leaves NO trace on the canvas the user is looking at: the graph in
 * front of them is unchanged, and without this the only evidence would be a
 * sentence in the transcript and a new row appearing in their dashboard later.
 * The link is the whole point — a thing that was made and cannot be reached
 * is barely better than one that was not.
 */
import { Link } from "react-router-dom"
import { FilePlus2 } from "lucide-react"
import { COPILOT_STRINGS as S } from "@/ee/lib/copilot/strings"
import { useCopilotStore } from "@/ee/lib/copilot/turn-store"

export function CreatedWorkflowPins() {
  const created = useCopilotStore((s) => s.turn.createdWorkflows)
  if (created.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5">
      {created.map((workflow) => (
        <div
          key={workflow.workflowId}
          className="flex items-center gap-2 px-2.5 py-2 bg-[var(--copilot-card)] border border-border rounded-[10px]"
        >
          <FilePlus2 className="w-3 h-3 flex-none text-primary" strokeWidth={2.2} aria-hidden />
          <span className="min-w-0 flex-1 text-[11.5px] leading-[1.45] text-foreground break-words">
            <span className="text-[var(--copilot-dim)]">{S.workflowCreated} · </span>
            {workflow.name}
          </span>
          {/* A real navigation, not a canvas swap: this conversation belongs to
              the workflow still on screen, and switching underneath it would
              strand the turn the user is reading. */}
          <Link
            to={`/projects/${encodeURIComponent(workflow.projectId)}/workflows/${encodeURIComponent(workflow.workflowId)}`}
            className="flex-none text-[11px] text-[var(--copilot-muted)] hover:text-foreground underline"
          >
            {S.workflowCreatedOpen}
          </Link>
        </div>
      ))}
    </div>
  )
}
