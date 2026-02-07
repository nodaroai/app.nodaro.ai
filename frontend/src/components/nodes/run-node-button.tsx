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
    <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 z-10 opacity-0 group-hover/run:opacity-100 transition-opacity">
      <button
        type="button"
        className="flex items-center gap-1 h-6 px-3 text-[11px] font-medium text-white rounded-b-md shadow-md transition-colors whitespace-nowrap"
        style={{ backgroundColor: '#ff0073' }}
        onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#e60068'}
        onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#ff0073'}
        onClick={(e) => { e.stopPropagation(); onRun(nodeId) }}
      >
        <Play className="w-3 h-3" />
        Run
        {hasCredits() && credits !== undefined && credits > 0 && (
          <span className="ml-1 opacity-80">({credits} CR)</span>
        )}
      </button>
    </div>
  )
}
