"use client"

import { ReactFlowProvider } from "@xyflow/react"
import { WorkflowCanvas } from "./workflow-canvas"
import { NodeToolbar } from "./node-toolbar"
import { ConfigPanel } from "./config-panel"
import { EditorToolbar } from "./editor-toolbar"
import { useWorkflowPersistence } from "@/hooks/use-workflow-persistence"

interface WorkflowEditorProps {
  readonly projectId?: string
  readonly workflowId?: string
}

export function WorkflowEditor({ projectId, workflowId }: WorkflowEditorProps) {
  const { save, saving } = useWorkflowPersistence()

  function handleSave() {
    if (projectId) {
      save(projectId)
    }
  }

  function handleRun() {
    // TODO: Execute workflow via API
  }

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
