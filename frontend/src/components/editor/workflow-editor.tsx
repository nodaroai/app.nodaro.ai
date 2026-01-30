"use client"

import { useCallback, useEffect } from "react"
import { ReactFlowProvider } from "@xyflow/react"
import { WorkflowCanvas } from "./workflow-canvas"
import { NodeToolbar } from "./node-toolbar"
import { ConfigPanel } from "./config-panel"
import { EditorToolbar } from "./editor-toolbar"
import { useWorkflowPersistence } from "@/hooks/use-workflow-persistence"
import { useProjectsStore } from "@/hooks/use-projects-store"

interface WorkflowEditorProps {
  readonly projectId?: string
  readonly workflowId?: string
}

export function WorkflowEditor({ projectId, workflowId }: WorkflowEditorProps) {
  const { save, load, saving, loading } = useWorkflowPersistence(projectId)
  const fetchProjects = useProjectsStore((s) => s.fetchProjects)

  useEffect(() => {
    if (workflowId) {
      load(workflowId)
    }
  }, [workflowId, load])

  // Ensure projects are loaded for breadcrumbs
  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  const handleSave = useCallback(() => {
    if (projectId) {
      save(projectId)
    }
  }, [projectId, save])

  function handleRun() {
    // TODO: Execute workflow via API
  }

  // Ctrl+S keyboard shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault()
        handleSave()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleSave])

  return (
    <div className="flex flex-col h-screen">
      <EditorToolbar
        projectId={projectId}
        workflowId={workflowId}
        onSave={handleSave}
        onRun={handleRun}
        saving={saving}
      />
      <div className="flex-1 relative">
        <ReactFlowProvider>
          <WorkflowCanvas />
          <NodeToolbar />
          <ConfigPanel />
        </ReactFlowProvider>
      </div>
    </div>
  )
}
