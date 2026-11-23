"use client"

import { useEffect, useState, useCallback } from "react"
import { createPortal } from "react-dom"
import { ReactFlowProvider } from "@xyflow/react"
import { X, Loader2 } from "lucide-react"

import { ReadOnlyCanvas } from "@/components/workflow-view/read-only-canvas"
import { readWorkflowContent } from "@/lib/workflow-content"
import { useT, tx } from "@/lib/i18n"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

interface WorkflowViewerModalProps {
  readonly workflowId: string
  readonly onClose: () => void
}

function WorkflowViewerCanvas({
  workflowId,
  onClose,
}: WorkflowViewerModalProps) {
  const t = useT()
  const [nodes, setNodes] = useState<WorkflowNode[]>([])
  const [edges, setEdges] = useState<WorkflowEdge[]>([])
  const [workflowName, setWorkflowName] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false

    async function fetchWorkflow() {
      try {
        // The referenced workflow may be somebody else's: read it as THIS
        // caller may hold it (lib/workflow-content.ts).
        const content = await readWorkflowContent(workflowId, "id, name, nodes, edges")

        if (cancelled) return

        if (!content) {
          setError(tx("editor.viewerNotFound"))
          setLoading(false)
          return
        }

        const data = content.row
        setWorkflowName(data.name || tx("cfgext.subwfUntitledWorkflow"))
        setNodes((data.nodes as unknown as WorkflowNode[]) ?? [])
        setEdges((data.edges as unknown as WorkflowEdge[]) ?? [])
        setLoading(false)
      } catch {
        if (!cancelled) {
          setError(tx("editor.viewerLoadFailed"))
          setLoading(false)
        }
      }
    }

    fetchWorkflow()
    return () => { cancelled = true }
  }, [workflowId])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    },
    [onClose],
  )

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    )
  }

  // The editor's own workflow is in the store: this canvas never writes to it.
  return (
    <ReadOnlyCanvas nodes={nodes} edges={edges} mode="view-detached">
      {/* Header bar */}
      <div className="absolute top-0 start-0 end-0 z-10 flex items-center justify-between px-4 py-3 bg-background/90 backdrop-blur-sm border-b border-border dark:bg-[#121212]/90 dark:border-[#2D2D2D]">
        <h2 className="text-sm font-medium text-white truncate">
          {workflowName}
        </h2>
        <button
          type="button"
          aria-label={t("editor.closeViewer")}
          className="text-white/70 hover:text-white transition-colors"
          onClick={onClose}
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </ReadOnlyCanvas>
  )
}

export function WorkflowViewerModal({
  workflowId,
  onClose,
}: WorkflowViewerModalProps) {
  return createPortal(
    <div role="presentation"
      className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-[85vw] h-[80vh] bg-background rounded-xl border border-border dark:bg-[#121212] dark:border-[#2D2D2D] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <ReactFlowProvider>
          <WorkflowViewerCanvas
            workflowId={workflowId}
            onClose={onClose}
          />
        </ReactFlowProvider>
      </div>
    </div>,
    document.body,
  )
}
