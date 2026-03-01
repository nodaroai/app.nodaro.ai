"use client"

import { Play } from "lucide-react"
import { hasCredits } from "@/lib/edition"

interface RunNodeButtonProps {
  nodeId: string
  credits?: number
  isRunning: boolean
  onRun: (nodeId: string) => void
}

export function RunNodeButton({ nodeId, credits, isRunning, onRun }: RunNodeButtonProps) {
  if (isRunning) return null

  return (
    <button
      type="button"
      className="flex items-center gap-1 h-6 px-3 text-[11px] font-medium text-white rounded-md whitespace-nowrap bg-[#ff0073] hover:bg-[#e60068]"
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
