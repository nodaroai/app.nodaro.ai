"use client"

import { ChevronRight } from "lucide-react"
import { useSubWorkflowStack } from "@/hooks/use-sub-workflow-stack"

interface SubWorkflowBreadcrumbProps {
  readonly rootLabel: string
  readonly onJumpToRoot: () => void
  readonly onJumpTo: (workflowId: string) => void
}

export function SubWorkflowBreadcrumb({ rootLabel, onJumpToRoot, onJumpTo }: SubWorkflowBreadcrumbProps) {
  const stack = useSubWorkflowStack((s) => s.stack)

  return (
    <nav aria-label="Sub-workflow navigation" className="flex items-center gap-1 text-sm text-white/80">
      <button
        type="button"
        className="hover:text-white transition-colors"
        onClick={onJumpToRoot}
      >
        {rootLabel}
      </button>
      {stack.map((frame, i) => (
        <span key={frame.workflowId} className="flex items-center gap-1">
          <ChevronRight className="w-3.5 h-3.5 text-white/40" />
          <button
            type="button"
            className={
              i === stack.length - 1
                ? "text-white font-medium"
                : "hover:text-white transition-colors"
            }
            onClick={() => onJumpTo(frame.workflowId)}
            aria-current={i === stack.length - 1 ? "page" : undefined}
          >
            {frame.workflowName}
          </button>
        </span>
      ))}
    </nav>
  )
}
