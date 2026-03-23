"use client"

import { Play, Square } from "lucide-react"
import { hasCredits } from "@/lib/edition"
import { cancelJob } from "@/lib/api"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

interface RunNodeButtonProps {
  nodeId: string
  credits?: number
  isRunning: boolean
  onRun: (nodeId: string) => void
}

export function RunNodeButton({ nodeId, credits, isRunning, onRun }: RunNodeButtonProps) {
  // Get currentJobId from store so callers don't need to pass it
  const currentJobId = useWorkflowStore((s) => {
    const node = s.nodes.find((n) => n.id === nodeId)
    return (node?.data as Record<string, unknown> | undefined)?.currentJobId as string | undefined
  })

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

  return (
    <button
      type="button"
      className="flex items-center gap-1 h-6 px-2.5 text-[11px] font-medium text-white rounded-md whitespace-nowrap bg-[#ff0073] hover:bg-[#e60068] shadow-sm"
      onClick={(e) => { e.stopPropagation(); onRun(nodeId) }}
    >
      <Play className="w-3 h-3" />
      Run
      {hasCredits() && credits !== undefined && credits > 0 && (
        <span className="ml-1 opacity-80">({credits} CR)</span>
      )}
    </button>
  )
}
