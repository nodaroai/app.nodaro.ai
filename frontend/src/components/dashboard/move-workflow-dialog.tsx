import { useState } from "react"
import { Star, Loader2, FolderOpen } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useProjects } from "@/hooks/queries/use-projects-queries"
import { useProjectsStore } from "@/hooks/use-projects-store"

interface MoveWorkflowDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly workflowId: string | null
  readonly workflowName: string | null
  readonly currentProjectId: string | null
}

/**
 * Pick a destination project for a workflow. Excludes the current project
 * (no-op move). Folders are auto-cleared by the store action — folders are
 * project-scoped and don't survive a cross-project move.
 */
export function MoveWorkflowDialog({
  open,
  onOpenChange,
  workflowId,
  workflowName,
  currentProjectId,
}: MoveWorkflowDialogProps) {
  const { data: projects = [], isLoading } = useProjects()
  const moveWorkflowToProject = useProjectsStore((s) => s.moveWorkflowToProject)
  const [moving, setMoving] = useState<string | null>(null)

  const eligible = projects.filter((p) => p.id !== currentProjectId)

  const handleMove = async (targetProjectId: string) => {
    if (!workflowId) return
    setMoving(targetProjectId)
    try {
      await moveWorkflowToProject(workflowId, targetProjectId)
      onOpenChange(false)
    } finally {
      setMoving(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Move workflow</DialogTitle>
          <DialogDescription>
            {workflowName ? `Move "${workflowName}" to a different project.` : "Pick a destination project."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : eligible.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No other projects to move to. Create another project first.
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto py-1">
            {eligible.map((p) => (
              <Button
                key={p.id}
                variant="ghost"
                className="w-full justify-start gap-2 h-9 px-2 font-normal"
                onClick={() => handleMove(p.id)}
                disabled={moving !== null}
              >
                {p.isDefault ? (
                  <Star className="h-3.5 w-3.5 text-[#ff0073] fill-[#ff0073]" />
                ) : (
                  <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="truncate flex-1 text-left">{p.name}</span>
                {moving === p.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              </Button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
