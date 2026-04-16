"use client"

import { useMemo } from "react"
import { FastForward, Play, Square } from "lucide-react"
import { hasCredits } from "@/lib/edition"
import { cancelJob } from "@/lib/api"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { getListInputForNode } from "@/components/editor/workflow-editor/node-input-resolver"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

interface RunNodeButtonProps {
  nodeId: string
  credits?: number
  isRunning: boolean
  onRun: (nodeId: string) => void
  /** When true, shows "Run from here" label with FastForward icon. */
  runFromHere?: boolean
}

export function RunNodeButton({ nodeId, credits, isRunning, onRun, runFromHere }: RunNodeButtonProps) {
  // Get currentJobId from store so callers don't need to pass it
  const currentJobId = useWorkflowStore((s) => {
    const node = s.nodes.find((n) => n.id === nodeId)
    return (node?.data as Record<string, unknown> | undefined)?.currentJobId as string | undefined
  })

  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)

  const fanOutCount = useMemo(() => {
    if (!credits || credits <= 0) return 1
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return 1
    const listItems = getListInputForNode(node as WorkflowNode, nodes as WorkflowNode[], edges as WorkflowEdge[])
    return listItems ? listItems.length : 1
  }, [nodeId, credits, nodes, edges])

  const totalCredits = (credits ?? 0) * fanOutCount

  if (isRunning && currentJobId) {
    return (
      <button
        type="button"
        className="flex items-center gap-1 h-6 px-2.5 text-[11px] font-medium text-white rounded-md whitespace-nowrap bg-red-500 hover:bg-red-600 shadow-sm"
        onClick={(e) => {
          e.stopPropagation()
          cancelJob(currentJobId).then(() => {
            useWorkflowStore.getState().updateNodeData(nodeId, {
              executionStatus: "failed",
              errorMessage: "Cancelled",
              currentJobId: undefined,
              currentJobProgress: undefined,
            })
          }).catch(() => {
            // If cancel API fails, still mark as failed locally
            useWorkflowStore.getState().updateNodeData(nodeId, {
              executionStatus: "failed",
              errorMessage: "Cancelled",
              currentJobId: undefined,
              currentJobProgress: undefined,
            })
          })
        }}
      >
        <Square className="w-2.5 h-2.5 fill-current" />
        Stop
      </button>
    )
  }

  if (isRunning) return null

  const Icon = runFromHere ? FastForward : Play
  const label = runFromHere ? "Run from here" : "Run"

  return (
    <button
      type="button"
      className="flex items-center gap-1 h-6 px-2.5 text-[11px] font-medium text-white rounded-md whitespace-nowrap bg-[#ff0073] hover:bg-[#e60068] shadow-sm"
      onClick={(e) => { e.stopPropagation(); onRun(nodeId) }}
    >
      <Icon className="w-3 h-3" />
      {label}
      {hasCredits() && credits !== undefined && credits > 0 && (
        <span className="ml-1 opacity-80">
          ({fanOutCount > 1 ? `${fanOutCount}×${credits}` : credits} CR)
        </span>
      )}
    </button>
  )
}
