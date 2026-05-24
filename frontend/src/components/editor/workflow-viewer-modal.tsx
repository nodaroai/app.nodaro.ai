"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { createPortal } from "react-dom"
import {
  ReactFlow,
  ReactFlowProvider,
  MiniMap,
  Background,
  BackgroundVariant,
  Controls,
} from "@xyflow/react"
import { X, Loader2 } from "lucide-react"
import "@xyflow/react/dist/style.css"

import { nodeTypes } from "@/components/nodes"
import { AnimatedFlowEdge } from "./animated-flow-edge"
import { orderNodesParentFirst } from "./workflow-editor/group-coords"
import { createClient } from "@/lib/supabase"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

const edgeTypes = {
  default: AnimatedFlowEdge as any,
  animatedFlow: AnimatedFlowEdge as any,
}

interface WorkflowViewerModalProps {
  readonly workflowId: string
  readonly onClose: () => void
}

function WorkflowViewerCanvas({
  workflowId,
  onClose,
}: WorkflowViewerModalProps) {
  const [nodes, setNodes] = useState<WorkflowNode[]>([])
  const [edges, setEdges] = useState<WorkflowEdge[]>([])
  const [workflowName, setWorkflowName] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false

    async function fetchWorkflow() {
      try {
        const supabase = createClient()
        const { data, error: fetchError } = await supabase
          .from("workflows")
          .select("id, name, nodes, edges")
          .eq("id", workflowId)
          .single()

        if (cancelled) return

        if (fetchError || !data) {
          setError("Workflow not found")
          setLoading(false)
          return
        }

        setWorkflowName(data.name || "Untitled Workflow")
        setNodes((data.nodes as unknown as WorkflowNode[]) ?? [])
        setEdges((data.edges as unknown as WorkflowEdge[]) ?? [])
        setLoading(false)
      } catch {
        if (!cancelled) {
          setError("Failed to load workflow")
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

  // Filter out hidden nodes (e.g. from sub-workflow execution leftovers).
  // Order parent-first: this modal reads raw DB nodes (no editor heal), so a
  // group saved after its children would otherwise teleport in the viewer.
  const visibleNodes = useMemo(
    () => orderNodesParentFirst(nodes.filter((n) => !n.hidden)),
    [nodes],
  )

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

  return (
    <ReactFlow
      nodes={visibleNodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      edgesFocusable={false}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#333" />
      <MiniMap
        pannable
        zoomable
        style={{ width: 120, height: 80 }}
        maskColor="rgba(0, 0, 0, 0.6)"
      />
      <Controls showInteractive={false} />
      {/* Header bar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3 bg-[#121212]/90 backdrop-blur-sm border-b border-[#2D2D2D]">
        <h2 className="text-sm font-medium text-white truncate">
          {workflowName}
        </h2>
        <button
          type="button"
          aria-label="Close viewer"
          className="text-white/70 hover:text-white transition-colors"
          onClick={onClose}
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </ReactFlow>
  )
}

export function WorkflowViewerModal({
  workflowId,
  onClose,
}: WorkflowViewerModalProps) {
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-[85vw] h-[80vh] bg-[#121212] rounded-xl border border-[#2D2D2D] overflow-hidden"
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
