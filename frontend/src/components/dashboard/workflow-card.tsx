import type { DragEvent } from "react"
import { Link } from "react-router-dom"
import { MoreHorizontal, Copy, Trash2, Pencil } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import type { WorkflowMeta } from "@/hooks/use-projects-store"

interface WorkflowCardProps {
  readonly workflow: WorkflowMeta
  readonly onDuplicate: (id: string) => void
  readonly onDelete: (id: string) => void
  readonly readOnly?: boolean
}

export function WorkflowCard({ workflow, onDuplicate, onDelete, readOnly }: WorkflowCardProps) {
  function handleDragStart(e: DragEvent) {
    e.dataTransfer.setData("application/x-workflow-id", workflow.id)
    e.dataTransfer.effectAllowed = "move"
  }

  return (
    <div
      className="group flex items-center justify-between px-3 py-2 rounded-md border bg-card hover:bg-accent/30 transition-colors cursor-grab active:cursor-grabbing"
      draggable
      onDragStart={handleDragStart}
    >
      <Link
        to={`/projects/${workflow.projectId}/workflows/${workflow.id}`}
        className="flex-1 min-w-0"
        draggable={false}
      >
        <p className="text-sm font-medium truncate">{workflow.name}</p>
        <p className="text-[10px] text-muted-foreground">
          {new Date(workflow.updatedAt).toLocaleDateString()}
        </p>
      </Link>
      {!readOnly && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100"
              aria-label={`Workflow options for ${workflow.name}`}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled>
              <Pencil className="h-3.5 w-3.5 mr-2" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDuplicate(workflow.id)}>
              <Copy className="h-3.5 w-3.5 mr-2" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => onDelete(workflow.id)}
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
