"use client"

import { useState, type DragEvent } from "react"
import { ChevronRight, ChevronDown, Folder, MoreHorizontal, Trash2, Pencil, Plus } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Folder as FolderType, WorkflowMeta } from "@/hooks/use-projects-store"
import { WorkflowCard } from "./workflow-card"

interface FolderItemProps {
  readonly folder: FolderType
  readonly workflows: ReadonlyArray<WorkflowMeta>
  readonly onRenameFolder: (id: string, name: string) => void
  readonly onDeleteFolder: (id: string) => void
  readonly onDuplicateWorkflow: (id: string) => void
  readonly onDeleteWorkflow: (id: string) => void
  readonly onMoveWorkflow: (workflowId: string, folderId: string | null) => void
  readonly onCreateWorkflow: (folderId: string) => void
}

export function FolderItem({
  folder,
  workflows,
  onRenameFolder,
  onDeleteFolder,
  onDuplicateWorkflow,
  onDeleteWorkflow,
  onMoveWorkflow,
  onCreateWorkflow,
}: FolderItemProps) {
  const [open, setOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  function handleDragOver(e: DragEvent) {
    if (e.dataTransfer.types.includes("application/x-workflow-id")) {
      e.preventDefault()
      e.dataTransfer.dropEffect = "move"
      setDragOver(true)
    }
  }

  function handleDragLeave() {
    setDragOver(false)
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const workflowId = e.dataTransfer.getData("application/x-workflow-id")
    if (workflowId) {
      onMoveWorkflow(workflowId, folder.id)
      setOpen(true)
    }
  }

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1 px-2 py-1.5 rounded-md transition-colors",
          dragOver
            ? "bg-primary/10 ring-2 ring-primary/50"
            : "hover:bg-accent/30",
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <button
          className="flex items-center gap-1 flex-1 min-w-0 text-sm font-medium text-left"
          onClick={() => setOpen(!open)}
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0" />
          )}
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{folder.name}</span>
          <span className="text-xs text-muted-foreground ml-1">
            ({workflows.length})
          </span>
        </button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation()
            onCreateWorkflow(folder.id)
            setOpen(true)
          }}
          title="New workflow in folder"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => {
                const name = prompt("Rename folder:", folder.name)
                if (name) onRenameFolder(folder.id, name)
              }}
            >
              <Pencil className="h-3.5 w-3.5 mr-2" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => onDeleteFolder(folder.id)}
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {open && (
        <div className="ml-6 flex flex-col gap-1 mt-1">
          {workflows.map((wf) => (
            <WorkflowCard
              key={wf.id}
              workflow={wf}
              onDuplicate={onDuplicateWorkflow}
              onDelete={onDeleteWorkflow}
            />
          ))}
          {workflows.length === 0 && (
            <p className="text-xs text-muted-foreground py-2 pl-2">
              Empty folder. Drag workflows here or click + to create one.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
