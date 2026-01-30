"use client"

import { useMemo, useState, type DragEvent } from "react"
import { Plus, FolderPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useProjectsStore } from "@/hooks/use-projects-store"
import { WorkflowCard } from "./workflow-card"
import { FolderItem } from "./folder-item"

interface WorkflowsTabProps {
  readonly projectId: string
}

export function WorkflowsTab({ projectId }: WorkflowsTabProps) {
  const allFolders = useProjectsStore((s) => s.folders)
  const allWorkflows = useProjectsStore((s) => s.workflowMetas)

  const folders = useMemo(
    () => allFolders.filter((f) => f.projectId === projectId),
    [allFolders, projectId],
  )
  const workflows = useMemo(
    () => allWorkflows.filter((w) => w.projectId === projectId),
    [allWorkflows, projectId],
  )
  const createWorkflow = useProjectsStore((s) => s.createWorkflow)
  const deleteWorkflow = useProjectsStore((s) => s.deleteWorkflow)
  const duplicateWorkflow = useProjectsStore((s) => s.duplicateWorkflow)
  const moveWorkflow = useProjectsStore((s) => s.moveWorkflow)
  const createFolder = useProjectsStore((s) => s.createFolder)
  const renameFolder = useProjectsStore((s) => s.renameFolder)
  const deleteFolder = useProjectsStore((s) => s.deleteFolder)

  const [rootDragOver, setRootDragOver] = useState(false)

  const rootWorkflows = workflows.filter((w) => w.folderId === null)

  function handleNewWorkflow() {
    createWorkflow(projectId, "Untitled Workflow")
  }

  function handleNewWorkflowInFolder(folderId: string) {
    createWorkflow(projectId, "Untitled Workflow", folderId)
  }

  function handleNewFolder() {
    const name = prompt("Folder name:")
    if (name) {
      createFolder(projectId, name)
    }
  }

  function handleRootDragOver(e: DragEvent) {
    if (e.dataTransfer.types.includes("application/x-workflow-id")) {
      e.preventDefault()
      e.dataTransfer.dropEffect = "move"
      setRootDragOver(true)
    }
  }

  function handleRootDragLeave() {
    setRootDragOver(false)
  }

  function handleRootDrop(e: DragEvent) {
    e.preventDefault()
    setRootDragOver(false)
    const workflowId = e.dataTransfer.getData("application/x-workflow-id")
    if (workflowId) {
      moveWorkflow(workflowId, null)
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Button size="sm" onClick={handleNewWorkflow}>
          <Plus className="h-4 w-4 mr-1" />
          New Workflow
        </Button>
        <Button size="sm" variant="outline" onClick={handleNewFolder}>
          <FolderPlus className="h-4 w-4 mr-1" />
          New Folder
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {folders.map((folder) => (
          <FolderItem
            key={folder.id}
            folder={folder}
            workflows={workflows.filter((w) => w.folderId === folder.id)}
            onRenameFolder={renameFolder}
            onDeleteFolder={deleteFolder}
            onDuplicateWorkflow={duplicateWorkflow}
            onDeleteWorkflow={deleteWorkflow}
            onMoveWorkflow={moveWorkflow}
            onCreateWorkflow={handleNewWorkflowInFolder}
          />
        ))}

        <div
          className={cn(
            "flex flex-col gap-1 rounded-md transition-colors min-h-[40px]",
            rootDragOver && folders.length > 0 && "bg-primary/10 ring-2 ring-primary/50 p-2",
          )}
          onDragOver={handleRootDragOver}
          onDragLeave={handleRootDragLeave}
          onDrop={handleRootDrop}
        >
          {rootDragOver && folders.length > 0 && rootWorkflows.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-1">
              Drop here to move to root
            </p>
          )}
          {rootWorkflows.map((wf) => (
            <WorkflowCard
              key={wf.id}
              workflow={wf}
              onDuplicate={duplicateWorkflow}
              onDelete={deleteWorkflow}
            />
          ))}
        </div>

        {workflows.length === 0 && folders.length === 0 && (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No workflows yet. Create one to get started.
          </p>
        )}
      </div>
    </div>
  )
}
